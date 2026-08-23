import { getProviderApiKeys } from "./provider-api-keys.ts";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export type IndependentDailyBriefCandidate = {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: string;
  imageUrl: string | null;
  language: string | null;
  country: string | null;
};

const MINIMAX_NEWS_QUERIES = [
  "Reuters latest investment news AI semiconductors technology stocks earnings bitcoin markets",
  "AP News latest investment news Federal Reserve economy oil geopolitics China markets",
] as const;
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function isEnabled(raw: string | undefined, fallback = true) {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return fallback;
  return !FALSE_VALUES.has(normalized);
}

function positiveInt(raw: string | undefined, fallback: number, max: number) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeHttpUrl(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function clampText(value: unknown, maxChars: number) {
  const text = stringValue(value).replace(/\s+/g, " ");
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function xmlTag(block: string, tag: string) {
  const match = block.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? stripHtml(decodeXml(match[1])).trim() : "";
}

function publishedAt(value: unknown, now: Date) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  const parsed = Date.parse(stringValue(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : now.toISOString();
}

function isFresh(isoTime: string, now: Date, lookbackHours: number) {
  const time = Date.parse(isoTime);
  return (
    Number.isFinite(time) &&
    time >= now.getTime() - lookbackHours * 60 * 60 * 1000 &&
    time <= now.getTime() + 60 * 60 * 1000
  );
}

function miniMaxSearchApiKey(env: EnvLike) {
  return [
    env.MINIMAX_WEB_SEARCH_API_KEY,
    env.MINIMAX_API_KEY,
    env.AI_SUMMARY_API_KEY,
  ]
    .map((value) => value?.trim() ?? "")
    .find((value) => value.startsWith("sk-cp-")) ?? "";
}

function miniMaxSearchHost(env: EnvLike) {
  const configured = env.MINIMAX_WEB_SEARCH_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "").replace(/\/v1$/, "");
  const summaryBase = env.AI_SUMMARY_BASE_URL?.trim() ?? "";
  if (/^https:\/\/api\.minimax(?:i)?\.com(?:\/|$)/i.test(summaryBase)) {
    return summaryBase.replace(/\/+$/, "").replace(/\/v1$/, "");
  }
  return "https://api.minimaxi.com";
}

function sourceFromNewsUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "reuters.com" || hostname.endsWith(".reuters.com")) {
      return "Reuters";
    }
    if (hostname === "apnews.com" || hostname.endsWith(".apnews.com")) {
      return "AP News";
    }
  } catch {}
  return null;
}

