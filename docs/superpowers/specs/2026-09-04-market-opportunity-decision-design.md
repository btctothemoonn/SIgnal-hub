# Signal Hub Market Opportunity Decision Design

## Goal

Upgrade the existing contract-alert page from a high-volume alert feed into a short-horizon decision workspace. The page should reduce all recent volatility and short-squeeze alerts to at most five stable candidates that help the user decide what deserves attention for trades held less than 12 hours.

The system must not claim to observe a market maker or whale directly. It may infer patterns such as suspected capital-driven momentum or suspected distribution from public market data, and it must expose the evidence and confidence behind those inferences.

## Accepted Product Direction

- Keep the existing pump, crash, and short-squeeze workers and historical alert feed.
- Add a rule-driven Top 5 decision area above the existing 24-hour ranking and real-time alert list.
- Show the result only on the contract-alert webpage. Do not add Telegram, browser, or operating-system notifications.
- Do not read or react to the user's Binance holdings.
- Target trades whose expected holding time is less than 12 hours.
- Use deterministic rules to select and classify candidates. AI explains the result but never creates, removes, scores, or changes the direction of a candidate.
- Use existing Binance public endpoints and the existing MiniMax-primary, DeepSeek-fallback provider chain. Do not add a paid market-data source.
- Never place orders or request Binance trading permissions.

## User-Facing Language

The UI must avoid presenting inferred activity as fact. Use these labels:

- `疑似资金推动`
- `拉盘做多确认`
- `疑似高位派发`
- `做空结构确认`
- `轧空蓄势`
- `轧空启动`
- `杠杆拉盘，谨防回撤`
- `等待确认`
- `禁止追单`

Do not label a candidate as confirmed market-maker entry or exit. Every candidate shows a confidence score and the market evidence that produced it.

## Architecture

Create an independent market-opportunity worker rather than adding AI and enrichment work to the existing volatility or squeeze workers. A failure in opportunity enrichment or AI generation must not delay or stop the current alert pipeline.

The pipeline is:

1. Read recent events, active signals, ticker snapshots, and fresh squeeze metrics from the existing market-alert SQLite database.
2. Group events by symbol and calculate a cheap preliminary score.
3. Select no more than 12 enrichment candidates.
4. Fetch or reuse the additional Binance public-market data needed for those candidates.
5. Run three deterministic scoring models and update stable candidate state.
6. Select at most five qualified candidates with hysteresis.
7. Generate one batched AI explanation when the Top 5 decision fingerprint materially changes and the AI cooldown permits it.
8. Persist the result and expose it through the existing market-alert snapshot and SSE update path.

The worker records a heartbeat and last successful scan so that the page and health panel can distinguish stale data from a genuinely empty candidate set.

## Candidate Input And Enrichment

The preliminary scan considers alerts from the last two hours and groups duplicate pump, crash, and squeeze events by symbol. It uses existing alert level, trigger count, price change, volume ratio, 24-hour change, quote volume, active-signal state, market cap, and FDV. Stable/fiat pairs, TradFi contracts, and markets rejected by the current minimum-liquidity rules remain excluded.

Only the preliminary Top 12 receive detailed enrichment. Reuse fresh squeeze data whenever available. Fetch missing data through Binance public endpoints with the existing shared SQLite request limiter:

- 1-minute and 5-minute futures candles.
- A 24-hour 5-minute context window, with 15-minute and 1-hour structure derived locally instead of issuing redundant candle requests.
- Recent open-interest history and open-interest notional.
- Current funding rate and futures basis.
- Global and top-trader long/short ratios.
- Futures taker buy/sell ratio.
- Matching spot price and volume context when the symbol has a Binance spot market.
- Distance from the recent high and low, prior run-up, support failure, breakout state, and spot-versus-perpetual divergence derived locally.

Cache enrichment per symbol and reuse any still-fresh value. Run coarse selection every minute and detailed enrichment no more than once every two minutes per symbol. Bound concurrency and share the existing Binance request backoff so this worker does not compete aggressively with the current alert workers.

