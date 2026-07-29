import type { TigerHoldingSnapshot } from "./tiger-holdings";

export function formatUsdtPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";

  const absValue = Math.abs(value);
  const maximumFractionDigits =
    absValue >= 1000 ? 2 : absValue >= 1 ? 4 : absValue >= 0.01 ? 6 : 8;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: absValue >= 1000 ? 2 : 0,
    maximumFractionDigits,
  }).format(value);
}

export function getBinanceDisplayTotalEquity({
  accountMode,
  futuresMarginBalance,
  spotTotal,
}: {
  accountMode: "standard" | "portfolioMargin";
  futuresMarginBalance: number;
  spotTotal: number;
}): number {
  return accountMode === "portfolioMargin"
    ? futuresMarginBalance
    : futuresMarginBalance + spotTotal;
}

export function getUsHoldingEquityMetric({
  source,
  netLiquidation,
  holdingMarketValue,
}: {
  source: "tiger" | "snapshot";
  netLiquidation: number;
  holdingMarketValue: number;
}): { label: "账户净值" | "持仓市值"; value: number } {
  return source === "tiger"
    ? { label: "账户净值", value: netLiquidation }
    : { label: "持仓市值", value: holdingMarketValue };
}

export function isFiniteTigerHoldingSnapshot(
  value: unknown,
): value is TigerHoldingSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<TigerHoldingSnapshot>;
  return (
    snapshot.source === "tiger" &&
    typeof snapshot.accountId === "string" &&
    typeof snapshot.accountLabel === "string" &&
    snapshot.currency === "USD" &&
    typeof snapshot.updatedAt === "string" &&
    Array.isArray(snapshot.positions) &&
    Number.isInteger(snapshot.reportedPositionCount) &&
    typeof snapshot.reportedMarketValue === "number" &&
    Number.isFinite(snapshot.reportedMarketValue) &&
    typeof snapshot.reportedPnl === "number" &&
    Number.isFinite(snapshot.reportedPnl) &&
    typeof snapshot.netLiquidation === "number" &&
    Number.isFinite(snapshot.netLiquidation) &&
    typeof snapshot.cashValue === "number" &&
    Number.isFinite(snapshot.cashValue) &&
    (snapshot.buyingPower === null ||
      (typeof snapshot.buyingPower === "number" &&
        Number.isFinite(snapshot.buyingPower))) &&
    Array.isArray(snapshot.warnings)
  );
}
