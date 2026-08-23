import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  getAlphaSummaryModel,
  getAlphaSummaryProviderCandidates,
  isMiniMaxBaseUrl,
} from "./alpha-summary.ts";
import {
  runWithAiProviderFallback,
  type AiProviderConfig,
} from "./ai-provider-fallback.ts";
import { collectIndependentDailyBriefCandidates } from "./daily-brief-independent-sources.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

type EnvLike = Record<string, string | undefined>;
type DbRow = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DAILY_BRIEF_TOPICS = [
  "AI / 科技产业链",
  "半导体 / 存储 / 海力士",
  "美股 / 韩股 / A股",
  "BTC / 加密货币",
  "宏观 / 地缘政治 / 原油",
] as const;

export type DailyBriefTopic = (typeof DAILY_BRIEF_TOPICS)[number];

export type DailyBriefPeriod = {
  key: string;
  dateKey: string;
  label: string;
  startAt: string;
  endAt: string;
  timeZone: string;
};

export type DailyBriefCandidate = {
  id: string;
  source: string;
  title: string;
  summary?: string | null;
  url: string;
  publishedAt: string;
  imageUrl: string | null;
  language: string | null;
  country: string | null;
};

export type DailyBriefItem = {
  rank: number;
  importance: "high" | "medium" | "low";
  title: string;
  topic: DailyBriefTopic | string;
  candidateIndexes?: number[];
  sourceNames: string[];
  sourceUrls: string[];
  imageUrl: string | null;
  whatHappened: string;
  investmentImpact: string;
  watchNext: string;
};

export type DailyBriefContent = {
  title: string;
  marketPulse: string;
  items: DailyBriefItem[];
  watchVariables: string[];
  priorityLine: string;
};

export type DailyBriefSnapshot = {
  success: boolean;
  status: "needs_key" | "empty" | "cached" | "generated" | "error";
  configured: boolean;
  period: DailyBriefPeriod;
  generatedAt: string | null;
  model: string;
  candidateCount: number;
  sourceCounts: Record<string, number>;
  brief: DailyBriefContent | null;
  error: string | null;
};

type DailyBriefRequestDeps = {
  collectCandidates?: (request: {
    now: Date;
    env: EnvLike;
  }) => Promise<DailyBriefCandidate[]>;
  requestBrief?: (request: {
    prompt: string;
    provider: AiProviderConfig;
    period: DailyBriefPeriod;
    candidates: DailyBriefCandidate[];
    env: EnvLike;
  }) => Promise<{ brief: DailyBriefContent; provider: AiProviderConfig }>;
};

const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_LOOKBACK_HOURS = 36;
const DEFAULT_GDELT_MAX_RECORDS = 60;
const DEFAULT_MAX_CANDIDATES = 80;
const DEFAULT_MAX_ITEMS = 10;
const DEFAULT_AI_TIMEOUT_MS = 120_000;
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

const DEFAULT_GDELT_QUERIES = [
  {
    source: "Reuters",
    query:
      'domain:reuters.com (Nvidia OR "artificial intelligence" OR AI OR "data center" OR semiconductor OR HBM OR "SK Hynix" OR Samsung OR Micron OR YMTC OR Alibaba OR Treasury OR yields OR Fed OR "Jackson Hole" OR bitcoin OR BTC OR crypto OR oil OR Iran OR Hormuz OR China OR robotics OR Unitree)',
  },
  {
    source: "AP News",
    query:
      'domain:apnews.com ("stock market" OR "Wall Street" OR "Federal Reserve" OR Treasury OR Nvidia OR AI OR semiconductor OR bitcoin OR crypto OR oil OR Iran OR China)',
  },
] as const;
const DEFAULT_ALLOWED_SOURCE_DOMAINS = ["reuters.com", "apnews.com"] as const;

function positiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isEnabled(raw: string | undefined, fallback = true) {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return fallback;
  return !FALSE_VALUES.has(normalized);
}

