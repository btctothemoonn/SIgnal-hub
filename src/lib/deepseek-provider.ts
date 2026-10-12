import type { AiProviderConfig } from "./ai-provider-fallback.ts";

type EnvLike = Record<string, string | undefined>;
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export function isOfficialDeepSeekBaseUrl(value: string) {
  try {
    if (value.includes("?") || value.includes("#")) return false;
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "api.deepseek.com" &&
      !url.port && !url.username && !url.password && !url.search && !url.hash &&
      ["", "/v1"].includes(url.pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}

export function getDeepSeekModel(env: EnvLike = process.env, preferredModel?: string, sourceModel?: string) {
  return [preferredModel, env.DEEPSEEK_MODEL, sourceModel, env.AI_SUMMARY_MODEL]
    .map(value => value?.trim())
    .find(value => value && /^deepseek-[a-zA-Z0-9._-]+$/.test(value)) ?? DEFAULT_DEEPSEEK_MODEL;
}

export function getDeepSeekBaseUrl(env: EnvLike = process.env) {
  const value = env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL;
  return isOfficialDeepSeekBaseUrl(value) ? value.replace(/\/+$/, "") : DEFAULT_DEEPSEEK_BASE_URL;
}

export function getDeepSeekProviderCandidates(
  env: EnvLike = process.env,
  options: { model?: string } = {},
): AiProviderConfig[] {
  // A legacy key is eligible only when its own configuration identifies DeepSeek.
  // Never infer that a MiniMax/OpenAI key can authenticate to another provider.
  const sources = [
    { key: env.DEEPSEEK_API_KEY, base: env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL },
    { key: env.AI_SUMMARY_API_KEY, base: env.AI_SUMMARY_BASE_URL, model: env.AI_SUMMARY_MODEL },
    { key: env.AI_SUMMARY_FALLBACK_API_KEY, base: env.AI_SUMMARY_FALLBACK_BASE_URL, model: env.AI_SUMMARY_FALLBACK_MODEL },
    { key: env.AI_TRANSLATION_API_KEY, base: env.AI_TRANSLATION_BASE_URL, model: env.AI_TRANSLATION_MODEL },
    { key: env.OPENAI_API_KEY, base: env.OPENAI_BASE_URL, model: env.OPENAI_MODEL },
  ];
  const providers: AiProviderConfig[] = [];
  for (const source of sources) {
    const apiKey = source.key?.trim();
    const baseUrl = source.base?.trim().replace(/\/+$/, "") ?? "";
    if (!apiKey || !isOfficialDeepSeekBaseUrl(baseUrl) || providers.some(p => p.apiKey === apiKey)) continue;
    providers.push({
      // Separate credential circuits without putting any part of a key in the identifier.
      id: providers.length === 0 ? "deepseek" : `deepseek-fallback-${providers.length}`,
      apiKey,
      baseUrl,
      model: getDeepSeekModel(env, options.model, source.model),
    });
  }
  return providers;
}

export function deepSeekChatOptions(maxTokens = 16_384) {
  return { thinking: { type: "disabled" as const }, max_tokens: maxTokens };
}
