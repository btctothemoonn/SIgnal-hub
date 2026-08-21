import type { BinanceFuturesPosition } from "./binance-holdings";

export type FuturesExposureRow = {
  position: BinanceFuturesPosition;
  asset: string;
  rank: number;
  direction: "多" | "空";
  absNotional: number;
  exposurePercent: number;
  pnlPercent: number;
  isTopExposure: boolean;
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
        isTopExposure: index < 3,
      };
    });
}