## Deterministic Decision Models

Implement three independent, pure scoring functions that return a score from 0 to 100, classification, direction, evidence, confirmation conditions, invalidation conditions, data coverage, and expiry state.

### Suspected Capital-Driven Long

Positive evidence includes aligned 5-minute, 15-minute, and 1-hour momentum; expanding volume; growing OI; stronger taker buying; spot confirmation; and repeated upward alerts. Excessively positive funding, large distance from structure, or a perpetual-only move increases chase risk and can force `禁止追单` even when momentum is strong.

### Suspected Distribution And Short

`疑似高位派发` requires a meaningful prior run-up followed by failure near a recent high, increasing sell aggression, and weakening short-horizon structure. It remains an observation state while OI is collapsing because that can indicate positions have already been flushed.

`做空结构确认` additionally requires a support break or confirmed lower structure, persistent sell aggression, and OI that is stable or growing enough to indicate new short participation. A single red candle never creates a confirmed short candidate.

### Short-Squeeze Long

Reuse the current short-squeeze scoring semantics: negative funding, short crowding, OI expansion, futures discount, taker buying, volume, and price breakout. Map the existing stages into `轧空蓄势` and `轧空启动` without changing the current alert worker.

### Coverage And Decision Thresholds

- Missing critical OI, funding, or taker data lowers confidence and caps the candidate below a confirmed long or short state.
- A score of 70 or more is eligible for observation.
- A score of 80 or more plus all mandatory confirmations is eligible for `关注做多` or `关注做空`.
- Lower scores are not inserted merely to fill all five slots. The panel may contain fewer than five candidates.
- Hard invalidation immediately removes actionable status even before the normal hysteresis window completes.

Exact weights and thresholds live in one typed configuration module so they can be calibrated from real snapshots without changing UI code.

## Top 5 Stability And Lifetime

- A new symbol must pass the entry threshold in two consecutive scans before entering the candidate set.
- A candidate below the exit threshold of 60 is removed after three consecutive scans.
- A hard invalidation removes it immediately.
- A newcomer replaces the fifth candidate only when it exceeds that candidate by at least five points or the fifth candidate is invalid.
- One symbol occupies at most one slot. Its strongest valid classification wins, with a confirmed squeeze taking precedence over an unconfirmed momentum observation.
- A candidate with no fresh confirmation for two hours is downgraded or removed.
- No candidate survives longer than 12 hours without a new qualifying cycle.
- Page updates may reorder the ranking, but the currently selected candidate remains selected while it is still in the Top 5 so the user's reading position is not disrupted.

## AI Explanation

AI receives only the structured Top 5 records and their evidence. It does not browse the web and does not infer unavailable market facts. It returns structured output for each candidate:

- One-sentence decision summary.
- Why the rule engine classified the setup this way.
- Entry confirmation still required.
- Invalidation condition.
- Primary chase, squeeze, liquidity, or stale-data risk.
- Remaining decision validity.

Generate all candidates in one batch. A normalized fingerprint includes Top 5 membership, direction, stage, score band, confirmation state, and material metric bands. Reuse the cached explanation when that fingerprint is unchanged.

AI generation rules:

- Minimum interval of 10 minutes between batch generations.
- No more than six generations per hour.
- A direction, stage, or Top 5 membership change makes a new batch eligible, but it still obeys cooldown and single-flight protection.
- MiniMax is primary and DeepSeek is fallback through the existing provider mechanism.
- Parsing or provider failure preserves the deterministic card and displays `AI 解释暂不可用`.
- AI wording cannot introduce leverage, position sizing, or an order instruction absent from the deterministic result.

## Persistence And Public Interface

Extend the existing market-alert SQLite database with focused tables for:

