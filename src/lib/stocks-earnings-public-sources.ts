import { load } from "cheerio";
import type { AlphaResearchStock } from "./alpha-research-pool.ts";
import type {
  StocksEarningsComparison,
  StocksEarningsProvider,
} from "./stocks-earnings-comparison.ts";
import type {
  StocksCompanyGuidance,
  StocksEarningsSourceRef,
} from "./stocks-earnings-calendar.ts";
import { getStocksEarningsSourceConfig } from "./stocks-earnings-source-config.ts";

type JsonRecord = Record<string, unknown>;
type CandidateField =
  | "reportDate"
  | "revenueEstimate"
  | "revenueActual"
  | "epsEstimate"
  | "epsActual"
  | "dilutedShares"
  | "netIncomeActual"
  | "companyGuidance";

export type StocksPublicEarningsCandidate = {
  ticker: string;
  fiscalYear: number;
  quarter: StocksEarningsComparison["quarter"];
  fiscalDateEnding: string;
  reportDate: string;
  reportTiming: StocksEarningsComparison["reportTiming"];
  currency: string;
  revenueEstimate: number | null;
  revenueActual: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  dilutedShares: number | null;
  netIncomeActual: number | null;
  companyGuidance: StocksCompanyGuidance | null;
  fieldSources: Partial<Record<CandidateField, StocksEarningsSourceRef>>;
};

