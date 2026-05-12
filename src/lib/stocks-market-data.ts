import type {
  AlphaResearchCandle,
  AlphaResearchMarket,
  AlphaResearchMarketFreshness,
  AlphaResearchMarketProviderTraceItem,
  AlphaResearchSession,
  AlphaResearchStock,
} from "./alpha-research-pool.ts";

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type EnvLike = Record<string, string | undefined>;

export type StocksMarketDataSource = "live" | "mock";
export type StocksMarketDataProvider =
  | "finnhub"
  | "massive"
  | "fmp"
  | "alpha-vantage"
  | "naver"
  | "yahoo"
  | "mock";
export type StocksMarketFreshness = AlphaResearchMarketFreshness;
export type StocksMarketProviderTraceItem =
  AlphaResearchMarketProviderTraceItem;

export type StocksMarketQuote = {
  ticker: string;
  lastPrice: number;
  dayChangePct: number;
  prePostChangePct: number;
  prePostAvailable?: boolean;
  sevenDayChangePct: number;
  relativeStrengthLabel: string;
  marketSession: AlphaResearchSession;
  candles3d: AlphaResearchCandle[];
  source: StocksMarketDataSource;
  provider: StocksMarketDataProvider;
  freshness: StocksMarketFreshness;
  fallbackUsed: boolean;
  dataQualityLabel: string;
  trace: StocksMarketProviderTraceItem[];
  updatedAt: string;
};

export type StocksMarketSnapshot = {
  generatedAt: string;
  source: StocksMarketDataSource;
  provider: StocksMarketDataProvider;
  freshness: StocksMarketFreshness;
  fallbackUsed: boolean;
  trace: StocksMarketProviderTraceItem[];
  quotes: Record<string, StocksMarketQuote>;
  errors: string[];
};

type StocksMarketQuoteCore = Omit<
  StocksMarketQuote,
  "provider" | "freshness" | "fallbackUsed" | "dataQualityLabel" | "trace"
>;
type ParsedQuoteRow = Omit<
  StocksMarketQuoteCore,
  | "candles3d"
  | "sevenDayChangePct"
  | "relativeStrengthLabel"
  | "source"
  | "updatedAt"
>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formattedNumberValue(value: unknown): number | null {
  return numberValue(
    typeof value === "string" ? value.replace(/,/g, "") : value,
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredNumber(value: unknown, fallback = 0) {
  return numberValue(value) ?? fallback;
}

function nonNegativeInt(
  raw: string | undefined,
  fallback: number,
  max: number,
) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, max)
    : fallback;
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function percentChange(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous === 0) return 0;
  return roundPercent(((current - previous) / previous) * 100);
}

function formatMarketDate(timestampSeconds: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(timestampSeconds * 1000));
}

function marketSessionFromState(state: string): AlphaResearchSession {
  const normalized = state.toUpperCase();
  if (normalized.includes("PRE")) return "pre-market";
  if (normalized.includes("POST")) return "after-hours";
  return "regular";
}

function marketSessionFromFmpRow(row: JsonRecord): AlphaResearchSession {
  if (
    numberValue(row.afterHoursChangePercent) !== null ||
    numberValue(row.afterHoursChangePercentage) !== null ||
    numberValue(row.afterMarketChangePercent) !== null ||
    numberValue(row.afterMarketChangePercentage) !== null ||
    numberValue(row.postMarketChangePercent) !== null
  ) {
    return "after-hours";
  }
  if (
    numberValue(row.preMarketChangePercent) !== null ||
    numberValue(row.preMarketChangePercentage) !== null
  ) {
    return "pre-market";
  }
  return "regular";
}

function relativeStrengthLabel(sevenDayChangePct: number) {
  if (sevenDayChangePct >= 8) return "强势";
  if (sevenDayChangePct >= 3) return "跑赢";
  if (sevenDayChangePct <= -5) return "转弱";
  if (sevenDayChangePct < 0) return "震荡偏弱";
  return "震荡";
}

function providerLabel(provider: StocksMarketDataProvider) {
  const labels: Record<StocksMarketDataProvider, string> = {
    finnhub: "Finnhub",
    massive: "Massive",
    fmp: "FMP",
    "alpha-vantage": "Alpha Vantage",
    naver: "Naver",
    yahoo: "Yahoo",
    mock: "Mock",
  };
  return labels[provider];
}

function freshnessForProvider(
  provider: StocksMarketDataProvider,
  source: StocksMarketDataSource,
): StocksMarketFreshness {
  if (source === "mock" || provider === "mock") return "mock";
  if (provider === "alpha-vantage") return "delayed";
  return "realtime";
}

function freshnessLabel(freshness: StocksMarketFreshness) {
  if (freshness === "realtime") return "实时";
  if (freshness === "delayed") return "延迟";
  return "Mock";
}

function dataQualityLabel({
  provider,
  freshness,
  fallbackUsed,
}: {
  provider: StocksMarketDataProvider;
  freshness: StocksMarketFreshness;
  fallbackUsed: boolean;
}) {
  const prefix = fallbackUsed
    ? `回落到 ${providerLabel(provider)}`
    : providerLabel(provider);
  return `${prefix} / ${freshnessLabel(freshness)}`;
}

function successTrace(
  provider: StocksMarketDataProvider,
  quoteCount: number,
): StocksMarketProviderTraceItem {
  return {
    provider,
    status: "success",
    message: `${providerLabel(provider)} returned ${quoteCount} quote${
      quoteCount === 1 ? "" : "s"
    }`,
    quoteCount,
    timestamp: new Date().toISOString(),
  };
}

function failedTrace(
  provider: StocksMarketDataProvider,
  error: unknown,
): StocksMarketProviderTraceItem {
  return {
    provider,
    status: "failed",
    message: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  };
}

