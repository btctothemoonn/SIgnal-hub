# Market valuation fallback

Set `COINMARKETCAP_API_KEY` in the server-only `.env.local` and restart the
market workers to enable the optional CoinMarketCap fallback. Never place this
key in a `NEXT_PUBLIC_` variable or commit it.

The existing valuation refresh schedule and SQLite cache are retained. Each
refresh batches missing market cap / FDV fields into one v3 quotes request
(at most 50 markets), only after CoinGecko. Complete records require no CMC
request. This consumes the configured CMC account's API allowance.

Duplicate symbols and quotes differing by more than 20% from the current
futures price are rejected. Missing values remain unavailable rather than
being guessed. Contract multipliers / renamed assets need an explicit verified
asset mapping before support; a symbol match is not proof of token identity.

Reference: https://coinmarketcap.com/api/documentation/guides/get-latest-crypto-prices