function csvValues(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeAllowedDomain(domain: string) {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function getAllowedDailyBriefDomains(env: EnvLike) {
  const configured = csvValues(env.DAILY_BRIEF_ALLOWED_DOMAINS)
    .map(normalizeAllowedDomain)
    .filter(Boolean);
  return configured.length > 0
    ? configured
    : [...DEFAULT_ALLOWED_SOURCE_DOMAINS];
}

function hostnameMatchesAllowedDomain(hostname: string, allowedDomain: string) {
  const normalizedHostname = normalizeAllowedDomain(hostname);
  const normalizedDomain = normalizeAllowedDomain(allowedDomain);
  return (
    normalizedHostname === normalizedDomain ||
    normalizedHostname.endsWith(`.${normalizedDomain}`)
  );
}

function isAllowedDailyBriefUrl(url: string, allowedDomains: string[]) {
  try {
    const hostname = new URL(url).hostname;
    return allowedDomains.some((domain) =>
      hostnameMatchesAllowedDomain(hostname, domain),
    );
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  const trimmed = stringValue(value).trim();
  return trimmed ? trimmed : null;
}

function stringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringValue(item).trim())
    .filter(Boolean)
    .slice(0, limit);
}

function countBySource(candidates: DailyBriefCandidate[]) {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.source] = (counts[candidate.source] ?? 0) + 1;
    return counts;
  }, {});
}

function clampText(value: unknown, maxChars: number) {
  const text = stringValue(value).replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
}

