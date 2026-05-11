# Binance Holding Design

## Goal

Replace the sidebar "收藏" entry with "Holding" and connect it to a read-only Binance holdings view focused on spot balances and USD-M futures positions.

## Scope

- The existing Signal Hub home remains the default "信号" view.
- The sidebar gets a new `Holding` entry that navigates to `/holding`.
- Binance API credentials stay server-side in environment variables.
- The Binance API key should be read-only. Trading and withdrawal permissions are out of scope.
- The first exchange target is Binance only. Other CEX providers can be added later through the same normalized holding types.

## Architecture

- `src/lib/binance-holdings.ts` owns Binance request signing, environment parsing, response normalization, and holding summary math.
- `src/app/api/holdings/binance/route.ts` exposes a dynamic server route for the UI. It returns normalized data and never returns API secrets.
- `src/components/holding-panel.tsx` renders the holdings view as a client component and refreshes via the API route.
- `src/components/app-shell.tsx` owns the reusable sidebar/header shell so the home page and holding page share navigation and active states.
- `src/app/holding/page.tsx` renders the Holding page inside the shared shell.

## Data Flow

1. User opens `/holding`.
2. `HoldingPanel` requests `/api/holdings/binance`.
3. The API route calls `getBinanceHoldingSnapshot`.
4. The Binance client signs `GET /api/v3/account` for spot balances and `GET /fapi/v3/account` for futures account/position data.
5. Raw Binance responses are normalized into spot assets, futures positions, and a portfolio summary.
6. The UI displays total estimated USDT value, non-zero spot balances, active futures positions, connection status, and last refresh time.

## Error Handling

- Missing API credentials returns a clear 400 response with setup guidance.
- Binance HTTP errors return status and message without leaking headers or secrets.
- Empty spot/futures data is displayed as an empty state, not a failure.
- The UI provides a manual refresh button and preserves the last visible state while refreshing.

## Testing

- Add focused node tests for signature creation, query serialization, spot normalization, futures normalization, and total summary calculation.
- Run the new lib test, then run the project lint/build checks.

