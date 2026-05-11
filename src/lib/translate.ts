import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
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

const translationCache = new Map<string, TranslationNote | null>();
const inFlightTranslations = new Map<string, Promise<TranslationNote | null>>();

function positiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function proxyAuthorization(proxyUrl: URL): string | undefined {
  if (!proxyUrl.username) {
    return undefined;
  }

  return `Basic ${Buffer.from(
    `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`,
  ).toString("base64")}`;
}

function getTranslationProxyUrl(): URL | null {
  const raw =
    process.env.TRANSLATION_PROXY_URL?.trim() ||
    process.env.TELEGRAM_PROXY_URL?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    "";
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed;
    }
    if (
      ["socks:", "socks4:", "socks5:", "socks5h:"].includes(parsed.protocol) &&
      parsed.hostname &&
      parsed.port
    ) {
      return new URL(
        `http://${parsed.username ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@` : ""}${parsed.hostname}:${parsed.port}`,
      );
    }
  } catch {}

  return null;
}

function readJsonResponse(
  response: IncomingMessage,
  resolve: (value: unknown) => void,
  reject: (reason?: unknown) => void,
) {
  const statusCode = response.statusCode ?? 0;
  const chunks: Buffer[] = [];

  response.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  response.on("end", () => {
    if (statusCode < 200 || statusCode >= 300) {
      reject(new Error(`Translation HTTP ${statusCode}`));
      return;
    }

    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
    } catch (error) {
      reject(error);
    }
  });
}

function requestJsonDirect(url: URL, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": "SignalHub/1.0",
        },
      },
      (response) => {
        readJsonResponse(response, resolve, reject);
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Translation request timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}

function requestJsonViaProxy(
  url: URL,
  proxyUrl: URL,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proxyAuth = proxyAuthorization(proxyUrl);
    const connectRequest = httpRequest({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port || 80),
      method: "CONNECT",
      path: `${url.hostname}:443`,
      headers: {
        Host: `${url.hostname}:443`,
        ...(proxyAuth ? { "Proxy-Authorization": proxyAuth } : {}),
      },
    });

    connectRequest.setTimeout(timeoutMs, () => {
      connectRequest.destroy(new Error("Translation proxy timeout"));
    });
    connectRequest.on("connect", (response, socket) => {
      if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
        socket.destroy();
        reject(new Error(`Translation proxy CONNECT ${response.statusCode ?? 0}`));
        return;
      }

      const tlsSocket = tlsConnect({
        socket,
        servername: url.hostname,
      });
      const request = httpsRequest(
        {
          host: url.hostname,
          servername: url.hostname,
          method: "GET",
          path: `${url.pathname}${url.search}`,
          createConnection: () => tlsSocket,
          headers: {
            "User-Agent": "SignalHub/1.0",
          },
        },
        (httpsResponse) => {
          readJsonResponse(httpsResponse, resolve, reject);
        },
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error("Translation request timeout"));
      });
      request.on("error", reject);
      request.end();
    });
    connectRequest.on("error", reject);
    connectRequest.end();
  });
}

function requestJson(url: URL, timeoutMs = 8000): Promise<unknown> {
  const proxyUrl = getTranslationProxyUrl();
  if (proxyUrl && url.protocol === "https:") {
    return requestJsonViaProxy(url, proxyUrl, timeoutMs).catch(() =>
      requestJsonDirect(url, timeoutMs),
    );
  }

  return requestJsonDirect(url, timeoutMs);
}

function guessSourceLanguage(text: string): string {
  if (/\p{Script=Cyrillic}/u.test(text)) return "ru";
  if (/\p{Script=Arabic}/u.test(text)) return "ar";
  if (/\p{Script=Greek}/u.test(text)) return "el";
  return "en";
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

  return cleaned
    .replace(/^```(?:\w+)?/i, "")
    .replace(/```$/i, "")
    .trim()
    .replace(/^[“”"']+|[“”"']+$/g, "")
    .trim();
}

async function translateWithGoogle(
  text: string,
  targetLanguage: string,
): Promise<TranslationNote | null> {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const payload = (await requestJson(url, 5000)) as unknown[];
  const segments = Array.isArray(payload[0]) ? (payload[0] as unknown[]) : [];
  const translated = cleanTranslationText(segments
    .map((segment) =>
      Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : "",
    )
    .join("")
    .trim());
  const sourceLanguage = typeof payload[2] === "string" ? payload[2] : "unknown";

  const note: TranslationNote = {
    provider: "google-web",
    sourceLanguage,
    targetLanguage,
    text: translated,
  };

  if (!isUsefulTranslation(text, note)) {
    return null;
  }

  return note;
}

async function translateWithMyMemory(
  text: string,
  targetLanguage: string,
): Promise<TranslationNote | null> {
  const sourceLanguage = guessSourceLanguage(text);
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", `${sourceLanguage}|${targetLanguage}`);

  const payload = (await requestJson(url, 10000)) as Record<string, unknown>;
  const responseData =
    payload.responseData &&
    typeof payload.responseData === "object" &&
    !Array.isArray(payload.responseData)
      ? (payload.responseData as Record<string, unknown>)
      : null;
  const translated = cleanTranslationText(
    typeof responseData?.translatedText === "string"
      ? responseData.translatedText.trim()
      : "",
  );

  const note: TranslationNote = {
    provider: "mymemory",
    sourceLanguage,
    targetLanguage,
    text: translated,
  };

  if (!isUsefulTranslation(text, note)) {
    return null;
  }

  return note;
}

function getMiniMaxTranslationBaseUrl() {
  return (
    process.env.AI_TRANSLATION_BASE_URL?.trim() ||
    process.env.AI_SUMMARY_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    DEFAULT_MINIMAX_BASE_URL
  ).replace(/\/+$/, "");
}

function getMiniMaxTranslationApiKey() {
  return (
    process.env.AI_TRANSLATION_API_KEY?.trim() ||
    process.env.MINIMAX_API_KEY?.trim() ||
    process.env.AI_SUMMARY_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

function getMiniMaxTranslationModel() {
  return (
    process.env.AI_TRANSLATION_MODEL?.trim() ||
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
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getMiniMaxTranslationModel(),
      messages: [
        {
          role: "system",
          content:
            "You translate financial market news into concise Simplified Chinese. Preserve tickers, company names, numbers, percentages, and URLs. Return only the translation.",
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
        : `MiniMax translation HTTP ${response.status}`,
    );
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
    return null;
  }

  return note;
}

async function translateWithProviders(
  text: string,
  targetLanguage: string,
): Promise<TranslationNote | null> {
  const defaultProviders = getMiniMaxTranslationApiKey()
    ? "minimax,google,mymemory"
    : "google,mymemory";
  const providers = (process.env.TRANSLATION_PROVIDERS || defaultProviders)
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);

  for (const provider of providers) {
    try {
      const result =
        provider === "minimax"
          ? await translateWithMiniMax(text, targetLanguage)
          : provider === "google"
          ? await translateWithGoogle(text, targetLanguage)
          : provider === "mymemory"
            ? await translateWithMyMemory(text, targetLanguage)
            : null;
      if (result) {
        return result;
      }
    } catch {
      continue;
    }
  }

  return null;
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
