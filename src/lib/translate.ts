import type { AiProviderConfig } from "./ai-provider-fallback.ts";
import { deepSeekChatOptions, getDeepSeekProviderCandidates } from "./deepseek-provider.ts";
import {
  isUsefulTranslation,
  shouldTranslateText,
} from "./translation-quality.ts";

export { isUsefulTranslation, shouldTranslateText } from "./translation-quality.ts";

export type TranslationNote = {
  provider: "deepseek" | "google-web" | "mymemory" | "minimax" | "985monitor";
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
};

const translationCache = new Map<string, TranslationNote | null>();
const inFlightTranslations = new Map<string, Promise<TranslationNote | null>>();

function positiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function cleanTranslationText(text: string): string {
  let cleaned = text
    .trim()
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/&lt;think&gt;[\s\S]*?(?:&lt;\/think&gt;|$)/gi, "")
    .trim();

  const finalMarker = cleaned.match(
    /(?:最终翻译|最终译文|翻译结果|翻译|译文|translation|final translation)\s*[:：]\s*([\s\S]+)$/i,
  );
  if (finalMarker?.[1]) {
    cleaned = finalMarker[1].trim();
  }
  const modernFinalMarker = cleaned.match(
    /(?:最终翻译|最终译文|翻译结果|译文|translation|final translation)\s*[:：]\s*([\s\S]+)$/i,
  );
  if (modernFinalMarker?.[1]) {
    cleaned = modernFinalMarker[1].trim();
  }

  return cleaned
    .replace(/^```(?:\w+)?/i, "")
    .replace(/```$/i, "")
    .trim()
    .replace(/^[“”"']+|[“”"']+$/g, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

async function translateWithDeepSeek(
  text: string,
  targetLanguage: string,
  provider: AiProviderConfig,
): Promise<TranslationNote | null> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      ...deepSeekChatOptions(),
      messages: [
        {
          role: "system",
          content:
            "You translate financial market posts into Simplified Chinese. Translate the entire input faithfully, including every sentence and line break. Do not summarize, shorten, omit, explain, or add commentary. Preserve @handles, tickers, company names, numbers, percentages, emojis, and URLs. Return only the translation.",
        },
        {
          role: "user",
          content: `Translate to ${targetLanguage}:\n\n${text}`,
        },
      ],
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(
      positiveInt(process.env.AI_TRANSLATION_TIMEOUT_MS, 45_000),
    ),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined;
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : `DeepSeek translation HTTP ${response.status}`,
    );
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const translated = cleanTranslationText(
    typeof message?.content === "string" ? message.content.trim() : "",
  );
  const note: TranslationNote = {
    provider: "deepseek",
    sourceLanguage: "auto",
    targetLanguage,
    text: translated,
  };

  if (!isUsefulTranslation(text, note)) {
    return null;
  }

  return note;
}

async function translateWithProviders(
  text: string,
  targetLanguage: string,
): Promise<TranslationNote | null> {
  const providers = getDeepSeekProviderCandidates(process.env, {
    model: process.env.AI_TRANSLATION_MODEL,
  });

  for (const provider of providers) {
    try {
      const result = await translateWithDeepSeek(text, targetLanguage, provider);
      if (result) {
        return result;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function getTranslationProviderNames() {
  return getDeepSeekProviderCandidates(process.env).length > 0 ? ["deepseek"] : [];
}

export async function translateText(
  text: string,
  options?: {
    enabled?: boolean;
    targetLanguage?: string;
    cacheNamespace?: string;
  },
): Promise<TranslationNote | null> {
  if (options?.enabled === false || !shouldTranslateText(text)) {
    return null;
  }

  const targetLanguage = options?.targetLanguage?.trim() || "zh-CN";
  const cacheNamespace = options?.cacheNamespace?.trim() || "default";
  const cacheKey = `${cacheNamespace}:${targetLanguage}:${text}`;
  const cached = translationCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const inFlight = inFlightTranslations.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async (): Promise<TranslationNote | null> => {
    try {
      const result = await translateWithProviders(text, targetLanguage);
      translationCache.set(cacheKey, result);
      return result;
    } catch {
      translationCache.delete(cacheKey);
      return null;
    }
  })();

  inFlightTranslations.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlightTranslations.delete(cacheKey);
  }
}
