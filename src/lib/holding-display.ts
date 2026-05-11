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
