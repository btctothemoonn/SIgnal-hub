type EnvLike = Record<string, string | undefined>;

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function positiveNumber(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value: string | undefined, fallback: number) {
  return Math.max(1, Math.floor(positiveNumber(value, fallback)));
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : fallback;
}

function marketWebSocketBaseUrl(value: string | undefined) {
  const baseUrl = value?.trim().replace(/\/$/, "") || "wss://fstream.binance.com/market";
  return baseUrl === "wss://fstream.binance.com" ? `${baseUrl}/market` : baseUrl;
}

export function getMarketAlertsConfig(env: EnvLike = process.env) {
  const restTopN = positiveInteger(env.MARKET_ALERTS_REST_TOP_N, 200);
  return {
    enabled: booleanValue(env.MARKET_ALERTS_ENABLED, true),
    restBaseUrl:
      env.MARKET_ALERTS_BINANCE_REST_BASE_URL?.trim() || "https://fapi.binance.com",
    wsBaseUrl: marketWebSocketBaseUrl(env.MARKET_ALERTS_BINANCE_WS_BASE_URL),
    wsTopN: positiveInteger(env.MARKET_ALERTS_WS_TOP_N, 200),
    wsRankRefreshMs: positiveInteger(
      env.MARKET_ALERTS_WS_RANK_REFRESH_MS,
      30 * 60 * 1000,
    ),
    wsFirstMessageTimeoutMs: positiveInteger(
      env.MARKET_ALERTS_WS_FIRST_MESSAGE_TIMEOUT_MS,
      20_000,
    ),
    restTopN,
    restCoreN: Math.min(
      restTopN,
      positiveInteger(env.MARKET_ALERTS_REST_CORE_N, 50),
    ),
    restIntervalMs: positiveInteger(env.MARKET_ALERTS_REST_INTERVAL_MS, 60_000),
    restExtendedIntervalMin: positiveInteger(
      env.MARKET_ALERTS_REST_EXTENDED_INTERVAL_MIN,
      3,
    ),
    squeezeTopN: positiveInteger(env.MARKET_ALERTS_SQUEEZE_TOP_N, 120),
    squeezeIntervalMs: positiveInteger(
      env.MARKET_ALERTS_SQUEEZE_INTERVAL_MS,
      60_000,
    ),
    squeezeWorkers: positiveInteger(env.MARKET_ALERTS_SQUEEZE_WORKERS, 12),
    minFdvUsd: positiveNumber(env.MARKET_ALERTS_MIN_FDV_USD, 10_000_000),
    minOiNotional: positiveNumber(
      env.MARKET_ALERTS_SQUEEZE_MIN_OI_USD,
      2_000_000,
    ),
    requestTimeoutMs: positiveInteger(env.MARKET_ALERTS_REQUEST_TIMEOUT_MS, 15_000),
    requestSpacingMs: nonNegativeInteger(
      env.MARKET_ALERTS_BINANCE_REQUEST_SPACING_MS,
      100,
    ),
    requestRetryBaseMs: positiveInteger(
      env.MARKET_ALERTS_BINANCE_RETRY_BASE_MS,
      1_000,
    ),
    chartBackfillPerScan: nonNegativeInteger(
      env.MARKET_ALERTS_CHART_BACKFILL_PER_SCAN,
      4,
    ),
    chartBackfillHours: positiveInteger(
      env.MARKET_ALERTS_CHART_BACKFILL_HOURS,
      168,
    ),
    eventPollMs: positiveInteger(env.MARKET_ALERTS_EVENT_POLL_MS, 3_000),
    telegramEnabled: booleanValue(env.MARKET_ALERTS_TELEGRAM_ENABLED, false),
  };
}

export type MarketAlertsConfig = ReturnType<typeof getMarketAlertsConfig>;
