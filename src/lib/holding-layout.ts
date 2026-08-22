import type { BinanceFuturesPosition } from "./binance-holdings";

export type FuturesExposureRow = {
  position: BinanceFuturesPosition;
  asset: string;
  rank: number;
  direction: "多" | "空";
  absNotional: number;
  exposurePercent: number;
  pnlPercent: number;
  liquidationDistancePercent: number | null;
  isTopExposure: boolean;
};

export type FuturesExposureSummary = {
  totalNotional: number;
  longNotional: number;
  shortNotional: number;
  longPercent: number;
  shortPercent: number;
  bias: "净多头" | "净空头" | "方向中性";
};

export function baseAssetFromFuturesSymbol(symbol: string) {
  return symbol.replace(/(USDT|USDC|BUSD|FDUSD|USD)$/i, "") || symbol;
}

function futuresPnlPercent(position: BinanceFuturesPosition) {
  const costBasis = Math.abs(position.amount * position.entryPrice);
  const fallbackBasis = Math.abs(position.notional);
  const basis = costBasis > 0 ? costBasis : fallbackBasis;
  return basis > 0 ? (position.unrealizedPnl / basis) * 100 : 0;
}

function futuresLiquidationDistancePercent(position: BinanceFuturesPosition) {
  if (position.markPrice <= 0 || position.liquidationPrice <= 0) return null;

  const distance =
    position.side === "SHORT"
      ? ((position.liquidationPrice - position.markPrice) / position.markPrice) *
        100
      : ((position.markPrice - position.liquidationPrice) / position.markPrice) *
        100;

  return Number.isFinite(distance) ? Math.max(0, distance) : null;
}

export function buildFuturesExposureRows(
  positions: BinanceFuturesPosition[],
): FuturesExposureRow[] {
  const grossNotional = positions.reduce(
    (total, position) => total + Math.abs(position.notional),
    0,
  );

  return [...positions]
    .sort(
      (left, right) =>
        Math.abs(right.notional) - Math.abs(left.notional) ||
        left.symbol.localeCompare(right.symbol),
    )
    .map((position, index) => {
      const absNotional = Math.abs(position.notional);
      return {
        position,
        asset: baseAssetFromFuturesSymbol(position.symbol),
        rank: index + 1,
        direction: position.side === "SHORT" ? "空" : "多",
        absNotional,
        exposurePercent:
          grossNotional > 0 ? (absNotional / grossNotional) * 100 : 0,
        pnlPercent: futuresPnlPercent(position),
        liquidationDistancePercent:
          futuresLiquidationDistancePercent(position),
        isTopExposure: index < 3,
      };
    });
}

export function summarizeFuturesExposure(
  rows: FuturesExposureRow[],
): FuturesExposureSummary {
  const totalNotional = rows.reduce((total, row) => total + row.absNotional, 0);
  const longNotional = rows.reduce(
    (total, row) =>
      total + (row.position.side === "LONG" ? row.absNotional : 0),
    0,
  );
  const shortNotional = rows.reduce(
    (total, row) =>
      total + (row.position.side === "SHORT" ? row.absNotional : 0),
    0,
  );
  const longPercent = totalNotional > 0 ? (longNotional / totalNotional) * 100 : 0;
  const shortPercent =
    totalNotional > 0 ? (shortNotional / totalNotional) * 100 : 0;

  return {
    totalNotional,
    longNotional,
    shortNotional,
    longPercent,
    shortPercent,
    bias:
      longNotional === shortNotional
        ? "方向中性"
        : longNotional > shortNotional
          ? "净多头"
          : "净空头",
  };
}