function withMarketMetadata(
  snapshot: Omit<
    StocksMarketSnapshot,
    "freshness" | "fallbackUsed" | "trace" | "quotes"
  > & {
    quotes: Record<string, StocksMarketQuoteCore | StocksMarketQuote>;
    freshness?: StocksMarketFreshness;
    fallbackUsed?: boolean;
    trace?: StocksMarketProviderTraceItem[];
  },
  options?: {
    fallbackUsed?: boolean;
    trace?: StocksMarketProviderTraceItem[];
  },
): StocksMarketSnapshot {
  const freshness =
    snapshot.freshness ?? freshnessForProvider(snapshot.provider, snapshot.source);
  const fallbackUsed = options?.fallbackUsed ?? snapshot.fallbackUsed ?? false;
  const trace =
    options?.trace ??
    snapshot.trace ??
    [successTrace(snapshot.provider, Object.keys(snapshot.quotes).length)];
  const qualityLabel = dataQualityLabel({
    provider: snapshot.provider,
    freshness,
    fallbackUsed,
  });

  return {
    ...snapshot,
    freshness,
    fallbackUsed,
    trace,
    quotes: Object.fromEntries(
      Object.entries(snapshot.quotes).map(([ticker, quote]) => [
        ticker,
        {
          ...quote,
          provider: "provider" in quote ? quote.provider : snapshot.provider,
          freshness: "freshness" in quote ? quote.freshness : freshness,
          fallbackUsed:
            options?.fallbackUsed !== undefined
              ? fallbackUsed
              : "fallbackUsed" in quote
                ? quote.fallbackUsed
                : fallbackUsed,
          dataQualityLabel:
            options?.fallbackUsed !== undefined
              ? dataQualityLabel({
                  provider:
                    "provider" in quote ? quote.provider : snapshot.provider,
                  freshness: "freshness" in quote ? quote.freshness : freshness,
                  fallbackUsed,
                })
              : "dataQualityLabel" in quote
                ? quote.dataQualityLabel
                : qualityLabel,
          trace:
            options?.trace !== undefined
              ? trace
              : "trace" in quote
                ? quote.trace
                : trace,
        },
      ]),
    ),
  };
}

function quoteNeedsFallbackCandles(quote: StocksMarketQuote) {
  return quote.source === "live" && quote.candles3d.length === 0;
}

function snapshotNeedsFallback(
  snapshot: StocksMarketSnapshot,
  tickers: string[],
) {
  return tickers.some((ticker) => {
    return !snapshot.quotes[ticker];
  });
}

function mergeFallbackMarketSnapshot({
  primary,
  fallback,
  tickers,
}: {
  primary: StocksMarketSnapshot;
  fallback: StocksMarketSnapshot;
  tickers: string[];
}): StocksMarketSnapshot {
  const quotes: Record<string, StocksMarketQuote> = { ...primary.quotes };
  let fallbackUsed = false;
  const trace = [...primary.trace, ...fallback.trace];

  for (const ticker of tickers) {
    const primaryQuote = quotes[ticker];
    const fallbackQuote = fallback.quotes[ticker];
    if (!fallbackQuote) continue;

    if (!primaryQuote) {
      fallbackUsed = true;
      const provider = fallbackQuote.provider ?? fallback.provider;
      const freshness = fallbackQuote.freshness ?? fallback.freshness;
      quotes[ticker] = {
        ...fallbackQuote,
        fallbackUsed: true,
        dataQualityLabel: dataQualityLabel({
          provider,
          freshness,
          fallbackUsed: true,
        }),
        trace,
      };
      continue;
    }

    if (
      quoteNeedsFallbackCandles(primaryQuote) &&
      fallbackQuote.candles3d.length > 0
    ) {
      fallbackUsed = true;
      const sevenDayChangePct = sevenDayChangeFromCandles(
        fallbackQuote.candles3d,
        primaryQuote.lastPrice,
      );
      quotes[ticker] = {
        ...primaryQuote,
        candles3d: fallbackQuote.candles3d,
        sevenDayChangePct,
        relativeStrengthLabel: relativeStrengthLabel(sevenDayChangePct),
        trace,
      };
    }
  }

  return withMarketMetadata({
    ...primary,
    fallbackUsed: primary.fallbackUsed || fallbackUsed,
    trace,
    quotes,
    errors: [...primary.errors, ...fallback.errors],
  });
}

function nanosecondsToIso(value: unknown) {
  const raw = numberValue(value);
  if (raw === null) return new Date().toISOString();
  return new Date(raw / 1_000_000).toISOString();
}