- Current candidate state and consecutive entry/exit counters.
- Latest enrichment snapshot and freshness metadata.
- Top 5 selection and decision fingerprint.
- Latest AI explanation, provider, generation time, and error state.
- Opportunity-worker heartbeat and last error.

Keep only the current candidate state plus a short diagnostic history. Old opportunity snapshots may be pruned after seven days; the existing historical alert events are not changed.

Extend the `/api/market-alerts` snapshot additively with `opportunities` and `opportunityMeta`. Include the new tables in the market-alert revision mechanism so the existing SSE stream refreshes the page without adding a second client connection.

The rule result appears as soon as it is persisted. A pending or stale AI explanation never blocks the API response.

## UI Design

Place `做单决策 · Top 5` directly below the contract-alert toolbar and above the existing 24-hour ranking.

Desktop layout:

- Left: five compact ranked candidates with symbol, classification, two key metrics, score, and decision status.
- Right: the selected candidate's AI explanation, confidence, confirmation condition, invalidation condition, key metrics, and expiry.
- Preserve the current dark workspace palette, semantic green/red status colors, restrained gold accent, square information density, and border radius of 8px or less.

Mobile layout:

- Show one full decision card at a time.
- Allow horizontal swipe through the Top 5 with a visible `current / total` indicator.
- Keep the decision, confirmation, and invalidation content above secondary metrics.
- Do not use a wide table or force horizontal text clipping.

The existing 24-hour ranking, real-time alerts, charts, active signals, and worker health remain available below the decision area. Empty, loading, stale, and AI-failed states have fixed-height layouts to avoid page shifts.

## Failure And Safety Behavior

- If Binance enrichment fails, retain the last successful candidate snapshot, mark its timestamp, lower confidence, and prohibit creation of a new actionable decision from stale data.
- If only some metrics are missing, show which fields are unavailable and cap the decision at `等待确认` when a mandatory field is absent.
- If the AI provider fails, keep all deterministic evidence and conditions visible.
- If the opportunity worker is stale, show a single clear warning in the Top 5 header and health panel rather than repeating errors on every card.
- If no candidate passes the rules, state that there are no qualified opportunities; do not fill the panel with low-quality alerts.
- All output remains informational and read-only. No API key with trading or withdrawal permission is introduced.

## Performance And Cost Controls

- Enrich only a bounded Top 12, not every monitored contract.
- Reuse current squeeze metrics and market tickers before making a new request.
- Derive 15-minute and 1-hour structure from cached 5-minute candles.
- Bound worker concurrency and use the shared Binance request limiter, retry backoff, and stale cache.
- Persist and reuse AI fingerprints, enforce single-flight generation, and batch all five candidates.
- Keep the web API read-only and fast by serving persisted results instead of performing Binance or AI requests during page rendering.

## Verification Targets

- Pure rule tests cover confirmed momentum long, unconfirmed distribution, confirmed short, short squeeze, chase-risk rejection, missing-data confidence caps, and hard invalidation.
- State-transition tests cover two-scan entry, three-scan exit, immediate invalidation, score-gap replacement, duplicate-symbol collapse, two-hour decay, and 12-hour expiry.
- Enrichment tests cover cache reuse, spot-market absence, partial Binance failure, derived timeframes, rate-limit backoff, and reuse of fresh squeeze metrics.
- Store tests cover migration, restart persistence, fingerprint deduplication, pruning, and revision updates.
- AI tests cover one-batch structured output, MiniMax-to-DeepSeek fallback, cooldown, hourly cap, single flight, malformed output, and deterministic fallback.
- API tests verify the additive snapshot fields and stale metadata without changing existing event results.
- Component tests verify desktop selection stability, mobile swipe behavior, fewer-than-five and empty states, stale warnings, and AI failure fallback.
- Existing market-alert worker tests, the complete repository test suite, lint, and `npm run build` pass.
- Browser verification covers desktop and mobile layouts, no overlapping text, stable card height, SSE refresh, and preservation of the selected candidate while ranking updates.

