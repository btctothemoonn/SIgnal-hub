import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { recordAiProviderAttempt } from "./ai-usage.ts";
import { getQuotaResetAt, isQuotaExhaustedError } from "./ai-provider-fallback.ts";
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

const DEFAULT_MINIMAX_MODEL = "MiniMax-M3";
const DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/v1";

const translationCache = new Map<string, { result: TranslationNote | null; expiresAt: number }>();
const inFlightTranslations = new Map<string, Promise<TranslationNote | null>>();

function withCooldownDb<T>(operate: (db: DatabaseSync) => T): T {
  const path = getRuntimeDataPath(process.env, "translation-cooldown.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = 1000;
      CREATE TABLE IF NOT EXISTS cooldown (key TEXT PRIMARY KEY, until_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS text_failure (key TEXT PRIMARY KEY, failures INTEGER NOT NULL,
        retry_at_ms INTEGER NOT NULL, last_failure TEXT NOT NULL, updated_ms INTEGER NOT NULL)`);
    return operate(db);
  } finally {
    db.close();
  }
}

function translationCooldown(key: string, until?: number) {
  return withCooldownDb((db) => {
    if (until !== undefined) {
      db.prepare(`INSERT INTO cooldown VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET until_ms = max(until_ms, excluded.until_ms)`).run(key, until);
    }
    return Number(db.prepare("SELECT until_ms FROM cooldown WHERE key = ?").get(key)?.until_ms ?? 0);
  });
}

// Failures caused by the text itself (the model cannot produce a usable
// translation) repeat on every retry. Back off per text, shared by every worker
// through the cooldown database, so a few hopeless texts cannot spend MiniMax
// quota every few minutes. Quota, rate-limit, auth and network failures are not
// about the text and keep using the provider-wide cooldown above.
const TEXT_FAILURE_BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];
const TEXT_FAILURES = new Set(["unusable_output", "truncated", "timeout"]);

function textFailureKey(text: string, targetLanguage: string) {
  return createHash("sha256").update(JSON.stringify([targetLanguage, text])).digest("hex");
}

/** Epoch ms before which `text` will not be sent to the provider again (0 = no backoff). */
export function getTranslationRetryAt(text: string, targetLanguage = "zh-CN"): number {
  try {
    return withCooldownDb((db) => Number(
      db.prepare("SELECT retry_at_ms FROM text_failure WHERE key = ?")
        .get(textFailureKey(text, targetLanguage.trim() || "zh-CN"))?.retry_at_ms ?? 0,
    ));
  } catch {
    return 0;
  }
}

export function isTranslationDeferred(text: string, targetLanguage = "zh-CN", now = Date.now()) {
  return getTranslationRetryAt(text, targetLanguage) > now;
}

function recordTextOutcome(key: string, failure: string | null) {
  try {
    withCooldownDb((db) => {
      if (!failure) {
        db.prepare("DELETE FROM text_failure WHERE key = ?").run(key);
        return;
      }
      const now = Date.now();
      const failures = Number(db.prepare("SELECT failures FROM text_failure WHERE key = ?").get(key)?.failures ?? 0) + 1;
      const delay = TEXT_FAILURE_BACKOFF_MS[Math.min(failures, TEXT_FAILURE_BACKOFF_MS.length) - 1];
      db.prepare(`INSERT INTO text_failure VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, retry_at_ms = excluded.retry_at_ms,
          last_failure = excluded.last_failure, updated_ms = excluded.updated_ms`)
        .run(key, failures, now + delay, failure, now);
    });
  } catch {
    // Backoff bookkeeping must not change translation.
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
      max_tokens: positiveInt(process.env.AI_TRANSLATION_MAX_TOKENS, 2048),
      // MiniMax-M3 reasons by default and can spend the whole token budget
      // thinking (finish_reason "length", no translation). Translation does not
      // need it: disabled, output is complete and ~15x cheaper.
      ...(/^minimax/i.test(model) && process.env.AI_TRANSLATION_THINKING?.trim().toLowerCase() !== "enabled"
        ? { thinking: { type: "disabled" } }
        : {}),
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
    const quota = response.status === 402 || isQuotaExhaustedError(messageText + (code ? " (" + code + ")" : "")) ||
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
      const now = Date.now();
      const until = quota ? getQuotaResetAt(messageText, now, 5 * 60_000) : now + 60_000;
      translationCooldown(cooldownKey, Math.max(until, now + (delay || 0)));
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

  if (first?.finish_reason === "length") {
    failure = "truncated";
    return null;
  }

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
    if (ok || TEXT_FAILURES.has(failure)) recordTextOutcome(textFailureKey(text, targetLanguage), ok ? null : failure);
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

  if (isTranslationDeferred(text, targetLanguage)) {
    return null;
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
