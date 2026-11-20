// Binance supplies contract symbols in uppercase with the quote currency appended.
export function findMarketSymbols(symbols: readonly string[], input: string) {
  const query = input.normalize("NFKC").trim().toUpperCase().replace(/^\$/, "").replace(/[\s/]+/g, "");
  if (!query) return [];

  const matches: { symbol: string; rank: number }[] = [];
  for (const symbol of symbols) {
    const full = symbol.toUpperCase();
    const base = full.replace(/USDT$/, "");
    if (query === base || query === full) matches.push({ symbol, rank: 0 });
    else if (base.startsWith(query)) matches.push({ symbol, rank: 1 });
    else if (base.includes(query)) matches.push({ symbol, rank: 2 });
  }
  return matches.sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol)).map(match => match.symbol);
}