function alphaVantageTradingDayToIso(value: string) {
  if (!value) return new Date().toISOString();
  const date = new Date(`${value}T21:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : new Date().toISOString();
}

function secondsToIso(value: unknown) {
  const raw = numberValue(value);
  if (raw === null || raw <= 0) return new Date().toISOString();
  return new Date(raw * 1000).toISOString();
}

function timestampStringToIso(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return new Date().toISOString();
  const normalized = raw.replace(/(\.\d{3})\d+/, "$1");
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : new Date().toISOString();
}

export function parseYahooQuoteRows(payload: unknown) {
  const quoteResponse = asRecord(asRecord(payload).quoteResponse);
  return asArray(quoteResponse.result)
    .map((item): ParsedQuoteRow | null => {
      const row = asRecord(item);
      const ticker =
        typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
      const lastPrice = numberValue(row.regularMarketPrice);
      if (!ticker || lastPrice === null) return null;

      const previousClose = requiredNumber(
        row.regularMarketPreviousClose,
        lastPrice,
      );
      const marketState =
        typeof row.marketState === "string" ? row.marketState : "REGULAR";
      const marketSession = marketSessionFromState(marketState);
      const prePostChangePct =
        marketSession === "pre-market"
          ? numberValue(row.preMarketChangePercent)
          : marketSession === "after-hours"
            ? numberValue(row.postMarketChangePercent)
            : null;

      return {
        ticker,
        lastPrice: roundPrice(lastPrice),
        dayChangePct: roundPercent(
          numberValue(row.regularMarketChangePercent) ??
            percentChange(lastPrice, previousClose),
        ),
        prePostChangePct: roundPercent(prePostChangePct ?? 0),
        prePostAvailable: prePostChangePct !== null,
        marketSession,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export function parseMassiveSnapshotRows(payload: unknown) {
  return asArray(asRecord(payload).tickers)
    .map((item): StocksMarketQuoteCore | null => {
      const row = asRecord(item);
      const ticker =
        typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
      const lastTrade = asRecord(row.lastTrade);
      const day = asRecord(row.day);
      const min = asRecord(row.min);
      const prevDay = asRecord(row.prevDay);
      const lastPrice =
        numberValue(lastTrade.p) ??
        numberValue(day.c) ??
        numberValue(min.c) ??
        numberValue(prevDay.c);
      if (!ticker || lastPrice === null) return null;
      const previousClose = requiredNumber(prevDay.c, lastPrice);
      const dayChangePct =
        numberValue(row.todaysChangePerc) ??
        percentChange(lastPrice, previousClose);

      return {
        ticker,
        lastPrice: roundPrice(lastPrice),
        dayChangePct: roundPercent(dayChangePct),
        prePostChangePct: 0,
        prePostAvailable: false,
        sevenDayChangePct: 0,
        relativeStrengthLabel: relativeStrengthLabel(0),
        marketSession: "regular",
        candles3d: [],
        source: "live",
        updatedAt: nanosecondsToIso(row.updated),
      };
    })
    .filter((row): row is StocksMarketQuote => Boolean(row));
}

export function parseAlphaVantageGlobalQuote(
  symbol: string,
  payload: unknown,
): StocksMarketQuoteCore | null {
  const row = asRecord(asRecord(payload)["Global Quote"]);
  const ticker =
    stringValue(row["01. symbol"]).toUpperCase() ||
    symbol.trim().toUpperCase();
  const lastPrice = numberValue(row["05. price"]);
  if (!ticker || lastPrice === null) return null;

  const previousClose = requiredNumber(row["08. previous close"], lastPrice);
  const rawChangePercent = stringValue(row["10. change percent"]).replace(
    /%$/,
    "",
  );
  const latestTradingDay = stringValue(row["07. latest trading day"]);

  return {
    ticker,
    lastPrice: roundPrice(lastPrice),
    dayChangePct: roundPercent(
      numberValue(rawChangePercent) ?? percentChange(lastPrice, previousClose),
    ),
    prePostChangePct: 0,
    prePostAvailable: false,
    sevenDayChangePct: 0,
    relativeStrengthLabel: relativeStrengthLabel(0),
    marketSession: "regular",
    candles3d: [],
    source: "live",
    updatedAt: alphaVantageTradingDayToIso(latestTradingDay),
  };
}

export function parseFinnhubQuote(
  symbol: string,
  payload: unknown,
): StocksMarketQuoteCore | null {
  const row = asRecord(payload);
  const ticker = symbol.trim().toUpperCase();
  const lastPrice = numberValue(row.c);
  if (!ticker || lastPrice === null || lastPrice <= 0) return null;

  const previousClose = requiredNumber(row.pc, lastPrice);
  return {
    ticker,
    lastPrice: roundPrice(lastPrice),
    dayChangePct: roundPercent(
      numberValue(row.dp) ?? percentChange(lastPrice, previousClose),
    ),
    prePostChangePct: 0,
    prePostAvailable: false,
    sevenDayChangePct: 0,
    relativeStrengthLabel: relativeStrengthLabel(0),
    marketSession: "regular",
    candles3d: [],
    source: "live",
    updatedAt: secondsToIso(row.t),
  };
}

export function parseNaverRealtimeDomesticStock(
  ticker: string,
  payload: unknown,
): StocksMarketQuoteCore | null {
  const row = asRecord(asArray(asRecord(payload).datas)[0] ?? payload);
  const normalizedTicker = ticker.trim().toUpperCase();
  const closePrice =
    formattedNumberValue(row.closePriceRaw) ??
    formattedNumberValue(row.closePrice);
  if (!normalizedTicker || closePrice === null || closePrice <= 0) return null;

  const closeChangePct =
    formattedNumberValue(row.fluctuationsRatioRaw) ??
    formattedNumberValue(row.fluctuationsRatio) ??
    0;
  const overMarketPriceInfo = asRecord(row.overMarketPriceInfo);
  const overPrice = formattedNumberValue(overMarketPriceInfo.overPrice);
  const overChangePct = formattedNumberValue(
    overMarketPriceInfo.fluctuationsRatio,
  );
  const hasOverMarketPrice = overPrice !== null && overPrice > 0;
  const lastPrice = hasOverMarketPrice ? overPrice : closePrice;
  const dayChangePct =
    hasOverMarketPrice && overChangePct !== null
      ? overChangePct
      : closeChangePct;
  const overTimestamp = stringValue(overMarketPriceInfo.localTradedAt);
  const marketStatus = stringValue(row.marketStatus).toUpperCase();

  return {
    ticker: normalizedTicker,
    lastPrice: roundPrice(lastPrice),
    dayChangePct: roundPercent(dayChangePct),
    prePostChangePct: hasOverMarketPrice
      ? percentChange(overPrice, closePrice)
      : 0,
    prePostAvailable: hasOverMarketPrice,
    sevenDayChangePct: 0,
    relativeStrengthLabel: relativeStrengthLabel(0),
    marketSession: hasOverMarketPrice
      ? "after-hours"
      : marketStatus === "OPEN"
        ? "regular"
        : "regular",
    candles3d: [],
    source: "live",
    updatedAt: timestampStringToIso(
      overTimestamp || stringValue(row.localTradedAt),
    ),
  };
}

export function parseFmpQuoteRows(payload: unknown) {
  return asArray(payload)
    .map((item): ParsedQuoteRow | null => {
      const row = asRecord(item);
      const ticker =
        typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
      const lastPrice = numberValue(row.price ?? row.regularMarketPrice);
      if (!ticker || lastPrice === null) return null;

      const previousClose = requiredNumber(
        row.previousClose ?? row.regularMarketPreviousClose,
        lastPrice,
      );
      const marketSession = marketSessionFromFmpRow(row);
      const prePostChangePct =
        marketSession === "pre-market"
          ? numberValue(row.preMarketChangePercent) ??
            numberValue(row.preMarketChangePercentage)
          : marketSession === "after-hours"
            ? numberValue(row.afterHoursChangePercent) ??
              numberValue(row.afterHoursChangePercentage) ??
              numberValue(row.afterMarketChangePercent) ??
              numberValue(row.afterMarketChangePercentage) ??
              numberValue(row.postMarketChangePercent)
            : null;

      return {
        ticker,
        lastPrice: roundPrice(lastPrice),
        dayChangePct: roundPercent(
          numberValue(row.changesPercentage) ??
            numberValue(row.changePercentage) ??
            numberValue(row.regularMarketChangePercent) ??
            percentChange(lastPrice, previousClose),
        ),
        prePostChangePct: roundPercent(prePostChangePct ?? 0),
        prePostAvailable: prePostChangePct !== null,
        marketSession,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export function parseYahooChartCandles(
  ticker: string,
  payload: unknown,
): AlphaResearchCandle[] {
  const chart = asRecord(asRecord(payload).chart);
  const result = asRecord(asArray(chart.result)[0]);
  const timestamps = asArray(result.timestamp)
    .map((value) => numberValue(value))
    .filter((value): value is number => value !== null);
  const indicators = asRecord(result.indicators);
  const quote = asRecord(asArray(indicators.quote)[0]);
  const opens = asArray(quote.open);
  const highs = asArray(quote.high);
  const lows = asArray(quote.low);
  const closes = asArray(quote.close);
  const volumes = asArray(quote.volume);

  const rows = timestamps
    .map((timestamp, index) => {
      const open = numberValue(opens[index]);
      const high = numberValue(highs[index]);
      const low = numberValue(lows[index]);
      const close = numberValue(closes[index]);
      if (open === null || high === null || low === null || close === null) {
        return null;
      }
      return {
        date: formatMarketDate(timestamp),
        open: roundPrice(open),
        high: roundPrice(high),
        low: roundPrice(low),
        close: roundPrice(close),
        volume: requiredNumber(volumes[index], 0),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .slice(-3);

  const averageVolume =
    rows.reduce((sum, row) => sum + row.volume, 0) / Math.max(rows.length, 1);

  return rows.map((row) => ({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volumeLabel:
      averageVolume > 0 ? `${(row.volume / averageVolume).toFixed(1)}x` : "n/a",
  }));
}

export function parseFmpHistoricalCandles(
  ticker: string,
  payload: unknown,
): AlphaResearchCandle[] {
  void ticker;
  const rows = (Array.isArray(payload)
    ? payload
    : asArray(asRecord(payload).historical))
    .map((item) => {
      const row = asRecord(item);
      const open = numberValue(row.open);
      const high = numberValue(row.high);
      const low = numberValue(row.low);
      const close = numberValue(row.close);
      if (open === null || high === null || low === null || close === null) {
        return null;
      }
      return {
        date: typeof row.date === "string" ? row.date.slice(5) : "",
        open: roundPrice(open),
        high: roundPrice(high),
        low: roundPrice(low),
        close: roundPrice(close),
        volume: requiredNumber(row.volume, 0),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-3);

  const averageVolume =
    rows.reduce((sum, row) => sum + row.volume, 0) / Math.max(rows.length, 1);

  return rows.map((row) => ({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volumeLabel:
      averageVolume > 0 ? `${(row.volume / averageVolume).toFixed(1)}x` : "n/a",
  }));
}

export function parseFinnhubStockCandles(
  ticker: string,
  payload: unknown,
): AlphaResearchCandle[] {
  void ticker;
  const row = asRecord(payload);
  if (stringValue(row.s).toLowerCase() === "no_data") return [];

  const timestamps = asArray(row.t)
    .map((value) => numberValue(value))
    .filter((value): value is number => value !== null);
  const opens = asArray(row.o);
  const highs = asArray(row.h);
  const lows = asArray(row.l);
  const closes = asArray(row.c);
  const volumes = asArray(row.v);

  const rows = timestamps
    .map((timestamp, index) => {
      const open = numberValue(opens[index]);
      const high = numberValue(highs[index]);
      const low = numberValue(lows[index]);
      const close = numberValue(closes[index]);
      if (open === null || high === null || low === null || close === null) {
        return null;
      }
      return {
        date: formatMarketDate(timestamp),
        open: roundPrice(open),
        high: roundPrice(high),
        low: roundPrice(low),
        close: roundPrice(close),
        volume: requiredNumber(volumes[index], 0),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-3);

  const averageVolume =
    rows.reduce((sum, item) => sum + item.volume, 0) / Math.max(rows.length, 1);

  return rows.map((item) => ({
    date: item.date,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
    volumeLabel:
      averageVolume > 0 ? `${(item.volume / averageVolume).toFixed(1)}x` : "n/a",
  }));
}

function sevenDayChangeFromCandles(
  candles: AlphaResearchCandle[],
  lastPrice: number,
): number {
  const first = candles[0];
  if (!first) return 0;
  return percentChange(lastPrice, first.open);
}

function quoteUrl(tickers: string[]) {
  const symbols = tickers.map(encodeURIComponent).join(",");
  return `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
}

function chartUrl(ticker: string) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?range=10d&interval=1d&includePrePost=true`;
}

function fmpApiKey(env: EnvLike) {
  return env.STOCKS_FMP_API_KEY?.trim() || env.FMP_API_KEY?.trim() || "";
}

function finnhubApiKey(env: EnvLike) {
  return env.STOCKS_FINNHUB_API_KEY?.trim() || env.FINNHUB_API_KEY?.trim() || "";
}

function alphaVantageApiKey(env: EnvLike) {
  return (
    env.STOCKS_ALPHA_VANTAGE_API_KEY?.trim() ||
    env.ALPHA_VANTAGE_API_KEY?.trim() ||
    ""
  );
}

function massiveApiKey(env: EnvLike) {
  return (
    env.STOCKS_POLYGON_API_KEY?.trim() ||
    env.STOCKS_MASSIVE_API_KEY?.trim() ||
    env.POLYGON_API_KEY?.trim() ||
    env.MASSIVE_API_KEY?.trim() ||
    ""
  );
}

function massiveBaseUrl(env: EnvLike) {
  return (
    env.STOCKS_POLYGON_BASE_URL?.trim().replace(/\/+$/, "") ||
    env.STOCKS_MASSIVE_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://api.polygon.io"
  );
}

function massiveSnapshotUrl(tickers: string[], apiKey: string, env: EnvLike) {
  const params = new URLSearchParams({
    tickers: tickers.join(","),
    apiKey,
  });
  return `${massiveBaseUrl(env)}/v2/snapshot/locale/us/markets/stocks/tickers?${params.toString()}`;
}

function fmpQuoteUrl(tickers: string[], apiKey: string) {
  const params = new URLSearchParams({
    symbols: tickers.join(","),
    apikey: apiKey,
  });
  return `https://financialmodelingprep.com/stable/batch-quote?${params.toString()}`;
}

