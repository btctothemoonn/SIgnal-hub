# Market Alert Brief

- The alerts page reads cached `briefs` from its existing authenticated snapshot/SSE endpoint. Reads and scope selection never invoke AI.
- The existing opportunity worker runs an independent summary loop once per hour. A shared SQLite atomic claim persists the one-hour limit across restarts and overlapping workers.
- Both rolling windows (1h and 24h) use one bounded model request. Empty windows and unchanged aggregate inputs do not invoke the model. Failed requests are not retried until the next hourly check and never automatically switch providers.
- M3 uses thinking disabled and a 2,200-token completion limit for this feature only. Existing homepage, opportunity explanations and WeCom behavior are unchanged.
- Full-window SQL aggregation supplies counts. At most five symbols per window are sent to the model; repeated alerts are counted and merged. Model output may only explain those selected symbols. Displayed numbers come from the database, not model output.
- Prices/changes refer to the latest alert at the displayed timestamp, not live market prices. Mixed-direction and older-trigger warnings are calculated locally.
- The last successful cache survives a failed generation and is marked as stale/error. No data is fetched from Binance or Signal feeds for this feature.
- Storage: `market_alert_brief` in the existing market-alert SQLite database. No extra service, credential, port or public API is introduced.

Tests cover full-window counts beyond feed pagination, future/out-of-window exclusion, grouping, persistent hourly gating, concurrent claims, empty/unchanged windows, batched requests, invalid symbols/scopes, retained caches, and responsive component states.
