# Alpha Research Pool Design

## Goal

Turn the sidebar Alpha entry into a dedicated US stock research pool for the AI compute chain, while keeping the existing Telegram/X Alpha summary as a secondary "message Alpha" view.

The first version is a read-only UI prototype backed by typed local mock data. It should validate the workflow, information hierarchy, and component boundaries before real market and financial APIs are connected.

## Scope

In scope:

- Add a dedicated `/alpha` page.
- Make the sidebar Alpha entry navigate to `/alpha`.
- Default the Alpha page to a "美股投研池" tab.
- Preserve the current Telegram/X Alpha summary as a second "消息 Alpha" tab.
- Build the research pool around AI compute chain stocks only.
- Use local mock data with typed structures.
- Use a left sector/ticker list and right stock detail layout.
- Show market strength, catalysts/news drivers, financial snapshot, financial readthrough, thesis, watch points, and risks.

Out of scope for the first version:

- Real market data APIs.
- Real financial statement APIs.
- Editable watchlists.
- Search, filters, alerts, or persistence.
- Binance Alpha relevance fields.
- Full income statement, balance sheet, and cash flow statement tables.
- Automatic news-to-ticker attribution.

## Product Structure

The Alpha page has two tabs:

- `美股投研池`: the default tab and main experience.
- `消息 Alpha`: a secondary tab that reuses the existing `AlphaSummaryCard`.

The research pool tab uses a two-column workbench layout:

- Left column: sector-grouped ticker list.
- Right column: selected stock detail.

On smaller screens, the layout stacks vertically with the ticker list above the stock detail.

## First-Version Stock Universe

The first version focuses only on the core AI compute chain:

- 半导体与设备: `NVDA`, `TSM`, `ASML`, `AMD`, `AVGO`, `LRCX`
- 光通信: `COHR`, `LITE`, `IPGP`, `FN`, `CIEN`, `GLW`
- 云/SaaS/软件: `MSFT`, `AMZN`, `GOOG`, `ORCL`, `NOW`, `SNOW`, `PLTR`
- 数据中心基础设施: `DELL`, `VRT`, `CLS`, `CRWV`, `NBIS`
- 数据存储: `MU`, `WDC`, `SNDK`, `STX`

Crypto, energy, nuclear, EV, space, and defense sectors are intentionally left out of the first version.

## Data Model

The first version should keep mock data in a typed local module, likely `src/lib/alpha-research-pool.ts`, so future API-backed data can replace the local source without rewriting the UI.

### Sector

`AlphaResearchSector` contains:

- `id`
- `name`
- `description`
- `themeScore`
- `tickers`

### Stock

`AlphaResearchStock` contains:

- `ticker`
- `companyName`
- `sectorId`
- `businessTags`
- `priority`
- `summary`
- `market`
- `catalysts`
- `financialSnapshot`
- `financialReadthrough`
- `thesis`
- `watchPoints`
- `risks`

### Market Fields

The stock market section contains:

- `lastPrice`
- `dayChangePct`
- `prePostChangePct`
- `sevenDayChangePct`
- `relativeStrengthLabel`
- `marketSession`
- `earningsStatus`

### Catalyst Fields

Each catalyst contains:

- `title`
- `type`
- `date`
- `impact`
- `summary`

Allowed first-version catalyst types:

- `earnings`
- `product`
- `supply-chain`
- `analyst`
- `macro`
- `regulatory`
- `industry-event`

### Financial Snapshot Fields

The financial snapshot contains:

- `revenue`
- `revenueYoY`
- `eps`
- `grossMargin`
- `freeCashFlow`
- `nextEarningsDate`
- `guidance`

The full three financial statements are not part of the first version.

## Components

### `AlphaResearchPage`

Page-level container for `/alpha`. It owns the active tab state and the selected ticker state.

### `AlphaResearchPool`

Main research pool tab body. It composes the left sector list and right detail panel.

### `AlphaSectorList`

Left-side sector and ticker list.

Each ticker row shows:

- Ticker
- Company short name
- Business tags
- Day change
- Seven-day change
- Earnings status

Sectors are expanded by default in the first version.

### `AlphaStockDetail`

Right-side selected-stock detail panel.

Sections appear in this order:

1. Header with ticker, company name, sector, priority, and short summary.
2. Market strength cards: day change, pre/post-market move, seven-day change, earnings status.
3. Catalyst/news drivers.
4. Financial snapshot.
5. Financial readthrough.
6. Thesis.
7. Watch points.
8. Risks.

This order follows the research workflow: first notice the move, then explain the catalyst, then verify against fundamentals.

### `AlphaMessageSummaryTab`

Secondary tab that reuses the existing `AlphaSummaryCard`. The existing Alpha summary API, cache, and summary logic remain intact.

## Interaction

- `/alpha` opens with the `美股投研池` tab selected.
- The first selected stock defaults to a high-priority or strong ticker, initially `NVDA`.
- Clicking a ticker in the left list immediately updates the right detail panel.
- The `消息 Alpha` tab displays the existing message-summary experience.
- No first-version interaction writes data.

## Visual Direction

The page should follow the current Signal Hub dark workbench style:

- Dense but readable information layout.
- Low-saturation dark surfaces.
- Thin borders.
- Small-radius cards and panels.
- Green/red accents for market moves.
- No marketing-style hero, decorative background, or oversized empty space.

The research pool should feel like an operational investing tool, not a landing page.

## Error Handling

Because the first version uses local mock data, runtime error handling is limited:

- If no ticker is selected, select the first available stock.
- If a sector has no stocks, render a quiet empty state.
- If a stock detail field is missing in mock data, render `n/a` or hide that subsection depending on the field.
- The message Alpha tab keeps the existing `AlphaSummaryCard` loading, empty, and error states.

## Testing

First-version testing should focus on the deterministic local data and component behavior:

- Validate that every stock references an existing sector.
- Validate that default selected ticker exists.
- Validate catalyst and financial mock objects have required fields.
- Validate the page builds without removing the existing Alpha summary behavior.

Run the project lint/build checks after implementation if the local environment supports them.

## Future Extensions

Likely follow-up work:

1. Add real market data, including pre-market and after-hours moves.
2. Add real financial data and replace mock financial snapshots.
3. Add search, filters, priority editing, and local persistence.
4. Connect Telegram/X message Alpha output to related tickers and sectors.
5. Add automatic catalyst attribution and alerts.