function fmpHistoricalUrl(ticker: string, apiKey: string) {
  const params = new URLSearchParams({
    symbol: ticker,
    from: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    apikey: apiKey,
  });
  return `https://financialmodelingprep.com/stable/historical-price-eod/full?${params.toString()}`;
}

function finnhubQuoteUrl(ticker: string, apiKey: string) {
  const params = new URLSearchParams({
    symbol: ticker,
    token: apiKey,
  });
  return `https://finnhub.io/api/v1/quote?${params.toString()}`;
}

function finnhubStockCandlesUrl(ticker: string, apiKey: string) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 14 * 24 * 60 * 60;
  const params = new URLSearchParams({
    symbol: ticker,
    resolution: "D",
    from: String(from),
    to: String(to),
    token: apiKey,
  });
  return `https://finnhub.io/api/v1/stock/candle?${params.toString()}`;
}

function alphaVantageGlobalQuoteUrl(ticker: string, apiKey: string) {
  const params = new URLSearchParams({
    function: "GLOBAL_QUOTE",
    symbol: ticker,
    apikey: apiKey,
  });
  return `https://www.alphavantage.co/query?${params.toString()}`;
}

function naverDomesticCode(ticker: string) {
  const match = ticker.trim().toUpperCase().match(/^(\d{6})\.KS$/);
  return match?.[1] ?? "";
}

