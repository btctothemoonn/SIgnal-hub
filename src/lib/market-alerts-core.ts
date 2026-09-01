export type VolatilitySide = "LONG" | "SHORT";
export type MarketAlertType = "volatility" | "short_squeeze";

const STABLE_OR_FIAT_BASES = new Set([
  "USDC",
  "USDP",
  "FDUSD",
  "TUSD",
  "DAI",
  "BUSD",
  "RLUSD",
  "USD1",
  "USDE",
  "EUR",
  "XUSD",
]);

export interface BinanceContractMeta {
  contractType?: unknown;
  underlyingType?: unknown;
  underlyingSubType?: unknown;
}

export function isTradFiContract(meta: BinanceContractMeta = {}) {
  const values = [
    meta.contractType,
    meta.underlyingType,
    ...(Array.isArray(meta.underlyingSubType) ? meta.underlyingSubType : []),
  ];
  const text = values.map((value) => String(value ?? "").toUpperCase()).join(" ");
  return ["TRADIFI", "EQUITY", "STOCK", "ETF", "INDEX"].some((token) =>
    text.includes(token),
  );
}

export function isStableOrFiatBase(base: unknown) {
  return STABLE_OR_FIAT_BASES.has(String(base ?? "").trim().toUpperCase());
}

export function signalLevel(strength: unknown) {
  const value = Math.abs(Number(strength) || 0);
  if (value >= 20) return 3;
  if (value >= 12) return 2;
  return 1;
}

export function fastMoveDirectionOk(
  side: VolatilitySide,
  fastPct: unknown,
  rollingPct: unknown,
) {
  const fast = Number(fastPct);
  const rolling = Number(rollingPct);
  if (side === "SHORT") return fast < 0 && rolling < 0;
  return fast > 0 && rolling > 0;
}

export function isVolatilityRecoveryCalm(input: {
  pct1m: unknown;
  pct25m: unknown;
}) {
  const fast = Number(input.pct1m);
  const rolling = Number(input.pct25m);
  return (
    Number.isFinite(fast) &&
    Number.isFinite(rolling) &&
    Math.abs(fast) < 2 &&
    Math.abs(rolling) < 2
  );
}

interface VolatilityInput {
  symbol: string;
  price: number;
  pct1m: number;
  pct5m: number;
  pct25m?: number;
  pct24h: number;
  candle5mPct?: number;
  streakGreen: number;
  streakRed: number;
  volRatio1m: number;
  volRatio5m: number;
  k1Closed: boolean;
  k5Closed: boolean;
  kTime?: number;
}

export interface VolatilitySignal {
  type: "volatility";
  symbol: string;
  side: VolatilitySide;
  level: number;
  stage: string;
  trigger: string;
  statusText: string;
  price: number;
  changePct: number;
  strengthPct: number;
  pct24h: number;
  volumeRatio: number;
  occurredAtMs?: number;
}

function triggerStatus(input: {
  a: boolean;
  b: boolean;
  c: boolean;
  d?: boolean;
  k1Closed: boolean;
  k5Closed: boolean;
  bWindow?: "1m" | "5m";
}) {
  const bWindow = input.bWindow ?? "1m";
  const bClosed = bWindow === "5m" ? input.k5Closed : input.k1Closed;
  if (input.a && input.b) {
    return {
      trigger: `A趋势${input.k5Closed ? "确认" : "实时"}+B加速${bClosed ? "确认" : "实时"}`,
      statusText: `A趋势${input.k5Closed ? "已确认" : "实时"} / B加速${bWindow}${bClosed ? "已收盘" : "实时"}`,
    };
  }
  if (input.a) {
    return {
      trigger: `A趋势·${input.k5Closed ? "确认" : "实时"}`,
      statusText: input.k5Closed ? "5m已收盘" : "5m实时",
    };
  }
  if (input.b) {
    return {
      trigger: `B加速·${bClosed ? "确认" : "实时"}`,
      statusText: `${bWindow}${bClosed ? "已收盘" : "实时"}`,
    };
  }
  if (input.c) {
    return {
      trigger: `C阶梯·${input.k5Closed ? "确认" : "实时"}`,
      statusText: input.k5Closed ? "5m已收盘" : "5m实时",
    };
  }
  return {
    trigger: `D先行·${input.k1Closed ? "确认" : "实时"}`,
    statusText: input.k1Closed ? "1m已收盘" : "1m实时",
  };
}

