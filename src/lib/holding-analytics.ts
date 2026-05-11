import type {
  BinanceFuturesPosition,
  BinanceHoldingSummary,
  BinanceSpotBalance,
} from "./binance-holdings";

export type FuturesBiasLabel =
  | "Extremely Bullish"
  | "Bullish"
  | "Slightly Bullish"
  | "Neutral"
  | "Slightly Bearish"
  | "Bearish"
  | "Extremely Bearish";

export type FuturesAnalytics = {
  biasLabel: FuturesBiasLabel;
  longShare: number;
  shortShare: number;
  profitShare: number;
  lossShare: number;
  positivePnl: number;
  negativePnlAbs: number;
  netExposureLeverage: number;
  maxAbsNotional: number;
};

export type HeatmapTileLayout = {
  colSpan: number;
  rowSpan: number;
};

export type SpotAllocationSlice = {
  asset: string;
  usdtValue: number;
  share: number;
};

export type SpotAllocation = {
  totalUsdtValue: number;
  slices: SpotAllocationSlice[];
};

function ratio(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

function biasLabel(netShare: number): FuturesBiasLabel {
  if (netShare >= 60) return "Extremely Bullish";
  if (netShare >= 25) return "Bullish";
  if (netShare >= 5) return "Slightly Bullish";
  if (netShare <= -60) return "Extremely Bearish";
  if (netShare <= -25) return "Bearish";
  if (netShare <= -5) return "Slightly Bearish";
  return "Neutral";
}

export function analyzeFuturesPositions({
  positions,
  summary,
}: {
  positions: BinanceFuturesPosition[];
  summary: BinanceHoldingSummary;
}): FuturesAnalytics {
  const positivePnl = positions.reduce(
    (total, position) =>
      position.unrealizedPnl > 0 ? total + position.unrealizedPnl : total,
    0,
  );
  const negativePnlAbs = positions.reduce(
    (total, position) =>
      position.unrealizedPnl < 0 ? total + Math.abs(position.unrealizedPnl) : total,
    0,
  );
  const pnlTotal = positivePnl + negativePnlAbs;
  const grossNotional =
    summary.futuresGrossNotional ||
    positions.reduce((total, position) => total + Math.abs(position.notional), 0);
  const longNotional =
    summary.futuresLongNotional ||
    positions
      .filter((position) => position.notional >= 0)
      .reduce((total, position) => total + Math.abs(position.notional), 0);
  const shortNotional =
    summary.futuresShortNotional ||
    positions
      .filter((position) => position.notional < 0)
      .reduce((total, position) => total + Math.abs(position.notional), 0);
  const netNotional = summary.futuresNetNotional || longNotional - shortNotional;
  const netShare = ratio(netNotional, grossNotional);
  const netExposureLeverage =
    summary.futuresMarginBalance > 0
      ? Math.abs(netNotional) / summary.futuresMarginBalance
      : 0;

  return {
    biasLabel: biasLabel(netShare),
    longShare: ratio(longNotional, grossNotional),
    shortShare: ratio(shortNotional, grossNotional),
    profitShare: pnlTotal > 0 ? ratio(positivePnl, pnlTotal) : 50,
    lossShare: pnlTotal > 0 ? ratio(negativePnlAbs, pnlTotal) : 50,
    positivePnl,
    negativePnlAbs,
    netExposureLeverage,
    maxAbsNotional: positions.reduce(
      (max, position) => Math.max(max, Math.abs(position.notional)),
      0,
    ),
  };
}

export function getHeatmapTileLayout({
  absNotional,
  maxAbsNotional,
}: {
  absNotional: number;
  maxAbsNotional: number;
}): HeatmapTileLayout {
  if (absNotional <= 0 || maxAbsNotional <= 0) {
    return { colSpan: 2, rowSpan: 1 };
  }

  const share = Math.max(0, Math.min(1, absNotional / maxAbsNotional));

  if (share >= 0.75) return { colSpan: 6, rowSpan: 2 };
  if (share >= 0.45) return { colSpan: 4, rowSpan: 2 };
  if (share >= 0.22) return { colSpan: 3, rowSpan: 2 };
  if (share >= 0.09) return { colSpan: 3, rowSpan: 1 };
  return { colSpan: 2, rowSpan: 1 };
}

export function analyzeSpotAllocation(
  balances: Pick<BinanceSpotBalance, "asset" | "usdtValue">[],
): SpotAllocation {
  const valuedBalances = balances
    .map((balance) => ({
      asset: balance.asset,
      usdtValue: balance.usdtValue ?? 0,
    }))
    .filter((balance) => balance.asset && balance.usdtValue > 0)
    .sort(
      (left, right) =>
        right.usdtValue - left.usdtValue || left.asset.localeCompare(right.asset),
    );
  const totalUsdtValue = valuedBalances.reduce(
    (total, balance) => total + balance.usdtValue,
    0,
  );

  return {
    totalUsdtValue,
    slices: valuedBalances.map((balance) => ({
      ...balance,
      share: ratio(balance.usdtValue, totalUsdtValue),
    })),
  };
}