function naverRealtimeDomesticStockUrl(ticker: string) {
  return `https://polling.finance.naver.com/api/realtime/domestic/stock/${naverDomesticCode(
    ticker,
  )}`;
}

function marketCacheMs(env: EnvLike) {
  return nonNegativeInt(
    env.STOCKS_MARKET_CACHE_MS,
    60 * 60 * 1000,
    24 * 60 * 60 * 1000,
  );
}

function marketCachePath(env: EnvLike) {
  return (
    env.STOCKS_MARKET_CACHE_PATH?.trim() ||
    ".signal-hub/stocks-market-cache.json"
  );
}

function isStocksMarketQuote(value: unknown): value is StocksMarketQuote {
  const row = asRecord(value);
  return (
    stringValue(row.ticker).length > 0 &&
    numberValue(row.lastPrice) !== null &&
    numberValue(row.dayChangePct) !== null &&
    stringValue(row.source) !== ""
  );
}

async function readStocksMarketCache({
  env,
  provider,
  tickers,
}: {
  env: EnvLike;
  provider: StocksMarketDataProvider;
  tickers: string[];
}): Promise<StocksMarketSnapshot | null> {
  const cacheMs = marketCacheMs(env);
  if (cacheMs <= 0) return null;
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(marketCachePath(env), "utf8");
    const snapshot = asRecord(JSON.parse(raw));
    if (snapshot.provider !== provider || snapshot.source !== "live") {
      return null;
    }
    const generatedAt = stringValue(snapshot.generatedAt);
    const generatedTime = Date.parse(generatedAt);
    if (!Number.isFinite(generatedTime) || Date.now() - generatedTime > cacheMs) {
      return null;
    }
    const cachedQuotes = asRecord(snapshot.quotes);
    const quotes = Object.fromEntries(
      tickers
        .map((ticker) => {
          const quote = cachedQuotes[ticker];
          return isStocksMarketQuote(quote)
            ? ([ticker, quote] as const)
            : null;
        })
        .filter((entry): entry is readonly [string, StocksMarketQuote] =>
          Boolean(entry),
        ),
    );
    if (Object.keys(quotes).length !== tickers.length) return null;
    return withMarketMetadata({
      generatedAt,
      source: "live",
      provider,
      quotes,
      errors: [],
    });
  } catch {
    return null;
  }
}

async function writeStocksMarketCache({
  env,
  snapshot,
}: {
  env: EnvLike;
  snapshot: StocksMarketSnapshot;
}) {
  if (marketCacheMs(env) <= 0 || snapshot.source !== "live") return;
  try {
    const [fs, path] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const cachePath = marketCachePath(env);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(snapshot), "utf8");
  } catch {
    // Cache writes are best-effort; market fetches should not fail because of disk IO.
  }
}

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export function buildMockStocksMarketSnapshot(
  stocks: AlphaResearchStock[],
): StocksMarketSnapshot {
  const generatedAt = new Date().toISOString();
  return withMarketMetadata({
    generatedAt,
    source: "mock",
    provider: "mock",
    errors: [],
    quotes: Object.fromEntries(
      stocks.map((stock) => [
        stock.ticker,
        {
          ticker: stock.ticker,
          ...stock.market,
          candles3d: stock.candles3d,
          prePostAvailable: false,
          source: "mock" as const,
          updatedAt: generatedAt,
        },
      ]),
    ),
  });
}

