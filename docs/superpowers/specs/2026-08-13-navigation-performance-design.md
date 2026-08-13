# Signal Hub Navigation Performance Design

## Goal

Reduce the visible delay when switching between Signals, Holding, Stocks, and
Douyin without removing data, controls, live updates, or historical access.

## Measured Baseline

- Stocks loads the largest client bundle and fetches a 1.4 MB performance
  snapshot containing 33 series and 7,920 points.
- Signals renders up to 200 rich feed cards and immediately repeats the
  Telegram and X snapshot requests already supplied by the server.
- Douyin serializes all 68 cached videos into the initial server response,
  producing about 927 KB of page data despite a small client bundle.
- Holding is already comparatively light and only needs an immediate route
  fallback while its dynamically imported panel loads.

## Design

### Stocks

Add an opt-in compact response to `/api/stocks-performance`. The default JSON
shape remains unchanged for compatibility. `format=compact` returns the same
series metadata with points encoded as tuples, and the browser expands those
tuples before passing data to existing chart components.

Market data and performance remain immediate because they drive the top of the
page. Financial and catalyst requests start after the first paint through a
small reusable deferred-task helper. Existing browser caches remain available
while deferred live data loads.

### Signals

The server-provided Telegram and X snapshots are authoritative on first mount.
Do not issue the existing duplicate refresh on initial `latest` mount. Range
changes, focus refreshes, timers, SSE, and manual refresh behavior remain.

Keep all feed cards in the DOM so reading anchors and jump controls continue to
work. Apply browser-native `content-visibility: auto` and an intrinsic size to
feed cards so off-screen content avoids layout and paint work.

### Douyin

Paginate cached videos without changing the default API response. The page and
client request `limit=10` initially. A load-more command raises the requested
limit by ten while preserving the existing one-minute refresh. Pagination only
changes serialization and rendering; all historical videos remain accessible.

### Route Feedback

Add route-level loading fallbacks for the four main workspaces. The skeletons
use one shared component and stable dimensions so navigation acknowledges a
tap immediately without shifting the final layout.

## Compatibility And Failure Behavior

- Existing API callers receive the current Stocks and Douyin response shapes
  unless they request the new query options.
- A deferred Stocks request failure uses the existing error and cached-data
  behavior.
- Signals still refreshes after range changes and through live streams.
- Douyin refresh failures keep the currently displayed page.
- No data source, worker, navigation item, or user-facing feature is removed.

## Verification

- Contract tests cover compact Stocks encoding/decoding, initial Signal refresh
  policy, Douyin pagination, and loading fallbacks.
- Existing component and API tests continue to pass.
- ESLint and the production Next.js build pass.
- Production measurements confirm smaller Stocks and Douyin payloads and no
  initial duplicate Signal snapshot requests.