function buildVolatilitySignal(
  input: VolatilityInput,
  side: VolatilitySide,
  flags: { a: boolean; b: boolean; c: boolean; d?: boolean },
  options: { bWindow?: "1m" | "5m" } = {},
): VolatilitySignal {
  const rolling = Number(input.pct25m ?? input.pct5m) || 0;
  const bWindow = options.bWindow ?? "1m";
  const bFast =
    bWindow === "5m"
      ? Number(input.candle5mPct ?? input.pct5m) || 0
      : Number(input.pct1m) || 0;
  const fast = flags.b
    ? bFast
    : flags.d
      ? Number(input.pct1m) || 0
      : rolling;
  const strength = Math.max(Math.abs(rolling), Math.abs(fast));
  const status = triggerStatus({
    ...flags,
    k1Closed: input.k1Closed,
    k5Closed: input.k5Closed,
    bWindow,
  });
  const direction = side === "LONG" ? "暴涨" : "暴跌";
  return {
    type: "volatility",
    symbol: input.symbol,
    side,
    level: signalLevel(strength),
    stage: `${direction}${signalLevel(strength) > 1 ? "升级" : "预警"}`,
    trigger: status.trigger,
    statusText: status.statusText,
    price: input.price,
    changePct: rolling,
    strengthPct: strength,
    pct24h: input.pct24h,
    volumeRatio: flags.b
      ? bWindow === "5m"
        ? input.volRatio5m
        : input.volRatio1m
      : flags.d
        ? input.volRatio1m
        : input.volRatio5m,
    occurredAtMs: input.kTime,
  };
}

export function evaluateWsVolatilitySignal(
  input: VolatilityInput,
): VolatilitySignal | null {
  const rolling = Number(input.pct25m ?? input.pct5m) || 0;
  const pumpA = rolling >= 6 && input.streakGreen >= 3 && input.volRatio5m >= 2;
  const crashA = rolling <= -6 && input.streakRed >= 2 && input.volRatio5m >= 3;
  const pumpB =
    input.pct1m >= 5 &&
    fastMoveDirectionOk("LONG", input.pct1m, rolling) &&
    input.volRatio1m >= 2;
  const crashB =
    input.pct1m <= -5 &&
    fastMoveDirectionOk("SHORT", input.pct1m, rolling) &&
    input.volRatio1m >= 3;
  const pumpC = input.streakGreen >= 2 && input.pct5m >= 5.5 && input.volRatio5m >= 5;
  const crashC = input.streakRed >= 2 && input.pct5m <= -5.5 && input.volRatio5m >= 5;

  if (pumpA || pumpB || pumpC) {
    return buildVolatilitySignal(input, "LONG", { a: pumpA, b: pumpB, c: pumpC });
  }
  if (crashA || crashB || crashC) {
    return buildVolatilitySignal(input, "SHORT", { a: crashA, b: crashB, c: crashC });
  }
  return null;
}

export function evaluateRestVolatilitySignal(
  input: VolatilityInput,
): VolatilitySignal | null {
  const rolling = Number(input.pct25m ?? input.pct5m) || 0;
  const candle5m = Number(input.candle5mPct ?? input.pct5m) || 0;
  const pumpA = rolling >= 6 && input.streakGreen >= 3 && input.volRatio5m >= 2;
  const crashA = rolling <= -6 && input.streakRed >= 2 && input.volRatio5m >= 3;
  const pumpB =
    candle5m >= 5 && fastMoveDirectionOk("LONG", candle5m, rolling) && input.volRatio5m >= 2;
  const crashB =
    candle5m <= -5 && fastMoveDirectionOk("SHORT", candle5m, rolling) && input.volRatio5m >= 3;
  const pumpC = input.streakGreen >= 2 && input.pct5m >= 5.5 && input.volRatio5m >= 5;
  const crashC = input.streakRed >= 2 && input.pct5m <= -5.5 && input.volRatio5m >= 5;
  const pumpD = input.pct1m >= 3.5 && input.volRatio1m >= 2 && input.pct5m >= 2;

  if (pumpA || pumpB || pumpC || pumpD) {
    return buildVolatilitySignal(input, "LONG", {
      a: pumpA,
      b: pumpB,
      c: pumpC,
      d: pumpD,
    }, { bWindow: "5m" });
  }
  if (crashA || crashB || crashC) {
    return buildVolatilitySignal(
      input,
      "SHORT",
      { a: crashA, b: crashB, c: crashC },
      { bWindow: "5m" },
    );
  }
  return null;
}