export async function fetchYahooStocksMarketSnapshot({
  tickers,
  fetchImpl = fetch,
}: {
  tickers: string[];
  fetchImpl?: FetchLike;
}): Promise<StocksMarketSnapshot> {
  const normalizedTickers = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );
  const generatedAt = new Date().toISOString();
  const quoteResponse = await fetchImpl(quoteUrl(normalizedTickers), {
    cache: "no-store",
  });
  if (!quoteResponse.ok) {
    throw new Error(`Yahoo quote HTTP ${quoteResponse.status}`);
  }

  const quoteRows = parseYahooQuoteRows(await quoteResponse.json());
  const quoteMap = new Map(quoteRows.map((row) => [row.ticker, row]));
  const errors: string[] = [];
  const entries: Array<readonly [string, StocksMarketQuoteCore] | null> =
    await Promise.all(
    normalizedTickers.map(async (ticker) => {
      const quote = quoteMap.get(ticker);
      if (!quote) return null;
      try {
        const chartResponse = await fetchImpl(chartUrl(ticker), {
          cache: "no-store",
        });
        if (!chartResponse.ok) {
          throw new Error(`Yahoo chart HTTP ${chartResponse.status}`);
        }
        const candles3d = parseYahooChartCandles(
          ticker,
          await chartResponse.json(),
        );
        const sevenDayChangePct = sevenDayChangeFromCandles(
          candles3d,
          quote.lastPrice,
        );
        return [
          ticker,
          {
            ...quote,
            candles3d,
            sevenDayChangePct,
            relativeStrengthLabel: relativeStrengthLabel(sevenDayChangePct),
            source: "live" as const,
            updatedAt: generatedAt,
          },
        ] as const;
      } catch (error) {
        errors.push(
          `${ticker}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    }),
    );

  const quoteEntries = entries.filter(
    (entry): entry is readonly [string, StocksMarketQuoteCore] => entry !== null,
  );
  const quotes = Object.fromEntries(quoteEntries);
  if (Object.keys(quotes).length === 0) {
    throw new Error("Yahoo market data returned no usable quotes");
  }

  return {
    ...withMarketMetadata({
      generatedAt,
      source: "live",
      provider: "yahoo",
      errors,
      quotes,
    }),
  };
}

export async function fetchFinnhubStocksMarketSnapshot({
  tickers,
  fetchImpl = fetch,
  env = process.env,
}: {
  tickers: string[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
}): Promise<StocksMarketSnapshot> {
  const apiKey = finnhubApiKey(env);
  if (!apiKey) throw new Error("Finnhub API key is not configured");
  const normalizedTickers = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );
  const maxTickers = nonNegativeInt(
    env.STOCKS_FINNHUB_MARKET_MAX_TICKERS,
    normalizedTickers.length,
    normalizedTickers.length,
  );
  const limitedTickers = normalizedTickers.slice(0, maxTickers);
  if (limitedTickers.length === 0) {
    throw new Error("Finnhub market quote limit is 0");
  }

  const generatedAt = new Date().toISOString();
  const requestDelayMs = nonNegativeInt(
    env.STOCKS_FINNHUB_MARKET_REQUEST_DELAY_MS,
    250,
    30000,
  );
  const chartTickerSet = new Set(
    limitedTickers.slice(
      0,
      nonNegativeInt(
        env.STOCKS_FINNHUB_MARKET_CHART_MAX_TICKERS,
        0,
        limitedTickers.length,
      ),
    ),
  );
  const entries: Array<readonly [string, StocksMarketQuoteCore]> = [];
  const errors: string[] = [];

  for (const [index, ticker] of limitedTickers.entries()) {
    if (index > 0 && requestDelayMs > 0) {
      await delay(requestDelayMs);
    }
    try {
      const quoteResponse = await fetchImpl(finnhubQuoteUrl(ticker, apiKey), {
        cache: "no-store",
      });
      if (!quoteResponse.ok) {
        throw new Error(`Finnhub quote HTTP ${quoteResponse.status}`);
      }
      const quote = parseFinnhubQuote(ticker, await quoteResponse.json());
      if (!quote) throw new Error("Finnhub returned no usable quote");

      let candles3d: AlphaResearchCandle[] = [];
      if (chartTickerSet.has(ticker)) {
        try {
          const chartResponse = await fetchImpl(
            finnhubStockCandlesUrl(ticker, apiKey),
            { cache: "no-store" },
          );
          if (!chartResponse.ok) {
            throw new Error(`Finnhub candle HTTP ${chartResponse.status}`);
          }
          candles3d = parseFinnhubStockCandles(
            ticker,
            await chartResponse.json(),
          );
        } catch (chartError) {
          errors.push(
            `${ticker}: ${
              chartError instanceof Error ? chartError.message : String(chartError)
            }`,
          );
        }
      }

      const sevenDayChangePct = sevenDayChangeFromCandles(
        candles3d,
        quote.lastPrice,
      );
      entries.push([
        quote.ticker,
        {
          ...quote,
          candles3d,
          sevenDayChangePct,
          relativeStrengthLabel: relativeStrengthLabel(sevenDayChangePct),
          updatedAt: quote.updatedAt || generatedAt,
        },
      ]);
    } catch (error) {
      errors.push(
        `${ticker}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const quotes = Object.fromEntries(entries);
  if (Object.keys(quotes).length === 0) {
    throw new Error(
      errors.length > 0
        ? `Finnhub market data returned no usable quotes (${errors.join("; ")})`
        : "Finnhub market data returned no usable quotes",
    );
  }

  return withMarketMetadata({
    generatedAt,
    source: "live",
    provider: "finnhub",
    errors,
    quotes,
  });
}

export async function fetchMassiveStocksMarketSnapshot({
  tickers,
  fetchImpl = fetch,
  env = process.env,
}: {
  tickers: string[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
}): Promise<StocksMarketSnapshot> {
  const apiKey = massiveApiKey(env);
  if (!apiKey) throw new Error("Massive API key is not configured");
  const normalizedTickers = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );
  const response = await fetchImpl(
    massiveSnapshotUrl(normalizedTickers, apiKey, env),
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Massive snapshot HTTP ${response.status}`);
  }
  const quoteRows = parseMassiveSnapshotRows(await response.json());
  const quotes = Object.fromEntries(quoteRows.map((row) => [row.ticker, row]));
  if (Object.keys(quotes).length === 0) {
    throw new Error("Massive snapshot returned no usable quotes");
  }
  return withMarketMetadata({
    generatedAt: new Date().toISOString(),
    source: "live",
    provider: "massive",
    errors: [],
    quotes,
  });
}

export async function fetchFmpStocksMarketSnapshot({
  tickers,
  fetchImpl = fetch,
  env = process.env,
}: {
  tickers: string[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
}): Promise<StocksMarketSnapshot> {
  const apiKey = fmpApiKey(env);
  if (!apiKey) throw new Error("FMP API key is not configured");
  const normalizedTickers = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );
  const generatedAt = new Date().toISOString();
  const quoteResponse = await fetchImpl(fmpQuoteUrl(normalizedTickers, apiKey), {
    cache: "no-store",
  });
  if (!quoteResponse.ok) {
    throw new Error(`FMP quote HTTP ${quoteResponse.status}`);
  }

  const quoteRows = parseFmpQuoteRows(await quoteResponse.json());
  const quoteMap = new Map(quoteRows.map((row) => [row.ticker, row]));
  const errors: string[] = [];
  const chartTickerSet = new Set(
    normalizedTickers.slice(
      0,
      nonNegativeInt(
        env.STOCKS_FMP_MARKET_CHART_MAX_TICKERS,
        normalizedTickers.length,
        normalizedTickers.length,
      ),
    ),
  );
  const entries: Array<readonly [string, StocksMarketQuoteCore] | null> =
    await Promise.all(
      normalizedTickers.map(async (ticker) => {
        const quote = quoteMap.get(ticker);
        if (!quote) return null;
        if (!chartTickerSet.has(ticker)) {
          return [
            ticker,
            {
              ...quote,
              candles3d: [],
              sevenDayChangePct: 0,
              relativeStrengthLabel: relativeStrengthLabel(0),
              source: "live" as const,
              updatedAt: generatedAt,
            },
          ] as const;
        }
        try {
          const chartResponse = await fetchImpl(fmpHistoricalUrl(ticker, apiKey), {
            cache: "no-store",
          });
          if (!chartResponse.ok) {
            throw new Error(`FMP historical HTTP ${chartResponse.status}`);
          }
          const candles3d = parseFmpHistoricalCandles(
            ticker,
            await chartResponse.json(),
          );
          const sevenDayChangePct = sevenDayChangeFromCandles(
            candles3d,
            quote.lastPrice,
          );
          return [
            ticker,
            {
              ...quote,
              candles3d,
              sevenDayChangePct,
              relativeStrengthLabel: relativeStrengthLabel(sevenDayChangePct),
              source: "live" as const,
              updatedAt: generatedAt,
            },
          ] as const;
        } catch (error) {
          errors.push(
            `${ticker}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [
            ticker,
            {
              ...quote,
              candles3d: [],
              sevenDayChangePct: 0,
              relativeStrengthLabel: relativeStrengthLabel(0),
              source: "live" as const,
              updatedAt: generatedAt,
            },
          ] as const;
        }
      }),
    );

  const quoteEntries = entries.filter(
    (entry): entry is readonly [string, StocksMarketQuoteCore] => entry !== null,
  );
  const quotes = Object.fromEntries(quoteEntries);
  if (Object.keys(quotes).length === 0) {
    throw new Error("FMP market data returned no usable quotes");
  }

  return withMarketMetadata({
    generatedAt,
    source: "live",
    provider: "fmp",
    errors,
    quotes,
  });
}

export async function fetchAlphaVantageStocksMarketSnapshot({
  tickers,
  fetchImpl = fetch,
  env = process.env,
}: {
  tickers: string[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
}): Promise<StocksMarketSnapshot> {
  const apiKey = alphaVantageApiKey(env);
  if (!apiKey) throw new Error("Alpha Vantage API key is not configured");
  const normalizedTickers = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );
  const maxTickers = nonNegativeInt(
    env.STOCKS_ALPHA_VANTAGE_MARKET_MAX_TICKERS,
    1,
    normalizedTickers.length,
  );
  const limitedTickers = normalizedTickers.slice(0, maxTickers);
  if (limitedTickers.length === 0) {
    throw new Error("Alpha Vantage market quote limit is 0");
  }

  const cachedSnapshot = await readStocksMarketCache({
    env,
    provider: "alpha-vantage",
    tickers: limitedTickers,
  });
  if (cachedSnapshot) return cachedSnapshot;

  const generatedAt = new Date().toISOString();
  const requestDelayMs = nonNegativeInt(
    env.STOCKS_ALPHA_VANTAGE_MARKET_REQUEST_DELAY_MS,
    1200,
    30000,
  );
  const entries: Array<readonly [string, StocksMarketQuoteCore]> = [];
  const errors: string[] = [];

  for (const [index, ticker] of limitedTickers.entries()) {
    if (index > 0 && requestDelayMs > 0) {
      await delay(requestDelayMs);
    }
    try {
      const response = await fetchImpl(alphaVantageGlobalQuoteUrl(ticker, apiKey), {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Alpha Vantage quote HTTP ${response.status}`);
      }
      const quote = parseAlphaVantageGlobalQuote(ticker, await response.json());
      if (!quote) throw new Error("Alpha Vantage returned no usable quote");
      entries.push([
        quote.ticker,
        {
          ...quote,
          updatedAt: quote.updatedAt || generatedAt,
        },
      ]);
    } catch (error) {
      errors.push(
        `${ticker}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const quotes = Object.fromEntries(entries);
  if (Object.keys(quotes).length === 0) {
    throw new Error(
      errors.length > 0
        ? `Alpha Vantage market data returned no usable quotes (${errors.join("; ")})`
        : "Alpha Vantage market data returned no usable quotes",
    );
  }

  const snapshot = withMarketMetadata({
    generatedAt,
    source: "live",
    provider: "alpha-vantage",
    errors,
    quotes,
  });
  await writeStocksMarketCache({ env, snapshot });
  return snapshot;
}

export async function fetchNaverStocksMarketSnapshot({
  tickers,
  fetchImpl = fetch,
}: {
  tickers: string[];
  fetchImpl?: FetchLike;
}): Promise<StocksMarketSnapshot> {
  const normalizedTickers = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );
  const naverTickers = normalizedTickers.filter((ticker) =>
    Boolean(naverDomesticCode(ticker)),
  );
  if (naverTickers.length === 0) {
    throw new Error("Naver market data supports only KRX .KS tickers");
  }

  const generatedAt = new Date().toISOString();
  const errors: string[] = [];
  const entries: Array<readonly [string, StocksMarketQuoteCore]> = [];

  for (const ticker of naverTickers) {
    try {
      const response = await fetchImpl(naverRealtimeDomesticStockUrl(ticker), {
        cache: "no-store",
        headers: {
          accept: "application/json,text/plain,*/*",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`Naver quote HTTP ${response.status}`);
      }
      const quote = parseNaverRealtimeDomesticStock(ticker, await response.json());
      if (!quote) throw new Error("Naver returned no usable quote");
      entries.push([ticker, quote]);
    } catch (error) {
      errors.push(
        `${ticker}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const quotes = Object.fromEntries(entries);
  if (Object.keys(quotes).length === 0) {
    throw new Error(
      errors.length > 0
        ? `Naver market data returned no usable quotes (${errors.join("; ")})`
        : "Naver market data returned no usable quotes",
    );
  }

  return withMarketMetadata({
    generatedAt,
    source: "live",
    provider: "naver",
    freshness: "realtime",
    errors,
    quotes,
  });
}

export async function getStocksMarketSnapshot({
  stocks,
  fetchImpl = fetch,
  env = process.env,
  provider = finnhubApiKey(env) ? "finnhub" : "yahoo",
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
  provider?: StocksMarketDataProvider;
}): Promise<StocksMarketSnapshot> {
  if (provider === "mock") return buildMockStocksMarketSnapshot(stocks);
  const tickers = stocks.map((stock) => stock.ticker);
  const errors: string[] = [];
  const trace: StocksMarketProviderTraceItem[] = [];
  const naverFallbackProviders = tickers.some((ticker) =>
    Boolean(naverDomesticCode(ticker)),
  )
    ? (["naver"] as const)
    : ([] as const);

  const providerChain =
    provider === "finnhub"
      ? (["finnhub", ...naverFallbackProviders, "yahoo"] as const)
      : provider === "massive"
        ? ([
            "massive",
            ...(fmpApiKey(env) ? ["fmp" as const] : []),
            ...(alphaVantageApiKey(env) ? ["alpha-vantage" as const] : []),
            ...naverFallbackProviders,
            "yahoo",
          ] as const)
        : provider === "fmp"
          ? ([
              "fmp",
              ...(alphaVantageApiKey(env) ? ["alpha-vantage" as const] : []),
              ...naverFallbackProviders,
              "yahoo",
            ] as const)
          : provider === "alpha-vantage"
            ? (["alpha-vantage", ...naverFallbackProviders, "yahoo"] as const)
            : provider === "naver"
              ? (["naver", "yahoo"] as const)
            : (["yahoo"] as const);

  const fetchProviderSnapshot = (activeProvider: (typeof providerChain)[number]) =>
    activeProvider === "finnhub"
      ? fetchFinnhubStocksMarketSnapshot({
          tickers,
          fetchImpl,
          env,
        })
      : activeProvider === "massive"
        ? fetchMassiveStocksMarketSnapshot({
            tickers,
            fetchImpl,
            env,
          })
        : activeProvider === "fmp"
          ? fetchFmpStocksMarketSnapshot({
              tickers,
              fetchImpl,
              env,
            })
          : activeProvider === "alpha-vantage"
            ? fetchAlphaVantageStocksMarketSnapshot({
                tickers,
                fetchImpl,
                env,
              })
            : activeProvider === "naver"
              ? fetchNaverStocksMarketSnapshot({
                  tickers,
                  fetchImpl,
                })
            : fetchYahooStocksMarketSnapshot({
                tickers,
                fetchImpl,
              });

  for (const [index, activeProvider] of providerChain.entries()) {
    try {
      const snapshot = await fetchProviderSnapshot(activeProvider);
      const primarySnapshot = withMarketMetadata(
        {
          ...snapshot,
          errors: [...errors, ...snapshot.errors],
        },
        {
          fallbackUsed: trace.length > 0,
          trace: [...trace, ...snapshot.trace],
        },
      );
      if (!snapshotNeedsFallback(primarySnapshot, tickers)) {
        return primarySnapshot;
      }

      for (const fallbackProvider of providerChain.slice(index + 1)) {
        try {
          const fallbackSnapshot = await fetchProviderSnapshot(fallbackProvider);
          return mergeFallbackMarketSnapshot({
            primary: primarySnapshot,
            fallback: fallbackSnapshot,
            tickers,
          });
        } catch (fallbackError) {
          primarySnapshot.errors.push(
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
          );
          primarySnapshot.trace.push(failedTrace(fallbackProvider, fallbackError));
        }
      }

      return primarySnapshot;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      trace.push(failedTrace(activeProvider, error));
    }
  }

  const snapshot = buildMockStocksMarketSnapshot(stocks);
  return withMarketMetadata(
    {
      ...snapshot,
      errors,
    },
    {
      fallbackUsed: trace.length > 0,
      trace: [...trace, ...snapshot.trace],
    },
  );
}

export function mergeStocksMarketSnapshot(
  stocks: AlphaResearchStock[],
  snapshot: StocksMarketSnapshot | null,
): AlphaResearchStock[] {
  if (!snapshot) return stocks;
  return stocks.map((stock) => {
    const quote = snapshot.quotes[stock.ticker];
    if (!quote) return stock;
    const provider = quote.provider ?? snapshot.provider;
    const freshness =
      quote.freshness ??
      snapshot.freshness ??
      freshnessForProvider(provider, quote.source);
    const fallbackUsed = quote.fallbackUsed ?? snapshot.fallbackUsed ?? false;
    const market: AlphaResearchMarket = {
      ...stock.market,
      lastPrice: quote.lastPrice,
      dayChangePct: quote.dayChangePct,
      prePostChangePct: quote.prePostChangePct,
      prePostAvailable: quote.prePostAvailable,
      sevenDayChangePct: quote.sevenDayChangePct,
      relativeStrengthLabel: quote.relativeStrengthLabel,
      marketSession: quote.marketSession,
      source: quote.source,
      provider,
      freshness,
      fallbackUsed,
      dataQualityLabel:
        quote.dataQualityLabel ??
        dataQualityLabel({ provider, freshness, fallbackUsed }),
      providerTrace: quote.trace ?? snapshot.trace,
      updatedAt: quote.updatedAt,
      candlesSource: quote.candles3d.length > 0 ? quote.source : "mock",
    };
    return {
      ...stock,
      market,
      candles3d: quote.candles3d.length > 0 ? quote.candles3d : stock.candles3d,
    };
  });
}
