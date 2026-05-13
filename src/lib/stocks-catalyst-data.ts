import type {
  AlphaCatalystType,
  AlphaResearchCatalyst,
  AlphaResearchStock,
} from "./alpha-research-pool.ts";

export type StocksCatalystDataSource = "live" | "mock";
export type StocksCatalystProvider =
  | "external-news"
  | "external-plus-supplemental"
  | "external-plus-subscription"
  | "subscription-plus-supplemental"
  | "all-sources"
  | "subscription-research"
  | "supplemental"
  | "mock";

export type StocksCatalystSourceItem = {
  id: string;
  source:
    | "Yahoo Finance"
    | "Polygon"
    | "FMP"
    | "Finnhub"
    | "Alpha Vantage"
    | "Google News"
    | "Patreon"
    | "Telegram"
    | "X";
  sourceRole: "external" | "supplemental" | "subscription";
  author: string;
  createdAt: string;
  text: string;
  translation: string | null;
  link: string;
  tickers?: string[];
};

export type StocksCatalystSnapshot = {
  generatedAt: string;
  source: StocksCatalystDataSource;
  provider: StocksCatalystProvider;
  catalysts: Record<string, AlphaResearchCatalyst[]>;
  errors: string[];
};

const COMMON_WORD_TICKERS = new Set(["FN", "NOW"]);
const POSITIVE_TERMS = [
  "beat",
  "beats",
  "raise",
  "raised",
  "upgrade",
  "upgraded",
  "strong",
  "上调",
  "上修",
  "超预期",
  "强劲",
  "改善",
];
const NEGATIVE_TERMS = [
  "miss",
  "misses",
  "cut",
  "downgrade",
  "lowered",
  "weak",
  "probe",
  "ban",
  "下调",
  "不及",
  "疲软",
  "调查",
  "限制",
];

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceId(prefix: string, value: string) {
  return `${prefix}:${value || Math.random().toString(36).slice(2)}`;
}

function normalizeTickerList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringValue(item).toUpperCase())
      .filter(Boolean);
  }
  const text = stringValue(value);
  if (!text) return [];
  return text
    .split(/[,\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function xmlTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripHtml(decodeXml(match[1])).trim() : "";
}

function textFromHtml(value: string) {
  return stripHtml(decodeXml(value));
}

function firstStringFromRecord(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return "";
}

function recordWithAttributes(record: JsonRecord) {
  return {
    ...asRecord(record.attributes),
    ...record,
  };
}

function dateValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  return stringValue(value);
}

function firstDateFromRecord(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = dateValue(record[key]);
    if (value) return value;
  }
  return "";
}

function alphaVantageDate(value: string) {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/,
  );
  if (!match) return value || new Date().toISOString();
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

export function parsePolygonNewsPayload(payload: unknown): StocksCatalystSourceItem[] {
  return asArray(asRecord(payload).results)
    .map((item): StocksCatalystSourceItem | null => {
      const row = asRecord(item);
      const title = stringValue(row.title);
      const description = stringValue(row.description);
      const link = stringValue(row.article_url) || stringValue(row.url);
      if (!title || !link) return null;
      const publisher = asRecord(row.publisher);
      return {
        id: sourceId("polygon", stringValue(row.id) || link),
        source: "Polygon" as const,
        sourceRole: "external" as const,
        author:
          stringValue(publisher.name) ||
          stringValue(row.author) ||
          "Polygon",
        createdAt:
          stringValue(row.published_utc) ||
          stringValue(row.published_at) ||
          new Date().toISOString(),
        text: [title, description].filter(Boolean).join("\n"),
        translation: null,
        link,
        tickers: normalizeTickerList(row.tickers),
      };
    })
    .filter((item): item is StocksCatalystSourceItem => Boolean(item));
}