function googleNewsRssUrl(domain: string) {
  const params = new URLSearchParams({
    q: `site:${domain} when:2d`,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

async function collectReutersApRssCandidates({
  now,
  env,
  fetchFn,
  lookbackHours,
  timeoutMs,
}: {
  now: Date;
  env: EnvLike;
  fetchFn: FetchLike;
  lookbackHours: number;
  timeoutMs: number;
}) {
  if (!isEnabled(env.DAILY_BRIEF_REUTERS_AP_RSS_ENABLED, true)) return [];
  const sources = [
    { domain: "reuters.com", source: "Reuters" },
    { domain: "apnews.com", source: "AP News" },
  ] as const;
  const groups = await Promise.all(
    sources.map(async ({ domain, source }) => {
      try {
        const response = await fetchFn(googleNewsRssUrl(domain), {
          cache: "no-store",
          headers: { "User-Agent": "SignalHubDailyBrief/1.0" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const xml = await response.text();
        return Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi))
          .map((match): IndependentDailyBriefCandidate | null => {
            const block = match[1];
            const articleSource = xmlTag(block, "source");
            if (articleSource.toLowerCase() !== source.toLowerCase()) return null;
            const url = safeHttpUrl(xmlTag(block, "link"));
            const rawTitle = xmlTag(block, "title");
            const title = clampText(
              rawTitle.replace(new RegExp(`\\s+-\\s+${source}$`, "i"), ""),
              220,
            );
            if (!url || !title) return null;
            const seenAt = publishedAt(xmlTag(block, "pubDate"), now);
            if (!isFresh(seenAt, now, lookbackHours)) return null;
            const description = clampText(xmlTag(block, "description"), 1_200);
            return {
              id: url,
              source,
              title,
              summary:
                description && description.toLowerCase() !== rawTitle.toLowerCase()
                  ? description
                  : null,
              url,
              publishedAt: seenAt,
              imageUrl: null,
              language: "English",
              country: null,
            };
          })
          .filter(
            (candidate): candidate is IndependentDailyBriefCandidate =>
              candidate !== null,
          );
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "daily_brief.source.failed",
            source: `${source} RSS`,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return [];
      }
    }),
  );
  return groups.flat();
}

async function collectMiniMaxCandidates({
  now,
  env,
  fetchFn,
  lookbackHours,
  timeoutMs,
}: {
  now: Date;
  env: EnvLike;
  fetchFn: FetchLike;
  lookbackHours: number;
  timeoutMs: number;
}) {
  const apiKey = miniMaxSearchApiKey(env);
  if (!apiKey || !isEnabled(env.DAILY_BRIEF_MINIMAX_SEARCH_ENABLED, true)) {
    return [];
  }

  const candidates: IndependentDailyBriefCandidate[] = [];
  for (const query of MINIMAX_NEWS_QUERIES) {
    try {
      const response = await fetchFn(
        `${miniMaxSearchHost(env)}/v1/coding_plan/search`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify({ q: query }),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const baseResponse = asRecord(payload.base_resp);
      if (Number(baseResponse.status_code ?? 0) !== 0) {
        throw new Error(stringValue(baseResponse.status_msg) || "request failed");
      }
      for (const rawHit of asArray(payload.organic)) {
        const hit = asRecord(rawHit);
        const url = safeHttpUrl(hit.link);
        const title = clampText(hit.title, 220);
        const source = url ? sourceFromNewsUrl(url) : null;
        if (!url || !title || !source) continue;
        const seenAt = publishedAt(hit.date, now);
        if (!isFresh(seenAt, now, lookbackHours)) continue;
        candidates.push({
          id: url,
          source,
          title,
          summary: clampText(hit.snippet, 1_200) || null,
          url,
          publishedAt: seenAt,
          imageUrl: null,
          language: null,
          country: null,
        });
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "daily_brief.source.failed",
          source: "MiniMax Search",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return candidates;
}

async function collectFmpCandidates({
  now,
  env,
  fetchFn,
  lookbackHours,
  timeoutMs,
}: {
  now: Date;
  env: EnvLike;
  fetchFn: FetchLike;
  lookbackHours: number;
  timeoutMs: number;
}) {
  const apiKey = getProviderApiKeys(env, [
    "STOCKS_FMP_API_KEYS",
    "STOCKS_FMP_API_KEY",
    "FMP_API_KEYS",
    "FMP_API_KEY",
  ])[0];
  if (!apiKey || !isEnabled(env.DAILY_BRIEF_FMP_ENABLED, true)) return [];
  const url = new URL(
    "https://financialmodelingprep.com/stable/news/general-latest",
  );
  url.searchParams.set("page", "0");
  url.searchParams.set("limit", String(positiveInt(env.DAILY_BRIEF_FMP_LIMIT, 40, 100)));
  url.searchParams.set("apikey", apiKey);
  try {
    const response = await fetchFn(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return asArray(await response.json())
      .map((raw): IndependentDailyBriefCandidate | null => {
        const item = asRecord(raw);
        const articleUrl = safeHttpUrl(item.url ?? item.link);
        const title = clampText(item.title, 220);
        if (!articleUrl || !title) return null;
        const seenAt = publishedAt(item.publishedDate ?? item.date, now);
        if (!isFresh(seenAt, now, lookbackHours)) return null;
        return {
          id: articleUrl,
          source: "FMP",
          title,
          summary: clampText(item.text ?? item.content, 1_200) || null,
          url: articleUrl,
          publishedAt: seenAt,
          imageUrl: safeHttpUrl(item.image),
          language: null,
          country: null,
        };
      })
      .filter(
        (candidate): candidate is IndependentDailyBriefCandidate =>
          candidate !== null,
      );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "daily_brief.source.failed",
        source: "FMP",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return [];
  }
}

async function collectFinnhubCandidates({
  now,
  env,
  fetchFn,
  lookbackHours,
  timeoutMs,
}: {
  now: Date;
  env: EnvLike;
  fetchFn: FetchLike;
  lookbackHours: number;
  timeoutMs: number;
}) {
  const apiKey = getProviderApiKeys(env, [
    "STOCKS_FINNHUB_API_KEYS",
    "STOCKS_FINNHUB_API_KEY",
    "FINNHUB_API_KEYS",
    "FINNHUB_API_KEY",
  ])[0];
  if (!apiKey || !isEnabled(env.DAILY_BRIEF_FINNHUB_ENABLED, true)) return [];
  const url = new URL("https://finnhub.io/api/v1/news");
  url.searchParams.set("category", "general");
  url.searchParams.set("minId", "0");
  url.searchParams.set("token", apiKey);
  try {
    const response = await fetchFn(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return asArray(await response.json())
      .map((raw): IndependentDailyBriefCandidate | null => {
        const item = asRecord(raw);
        const articleUrl = safeHttpUrl(item.url);
        const title = clampText(item.headline ?? item.title, 220);
        if (!articleUrl || !title) return null;
        const seenAt = publishedAt(item.datetime ?? item.date, now);
        if (!isFresh(seenAt, now, lookbackHours)) return null;
        return {
          id: articleUrl,
          source: "Finnhub",
          title,
          summary: clampText(item.summary, 1_200) || null,
          url: articleUrl,
          publishedAt: seenAt,
          imageUrl: safeHttpUrl(item.image),
          language: null,
          country: null,
        };
      })
      .filter(
        (candidate): candidate is IndependentDailyBriefCandidate =>
          candidate !== null,
      );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "daily_brief.source.failed",
        source: "Finnhub",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return [];
  }
}

export async function collectIndependentDailyBriefCandidates({
  now = new Date(),
  env = process.env,
  fetchFn = fetch,
}: {
  now?: Date;
  env?: EnvLike;
  fetchFn?: FetchLike;
} = {}) {
  const lookbackHours = positiveInt(env.DAILY_BRIEF_LOOKBACK_HOURS, 36, 168);
  const timeoutMs = positiveInt(env.DAILY_BRIEF_SOURCE_TIMEOUT_MS, 25_000, 60_000);
  const options = { now, env, fetchFn, lookbackHours, timeoutMs };
  const [rss, fmp, finnhub] = await Promise.all([
    collectReutersApRssCandidates(options),
    collectFmpCandidates(options),
    collectFinnhubCandidates(options),
  ]);
  const miniMax =
    rss.length > 0 ? [] : await collectMiniMaxCandidates(options);
  return [...rss, ...miniMax, ...fmp, ...finnhub];
}
