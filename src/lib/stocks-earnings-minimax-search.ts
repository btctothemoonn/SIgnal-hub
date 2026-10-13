import type { AlphaResearchStock } from "./alpha-research-pool.ts";
import type { StocksEarningsComparison } from "./stocks-earnings-comparison.ts";
import type { StocksEarningsSourceRef } from "./stocks-earnings-calendar.ts";
import type { StocksPublicEarningsCandidate } from "./stocks-earnings-public-sources.ts";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

type SearchHit = {
  title: string;
  link: string;
  snippet: string;
  date: string;
};

type CacheValue = {
  expiresAt: number;
  candidates: StocksPublicEarningsCandidate[];
  errors: string[];
};

const SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 55_000;
const MAX_HITS_PER_TARGET = 3;
const MAX_SNIPPET_CHARS = 1_800;
const memoryCache = new Map<string, CacheValue>();

export function clearMiniMaxEarningsSearchMemoryCacheForTests() {
  memoryCache.clear();
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

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseScaledNumber(value: string) {
  const normalized = value
    .trim()
    .replace(/,/g, "")
    .replace(/[−–—]/g, "-");
  const match = normalized.match(
    /\(?\s*[-+]?(?:US\$|\$)?\s*(\d+(?:\.\d+)?)\s*(K|M|B|T|thousand|million|billion|trillion|万|亿)?\s*\)?/i,
  );
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  const scale =
    {
      K: 1e3,
      THOUSAND: 1e3,
      M: 1e6,
      MILLION: 1e6,
      B: 1e9,
      BILLION: 1e9,
      T: 1e12,
      TRILLION: 1e12,
      万: 1e4,
      亿: 1e8,
    }[(match[2] ?? "").toUpperCase()] ?? 1;
  const negative = /^\s*\(/.test(normalized) || /-/.test(normalized);
  return magnitude * scale * (negative ? -1 : 1);
}

function getApiKey(env: EnvLike) {
  const candidates = [
    env.MINIMAX_WEB_SEARCH_API_KEY,
    env.MINIMAX_API_KEY,
    env.AI_SUMMARY_API_KEY,
  ];
  return candidates
    .map((value) => value?.trim() ?? "")
    .find((value) => value.startsWith("sk-cp-")) ?? "";
}

function getSearchHost(env: EnvLike) {
  const configured = env.MINIMAX_WEB_SEARCH_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "").replace(/\/v1$/, "");
  const summaryBase = env.AI_SUMMARY_BASE_URL?.trim() ?? "";
  if (/^https:\/\/api\.minimax(?:i)?\.com(?:\/|$)/i.test(summaryBase)) {
    return summaryBase.replace(/\/+$/, "").replace(/\/v1$/, "");
  }
  return "https://api.minimaxi.com";
}

function getTextBaseUrl(env: EnvLike, searchHost: string) {
  const configured = env.AI_SUMMARY_BASE_URL?.trim();
  if (configured && /^https:\/\/api\.minimax(?:i)?\.com(?:\/|$)/i.test(configured)) {
    return configured.replace(/\/+$/, "");
  }
  return `${searchHost}/v1`;
}

function positiveInt(value: string | undefined, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function getMiniMaxEarningsSearchTimeoutMs(env: EnvLike = process.env) {
  return positiveInt(
    env.STOCKS_EARNINGS_MINIMAX_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    60_000,
  );
}

function incompleteComparison(comparison: StocksEarningsComparison, now: Date) {
  const reportTime = comparison.reportDate
    ? Date.parse(`${comparison.reportDate}T23:59:59Z`)
    : Number.NaN;
  const reported = Number.isFinite(reportTime) && reportTime <= now.getTime();
  return (
    comparison.revenue.estimate === null ||
    comparison.netIncome.estimate === null ||
    (reported &&
      (comparison.revenue.actual === null || comparison.netIncome.actual === null))
  );
}

function targetComparisons(
  comparisons: StocksEarningsComparison[],
  now: Date,
  limit: number,
) {
  return comparisons
    .filter((comparison) => {
      if (!comparison.reportDate || !incompleteComparison(comparison, now)) return false;
      const reportTime = Date.parse(`${comparison.reportDate}T00:00:00Z`);
      if (!Number.isFinite(reportTime)) return false;
      const calendarYear = new Date(reportTime).getUTCFullYear();
      return calendarYear === now.getUTCFullYear();
    })
    .sort((left, right) => {
      const leftTime = Date.parse(`${left.reportDate}T00:00:00Z`);
      const rightTime = Date.parse(`${right.reportDate}T00:00:00Z`);
      return Math.abs(leftTime - now.getTime()) - Math.abs(rightTime - now.getTime());
    })
    .slice(0, limit);
}

function cacheKey(stock: AlphaResearchStock, now: Date) {
  return `${stock.ticker.trim().toUpperCase()}-${now.getUTCFullYear()}`;
}

function cachePath(cacheDir: string, key: string) {
  return `${cacheDir.replace(/[\\/]+$/, "")}/${key.replace(/[^A-Z0-9.-]/gi, "_")}.json`;
}

function defaultCacheDir(env: EnvLike) {
  const configured = env.SIGNAL_HUB_RUNTIME_DIR?.trim();
  const root = configured
    ? configured
    : env.VERCEL?.trim() || env.VERCEL_ENV?.trim()
      ? "/tmp/signal-hub"
      : `${process.cwd()}/.signal-hub`;
  return `${root.replace(/[\\/]+$/, "")}/stocks-earnings-minimax-search`;
}

function validCacheValue(value: unknown, nowMs: number): CacheValue | null {
  const record = asRecord(value);
  const expiresAt = numberValue(record.expiresAt);
  if (expiresAt === null || expiresAt <= nowMs || !Array.isArray(record.candidates)) {
    return null;
  }
  return {
    expiresAt,
    candidates: record.candidates as StocksPublicEarningsCandidate[],
    errors: asArray(record.errors).map(stringValue).filter(Boolean),
  };
}

async function readCache(filePath: string, key: string, nowMs: number) {
  const inMemory = memoryCache.get(key);
  if (inMemory && inMemory.expiresAt > nowMs) return inMemory;
  try {
    const { readFile } = await import("node:fs/promises");
    const cached = validCacheValue(JSON.parse(await readFile(filePath, "utf8")), nowMs);
    if (cached) memoryCache.set(key, cached);
    return cached;
  } catch {
    return null;
  }
}

async function writeCache(
  cacheDir: string,
  filePath: string,
  key: string,
  value: CacheValue,
) {
  const { mkdir, rename, writeFile } = await import("node:fs/promises");
  memoryCache.set(key, value);
  await mkdir(cacheDir, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), "utf8");
  await rename(temporaryPath, filePath);
}

function searchQuery(
  stock: AlphaResearchStock,
  target: StocksEarningsComparison,
  now: Date,
) {
  const reportTime = target.reportDate
    ? Date.parse(`${target.reportDate}T23:59:59Z`)
    : Number.NaN;
  const reported = Number.isFinite(reportTime) && reportTime <= now.getTime();
  return [
    stock.companyName,
    stock.ticker,
    `fiscal ${target.fiscalYear} ${target.quarter}`,
    reported
      ? "revenue actual consensus estimate net income actual consensus estimate"
      : "net income consensus estimate revenue consensus",
  ].join(" ");
}

async function requestSearch(input: {
  query: string;
  apiKey: string;
  searchHost: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
}) {
  const response = await input.fetchImpl(
    `${input.searchHost}/v1/coding_plan/search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "MM-API-Source": "Minimax-MCP",
      },
      body: JSON.stringify({ q: input.query }),
      signal: AbortSignal.timeout(input.timeoutMs),
    },
  );
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) throw new Error(`MiniMax search HTTP ${response.status}`);
  const baseResponse = asRecord(payload.base_resp);
  if (numberValue(baseResponse.status_code) !== 0) {
    throw new Error(
      `MiniMax search ${stringValue(baseResponse.status_msg) || "request failed"}`,
    );
  }
  return asArray(payload.organic)
    .map(asRecord)
    .map((item) => ({
      title: stringValue(item.title),
      link: stringValue(item.link),
      snippet: stringValue(item.snippet),
      date: stringValue(item.date),
    }))
    .filter((item) => /^https:\/\//i.test(item.link) && Boolean(item.snippet));
}

function searchHitScore(
  hit: SearchHit,
  target: StocksEarningsComparison,
  index: number,
) {
  const text = `${hit.title} ${hit.snippet}`.toLowerCase();
  const quarterTerms =
    {
      Q1: ["q1", "first quarter", "第一季度", "一季度"],
      Q2: ["q2", "second quarter", "第二季度", "二季度"],
      Q3: ["q3", "third quarter", "第三季度", "三季度"],
      Q4: ["q4", "fourth quarter", "第四季度", "四季度"],
    }[target.quarter] ?? [target.quarter.toLowerCase()];
  let score = -index * 0.01;
  if (text.includes(String(target.fiscalYear))) score += 8;
  if (quarterTerms.some((term) => text.includes(term))) score += 10;
  if (/revenue|sales|营收|收入/.test(text)) score += 4;
  if (/net income|net profit|净利润|净利/.test(text)) score += 4;
  if (/consensus|estimate|expected|预期|共识/.test(text)) score += 5;
  if (/actual|reported|公布|实际|财报/.test(text)) score += 2;
  if (/\$?\d+(?:\.\d+)?\s*(?:million|billion|m|b|百万|亿)/i.test(text)) {
    score += 3;
  }
  return score;
}

function selectSearchHits(
  hits: SearchHit[],
  target: StocksEarningsComparison,
) {
  return hits
    .map((hit, index) => ({ hit, score: searchHitScore(hit, target, index) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_HITS_PER_TARGET)
    .map(({ hit }) => ({
      ...hit,
      snippet: hit.snippet.slice(0, MAX_SNIPPET_CHARS),
    }));
}

type SourcedNumber = {
  value: number;
  source: StocksEarningsSourceRef;
};

const ALL_QUARTERS_RE =
  /\bq[1-4]\b|first quarter|second quarter|third quarter|fourth quarter|第?[一二三四]季度|[一二三四]季/gi;
const SCALED_NUMBER_RE =
  /\(?\s*[-+]?(?:US\$|\$)?\s*\d[\d,]*(?:\.\d+)?\s*(?:thousand|million|billion|trillion|[KMBT]|万|亿)\s*(?:美元)?\s*\)?/gi;

function quarterTerms(quarter: string) {
  return (
    {
      Q1: ["q1", "first quarter", "第一季度", "一季度", "一季"],
      Q2: ["q2", "second quarter", "第二季度", "二季度", "二季"],
      Q3: ["q3", "third quarter", "第三季度", "三季度", "三季"],
      Q4: ["q4", "fourth quarter", "第四季度", "四季度", "四季"],
    }[quarter] ?? [quarter.toLowerCase()]
  );
}

function targetText(hit: SearchHit, target: StocksEarningsComparison) {
  const text = `${hit.title}. ${hit.snippet}`;
  const matches = [...text.matchAll(ALL_QUARTERS_RE)];
  const targetTerms = quarterTerms(target.quarter);
  const windows = matches.flatMap((match, index) => {
    if (!targetTerms.includes(match[0].toLowerCase())) return [];
    const start = match.index ?? 0;
    const next = matches[index + 1]?.index ?? text.length;
    return [text.slice(start, Math.min(next, start + MAX_SNIPPET_CHARS))];
  });
  if (windows.length === 0) return matches.length > 0 ? "" : text;
  return windows.join(" ");
}

function metricSection(
  text: string,
  metric: RegExp,
  stopAt?: RegExp,
) {
  const flags = `${metric.flags.replace(/g/g, "")}g`;
  const amount = new RegExp(SCALED_NUMBER_RE.source, "i");
  return [...text.matchAll(new RegExp(metric.source, flags))]
    .flatMap((match) => {
      const start = match.index ?? 0;
      let section = text.slice(start, start + 600);
      if (stopAt) {
        const remainder = section.slice(match[0].length);
        const stop = remainder.search(stopAt);
        if (stop >= 0) section = section.slice(0, match[0].length + stop);
      }
      const amountIndex = section.search(amount);
      return amountIndex >= 0 ? [{ section, amountIndex }] : [];
    })
    .sort((left, right) => left.amountIndex - right.amountIndex)[0]?.section ?? "";
}

function metricValues(
  section: string,
  reported: boolean,
  hit: SearchHit,
  fetchedAt: string,
) {
  const matches = [...section.matchAll(SCALED_NUMBER_RE)].flatMap((match) => {
    const value = parseScaledNumber(match[0]);
    return value === null
      ? []
      : [{ value, raw: match[0], index: match.index ?? 0 }];
  });
  if (matches.length === 0) return { estimate: null, actual: null };
  const estimateMarker = /consensus|estimate|expected|forecast|预期|共识|预测/i;
  const actualMarker = /actual|reported|公布|实际/i;
  const classified = matches.map((match, index) => {
    const previousEnd =
      index === 0
        ? 0
        : matches[index - 1].index + matches[index - 1].raw.length;
    const context = section.slice(previousEnd, match.index + match.raw.length);
    return {
      ...match,
      estimate: estimateMarker.test(context),
      actual: actualMarker.test(context),
    };
  });
  const source: StocksEarningsSourceRef = {
    provider: "minimax-web",
    url: hit.link,
    fetchedAt,
    confidence: "public-page",
  };
  const sourced = (item: (typeof classified)[number] | undefined): SourcedNumber | null =>
    item ? { value: item.value, source } : null;
  const explicitEstimate = classified.find((item) => item.estimate);
  if (!reported) {
    return { estimate: sourced(explicitEstimate ?? classified[0]), actual: null };
  }
  const explicitActual = classified.find((item) => item.actual);
  const estimate = explicitEstimate ?? (classified.length > 1 ? classified[0] : undefined);
  const actual =
    explicitActual ?? classified.find((item) => item !== estimate && !item.estimate);
  return { estimate: sourced(estimate), actual: sourced(actual) };
}

function deterministicCandidate(input: {
  stock: AlphaResearchStock;
  target: StocksEarningsComparison;
  hits: SearchHit[];
  now: Date;
}) {
  const reportTime = input.target.reportDate
    ? Date.parse(`${input.target.reportDate}T23:59:59Z`)
    : Number.NaN;
  const reported = Number.isFinite(reportTime) && reportTime <= input.now.getTime();
  const fetchedAt = input.now.toISOString();
  let revenueEstimate: SourcedNumber | null = null;
  let revenueActual: SourcedNumber | null = null;
  let netIncomeEstimate: SourcedNumber | null = null;
  let netIncomeActual: SourcedNumber | null = null;
  for (const hit of input.hits) {
    const text = targetText(hit, input.target);
    const revenue = metricValues(
      metricSection(text, /revenue|sales|营收|营业收入|收入/i, /net income|net profit|净利润|净利/i),
      reported,
      hit,
      fetchedAt,
    );
    const netIncome = metricValues(
      metricSection(
        text,
        /net income|net profit|净利润|净利/i,
        /revenue|sales|营收|营业收入|收入/i,
      ),
      reported,
      hit,
      fetchedAt,
    );
    revenueEstimate ??= revenue.estimate;
    revenueActual ??= revenue.actual;
    netIncomeEstimate ??= netIncome.estimate;
    netIncomeActual ??= netIncome.actual;
  }
  if (!revenueEstimate && !revenueActual && !netIncomeEstimate && !netIncomeActual) {
    return null;
  }
  const candidate: StocksPublicEarningsCandidate = {
    ticker: input.stock.ticker.trim().toUpperCase(),
    fiscalYear: input.target.fiscalYear,
    quarter: input.target.quarter,
    fiscalDateEnding: input.target.fiscalDateEnding,
    reportDate: input.target.reportDate ?? "",
    reportTiming: input.target.reportTiming,
    currency: input.target.currency,
    revenueEstimate: revenueEstimate?.value ?? null,
    revenueActual: revenueActual?.value ?? null,
    epsEstimate: null,
    epsActual: null,
    dilutedShares: null,
    netIncomeEstimate: netIncomeEstimate?.value ?? null,
    netIncomeActual: netIncomeActual?.value ?? null,
    companyGuidance: null,
    fieldSources: {
      ...(revenueEstimate ? { revenueEstimate: revenueEstimate.source } : {}),
      ...(revenueActual ? { revenueActual: revenueActual.source } : {}),
      ...(netIncomeEstimate
        ? { netIncomeEstimate: netIncomeEstimate.source }
        : {}),
      ...(netIncomeActual ? { netIncomeActual: netIncomeActual.source } : {}),
    },
  };
  return candidate;
}

function parseCompletionContent(payload: JsonRecord) {
  const choice = asRecord(asArray(payload.choices)[0]);
  const message = asRecord(choice.message);
  const content = stringValue(message.content)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/&lt;think&gt;[\s\S]*?&lt;\/think&gt;/gi, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!content) throw new Error("MiniMax earnings extraction returned empty content");
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");
  const json =
    jsonStart >= 0 && jsonEnd > jsonStart
      ? content.slice(jsonStart, jsonEnd + 1)
      : content;
  return asRecord(JSON.parse(json));
}

async function requestExtraction(input: {
  stock: AlphaResearchStock;
  targets: StocksEarningsComparison[];
  hits: SearchHit[];
  apiKey: string;
  textBaseUrl: string;
  model: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
}) {
  const prompt = [
    "Extract earnings values only from the supplied web search result titles and snippets.",
    "Return JSON only: {\"periods\":[{\"fiscalYear\":number,\"quarter\":\"Q1|Q2|Q3|Q4\",\"reportDate\":\"YYYY-MM-DD|null\",\"currency\":\"USD\",\"revenueEstimate\":Field|null,\"revenueActual\":Field|null,\"netIncomeEstimate\":Field|null,\"netIncomeActual\":Field|null}]}",
    "Field is {\"value\": raw numeric value, \"sourceValue\": exact scaled text such as '$93.63 billion', \"sourceUrl\": exact link from SEARCH_RESULTS}.",
    "Use null unless the snippet explicitly states the metric, period and whether it is consensus/estimate or actual/reported. Never calculate net income from EPS and never use prior model knowledge.",
    `COMPANY=${input.stock.companyName} (${input.stock.ticker})`,
    `TARGETS=${JSON.stringify(input.targets.map((item) => ({ fiscalYear: item.fiscalYear, quarter: item.quarter, reportDate: item.reportDate, currency: item.currency })))}`,
    `SEARCH_RESULTS=${JSON.stringify(input.hits)}`,
  ].join("\n");
  const response = await input.fetchImpl(`${input.textBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        {
          role: "system",
          content: "You extract cited financial values and return strict JSON without guessing.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) throw new Error(`MiniMax extraction HTTP ${response.status}`);
  return parseCompletionContent(payload);
}

function validatedField(
  value: unknown,
  hitTextByUrl: Map<string, string>,
  fetchedAt: string,
) {
  const record = asRecord(value);
  const numeric = numberValue(record.value);
  const sourceValue = stringValue(record.sourceValue);
  const sourceUrl = stringValue(record.sourceUrl);
  const parsedSourceValue = parseScaledNumber(sourceValue);
  const sourceText = hitTextByUrl.get(sourceUrl)?.toLowerCase() ?? "";
  if (
    numeric === null ||
    parsedSourceValue === null ||
    !sourceText.includes(sourceValue.toLowerCase()) ||
    Math.abs(numeric) > 1e15 ||
    Math.abs(numeric - parsedSourceValue) > Math.max(1, Math.abs(numeric) * 0.01)
  ) {
    return null;
  }
  const source: StocksEarningsSourceRef = {
    provider: "minimax-web",
    url: sourceUrl,
    fetchedAt,
    confidence: "public-page",
  };
  return { value: numeric, source };
}

function candidatesFromExtraction(input: {
  payload: JsonRecord;
  stock: AlphaResearchStock;
  targets: StocksEarningsComparison[];
  hits: SearchHit[];
  now: Date;
}) {
  const hitTextByUrl = new Map(
    input.hits.map((hit) => [hit.link, `${hit.title} ${hit.snippet}`]),
  );
  const fetchedAt = input.now.toISOString();
  return asArray(input.payload.periods).flatMap((rawPeriod) => {
    const period = asRecord(rawPeriod);
    const fiscalYear = numberValue(period.fiscalYear);
    const quarter = stringValue(period.quarter).toUpperCase();
    const target = input.targets.find(
      (item) => item.fiscalYear === fiscalYear && item.quarter === quarter,
    );
    if (!target || stringValue(period.currency).toUpperCase() !== target.currency) {
      return [];
    }
    const reported = target.reportDate
      ? Date.parse(`${target.reportDate}T23:59:59Z`) <= input.now.getTime()
      : false;
    const revenueEstimate = validatedField(
      period.revenueEstimate,
      hitTextByUrl,
      fetchedAt,
    );
    const revenueActual = reported
      ? validatedField(period.revenueActual, hitTextByUrl, fetchedAt)
      : null;
    const netIncomeEstimate = validatedField(
      period.netIncomeEstimate,
      hitTextByUrl,
      fetchedAt,
    );
    const netIncomeActual = reported
      ? validatedField(period.netIncomeActual, hitTextByUrl, fetchedAt)
      : null;
    if (!revenueEstimate && !revenueActual && !netIncomeEstimate && !netIncomeActual) {
      return [];
    }
    const candidate: StocksPublicEarningsCandidate = {
      ticker: input.stock.ticker.trim().toUpperCase(),
      fiscalYear: target.fiscalYear,
      quarter: target.quarter,
      fiscalDateEnding: target.fiscalDateEnding,
      reportDate: target.reportDate ?? "",
      reportTiming: target.reportTiming,
      currency: target.currency,
      revenueEstimate: revenueEstimate?.value ?? null,
      revenueActual: revenueActual?.value ?? null,
      epsEstimate: null,
      epsActual: null,
      dilutedShares: null,
      netIncomeEstimate: netIncomeEstimate?.value ?? null,
      netIncomeActual: netIncomeActual?.value ?? null,
      companyGuidance: null,
      fieldSources: {
        ...(revenueEstimate ? { revenueEstimate: revenueEstimate.source } : {}),
        ...(revenueActual ? { revenueActual: revenueActual.source } : {}),
        ...(netIncomeEstimate
          ? { netIncomeEstimate: netIncomeEstimate.source }
          : {}),
        ...(netIncomeActual ? { netIncomeActual: netIncomeActual.source } : {}),
      },
    };
    return [candidate];
  });
}

export async function fetchMiniMaxEarningsCandidates({
  stock,
  comparisons,
  now,
  fetchImpl = fetch,
  env = process.env,
  cacheDir = defaultCacheDir(env),
}: {
  stock: AlphaResearchStock;
  comparisons: StocksEarningsComparison[];
  now: Date;
  fetchImpl?: FetchLike;
  env?: EnvLike;
  cacheDir?: string;
}): Promise<{ candidates: StocksPublicEarningsCandidate[]; errors: string[] }> {
  if (env.STOCKS_EARNINGS_MINIMAX_WEB_ENABLED?.trim().toLowerCase() === "false") {
    return { candidates: [], errors: [] };
  }
  const apiKey = getApiKey(env);
  if (!apiKey) return { candidates: [], errors: [] };

  const targets = targetComparisons(
    comparisons,
    now,
    positiveInt(env.STOCKS_EARNINGS_MINIMAX_MAX_QUERIES, 2, 4),
  );
  if (targets.length === 0) return { candidates: [], errors: [] };

  const key = cacheKey(stock, now);
  const filePath = cachePath(cacheDir, key);
  const cached = await readCache(filePath, key, now.getTime());
  if (cached) return { candidates: cached.candidates, errors: cached.errors };

  const timeoutMs = getMiniMaxEarningsSearchTimeoutMs(env);
  const searchHost = getSearchHost(env);
  const errors: string[] = [];
  const hits: SearchHit[] = [];
  const deterministicCandidates: StocksPublicEarningsCandidate[] = [];
  for (const target of targets) {
    try {
      const selectedHits = selectSearchHits(
        await requestSearch({
          query: searchQuery(stock, target, now),
          apiKey,
          searchHost,
          fetchImpl,
          timeoutMs,
        }),
        target,
      );
      hits.push(...selectedHits);
      const candidate = deterministicCandidate({
        stock,
        target,
        hits: selectedHits,
        now,
      });
      if (candidate) deterministicCandidates.push(candidate);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "MiniMax search failed");
    }
  }

  const uniqueHits = [
    ...new Map(hits.map((hit) => [hit.link, hit] as const)).values(),
  ];
  let candidates = deterministicCandidates;
  if (candidates.length === 0 && uniqueHits.length > 0) {
    try {
      const extraction = await requestExtraction({
        stock,
        targets,
        hits: uniqueHits,
        apiKey,
        textBaseUrl: getTextBaseUrl(env, searchHost),
        model: env.AI_SUMMARY_MODEL?.trim() || "MiniMax-M2.7",
        fetchImpl,
        timeoutMs,
      });
      candidates = candidatesFromExtraction({
        payload: extraction,
        stock,
        targets,
        hits: uniqueHits,
        now,
      });
      if (candidates.length === 0) {
        errors.push("MiniMax search returned no usable sourced values");
      }
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "MiniMax earnings extraction failed",
      );
    }
  } else if (uniqueHits.length === 0 && errors.length === 0) {
    errors.push("MiniMax search returned no results");
  }

  const value: CacheValue = {
    expiresAt:
      now.getTime() +
      (candidates.length > 0 ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
    candidates,
    errors,
  };
  await writeCache(cacheDir, filePath, key, value);
  return { candidates, errors };
}
