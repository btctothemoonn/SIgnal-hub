import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { recordAiProviderAttempt } from "./ai-usage.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";
import {
  isUsefulTranslation,
  shouldTranslateText,
} from "./translation-quality.ts";

export { isUsefulTranslation, shouldTranslateText } from "./translation-quality.ts";

export type TranslationNote = {
  provider: "google-web" | "mymemory" | "minimax" | "985monitor";
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
};

const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";
const DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/v1";

const translationCache = new Map<string, { result: TranslationNote | null; expiresAt: number }>();
const inFlightTranslations = new Map<string, Promise<TranslationNote | null>>();

function translationCooldown(key: string, until?: number) {
  const path = getRuntimeDataPath(process.env, "translation-cooldown.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = 1000;
      CREATE TABLE IF NOT EXISTS cooldown (key TEXT PRIMARY KEY, until_ms INTEGER NOT NULL)`);
    if (until !== undefined) {
      db.prepare(`INSERT INTO cooldown VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET until_ms = max(until_ms, excluded.until_ms)`).run(key, until);
    }
    return Number(db.prepare("SELECT until_ms FROM cooldown WHERE key = ?").get(key)?.until_ms ?? 0);
  } finally {
    db.close();
  }
}

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

function getMiniMaxTranslationBaseUrl() {
  const explicit = process.env.AI_TRANSLATION_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (!allowSummaryKeyForTranslation()) return DEFAULT_MINIMAX_BASE_URL;
  return (
    process.env.AI_SUMMARY_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    DEFAULT_MINIMAX_BASE_URL
  ).replace(/\/+$/, "");
}

function allowSummaryKeyForTranslation() {
  return process.env.AI_TRANSLATION_ALLOW_SUMMARY_KEY?.trim().toLowerCase() === "true";
}

function getMiniMaxTranslationApiKey() {
  const explicit =
    process.env.AI_TRANSLATION_API_KEY?.trim() ||
    process.env.MINIMAX_API_KEY?.trim() ||
    "";
  if (explicit) return explicit;
  if (!allowSummaryKeyForTranslation()) return "";
  return (
    process.env.AI_SUMMARY_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

function getMiniMaxTranslationModel() {
  const explicit = process.env.AI_TRANSLATION_MODEL?.trim();
  if (explicit) return explicit;
  if (!allowSummaryKeyForTranslation()) return DEFAULT_MINIMAX_MODEL;
  return (
    process.env.AI_SUMMARY_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    DEFAULT_MINIMAX_MODEL
  );
}

async function translateWithMiniMax(
  text: string,
  targetLanguage: string,
): Promise<TranslationNote | null> {
  const apiKey = getMiniMaxTranslationApiKey();
  if (!apiKey) return null;
  const baseUrl = getMiniMaxTranslationBaseUrl();
  const model = getMiniMaxTranslationModel();
  const cooldownKey = createHash("sha256").update(JSON.stringify([baseUrl, apiKey])).digest("hex");
  if (translationCooldown(cooldownKey) > Date.now()) return null;
  let ok = false;
  let failure = "network";
  try {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
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
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(
      positiveInt(process.env.AI_TRANSLATION_TIMEOUT_MS, 45_000),
    ),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const error = payload.error as Record<string, unknown> | undefined;
  const base = payload.base_resp as Record<string, unknown> | undefined;
  const code = String(base?.status_code ?? error?.code ?? "");
  const messageText = [base?.status_msg, error?.message, error?.type, code].join(" ");
  if (!response.ok || error || (base?.status_code != null && code !== "0")) {
    const quota = response.status === 402 ||
      /insufficient[_ ](?:quota|balance|credits)|(?:quota|usage limit|token limit).{0,32}(?:exhausted|exceeded|reached)|(?:额度|余额).{0,12}(?:不足|用尽|超限)/i.test(messageText);
    const rateLimit = response.status === 429 || /rate[_ ]limit|too many requests/i.test(messageText);
    failure = quota ? "quota" : rateLimit ? "rate_limit" :
      [401, 403].includes(response.status) ? "auth" :
      response.status >= 500 ? "upstream" : "provider_error";
    if (quota || rateLimit) {
      const retryAfter = response.headers.get("retry-after");
      const delay = retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
      translationCooldown(cooldownKey, Date.now() + Math.max(quota ? 30 * 60_000 : 60_000, delay || 0));
    }
    return null;
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const translated = cleanTranslationText(
    typeof message?.content === "string" ? message.content.trim() : "",
  );
  const note: TranslationNote = {
    provider: "minimax",
    sourceLanguage: "auto",
    targetLanguage,
    text: translated,
  };

  if (!isUsefulTranslation(text, note)) {
    failure = "unusable_output";
    return null;
  }

  ok = true;
  return note;
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) failure = "timeout";
    return null;
  } finally {
    if (!ok) console.warn(JSON.stringify({ event: "minimax_translation_failure", model, failure }));
    try {
      recordAiProviderAttempt({ providerId: "minimax", model, ok });
    } catch {
      // Usage metrics must not change translation.
    }
  }
}

export function getTranslationProviderNames() {
  return ["minimax"];
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

  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const inFlight = inFlightTranslations.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async (): Promise<TranslationNote | null> => {
    try {
      const result = await translateWithMiniMax(text, targetLanguage).catch(() => null);
      translationCache.delete(cacheKey);
      translationCache.set(cacheKey, { result, expiresAt: result ? Infinity : Date.now() + 5 * 60_000 });
      if (translationCache.size > 5000) {
        const oldest = translationCache.keys().next().value;
        if (oldest !== undefined) translationCache.delete(oldest);
      }
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
