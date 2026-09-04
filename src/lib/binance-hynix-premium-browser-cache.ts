import type {
  BinanceHynixPremiumInterval,
  BinanceHynixPremiumPoint,
  BinanceHynixPremiumSnapshot,
} from "@/lib/binance-hynix-premium";

type CompactPremiumPoint = [
  openTime: number,
  closeTime: number,
  capturedAt: string,
  basePrice: number,
  baseOpenPrice: number,
  baseHighPrice: number,
  baseLowPrice: number,
  baseClosePrice: number,
  benchmarkPrice: number,
  benchmarkOpenPrice: number,
  benchmarkHighPrice: number,
  benchmarkLowPrice: number,
  benchmarkClosePrice: number,
  premiumPct: number,
  premiumOpenPct: number,
  premiumHighPct: number,
  premiumLowPct: number,
  premiumClosePct: number,
  volume: number,
];

export type BinanceHynixPremiumBrowserCache = {
  v: 1;
  generatedAt: string;
  source: BinanceHynixPremiumSnapshot["source"];
  provider: BinanceHynixPremiumSnapshot["provider"];
  interval: BinanceHynixPremiumInterval;
  symbols: BinanceHynixPremiumSnapshot["symbols"];
  websocket: BinanceHynixPremiumSnapshot["websocket"];
  points: CompactPremiumPoint[];
  errors: string[];
};

function isInterval(value: unknown): value is BinanceHynixPremiumInterval {
  return value === "1m" || value === "5m" || value === "1h" || value === "1d";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCompactPoint(value: unknown): value is CompactPremiumPoint {
  return (
    Array.isArray(value) &&
    value.length === 19 &&
    typeof value[2] === "string" &&
    value.every(
      (entry, index) => index === 2 || typeof entry === "number",
    )
  );
}

function isLegacySnapshot(value: unknown): value is BinanceHynixPremiumSnapshot {
  if (!isObject(value) || !isObject(value.symbols) || !isObject(value.websocket)) {
    return false;
  }

  return (
    typeof value.generatedAt === "string" &&
    (value.source === "live" || value.source === "empty") &&
    value.provider === "binance-futures" &&
    isInterval(value.interval) &&
    typeof value.symbols.base === "string" &&
    typeof value.symbols.benchmark === "string" &&
    typeof value.websocket.url === "string" &&
    Array.isArray(value.websocket.streams) &&
    Array.isArray(value.points) &&
    Array.isArray(value.errors)
  );
}

function isCompactCache(value: unknown): value is BinanceHynixPremiumBrowserCache {
  if (!isObject(value) || !isObject(value.symbols) || !isObject(value.websocket)) {
    return false;
  }

  return (
    value.v === 1 &&
    typeof value.generatedAt === "string" &&
    (value.source === "live" || value.source === "empty") &&
    value.provider === "binance-futures" &&
    isInterval(value.interval) &&
    typeof value.symbols.base === "string" &&
    typeof value.symbols.benchmark === "string" &&
    typeof value.websocket.url === "string" &&
    Array.isArray(value.websocket.streams) &&
    value.websocket.streams.every((stream) => typeof stream === "string") &&
    Array.isArray(value.points) &&
    value.points.every(isCompactPoint) &&
    Array.isArray(value.errors) &&
    value.errors.every((error) => typeof error === "string")
  );
}

function compactPoint(point: BinanceHynixPremiumPoint): CompactPremiumPoint {
  return [
    point.openTime,
    point.closeTime,
    point.capturedAt,
    point.basePrice,
    point.baseOpenPrice,
    point.baseHighPrice,
    point.baseLowPrice,
    point.baseClosePrice,
    point.benchmarkPrice,
    point.benchmarkOpenPrice,
    point.benchmarkHighPrice,
    point.benchmarkLowPrice,
    point.benchmarkClosePrice,
    point.premiumPct,
    point.premiumOpenPct,
    point.premiumHighPct,
    point.premiumLowPct,
    point.premiumClosePct,
    point.volume,
  ];
}

function restorePoint(
  point: CompactPremiumPoint,
  symbols: BinanceHynixPremiumSnapshot["symbols"],
): BinanceHynixPremiumPoint {
  return {
    openTime: point[0],
    closeTime: point[1],
    capturedAt: point[2],
    baseSymbol: symbols.base,
    benchmarkSymbol: symbols.benchmark,
    basePrice: point[3],
    baseOpenPrice: point[4],
    baseHighPrice: point[5],
    baseLowPrice: point[6],
    baseClosePrice: point[7],
    benchmarkPrice: point[8],
    benchmarkOpenPrice: point[9],
    benchmarkHighPrice: point[10],
    benchmarkLowPrice: point[11],
    benchmarkClosePrice: point[12],
    premiumPct: point[13],
    premiumOpenPct: point[14],
    premiumHighPct: point[15],
    premiumLowPct: point[16],
    premiumClosePct: point[17],
    volume: point[18],
  };
}

export function compactBinanceHynixPremiumSnapshot(
  snapshot: BinanceHynixPremiumSnapshot,
): BinanceHynixPremiumBrowserCache {
  return {
    v: 1,
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
    provider: snapshot.provider,
    interval: snapshot.interval,
    symbols: snapshot.symbols,
    websocket: snapshot.websocket,
    points: snapshot.points.map(compactPoint),
    errors: snapshot.errors,
  };
}

export function restoreBinanceHynixPremiumSnapshot(
  value: unknown,
): BinanceHynixPremiumSnapshot | null {
  if (!isCompactCache(value)) {
    return isLegacySnapshot(value) ? value : null;
  }

  const points = value.points.map((point) => restorePoint(point, value.symbols));
  return {
    generatedAt: value.generatedAt,
    source: value.source,
    provider: value.provider,
    interval: value.interval,
    symbols: value.symbols,
    websocket: value.websocket,
    points,
    latest: points.at(-1) ?? null,
    errors: value.errors,
  };
}