export function parseFmpStockNewsPayload(payload: unknown): StocksCatalystSourceItem[] {
  return asArray(payload)
    .map((item): StocksCatalystSourceItem | null => {
      const row = asRecord(item);
      const title = stringValue(row.title);
      const text = stringValue(row.text) || stringValue(row.content);
      const link = stringValue(row.url);
      if (!title || !link) return null;
      return {
        id: sourceId("fmp", link),
        source: "FMP" as const,
        sourceRole: "external" as const,
        author: stringValue(row.site) || stringValue(row.publisher) || "FMP",
        createdAt:
          stringValue(row.publishedDate) ||
          stringValue(row.date) ||
          new Date().toISOString(),
        text: [title, text].filter(Boolean).join("\n"),
        translation: null,
        link,
        tickers: normalizeTickerList(row.symbol ?? row.symbols ?? row.tickers),
      };
    })
    .filter((item): item is StocksCatalystSourceItem => Boolean(item));
}

export function parseFinnhubCompanyNewsPayload(
  payload: unknown,
  ticker: string,
): StocksCatalystSourceItem[] {
  const normalizedTicker = ticker.trim().toUpperCase();
  return asArray(payload)
    .map((item): StocksCatalystSourceItem | null => {
      const row = asRecord(item);
      const title = stringValue(row.headline) || stringValue(row.title);
      const summary = stringValue(row.summary);
      const link = stringValue(row.url);
      if (!title || !link) return null;
      const timestamp = numberValue(row.datetime);
      return {
        id: sourceId("finnhub", stringValue(row.id) || link),
        source: "Finnhub" as const,
        sourceRole: "external" as const,
        author: stringValue(row.source) || "Finnhub",
        createdAt:
          timestamp === null
            ? new Date().toISOString()
            : new Date(timestamp * 1000).toISOString(),
        text: [title, summary].filter(Boolean).join("\n"),
        translation: null,
        link,
        tickers: normalizeTickerList(row.related).length > 0
          ? normalizeTickerList(row.related)
          : [normalizedTicker],
      };
    })
    .filter((item): item is StocksCatalystSourceItem => Boolean(item));
}

export function parseAlphaVantageNewsPayload(
  payload: unknown,
): StocksCatalystSourceItem[] {
  return asArray(asRecord(payload).feed)
    .map((item): StocksCatalystSourceItem | null => {
      const row = asRecord(item);
      const title = stringValue(row.title);
      const summary = stringValue(row.summary);
      const link = stringValue(row.url);
      if (!title || !link) return null;
      const tickerSentiment = asArray(row.ticker_sentiment)
        .map((sentiment) => stringValue(asRecord(sentiment).ticker).toUpperCase())
        .filter(Boolean);
      return {
        id: sourceId("alphavantage", link),
        source: "Alpha Vantage" as const,
        sourceRole: "external" as const,
        author: stringValue(row.source) || "Alpha Vantage",
        createdAt: alphaVantageDate(stringValue(row.time_published)),
        text: [title, summary].filter(Boolean).join("\n"),
        translation: null,
        link,
        tickers: tickerSentiment,
      };
    })
    .filter((item): item is StocksCatalystSourceItem => Boolean(item));
}

export function parseYahooFinanceRss(
  xml: string,
  ticker: string,
): StocksCatalystSourceItem[] {
  return Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi))
    .map((match, index): StocksCatalystSourceItem | null => {
      const block = match[1];
      const title = xmlTag(block, "title");
      const description = xmlTag(block, "description");
      const link = xmlTag(block, "link");
      if (!title || !link) return null;
      return {
        id: sourceId("yahoo", `${ticker}:${link || index}`),
        source: "Yahoo Finance" as const,
        sourceRole: "external" as const,
        author: "Yahoo Finance",
        createdAt: xmlTag(block, "pubDate") || new Date().toISOString(),
        text: [title, description].filter(Boolean).join("\n"),
        translation: null,
        link,
        tickers: [ticker.toUpperCase()],
      };
    })
    .filter((item): item is StocksCatalystSourceItem => Boolean(item));
}