type CacheEntry = {
  expiresAt: number;
  candidates: StocksPublicEarningsCandidate[];
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;
const publicEarningsCache = new Map<string, CacheEntry>();

export function clearStocksPublicEarningsCacheForTests() {
  publicEarningsCache.clear();
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

function parseTimeout(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, DEFAULT_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
}

function parseFiscalPeriod(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const fyFirst = normalized.match(/FY\s*(\d{4})\s*Q([1-4])/i);
  const quarterFirst = normalized.match(/Q([1-4])\s*FY\s*(\d{4})/i);
  const match = fyFirst ?? quarterFirst;
  if (!match) return null;
  const fiscalYear = Number(fyFirst ? match[1] : match[2]);
  const quarter = Number(fyFirst ? match[2] : match[1]);
  if (!Number.isInteger(fiscalYear) || quarter < 1 || quarter > 4) return null;
  return {
    fiscalYear,
    quarter: `Q${quarter}` as StocksEarningsComparison["quarter"],
  };
}

function parseIsoDate(value: string) {
  const match = value.match(/(20\d{2}-\d{2}-\d{2})/);
  if (!match) return "";
  return Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`)) ? match[1] : "";
}

function parseScaledNumber(value: string) {
  const normalized = value
    .trim()
    .replace(/,/g, "")
    .replace(/[−–—]/g, "-");
  if (!normalized || /^(?:n\/?a|--|—)$/i.test(normalized)) return null;
  const match = normalized.match(
    /\(?\s*[-+]?\$?\s*(\d+(?:\.\d+)?)\s*(K|M|B|T|thousand|million|billion|trillion)?\s*\)?/i,
  );
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  const scaleKey = (match[2] ?? "").toUpperCase();
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
    }[scaleKey] ?? 1;
  const negative = /^\s*\(/.test(normalized) || /[-−–—]/.test(normalized);
  return magnitude * scale * (negative ? -1 : 1);
}

function sourceRef(
  provider: StocksEarningsProvider,
  url: string,
  fetchedAt: string,
  confidence: StocksEarningsSourceRef["confidence"],
): StocksEarningsSourceRef {
  return { provider, url, fetchedAt, confidence };
}

function reportTiming(value: string): StocksEarningsComparison["reportTiming"] {
  const normalized = value.toLowerCase();
  if (/before[- ]market|before market open|\bbmo\b/.test(normalized)) {
    return "before-market";
  }
  if (/after[- ]market|after market close|\bamc\b/.test(normalized)) {
    return "after-market";
  }
  return "unknown";
}

function emptyCandidate(input: {
  ticker: string;
  fiscalYear: number;
  quarter: StocksEarningsComparison["quarter"];
  fiscalDateEnding?: string;
  reportDate?: string;
  reportTiming?: StocksEarningsComparison["reportTiming"];
  currency: string;
}): StocksPublicEarningsCandidate {
  return {
    ticker: input.ticker,
    fiscalYear: input.fiscalYear,
    quarter: input.quarter,
    fiscalDateEnding: input.fiscalDateEnding ?? "",
    reportDate: input.reportDate ?? "",
    reportTiming: input.reportTiming ?? "unknown",
    currency: input.currency,
    revenueEstimate: null,
    revenueActual: null,
    epsEstimate: null,
    epsActual: null,
    dilutedShares: null,
    netIncomeActual: null,
    companyGuidance: null,
    fieldSources: {},
  };
}

function parseGuidance(
  text: string,
  providerSource: StocksEarningsSourceRef,
  currency: string,
) {
  const normalized = text.replace(/\s+/g, " ");
  const range = normalized.match(
    /revenue\s+is\s+expected\s+to\s+be\s+(\$?[\d,.]+\s*(?:K|M|B|T|thousand|million|billion|trillion)?)\s+(?:to|through|[-–—])\s*(\$?[\d,.]+\s*(?:K|M|B|T|thousand|million|billion|trillion)?)/i,
  );
  if (range) {
    const revenueLow = parseScaledNumber(range[1]);
    const revenueHigh = parseScaledNumber(range[2]);
    if (revenueLow !== null && revenueHigh !== null) {
      return {
        revenueLow,
        revenueHigh,
        revenueMid: (revenueLow + revenueHigh) / 2,
        currency,
        source: providerSource,
      } satisfies StocksCompanyGuidance;
    }
  }
  const midpoint = normalized.match(
    /revenue\s+is\s+expected\s+to\s+be\s+(\$?[\d,.]+\s*(?:K|M|B|T|thousand|million|billion|trillion)?)(?:\s*,)?\s*(?:plus|\+)\s+or\s+(?:minus|-)\s+(\d+(?:\.\d+)?)%/i,
  );
  if (!midpoint) return null;
  const revenueMid = parseScaledNumber(midpoint[1]);
  const tolerancePct = Number(midpoint[2]);
  if (revenueMid === null || !Number.isFinite(tolerancePct)) return null;
  return {
    revenueLow: revenueMid * (1 - tolerancePct / 100),
    revenueHigh: revenueMid * (1 + tolerancePct / 100),
    revenueMid,
    currency,
    source: providerSource,
  } satisfies StocksCompanyGuidance;
}

function parseOfficialIrHtml(input: {
  html: string;
  ticker: string;
  currency: string;
  url: string;
  fetchedAt: string;
}) {
  const $ = load(input.html);
  const candidates: StocksPublicEarningsCandidate[] = [];
  const pageTiming = reportTiming(
    $("body").attr("data-report-timing") ?? $("body").text(),
  );
  const pageText = $("body").text();
  $("script[type='application/ld+json']").each((_index, element) => {
    try {
      const parsed = JSON.parse($(element).html() ?? "");
      const records = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of records) {
        const event = asRecord(value);
        const period = parseFiscalPeriod(
          `${stringValue(event.name)} ${stringValue(event.description)}`,
        );
        const reportDate = parseIsoDate(stringValue(event.startDate));
        if (!period || !reportDate) continue;
        const ref = sourceRef(
          "official-ir",
          input.url,
          input.fetchedAt,
          "official",
        );
        const candidate = emptyCandidate({
          ticker: input.ticker,
          ...period,
          reportDate,
          reportTiming: pageTiming,
          currency: input.currency,
        });
        candidate.fieldSources.reportDate = ref;
        candidate.companyGuidance = parseGuidance(pageText, ref, input.currency);
        if (candidate.companyGuidance) {
          candidate.fieldSources.companyGuidance = ref;
        }
        candidates.push(candidate);
      }
    } catch {
      // Ignore malformed JSON-LD and continue checking other blocks.
    }
  });
  return candidates;
}

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseEarningsLabsHtml(input: {
  html: string;
  ticker: string;
  currency: string;
  url: string;
  fetchedAt: string;
}) {
  const $ = load(input.html);
  const candidates: StocksPublicEarningsCandidate[] = [];
  $("table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("thead th")
      .toArray()
      .map((header) => normalizedHeader($(header).text()));
    if (!headers.includes("quarter") || !headers.includes("revenue estimate")) {
      return;
    }
    $(table)
      .find("tbody tr")
      .each((_rowIndex, row) => {
        const values = $(row)
          .find("td")
          .toArray()
          .map((cell) => $(cell).text().replace(/\s+/g, " ").trim());
        const cells = new Map(headers.map((header, index) => [header, values[index] ?? ""]));
        const period = parseFiscalPeriod(cells.get("quarter") ?? "");
        const fiscalDateEnding = parseIsoDate(
          cells.get("fiscal date") ?? cells.get("fiscal date ending") ?? "",
        );
        const reportDate = parseIsoDate(cells.get("report date") ?? cells.get("date") ?? "");
        if (!period || !fiscalDateEnding || !reportDate) return;
        const ref = sourceRef(
          "earnings-labs",
          input.url,
          input.fetchedAt,
          "public-page",
        );
        const candidate = emptyCandidate({
          ticker: input.ticker,
          ...period,
          fiscalDateEnding,
          reportDate,
          currency: input.currency,
        });
        candidate.revenueEstimate = parseScaledNumber(cells.get("revenue estimate") ?? "");
        candidate.revenueActual = parseScaledNumber(cells.get("revenue actual") ?? "");
        candidate.epsEstimate = parseScaledNumber(cells.get("eps estimate") ?? "");
        candidate.epsActual = parseScaledNumber(cells.get("eps actual") ?? "");
        candidate.fieldSources.reportDate = ref;
        if (candidate.revenueEstimate !== null) candidate.fieldSources.revenueEstimate = ref;
        if (candidate.revenueActual !== null) candidate.fieldSources.revenueActual = ref;
        if (candidate.epsEstimate !== null) candidate.fieldSources.epsEstimate = ref;
        if (candidate.epsActual !== null) candidate.fieldSources.epsActual = ref;
        candidates.push(candidate);
      });
  });
  return candidates;
}

function parseChartmillHtml(input: {
  html: string;
  ticker: string;
  currency: string;
  url: string;
  fetchedAt: string;
}) {
  const $ = load(input.html);
  const labels = new Map<string, string>();
  $("section[data-upcoming-earnings] dt").each((_index, term) => {
    const label = normalizedHeader($(term).text());
    const value = $(term).next("dd").text().replace(/\s+/g, " ").trim();
    if (label && value) labels.set(label, value);
  });
  const period = parseFiscalPeriod(labels.get("fiscal quarter") ?? "");
  const fiscalDateEnding = parseIsoDate(labels.get("fiscal date") ?? "");
  const reportDate = parseIsoDate(labels.get("report date") ?? "");
  if (!period || !fiscalDateEnding || !reportDate) return [];
  const ref = sourceRef(
    "chartmill",
    input.url,
    input.fetchedAt,
    "public-page",
  );
  const candidate = emptyCandidate({
    ticker: input.ticker,
    ...period,
    fiscalDateEnding,
    reportDate,
    currency: input.currency,
  });
  candidate.revenueEstimate = parseScaledNumber(labels.get("revenue consensus") ?? "");
  candidate.epsEstimate = parseScaledNumber(labels.get("eps consensus") ?? "");
  candidate.dilutedShares = parseScaledNumber(labels.get("diluted shares") ?? "");
  candidate.fieldSources.reportDate = ref;
  if (candidate.revenueEstimate !== null) candidate.fieldSources.revenueEstimate = ref;
  if (candidate.epsEstimate !== null) candidate.fieldSources.epsEstimate = ref;
  if (candidate.dilutedShares !== null) candidate.fieldSources.dilutedShares = ref;
  return candidate.revenueEstimate !== null || candidate.epsEstimate !== null
    ? [candidate]
    : [];
}

const SEC_FORMS = new Set(["10-Q", "10-K", "20-F", "40-F", "6-K", "8-K"]);

function secFactUnits(concept: JsonRecord) {
  return Object.values(asRecord(concept.units)).flatMap(asArray).map(asRecord);
}

function parseSecCompanyFacts(input: {
  payload: unknown;
  ticker: string;
  currency: string;
  url: string;
  fetchedAt: string;
}) {
  const facts = asRecord(asRecord(input.payload).facts);
  const taxonomy = asRecord(facts["us-gaap"] ?? facts.ifrs);
  const conceptNames = {
    revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
    netIncome: ["NetIncomeLoss", "ProfitLoss"],
    eps: ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare"],
    shares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  } as const;
  const rows = new Map<string, StocksPublicEarningsCandidate>();
  const ref = sourceRef("sec", input.url, input.fetchedAt, "official");

  for (const [field, concepts] of Object.entries(conceptNames)) {
    const concept = concepts.map((name) => asRecord(taxonomy[name])).find((value) => Object.keys(value).length);
    if (!concept) continue;
    for (const fact of secFactUnits(concept)) {
      if (!SEC_FORMS.has(stringValue(fact.form))) continue;
      const fiscalYear = Number(fact.fy);
      const fp = stringValue(fact.fp).toUpperCase();
      if (!Number.isInteger(fiscalYear) || !/^Q[1-4]$/.test(fp)) continue;
      const fiscalDateEnding = parseIsoDate(stringValue(fact.end));
      const reportDate = parseIsoDate(stringValue(fact.filed));
      const value = Number(fact.val);
      if (!fiscalDateEnding || !reportDate || !Number.isFinite(value)) continue;
      const key = `${fiscalYear}-${fp}-${fiscalDateEnding}`;
      const candidate =
        rows.get(key) ??
        emptyCandidate({
          ticker: input.ticker,
          fiscalYear,
          quarter: fp as StocksEarningsComparison["quarter"],
          fiscalDateEnding,
          reportDate,
          currency: input.currency,
        });
      candidate.fieldSources.reportDate = ref;
      if (field === "revenue") {
        candidate.revenueActual = value;
        candidate.fieldSources.revenueActual = ref;
      } else if (field === "netIncome") {
        candidate.netIncomeActual = value;
        candidate.fieldSources.netIncomeActual = ref;
      } else if (field === "eps") {
        candidate.epsActual = value;
        candidate.fieldSources.epsActual = ref;
      } else if (field === "shares") {
        candidate.dilutedShares = value;
        candidate.fieldSources.dilutedShares = ref;
      }
      rows.set(key, candidate);
    }
  }
  return [...rows.values()];
}

async function fetchResponse(input: {
  url: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  userAgent: string;
  asJson?: boolean;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.url, {
      signal: controller.signal,
      headers: { "User-Agent": input.userAgent, Accept: input.asJson ? "application/json" : "text/html" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return input.asJson ? await response.json() : await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readProvider(input: {
  provider: StocksEarningsProvider;
  ticker: string;
  calendarYear: number;
  nowMs: number;
  read: () => Promise<StocksPublicEarningsCandidate[]>;
}) {
  const key = `${input.provider}:${input.ticker}:${input.calendarYear}`;
  const cached = publicEarningsCache.get(key);
  if (cached && cached.expiresAt > input.nowMs) return cached.candidates;
  const candidates = await input.read();
  if (candidates.length > 0) {
    publicEarningsCache.set(key, {
      expiresAt: input.nowMs + CACHE_TTL_MS,
      candidates,
    });
  }
  return candidates;
}

export async function fetchPublicEarningsCandidates({
  stock,
  now,
  fetchImpl = fetch,
  env = process.env,
}: {
  stock: AlphaResearchStock;
  now: Date;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}) {
  const ticker = stock.ticker.trim().toUpperCase();
  const config = getStocksEarningsSourceConfig(ticker);
  const fetchedAt = now.toISOString();
  const timeoutMs = parseTimeout(env.STOCKS_EARNINGS_FETCH_TIMEOUT_MS);
  const calendarYear = now.getUTCFullYear();
  const nowMs = now.getTime();
  const userAgent = env.STOCKS_EARNINGS_USER_AGENT?.trim() || "SignalHub/1.0 (public earnings research)";
  const errors: string[] = [];
  const candidates: StocksPublicEarningsCandidate[] = [];

  const providers: Array<{
    provider: StocksEarningsProvider;
    read: () => Promise<StocksPublicEarningsCandidate[]>;
  }> = [];
  const officialUrl = config.officialIrUrls[0];
  if (officialUrl) {
    providers.push({
      provider: "official-ir",
      read: async () =>
        parseOfficialIrHtml({
          html: String(await fetchResponse({ url: officialUrl, fetchImpl, timeoutMs, userAgent })),
          ticker,
          currency: stock.listing.currency,
          url: officialUrl,
          fetchedAt,
        }),
    });
  }

  const secUserAgent = env.STOCKS_SEC_USER_AGENT?.trim();
  if (config.secCik && secUserAgent) {
    const secUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${config.secCik}.json`;
    providers.push({
      provider: "sec",
      read: async () =>
        parseSecCompanyFacts({
          payload: await fetchResponse({
            url: secUrl,
            fetchImpl,
            timeoutMs,
            userAgent: secUserAgent,
            asJson: true,
          }),
          ticker,
          currency: stock.listing.currency,
          url: secUrl,
          fetchedAt,
        }),
    });
  } else if (config.secCik) {
    errors.push("SEC skipped: STOCKS_SEC_USER_AGENT is missing");
  }

  const earningsLabsUrl = `https://www.earningslabs.com/stock/${encodeURIComponent(config.earningsLabsTicker)}/earnings`;
  providers.push({
    provider: "earnings-labs",
    read: async () =>
      parseEarningsLabsHtml({
        html: String(await fetchResponse({ url: earningsLabsUrl, fetchImpl, timeoutMs, userAgent })),
        ticker,
        currency: stock.listing.currency,
        url: earningsLabsUrl,
        fetchedAt,
      }),
  });

  const chartmillUrl = `https://www.chartmill.com/stock/quote/${encodeURIComponent(config.chartmillTicker)}/analyst-ratings`;
  providers.push({
    provider: "chartmill",
    read: async () =>
      parseChartmillHtml({
        html: String(await fetchResponse({ url: chartmillUrl, fetchImpl, timeoutMs, userAgent })),
        ticker,
        currency: stock.listing.currency,
        url: chartmillUrl,
        fetchedAt,
      }),
  });

  for (const entry of providers.slice(0, 4)) {
    try {
      const providerCandidates = await readProvider({
        provider: entry.provider,
        ticker,
        calendarYear,
        nowMs,
        read: entry.read,
      });
      if (providerCandidates.length === 0) {
        errors.push(`${entry.provider} schema mismatch`);
      } else {
        candidates.push(...providerCandidates);
      }
    } catch (error) {
      errors.push(
        `${entry.provider} ${error instanceof Error ? error.message : "request failed"}`,
      );
    }
  }

  return { candidates, errors };
}
