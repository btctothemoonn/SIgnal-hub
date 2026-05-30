export type AiProviderConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const blockedUntilByProvider = new Map<string, number>();

function providerKey(provider: AiProviderConfig) {
  return `${provider.id}:${provider.baseUrl}:${provider.model}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asTimestamp(now: Date | number) {
  return now instanceof Date ? now.getTime() : now;
}

export function isQuotaExhaustedError(error: unknown) {
  return /usage limit exceeded|weekly usage limit reached|quota exceeded|insufficient (?:balance|credits?)|credit balance|额度|限额/i.test(
    errorMessage(error),
  );
}

function getQuotaResetAt(
  error: unknown,
  now: Date | number,
  fallbackCooldownMs = DEFAULT_COOLDOWN_MS,
) {
  const timestamp = asTimestamp(now);
  const resetMatch = errorMessage(error).match(/resets?\s+at\s+([^\s()]+)/i);
  const parsedReset = resetMatch ? Date.parse(resetMatch[1]) : Number.NaN;
  return Number.isFinite(parsedReset) && parsedReset > timestamp
    ? parsedReset
    : timestamp + fallbackCooldownMs;
}

export function isAiProviderBlocked(
  provider: AiProviderConfig,
  now: Date | number = Date.now(),
) {
  return (blockedUntilByProvider.get(providerKey(provider)) ?? 0) > asTimestamp(now);
}

export function resetAiProviderCircuitBreakers() {
  blockedUntilByProvider.clear();
}

export function getAvailableAiProviders(
  providers: AiProviderConfig[],
  now: Date | number = Date.now(),
) {
  return providers.filter((provider) => !isAiProviderBlocked(provider, now));
}

export async function runWithAiProviderFallback<T>({
  providers,
  request,
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
}: {
  providers: AiProviderConfig[];
  request: (provider: AiProviderConfig) => Promise<T>;
  now?: Date | number;
  cooldownMs?: number;
}): Promise<{ value: T; provider: AiProviderConfig }> {
  const candidates = getAvailableAiProviders(providers, now);
  if (candidates.length === 0) {
    throw new Error("All configured AI providers are temporarily blocked");
  }

  let lastError: unknown = new Error("No AI provider request was attempted");
  for (let index = 0; index < candidates.length; index += 1) {
    const provider = candidates[index];
    try {
      return {
        value: await request(provider),
        provider,
      };
    } catch (error) {
      lastError = error;
      if (!isQuotaExhaustedError(error)) {
        throw error;
      }
      blockedUntilByProvider.set(
        providerKey(provider),
        getQuotaResetAt(error, now, cooldownMs),
      );
      if (index === candidates.length - 1) {
        throw error;
      }
    }
  }

  throw lastError;
}