export function parseGoogleNewsRss(
  xml: string,
  ticker: string,
): StocksCatalystSourceItem[] {
  const normalizedTicker = ticker.trim().toUpperCase();
  return Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi))
    .map((match, index): StocksCatalystSourceItem | null => {
      const block = match[1];
      const title = xmlTag(block, "title");
      const description = xmlTag(block, "description");
      const link = xmlTag(block, "link");
      if (!title || !link) return null;
      return {
        id: sourceId("google-news", `${normalizedTicker}:${link || index}`),
        source: "Google News" as const,
        sourceRole: "external" as const,
        author: xmlTag(block, "source") || "Google News",
        createdAt: xmlTag(block, "pubDate") || new Date().toISOString(),
        text: [title, description].filter(Boolean).join("\n"),
        translation: null,
        link,
        tickers: [normalizedTicker],
      };
    })
    .filter((item): item is StocksCatalystSourceItem => Boolean(item));
}

type PatreonPostsPageOptions = {
  sourceUrl?: string;
  creatorName?: string;
  maxPosts?: number;
};

const PATREON_TITLE_KEYS = ["title", "post_title", "postTitle", "name"];
const PATREON_LINK_KEYS = [
  "url",
  "post_url",
  "postUrl",
  "canonical_url",
  "canonicalUrl",
  "share_url",
  "shareUrl",
  "full_url",
  "fullUrl",
  "permalink",
];
const PATREON_DATE_KEYS = [
  "published_at",
  "publishedAt",
  "published",
  "published_date",
  "datePublished",
  "created_at",
  "createdAt",
];
const PATREON_EXCERPT_KEYS = [
  "excerpt",
  "summary",
  "description",
  "teaser_text",
  "teaserText",
  "teaser",
  "preview_text",
  "previewText",
];
const PATREON_BODY_KEYS = [
  "content",
  "body",
  "post_content",
  "postContent",
  "plain_text",
  "plainText",
  "text",
];

function parseJsonScriptPayloads(html: string): unknown[] {
  return Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
    .map((match) => decodeXml(match[1]).trim())
    .filter((script) => script.startsWith("{") || script.startsWith("["))
    .map((script) => {
      try {
        return JSON.parse(script) as unknown;
      } catch {
        return null;
      }
    })
    .filter((payload): payload is unknown => payload !== null);
}

function normalizePatreonUrl(value: string, sourceUrl: string) {
  if (!value) return sourceUrl;
  try {
    return new URL(value, sourceUrl || "https://www.patreon.com").toString();
  } catch {
    return value;
  }
}

function patreonTitle(record: JsonRecord) {
  return textFromHtml(firstStringFromRecord(record, PATREON_TITLE_KEYS));
}

function patreonLink(record: JsonRecord, sourceUrl: string) {
  return normalizePatreonUrl(
    firstStringFromRecord(record, PATREON_LINK_KEYS),
    sourceUrl,
  );
}

function patreonCreatedAt(record: JsonRecord) {
  return firstDateFromRecord(record, PATREON_DATE_KEYS);
}

function patreonText(record: JsonRecord, title: string) {
  const excerpt = textFromHtml(firstStringFromRecord(record, PATREON_EXCERPT_KEYS));
  if (excerpt) return clampText([title, excerpt].filter(Boolean).join("\n"), 900);

  const body = textFromHtml(firstStringFromRecord(record, PATREON_BODY_KEYS));
  return clampText([title, body].filter(Boolean).join("\n"), 900);
}

function collectPatreonPostRecords(
  value: unknown,
  records: JsonRecord[],
  seen: WeakSet<object>,
) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectPatreonPostRecords(item, records, seen);
    return;
  }

  const record = recordWithAttributes(value as JsonRecord);
  const title = patreonTitle(record);
  const link = firstStringFromRecord(record, PATREON_LINK_KEYS);
  const type = stringValue(record.type).toLowerCase();
  const postHint =
    type.includes("post") ||
    /patreon\.com\/posts\//i.test(link) ||
    Boolean(firstDateFromRecord(record, PATREON_DATE_KEYS));
  if (title && postHint) records.push(record);

  for (const child of Object.values(value)) {
    collectPatreonPostRecords(child, records, seen);
  }
}