function getShanghaiParts(date: Date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateLabel(parts: ReturnType<typeof getShanghaiParts>) {
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日`;
}

export function getDailyBriefDbPath(env: EnvLike = process.env) {
  return (
    env.DAILY_BRIEF_DB?.trim() ||
    getRuntimeDataPath(env, "daily-investment-brief.sqlite")
  );
}

export function getDailyBriefPeriod({
  now = new Date(),
  env = process.env,
}: {
  now?: Date;
  env?: EnvLike;
} = {}): DailyBriefPeriod {
  const parts = getShanghaiParts(now);
  const dateKey = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  const lookbackHours = positiveInt(
    env.DAILY_BRIEF_LOOKBACK_HOURS,
    DEFAULT_LOOKBACK_HOURS,
  );

  return {
    key: dateKey,
    dateKey,
    label: formatDateLabel(parts),
    startAt: new Date(now.getTime() - lookbackHours * 60 * 60 * 1000).toISOString(),
    endAt: now.toISOString(),
    timeZone: env.DAILY_BRIEF_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE,
  };
}

export function isDailyBriefDue({
  now = new Date(),
  env = process.env,
}: {
  now?: Date;
  env?: EnvLike;
} = {}) {
  const parts = getShanghaiParts(now);
  const targetHour = positiveInt(env.DAILY_BRIEF_TARGET_HOUR, 8);
  const targetMinute = positiveInt(env.DAILY_BRIEF_TARGET_MINUTE, 0);
  return (
    parts.hour > targetHour ||
    (parts.hour === targetHour && parts.minute >= targetMinute)
  );
}

export function buildDailyBriefGdeltUrl({
  query,
  timespan,
  maxRecords,
}: {
  query: string;
  timespan: string;
  maxRecords: number;
}) {
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: String(Math.min(250, Math.max(1, maxRecords))),
    timespan,
    sort: "DateDesc",
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

function sourceNameFromDomain(domain: string) {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  if (normalized.endsWith("reuters.com")) return "Reuters";
  if (normalized.endsWith("apnews.com")) return "AP News";
  if (normalized.endsWith("wsj.com")) return "The Wall Street Journal";
  return normalized || "News";
}

function canonicalUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

function safeHttpUrl(value: unknown) {
  const raw = stringValue(value).trim();
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

function parseGdeltSeenDate(value: unknown, fallback: Date) {
  const raw = stringValue(value).trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return fallback.toISOString();
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  ).toISOString();
}

function normalizeGdeltArticles(
  payload: unknown,
  sourceHint: string,
  now: Date,
  allowedDomains: string[],
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const articles = (payload as Record<string, unknown>).articles;
  if (!Array.isArray(articles)) return [];

  return articles
    .map((article): DailyBriefCandidate | null => {
      if (!article || typeof article !== "object" || Array.isArray(article)) {
        return null;
      }
      const record = article as Record<string, unknown>;
      const url = safeHttpUrl(record.url);
      const title = clampText(record.title, 220);
      if (!url || !title || !isAllowedDailyBriefUrl(url, allowedDomains)) {
        return null;
      }
      const domain = stringValue(record.domain) || new URL(url).hostname;
      const source = sourceNameFromDomain(domain) || sourceHint;
      return {
        id: canonicalUrl(url),
        source,
        title,
        url,
        publishedAt: parseGdeltSeenDate(record.seendate, now),
        imageUrl: safeHttpUrl(record.socialimage),
        language: nullableString(record.language),
        country: nullableString(record.sourcecountry),
      };
    })
    .filter((candidate): candidate is DailyBriefCandidate => Boolean(candidate));
}

export async function collectDailyBriefCandidates({
  now = new Date(),
  env = process.env,
  fetchFn = fetch,
}: {
  now?: Date;
  env?: EnvLike;
  fetchFn?: FetchLike;
} = {}) {
  const timespan = `${positiveInt(
    env.DAILY_BRIEF_LOOKBACK_HOURS,
    DEFAULT_LOOKBACK_HOURS,
  )}h`;
  const maxRecords = positiveInt(
    env.DAILY_BRIEF_GDELT_MAX_RECORDS,
    DEFAULT_GDELT_MAX_RECORDS,
  );
  const maxCandidates = positiveInt(
    env.DAILY_BRIEF_MAX_CANDIDATES,
    DEFAULT_MAX_CANDIDATES,
  );
  const allowedDomains = getAllowedDailyBriefDomains(env);
  const candidates: DailyBriefCandidate[] =
    await collectIndependentDailyBriefCandidates({ now, env, fetchFn });

  for (const { source, query } of candidates.length === 0 &&
  isEnabled(env.DAILY_BRIEF_GDELT_ENABLED, true)
    ? DEFAULT_GDELT_QUERIES
    : []) {
    try {
      const response = await fetchFn(
        buildDailyBriefGdeltUrl({ query, timespan, maxRecords }),
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "SignalHubDailyBrief/1.0",
          },
          signal: AbortSignal.timeout(
            positiveInt(env.DAILY_BRIEF_SOURCE_TIMEOUT_MS, 25_000),
          ),
        },
      );
      if (!response.ok) continue;
      candidates.push(
        ...normalizeGdeltArticles(
          await response.json(),
          source,
          now,
          allowedDomains,
        ),
      );
    } catch {}
  }

  const byUrl = new Map<string, DailyBriefCandidate>();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.id);
    if (!existing) {
      byUrl.set(candidate.id, candidate);
      continue;
    }
    if (!existing.imageUrl && candidate.imageUrl) {
      byUrl.set(candidate.id, { ...existing, imageUrl: candidate.imageUrl });
    }
  }

  return Array.from(byUrl.values())
    .sort(
      (left, right) =>
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
        left.source.localeCompare(right.source),
    )
    .slice(0, maxCandidates);
}

function candidateLines(candidates: DailyBriefCandidate[]) {
  return candidates
    .map((candidate, index) =>
      [
        `[${index + 1}] ${candidate.source} ${candidate.publishedAt}`,
        `标题: ${candidate.title}`,
        candidate.summary ? `摘要: ${candidate.summary}` : "摘要: n/a",
        `链接: ${candidate.url}`,
        candidate.imageUrl ? `配图: ${candidate.imageUrl}` : "配图: n/a",
      ].join("\n"),
    )
    .join("\n\n");
}

export function buildDailyBriefPrompt({
  period,
  candidates,
  maxItems = DEFAULT_MAX_ITEMS,
}: {
  period: DailyBriefPeriod;
  candidates: DailyBriefCandidate[];
  maxItems?: number;
}) {
  return `
你是中文每日投资简报编辑。请只基于下面的 Reuters / AP News / 官方候选新闻，生成「每日投资简报」。

硬性边界:
- 不要从 Signal、Telegram、X、985、6551 或 KOL 观点流里总结；这些候选新闻才是素材。
- 不要编造候选新闻里没有的事实；不确定就写“证据不足”。
- 每天最多 ${maxItems} 条，宁缺毋滥；如果真正重要的少于 ${maxItems} 条，就少写。
- 重点范围: ${DAILY_BRIEF_TOPICS.join("、")}。
- 每条都要有: 标题、配图、发生了什么、投资影响、后续关注什么。
- 每条必须用 candidateIndexes 引用候选新闻前的编号；不要改写编号，不要编造链接。系统会按编号回填真实来源。
- 输出中文，直接返回 JSON，不要 Markdown。

JSON 结构:
{
  "title": "每日投资简报｜${period.label}",
  "marketPulse": "开头总览，2 到 4 句话",
  "items": [
    {
      "rank": 1,
      "importance": "high | medium | low",
      "title": "string",
      "topic": "${DAILY_BRIEF_TOPICS[0]}",
      "candidateIndexes": [1],
      "sourceNames": ["Reuters"],
      "sourceUrls": [],
      "imageUrl": "https://... or null",
      "whatHappened": "发生了什么",
      "investmentImpact": "为什么影响价格/供需/产业链",
      "watchNext": "后续关注什么"
    }
  ],
  "watchVariables": ["最值得盯的变量"],
  "priorityLine": "今天主线优先级"
}

候选新闻窗口: ${period.startAt} 至 ${period.endAt} (${period.timeZone})

候选新闻:
${candidateLines(candidates)}
`.trim();
}

function repairUnescapedJsonStringContent(content: string) {
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (!inString) {
      if (char === '"') inString = true;
      repaired += char;
      continue;
    }
    if (escaped) {
      escaped = false;
      repaired += char;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      repaired += char;
      continue;
    }
    if (char === "\n" || char === "\r") {
      repaired += "\\n";
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      continue;
    }
    if (char !== '"') {
      repaired += char;
      continue;
    }

    let nextIndex = index + 1;
    while (nextIndex < content.length && /\s/.test(content[nextIndex])) {
      nextIndex += 1;
    }
    const next = content[nextIndex];
    if (next === undefined || next === ":" || next === "," || next === "}" || next === "]") {
      inString = false;
      repaired += char;
    } else {
      repaired += '\\"';
    }
  }

  return repaired;
}

function repairCommonAiJsonIssues(content: string) {
  const structuralRepair = content
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/"\s*\n\s*"/g, '",\n"')
    .replace(/([}\]])\s*\n\s*"/g, '$1,\n"');
  return repairUnescapedJsonStringContent(structuralRepair);
}

function extractFirstJsonObject(content: string) {
  const start = content.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return null;
}

function normalizeImportance(value: unknown): DailyBriefItem["importance"] {
  const normalized = stringValue(value).trim().toLowerCase();
  return normalized === "high" || normalized === "medium" || normalized === "low"
    ? normalized
    : "medium";
}

function normalizeDailyBriefRecord(
  parsed: Record<string, unknown>,
): DailyBriefContent {
  const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
  const items = itemsRaw
    .map((item, index): DailyBriefItem | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const title = clampText(record.title, 180);
      if (!title) return null;
      return {
        rank: Math.max(1, Math.round(Number(record.rank) || index + 1)),
        importance: normalizeImportance(record.importance),
        title,
        topic: clampText(record.topic, 80) || DAILY_BRIEF_TOPICS[0],
        candidateIndexes: Array.isArray(record.candidateIndexes)
          ? Array.from(
              new Set(
                record.candidateIndexes
                  .map((value) => Math.round(Number(value)))
                  .filter((value) => Number.isInteger(value) && value > 0),
              ),
            ).slice(0, 4)
          : [],
        sourceNames: stringArray(record.sourceNames, 4),
        sourceUrls: stringArray(record.sourceUrls, 4),
        imageUrl: safeHttpUrl(record.imageUrl),
        whatHappened: clampText(record.whatHappened, 520),
        investmentImpact: clampText(record.investmentImpact, 520),
        watchNext: clampText(record.watchNext, 520),
      };
    })
    .filter((item): item is DailyBriefItem => Boolean(item))
    .slice(0, DEFAULT_MAX_ITEMS)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    title: clampText(parsed.title, 160) || "每日投资简报",
    marketPulse: clampText(parsed.marketPulse, 900),
    items,
    watchVariables: stringArray(parsed.watchVariables, 8),
    priorityLine: clampText(parsed.priorityLine, 240),
  };
}

export function parseDailyBriefContent(content: string): DailyBriefContent {
  const cleanedBase = content
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const cleaned = extractFirstJsonObject(cleanedBase) ?? cleanedBase;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    parsed = JSON.parse(repairCommonAiJsonIssues(cleaned)) as Record<string, unknown>;
  }
  return normalizeDailyBriefRecord(parsed);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function sanitizeBriefForCandidates(
  brief: DailyBriefContent,
  candidates: DailyBriefCandidate[],
): DailyBriefContent {
  const candidateByCanonicalUrl = new Map(
    candidates.map((candidate) => [candidate.id, candidate] as const),
  );
  const items = brief.items
    .map((item): DailyBriefItem | null => {
      const matchedCandidates = Array.from(
        new Map(
          [
            ...(item.candidateIndexes ?? []).map(
              (candidateIndex) => candidates[candidateIndex - 1],
            ),
            ...item.sourceUrls.map((sourceUrl) =>
              candidateByCanonicalUrl.get(canonicalUrl(sourceUrl)),
            ),
          ]
            .filter(
              (candidate): candidate is DailyBriefCandidate =>
                Boolean(candidate),
            )
            .map((candidate) => [candidate.id, candidate] as const),
        ).values(),
      );
      if (matchedCandidates.length === 0) return null;

      const imageUrl =
        matchedCandidates.find((candidate) => candidate.imageUrl)?.imageUrl ??
        null;

      return {
        ...item,
        sourceNames: uniqueStrings(
          matchedCandidates.map((candidate) => candidate.source),
        ),
        sourceUrls: uniqueStrings(
          matchedCandidates.map((candidate) => candidate.url),
        ),
        imageUrl,
      };
    })
    .filter((item): item is DailyBriefItem => Boolean(item))
    .slice(0, DEFAULT_MAX_ITEMS)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return { ...brief, items };
}

function openDailyBriefDb(path = getDailyBriefDbPath()) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal");
  db.exec("pragma synchronous = normal");
  db.exec(`
    create table if not exists daily_brief_cache (
      date_key text primary key,
      snapshot_json text not null,
      input_hash text,
      status text not null,
      generated_at text,
      updated_at text not null
    )
  `);
  return db;
}

function parseSnapshot(raw: unknown): DailyBriefSnapshot | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as DailyBriefSnapshot;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readCachedBrief(dateKey: string, db: DatabaseSync) {
  const row = db
    .prepare("select snapshot_json from daily_brief_cache where date_key = ?")
    .get(dateKey) as DbRow | undefined;
  return parseSnapshot(row?.snapshot_json);
}

function readLatestBrief(db: DatabaseSync) {
  const row = db
    .prepare(
      "select snapshot_json from daily_brief_cache order by generated_at desc, updated_at desc limit 1",
    )
    .get() as DbRow | undefined;
  return parseSnapshot(row?.snapshot_json);
}

function readLatestBriefWithContent(db: DatabaseSync) {
  const rows = db
    .prepare(
      "select snapshot_json from daily_brief_cache order by generated_at desc, updated_at desc limit 20",
    )
    .all() as DbRow[];
  for (const row of rows) {
    const snapshot = parseSnapshot(row.snapshot_json);
    if (snapshot?.brief) return snapshot;
  }
  return null;
}

function writeCachedBrief(snapshot: DailyBriefSnapshot, inputHash: string, db: DatabaseSync) {
  const now = new Date().toISOString();
  db.prepare(`
    insert into daily_brief_cache (
      date_key,
      snapshot_json,
      input_hash,
      status,
      generated_at,
      updated_at
    )
    values (?, ?, ?, ?, ?, ?)
    on conflict(date_key) do update set
      snapshot_json = excluded.snapshot_json,
      input_hash = excluded.input_hash,
      status = excluded.status,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at
  `).run(
    snapshot.period.dateKey,
    JSON.stringify(snapshot),
    inputHash,
    snapshot.status,
    snapshot.generatedAt,
    now,
  );
}

function inputHashForCandidates(candidates: DailyBriefCandidate[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        candidates.map((candidate) => [
          candidate.id,
          candidate.title,
          candidate.summary,
          candidate.publishedAt,
          candidate.imageUrl,
        ]),
      ),
    )
    .digest("hex");
}

async function requestDailyBrief({
  prompt,
  provider,
  env,
}: {
  prompt: string;
  provider: AiProviderConfig;
  env: EnvLike;
}) {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        {
          role: "system",
          content:
            "You write concise Chinese daily investment briefs from supplied news candidates only.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      ...(isMiniMaxBaseUrl(provider.baseUrl)
        ? {}
        : { response_format: { type: "json_object" } }),
    }),
    signal: AbortSignal.timeout(
      positiveInt(
        env.DAILY_BRIEF_AI_TIMEOUT_MS || env.AI_SUMMARY_TIMEOUT_MS,
        DEFAULT_AI_TIMEOUT_MS,
      ),
    ),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined;
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : `Daily brief AI HTTP ${response.status}`,
    );
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === "string" ? message.content : "";
  if (!content) throw new Error("Daily brief AI returned empty content");
  return parseDailyBriefContent(content);
}

async function runDailyBriefAi({
  prompt,
  period,
  candidates,
  env,
  requestBrief,
}: {
  prompt: string;
  period: DailyBriefPeriod;
  candidates: DailyBriefCandidate[];
  env: EnvLike;
  requestBrief?: DailyBriefRequestDeps["requestBrief"];
}) {
  const providers = getAlphaSummaryProviderCandidates(env);
  const result = await runWithAiProviderFallback({
    providers,
    cooldownMs: positiveInt(
      env.AI_SUMMARY_PROVIDER_COOLDOWN_MS,
      6 * 60 * 60 * 1000,
    ),
    request: async (provider) =>
      requestBrief
        ? (
            await requestBrief({
              prompt,
              provider,
              period,
              candidates,
              env,
            })
          ).brief
        : requestDailyBrief({ prompt, provider, env }),
  });
  return {
    brief: sanitizeBriefForCandidates(result.value, candidates),
    provider: result.provider,
  };
}

function emptySnapshot({
  period,
  env,
  status = "empty",
  error = null,
}: {
  period: DailyBriefPeriod;
  env: EnvLike;
  status?: DailyBriefSnapshot["status"];
  error?: string | null;
}): DailyBriefSnapshot {
  const providers = getAlphaSummaryProviderCandidates(env);
  return {
    success: status === "empty",
    status,
    configured: providers.length > 0,
    period,
    generatedAt: null,
    model: providers[0]?.model ?? getAlphaSummaryModel(env),
    candidateCount: 0,
    sourceCounts: {},
    brief: null,
    error,
  };
}

export async function getLatestDailyInvestmentBrief({
  now = new Date(),
  env = process.env,
}: {
  now?: Date;
  env?: EnvLike;
} = {}): Promise<DailyBriefSnapshot> {
  const period = getDailyBriefPeriod({ now, env });
  const db = openDailyBriefDb(getDailyBriefDbPath(env));
  try {
    const latest = readLatestBrief(db);
    if (!latest) return emptySnapshot({ period, env });
    if (latest.status === "generated") return { ...latest, status: "cached" };
    if (!latest.brief) {
      const latestWithContent = readLatestBriefWithContent(db);
      return latestWithContent
        ? { ...latestWithContent, status: "cached" }
        : latest;
    }
    return latest;
  } finally {
    db.close();
  }
}

export async function getOrCreateDailyInvestmentBrief({
  force = false,
  now = new Date(),
  env = process.env,
  collectCandidates = collectDailyBriefCandidates,
  requestBrief,
}: {
  force?: boolean;
  now?: Date;
  env?: EnvLike;
} & DailyBriefRequestDeps = {}): Promise<DailyBriefSnapshot> {
  const period = getDailyBriefPeriod({ now, env });
  const providers = getAlphaSummaryProviderCandidates(env);
  const db = openDailyBriefDb(getDailyBriefDbPath(env));
  try {
    const cached = readCachedBrief(period.dateKey, db);
    const fallbackWithContent = cached?.brief ? cached : readLatestBriefWithContent(db);
    if (
      cached?.brief &&
      cached.success &&
      (cached.status === "generated" || cached.status === "cached") &&
      !force
    ) {
      return { ...cached, status: "cached" };
    }

    const candidates = await collectCandidates({ now, env });
    const sourceCounts = countBySource(candidates);
    const inputHash = inputHashForCandidates(candidates);
    const model = providers[0]?.model ?? getAlphaSummaryModel(env);

    if (candidates.length === 0) {
      if (fallbackWithContent?.brief) {
        return { ...fallbackWithContent, status: "cached" };
      }
      const snapshot: DailyBriefSnapshot = {
        ...emptySnapshot({ period, env }),
        configured: providers.length > 0,
        model,
        error: null,
      };
      writeCachedBrief(snapshot, inputHash, db);
      return snapshot;
    }

    if (providers.length === 0) {
      const snapshot: DailyBriefSnapshot = {
        success: false,
        status: "needs_key",
        configured: false,
        period,
        generatedAt: cached?.generatedAt ?? null,
        model,
        candidateCount: candidates.length,
        sourceCounts,
        brief: fallbackWithContent?.brief ?? null,
        error:
          "MINIMAX_API_KEY, AI_SUMMARY_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY is required",
      };
      writeCachedBrief(snapshot, inputHash, db);
      return snapshot;
    }

    try {
      const { brief, provider } = await runDailyBriefAi({
        prompt: buildDailyBriefPrompt({
          period,
          candidates,
          maxItems: positiveInt(env.DAILY_BRIEF_MAX_ITEMS, DEFAULT_MAX_ITEMS),
        }),
        period,
        candidates,
        env,
        requestBrief,
      });
      const snapshot: DailyBriefSnapshot = {
        success: true,
        status: "generated",
        configured: true,
        period,
        generatedAt: now.toISOString(),
        model: provider.model,
        candidateCount: candidates.length,
        sourceCounts,
        brief,
        error: null,
      };
      writeCachedBrief(snapshot, inputHash, db);
      return snapshot;
    } catch (error) {
      const snapshot: DailyBriefSnapshot = {
        success: false,
        status: "error",
        configured: true,
        period,
        generatedAt: now.toISOString(),
        model,
        candidateCount: candidates.length,
        sourceCounts,
        brief: fallbackWithContent?.brief ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
      writeCachedBrief(snapshot, inputHash, db);
      return snapshot;
    }
  } finally {
    db.close();
  }
}
