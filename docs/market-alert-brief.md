# Market Alert Brief

- The alerts page reads cached `briefs` from its existing authenticated snapshot/SSE endpoint. Reads and scope selection never invoke AI.
- The existing opportunity worker runs an independent summary loop once every three hours. A shared SQLite atomic claim persists the three-hour limit across restarts and overlapping workers. Existing hourly deadlines are extended from the last check when upgrading.
- Both rolling windows (3h and 24h) use one bounded model request. The default 3h report covers all alerts in the preceding three hours, matching the generation cadence. Empty windows and unchanged aggregate inputs do not invoke the model. Failed requests are not retried until the next three-hour check and never automatically switch providers.
- Upgrading from 1h preserves the 24h cache and the existing cooldown, but excludes the old 1h cache from API responses. The 3h report stays unavailable until the next scheduled generation; old hourly text is never relabeled as a three-hour report.
- M3 uses thinking disabled and a 2,200-token completion limit for this feature only. Existing homepage, opportunity explanations and WeCom behavior are unchanged.
- Full-window SQL aggregation supplies counts. At most five symbols per window are sent to the model; repeated alerts are counted and merged. Model output may only explain those selected symbols. Displayed numbers come from the database, not model output.
- Prices/changes refer to the latest alert at the displayed timestamp, not live market prices. Mixed-direction and older-trigger warnings are calculated locally.
- The last successful cache survives a failed generation and is marked as stale/error. Otherwise, server and browser mark it stale after 195 minutes (three hours plus 15 minutes of grace). No data is fetched from Binance or Signal feeds for this feature.
- Storage: `market_alert_brief` in the existing market-alert SQLite database. No extra service, credential, port or public API is introduced.

Tests cover full-window counts beyond feed pagination, future/out-of-window exclusion, grouping, persistent three-hour gating and legacy deadline migration, concurrent claims, empty/unchanged windows, batched requests, invalid symbols/scopes, retained caches, and responsive component states.