export function parsePatreonPostsPage(
  html: string,
  options: PatreonPostsPageOptions = {},
): StocksCatalystSourceItem[] {
  const sourceUrl =
    options.sourceUrl?.trim() || "https://www.patreon.com/posts";
  const creatorName = options.creatorName?.trim() || "Patreon";
  const maxPosts = Math.max(1, Math.min(options.maxPosts ?? 10, 25));
  const records: JsonRecord[] = [];
  for (const payload of parseJsonScriptPayloads(html)) {
    collectPatreonPostRecords(payload, records, new WeakSet<object>());
  }

  const seen = new Set<string>();
  return records
    .map((record): StocksCatalystSourceItem | null => {
      const title = patreonTitle(record);
      if (!title) return null;
      const link = patreonLink(record, sourceUrl);
      const dedupeKey = link || `${title}:${patreonCreatedAt(record)}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      return {
        id: sourceId("patreon", stringValue(record.id) || dedupeKey),
        source: "Patreon" as const,
        sourceRole: "subscription" as const,
        author: creatorName,
        createdAt: patreonCreatedAt(record) || new Date().toISOString(),
        text: patreonText(record, title),
        translation: null,
        link,
      };
    })
    .filter((item): item is StocksCatalystSourceItem => Boolean(item))
    .slice(0, maxPosts);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampText(text: string, maxChars: number) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars).trim()}...`
    : normalized;
}

function dateLabel(createdAt: string) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return createdAt.slice(0, 16);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function tickerMatches(text: string, ticker: string) {
  const upper = text.toUpperCase();
  if (upper.includes(`$${ticker}`)) return true;
  if (COMMON_WORD_TICKERS.has(ticker)) return false;
  return new RegExp(`(^|[^A-Z0-9])${escapeRegExp(ticker)}([^A-Z0-9]|$)`).test(
    upper,
  );
}

function termMatches(text: string, term: string) {
  const normalized = term.trim().toLowerCase();
  return normalized.length >= 3 && text.toLowerCase().includes(normalized);
}

function matchedTickersForItem(
  item: StocksCatalystSourceItem,
  stocks: AlphaResearchStock[],
) {
  const text = [item.author, item.text, item.translation ?? ""].join("\n");
  const tickerSet = new Set((item.tickers ?? []).map((ticker) => ticker.toUpperCase()));
  if (item.sourceRole === "external" && tickerSet.size > 0) {
    return stocks
      .filter((stock) => tickerSet.has(stock.ticker))
      .map((stock) => stock.ticker);
  }
  return stocks
    .filter((stock) => {
      if (tickerSet.has(stock.ticker)) return true;
      if (tickerMatches(text, stock.ticker)) return true;
      if (termMatches(text, stock.companyName)) return true;
      if (termMatches(text, stock.companyNameZh)) return true;
      return stock.businessTags.some((tag) => termMatches(text, tag));
    })
    .map((stock) => stock.ticker);
}

function classifyCatalystType(text: string): AlphaCatalystType {
  const lower = text.toLowerCase();
  if (/earnings|revenue|eps|guidance|财报|业绩|指引/.test(lower)) {
    return "earnings";
  }
  if (/analyst|rating|price target|upgrade|downgrade|机构|评级/.test(lower)) {
    return "analyst";
  }
  if (/blackwell|cuda|mi series|product|launch|shipment|产品|出货/.test(lower)) {
    return "product";
  }
  if (/supply|cowos|hbm|order|capex|供应|订单|产能|资本开支/.test(lower)) {
    return "supply-chain";
  }
  if (/export|regulator|ftc|doj|probe|ban|监管|调查|限制/.test(lower)) {
    return "regulatory";
  }
  if (/fed|cpi|rates|treasury|macro|通胀|降息|利率/.test(lower)) {
    return "macro";
  }
  return "industry-event";
}

function classifyImpact(text: string): AlphaResearchCatalyst["impact"] {
  const lower = text.toLowerCase();
  if (NEGATIVE_TERMS.some((term) => lower.includes(term.toLowerCase()))) {
    return "negative";
  }
  if (POSITIVE_TERMS.some((term) => lower.includes(term.toLowerCase()))) {
    return "positive";
  }
  return "neutral";
}

function titleFromItem(item: StocksCatalystSourceItem) {
  const raw = item.translation || item.text;
  const firstLine = raw.split(/\n+/).find((line) => line.trim()) ?? raw;
  return clampText(firstLine, 120);
}

function catalystFromItem(item: StocksCatalystSourceItem): AlphaResearchCatalyst {
  const summary = clampText(item.translation || item.text, 420);
  const text = [item.text, item.translation ?? ""].join("\n");
  return {
    title: titleFromItem(item),
    type: classifyCatalystType(text),
    date: dateLabel(item.createdAt),
    impact: classifyImpact(text),
    summary,
    source: item.source,
    sourceRole: item.sourceRole,
    author: item.author,
    link: item.link,
  };
}

function catalystProviderFromItems(
  items: StocksCatalystSourceItem[],
): StocksCatalystProvider {
  const hasExternal = items.some((item) => item.sourceRole === "external");
  const hasSupplemental = items.some((item) => item.sourceRole === "supplemental");
  const hasSubscription = items.some((item) => item.sourceRole === "subscription");
  if (hasExternal && hasSupplemental && hasSubscription) return "all-sources";
  if (hasExternal && hasSubscription) return "external-plus-subscription";
  if (hasSupplemental && hasSubscription) return "subscription-plus-supplemental";
  if (hasExternal && hasSupplemental) return "external-plus-supplemental";
  if (hasExternal) return "external-news";
  if (hasSubscription) return "subscription-research";
  if (hasSupplemental) return "supplemental";
  return "mock";
}

function sourceRoleRank(item: StocksCatalystSourceItem) {
  if (item.sourceRole === "subscription") return 0;
  if (item.sourceRole === "external") return 1;
  return 2;
}

export function buildStocksCatalystSnapshotFromItems({
  stocks,
  items,
  generatedAt = new Date().toISOString(),
}: {
  stocks: AlphaResearchStock[];
  items: StocksCatalystSourceItem[];
  generatedAt?: string;
}): StocksCatalystSnapshot {
  const catalysts: Record<string, AlphaResearchCatalyst[]> = {};

  const orderedItems = [...items].sort(
    (left, right) =>
      sourceRoleRank(left) - sourceRoleRank(right) ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

  for (const item of orderedItems) {
    for (const ticker of matchedTickersForItem(item, stocks)) {
      catalysts[ticker] ??= [];
      if (catalysts[ticker].some((catalyst) => catalyst.link === item.link)) {
        continue;
      }
      catalysts[ticker].push(catalystFromItem(item));
    }
  }

  for (const [ticker, tickerCatalysts] of Object.entries(catalysts)) {
    catalysts[ticker] = tickerCatalysts.slice(0, 5);
  }

  return {
    generatedAt,
    source: Object.keys(catalysts).length > 0 ? "live" : "mock",
    provider:
      Object.keys(catalysts).length > 0
        ? catalystProviderFromItems(orderedItems)
        : "mock",
    catalysts,
    errors: [],
  };
}

export function buildMockStocksCatalystSnapshot(
  stocks: AlphaResearchStock[],
): StocksCatalystSnapshot {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    source: "mock",
    provider: "mock",
    errors: [],
    catalysts: Object.fromEntries(
      stocks.map((stock) => [
        stock.ticker,
        stock.catalysts.map((catalyst) => ({
          ...catalyst,
          source: "mock" as const,
          sourceRole: "mock" as const,
        })),
      ]),
    ),
  };
}

export function mergeStocksCatalystSnapshot(
  stocks: AlphaResearchStock[],
  snapshot: StocksCatalystSnapshot | null,
): AlphaResearchStock[] {
  if (!snapshot) return stocks;
  return stocks.map((stock) => {
    const catalysts = snapshot.catalysts[stock.ticker];
    if (!catalysts?.length) return stock;
    return {
      ...stock,
      catalysts,
    };
  });
}