export interface VolatilitySignalState {
  level: number;
  firstAt: number;
  lastSeenAt: number;
  strength: number;
}

export function transitionVolatilityState(
  previous: VolatilitySignalState | null,
  event: { triggered: boolean; strength: number; recovered: boolean; now: number },
) {
  if (!event.triggered) {
    return event.recovered
      ? { send: false, next: null }
      : { send: false, next: previous };
  }
  const strength = Math.abs(Number(event.strength) || 0);
  const level = signalLevel(strength);
  if (!previous) {
    return {
      send: true,
      next: {
        level,
        firstAt: event.now,
        lastSeenAt: event.now,
        strength,
      },
    };
  }
  return {
    send: level > previous.level,
    next: {
      level: Math.max(previous.level, level),
      firstAt: previous.firstAt,
      lastSeenAt: event.now,
      strength: Math.max(previous.strength, strength),
    },
  };
}

export interface SqueezeMetrics {
  funding: number | null;
  basis: number | null;
  oiGrowth15m: number | null;
  oiNotional: number | null;
  priceChange15m: number | null;
  volRatio: number | null;
  breakout20: boolean;
  globalLongShortRatio: number | null;
  topTraderLongShortRatio: number | null;
  takerBuySellRatio: number | null;
}

function finite(value: unknown, fallback: number | null = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function scoreShortSqueeze(
  metrics: SqueezeMetrics,
  options: { minOiNotional: number },
) {
  const fundingValue = finite(metrics.funding);
  const basisValue = finite(metrics.basis);
  const funding = fundingValue ?? 0;
  const basis = basisValue ?? 0;
  const oiGrowth = finite(metrics.oiGrowth15m, 0) ?? 0;
  const oiNotional = finite(metrics.oiNotional, 0) ?? 0;
  const priceChange = finite(metrics.priceChange15m, -999) ?? -999;
  const volRatio = finite(metrics.volRatio, 0) ?? 0;
  const globalLs = finite(metrics.globalLongShortRatio);
  const topLs = finite(metrics.topTraderLongShortRatio);
  const taker = finite(metrics.takerBuySellRatio);

  const confirmationsComplete = [globalLs, topLs, taker].every((value) => value !== null);
  const confirmationCount = [
    globalLs !== null && globalLs <= 0.9,
    topLs !== null && topLs <= 0.9,
    taker !== null && taker >= 1.15,
  ].filter(Boolean).length;
  const positioningConfirmed = confirmationsComplete && confirmationCount >= 2;
  const setupMandatory =
    fundingValue !== null &&
    basisValue !== null &&
    funding <= -0.0005 &&
    oiGrowth >= 4 &&
    oiNotional >= options.minOiNotional &&
    priceChange >= -0.5;
  const confirmedMandatory = setupMandatory && oiGrowth >= 6;
  const priceTrigger = metrics.breakout20 || priceChange >= 1.5;

  let score = 0;
  const reasons: string[] = [];
  if (funding <= -0.001) {
    score += 2;
    reasons.push("极端负费率");
  } else if (funding <= -0.0005) {
    score += 1;
    reasons.push("负费率");
  }
  if (oiGrowth >= 15) {
    score += 2;
    reasons.push("OI快速扩张");
  } else if (oiGrowth >= 6) {
    score += 1;
    reasons.push("OI扩张");
  }
  if (basis <= -0.001) {
    score += 1;
    reasons.push("合约折价");
  }
  if (metrics.breakout20) {
    score += 2;
    reasons.push("突破20根高点");
  } else if (priceChange >= 1.5) {
    score += 1;
    reasons.push("价格转强");
  }
  if (volRatio >= 2) {
    score += 1;
    reasons.push("成交放量");
  }
  if (globalLs !== null && globalLs <= 0.9) {
    score += 1;
    reasons.push("账户空头拥挤");
  }
  if (topLs !== null && topLs <= 0.9) {
    score += 1;
    reasons.push("大户仓位偏空");
  }
  if (taker !== null && taker >= 1.15) {
    score += 1;
    reasons.push("主动买盘增强");
  }

  const setupEligible = setupMandatory && positioningConfirmed && score >= 5;
  const confirmedEligible =
    confirmedMandatory && priceTrigger && positioningConfirmed && score >= 6;
  let level = 0;
  let stage = "";
  if (confirmedEligible && (score >= 9 || (oiGrowth >= 20 && priceChange >= 4))) {
    level = 3;
    stage = "轧空加速";
  } else if (confirmedEligible) {
    level = 2;
    stage = "轧空启动";
  } else if (setupEligible) {
    level = 1;
    stage = "轧空蓄势";
  }
  return {
    eligible: setupEligible || confirmedEligible,
    score,
    level,
    stage,
    reasons,
  };
}

export function shouldSendSqueezeAlert(activeLevel: number, candidateLevel: number) {
  return candidateLevel > 0 && candidateLevel > activeLevel;
}

export function nextSqueezeRecoveryCount(current: number, recovered: boolean) {
  return recovered ? current + 1 : 0;
}

export function squeezeRecoveryDecision(
  metrics: Pick<SqueezeMetrics, "funding" | "oiGrowth15m"> | null,
) {
  if (!metrics) return null;
  const funding = finite(metrics.funding);
  const oiGrowth = finite(metrics.oiGrowth15m);
  if (funding === null || oiGrowth === null) return null;
  return funding > -0.0002 || oiGrowth < 1;
}

interface RankingEvent {
  type: MarketAlertType;
  symbol: string;
  side?: VolatilitySide | null;
  occurredAt: string;
}

interface RankingTicker {
  symbol: string;
  price: number;
  pct24h: number;
  quoteVolume: number;
  marketCapUsd?: number | null;
  fdvUsd?: number | null;
  updatedAt?: string;
}

export function rankTriggeredMarkets(input: {
  events: RankingEvent[];
  tickers: RankingTicker[];
  since: string;
  now?: string;
  maxTickerAgeMs?: number;
  limit?: number;
}) {
  const sinceMs = Date.parse(input.since);
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const counts = new Map<
    string,
    { pump: number; crash: number; squeeze: number; total: number; lastTriggeredAt: string }
  >();
  for (const event of input.events) {
    const occurredAtMs = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredAtMs) || occurredAtMs < sinceMs) continue;
    if (event.type !== "volatility" && event.type !== "short_squeeze") continue;
    const current = counts.get(event.symbol) ?? {
      pump: 0,
      crash: 0,
      squeeze: 0,
      total: 0,
      lastTriggeredAt: event.occurredAt,
    };
    if (event.type === "short_squeeze") current.squeeze += 1;
    else if (event.side === "SHORT") current.crash += 1;
    else if (event.side === "LONG") current.pump += 1;
    current.total += 1;
    if (event.occurredAt > current.lastTriggeredAt) current.lastTriggeredAt = event.occurredAt;
    counts.set(event.symbol, current);
  }

  return input.tickers
    .filter((ticker) => {
      if (!counts.has(ticker.symbol) || !Number.isFinite(Number(ticker.pct24h))) {
        return false;
      }
      if (!ticker.updatedAt || !input.maxTickerAgeMs) return true;
      const updatedAtMs = Date.parse(ticker.updatedAt);
      return (
        Number.isFinite(updatedAtMs) &&
        Number.isFinite(nowMs) &&
        nowMs - updatedAtMs <= input.maxTickerAgeMs
      );
    })
    .map((ticker) => {
      const aggregate = counts.get(ticker.symbol)!;
      const { lastTriggeredAt, ...alertCounts } = aggregate;
      return {
        ...ticker,
        counts: alertCounts,
        lastTriggeredAt,
        dualSignal:
          aggregate.squeeze > 0 && (aggregate.pump > 0 || aggregate.crash > 0),
      };
    })
    .sort(
      (left, right) =>
        Math.abs(right.pct24h) - Math.abs(left.pct24h) ||
        right.quoteVolume - left.quoteVolume ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, Math.max(1, input.limit ?? 20));
}
