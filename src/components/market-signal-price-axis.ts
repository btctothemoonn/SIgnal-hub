function formatTick(price: number, digits: number) {
  const rounded = Number(price.toPrecision(digits));
  // Rounding the largest finite doubles can overflow. The unrounded price is always finite here.
  const value = Number.isFinite(rounded) ? rounded : price;
  return value >= 1e10 || value < 1e-6 ? value.toExponential() : String(value);
}

export function getCardPriceTicks(low: number, high: number, count: number): { price: number; label: string }[] {
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low ||
      !Number.isSafeInteger(count) || count < 1) return [];
  if (low === high) return [{ price: low, label: formatTick(low, 17) }];
  if (count < 2) return [];

  const prices = new Set<number>();
  for (let i = 0; i < count; i++) {
    // Keep the quoted low exact even when the two prices are many orders of magnitude apart.
    prices.add(i === count - 1 ? low : high - (high - low) * (i / (count - 1)));
  }

  // Show additional digits only when a narrow range would give neighboring ticks identical labels.
  const values = [...prices];
  let digits = 5;
  let labels = values.map(price => formatTick(price, digits));
  while (new Set(labels).size < values.length && digits < 17) {
    digits++;
    labels = values.map(price => formatTick(price, digits));
  }
  return values.map((price, index) => ({ price, label: labels[index] }));
}