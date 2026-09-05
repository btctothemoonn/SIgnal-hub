type Market = { symbol: string; price: number };
type Valuation = { symbol: string; marketCapUsd: number | null; fdvUsd: number | null };
type RecordValue = Record<string, unknown>;

function positive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Only fill gaps; ambiguous symbols must not silently map to another token.
export async function fillCmcValuations(
  markets: Market[],
  values: Valuation[],
  options: { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Valuation[]> {
  const apiKey = options.apiKey ?? process.env.COINMARKETCAP_API_KEY ?? "";
  const missing = values.filter((item) => item.marketCapUsd === null || item.fdvUsd === null);
  if (!apiKey.trim() || !missing.length) return values;
  try {
    const url = new URL("https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/latest");
    url.searchParams.set("symbol", [...new Set(missing.map((item) => item.symbol.replace(/USDT$/i, "")))].join(","));
    url.searchParams.set("convert", "USD");
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: { "X-CMC_PRO_API_KEY": apiKey },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    if (!response.ok) return values;
    const body = await response.json();
    if (Number(body.status?.error_code ?? 0) !== 0 || !Array.isArray(body.data)) return values;
    return values.map((value) => {
      if (value.marketCapUsd !== null && value.fdvUsd !== null) return value;
      const base = value.symbol.replace(/USDT$/i, "").toUpperCase();
      const candidates = body.data.filter((coin: RecordValue) => String(coin.symbol).toUpperCase() === base);
      if (candidates.length !== 1) return value;
      const quote = candidates[0].quote?.find((item: RecordValue) => item.symbol === "USD");
      const price = positive(quote?.price);
      const expected = markets.find((market) => market.symbol === value.symbol)?.price;
      if (!price || !expected || Math.abs(price / expected - 1) > 0.2) return value;
      return {
        ...value,
        marketCapUsd: value.marketCapUsd ?? positive(quote?.market_cap),
        fdvUsd: value.fdvUsd ?? positive(quote?.fully_diluted_market_cap),
      };
    });
  } catch {
    return values;
  }
}
