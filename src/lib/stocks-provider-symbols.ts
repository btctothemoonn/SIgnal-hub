export function eodhdProviderSymbol(ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!normalizedTicker) return "";

  const koreanSymbol = normalizedTicker.match(/^(\d{6})\.KS$/);
  if (koreanSymbol) return `${koreanSymbol[1]}.KO`;

  return normalizedTicker.includes(".")
    ? normalizedTicker
    : `${normalizedTicker}.US`;
}
