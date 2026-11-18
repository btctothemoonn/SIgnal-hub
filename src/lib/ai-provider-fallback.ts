export type AiProviderConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

import { recordAiProviderAttempt } from "./ai-usage.ts";

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
  return /usage limit exceeded|weekly usage limit reached|quota exceeded|insufficient (?:balance|credits?)|credit balance|额度|限额|用量上限|\((?:2056|2062)\)/i.test(
    errorMessage(error),
  );
}

export function getQuotaResetAt(
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

export class AiProvidersBlockedError extends Error {
  constructor() {
    super("All configured AI providers are temporarily blocked");
    this.name = "AiProvidersBlockedError";
  }
}

export function aiChatResponseError(payload: Record<string, unknown>, status: number, context: string) {
  const error = payload.error as Record<string, unknown> | string | undefined;
  const base = payload.base_resp as Record<string, unknown> | undefined;
  const code = base?.status_code ?? (typeof error === "object" ? error?.code : undefined);
  const message = base?.status_msg ?? (typeof error === "object" ? error?.message : error) ?? payload.message;
  const httpError = status < 200 || status >= 300;
  if (!httpError && !(base?.status_code != null && Number(base.status_code) !== 0) && !error) return null;
  return new Error([
    `${context} HTTP ${status}`,
    typeof message === "string" ? message.slice(0, 500) : "",
    typeof code === "number" || typeof code === "string" ? `(${String(code).slice(0, 32)})` : "",
  ].filter(Boolean).join(" "));
}

export async function runWithAiProviderFallback<T>({
  providers,
  request,
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
  shouldFallback = isQuotaExhaustedError,
}: {
  providers: AiProviderConfig[];
  request: (provider: AiProviderConfig) => Promise<T>;
  now?: Date | number;
  cooldownMs?: number;
  shouldFallback?: (error: unknown) => boolean;
}): Promise<{ value: T; provider: AiProviderConfig }> {
  const candidates = getAvailableAiProviders(providers, now);
  if (candidates.length === 0) {
    throw new AiProvidersBlockedError();
  }

  let lastError: unknown = new Error("No AI provider request was attempted");
  for (let index = 0; index < candidates.length; index += 1) {
    const provider = candidates[index];
    try {
      const value = await request(provider);
      try { recordAiProviderAttempt({ providerId: provider.id, model: provider.model, ok: true, atMs: asTimestamp(now) }); } catch { /* usage metrics must not affect generation */ }
      return { value, provider };
    } catch (error) {
      try { recordAiProviderAttempt({ providerId: provider.id, model: provider.model, ok: false, atMs: asTimestamp(now) }); } catch { /* usage metrics must not affect generation */ }
      lastError = error;
      if (!shouldFallback(error)) {
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
