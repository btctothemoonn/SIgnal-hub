# Signal Hub Command Workspace Full-Site Redesign

## Summary

Redesign the full Signal Hub interface as a modern command workspace while
preserving all existing product features, routes, data sources, background
workers, authentication behavior, and business logic.

The selected direction is:

- Command Workspace visual style.
- Full-site redesign in one coordinated release.
- Adaptive density by page rather than one density everywhere.
- Dark theme as the primary design, with a complete functional light theme.
- Design-system-first implementation rather than independent page rewrites.

The redesign covers Signal, Holding, Stocks, Douyin, Settings, Login, the shared
AppShell, desktop layouts, and mobile layouts.

## Goals

- Make the application feel like one coherent operational product.
- Improve information hierarchy without removing information or functionality.
- Increase scanning efficiency in Signal and Holding.
- Preserve comfortable reading in Stocks research, reports, and AI summaries.
- Reduce repeated status text, oversized surfaces, and unnecessary empty space.
- Keep mobile navigation and module switching predictable.
- Preserve existing data during refreshes and recover clearly from failures.

## Non-Goals

- Do not change data collection, AI generation, authentication, API contracts,
  caches, workers, or database behavior.
- Do not remove routes, navigation destinations, filters, refresh controls,
  reports, charts, translations, or holding sources.
- Do not add a new UI framework. `lucide-react` is the only permitted new
  presentation dependency and is used only to replace hand-drawn interface
  icons.
- Do not redesign business workflows beyond rearranging existing controls and
  information.
- Do not combine Douyin content into Signal Flow.

## Implementation Approach

Use a design-system-first migration:

1. Define shared semantic tokens and reusable surface rules.
2. Redesign AppShell and global navigation.
3. Apply page-specific layout shells using the shared system.
4. Update high-impact components only where their internal hierarchy must
   change.
5. Keep existing data fetching, state management, and event handlers in place.

This avoids a CSS-only reskin, which would leave current layout problems intact,
and avoids unrelated page-by-page rewrites that could produce inconsistent
behavior.

## Global Design System

### Color

The primary dark theme uses:

- Near-black and charcoal application backgrounds.
- Muted green-gray surfaces.
- Warm gold for selected navigation and priority emphasis.
- Green for healthy and positive states.
- Red or coral only for failures, destructive actions, and negative values.

The light theme uses the same semantic roles with cool white, gray-green,
charcoal text, restrained gold selection, and the same status meanings.

Large purple, blue-purple, beige, brown, and single-hue surfaces are excluded.
Color never acts as the only status indicator.

### Typography

- Use the existing system-oriented sans-serif stack for operational content.
- Use stable font sizes rather than viewport-scaled typography.
- Reserve large type for page titles and major portfolio values.
- Use compact headings inside panels, cards, sidebars, and tools.
- Use tabular numerals for prices, percentages, timestamps, and account values.
- Keep letter spacing at zero.

### Spacing And Surfaces

- Use an adaptive density scale:
  - Signal and Holding: compact.
  - Stocks: medium density.
  - Reports, long AI summaries, and settings forms: comfortable reading density.
- Standard card radius is 6px.
- Page sections are unframed or separated by borders and surface bands.
- Cards are reserved for repeated items, bounded tools, and modals.
- Do not place cards inside cards.
- Stable dimensions are required for navigation, toolbars, charts, tabs,
  icon buttons, and status counters.

### Controls

- Use `lucide-react` icons for interface actions and navigation.
- Use icon buttons for familiar actions such as refresh, settings, copy, open,
  previous, next, and close.
- Use text or icon-plus-text buttons only for clear commands.
- Use tabs for views, segmented controls for compact modes, toggles for binary
  settings, and menus for option sets.
- Provide tooltips for unfamiliar icon-only actions.

## Global AppShell

### Desktop

- Keep a compact left navigation rail with icon and Chinese label.
- Highlight the active destination with a warm-gold border and low-saturation
  selected surface.
- Keep navigation dimensions stable so route transitions do not move content.
- Limit the top bar to the page name, essential data status, settings, theme,
  and logout.
- Remove repeated product descriptions and duplicated source counts from global
  chrome.
- Use a common content gutter, while allowing Signal and Stocks charts to use a
  wider workspace.

### Mobile

- Keep the fixed bottom navigation.
- Use fixed icon and label dimensions so selected states do not shift.
- Reduce the top bar to page title, connection state, and necessary actions.
- Respect device safe areas.
- Prevent unintended page-level horizontal scrolling.

## Signal

### Desktop Layout

- Keep the existing two-column workflow.
- Signal Flow occupies approximately 70 percent of the available width.
- AI summary occupies approximately 30 percent.
- Consolidate search, source filters, author/channel selection, refresh, and
  relevant counters into one compact toolbar.
- Remove low-value duplicated status pills while retaining actionable status.

### Message Cards

- Preserve avatar, display name, username, source, timestamp, full text,
  translation, quoted or forwarded content, media, copy, and source link.
- Reduce padding and repeated borders without reducing text readability.
- Keep quoted content visually subordinate but fully readable.
- Preserve deduplication behavior and existing message ordering.

### Mobile Behavior

- Keep horizontal swipe navigation between Signal Flow and AI summary.
- Switching modules always scrolls the destination module to its top.
- Preserve floating actions for newest, last-read, and oldest positions.
- New messages must not move the current reading viewport.
- Opening Signal defaults to the newest messages; last-read remains an explicit
  user action.

## Holding

- Keep Binance, US securities, and tracked third-party holdings as peer views.
- Place total equity, total PnL, total PnL percentage, risk state, and last
  update in the first information band.
- Use compact position cards that prioritize symbol, market value, weight,
  quantity, cost, current price, PnL, and PnL percentage.
- Keep position values visually aligned and stable across rows.
- Keep account equity curves and position lists at the same hierarchy level.
- Do not recreate removed heatmap or redundant holdings-detail sections.
- Preserve existing sector and theme classifications.

## Stocks

### Page Hierarchy

1. Compact Stocks-specific data health and source state.
2. Relative performance and Hynix premium/funding charts.
3. Industry-chain stock pool and selected-stock research workspace.
4. Subscription reports, catalysts, news, and supporting financial detail.

### Data Health

- Show healthy providers in a compact single line.
- Give failures, fallbacks, and stale data stronger emphasis.
- Keep retry and refresh actions available.
- Do not expose provider secrets.

### Stock Detail

- Prioritize current price, daily move, seven-day strength, structure state,
  earnings window, impact tags, risk tags, and core research drivers.
- Keep deterministic intelligence available when AI summaries fail.
- Place long news, reports, and raw financial fields below the first research
  viewport.
- Keep missing values as `n/a` without destabilizing the layout.

### Charts And Pool

- Keep stable chart dimensions and label lanes.
- Prevent overlapping endpoint labels.
- Keep the industry stock pool wide enough to show names and tags.
- Preserve existing desktop split layouts and mobile horizontal module paging.
- Never compress a desktop multi-column research tool into unreadable mobile
  columns.

## Douyin

- Keep creator identity, collection status, last update, and manual refresh in a
  compact header.
- Display videos newest first.
- Use a desktop media-and-summary layout with cover and metadata on one side and
  the research summary on the other.
- Structure summaries around mentioned A-share stocks, sectors, recommendation
  logic, catalysts, risks, and follow-up items.
- Avoid large tag walls.
- On mobile, stack cover, title, metadata, and summary.
- Keep the cover and title as direct video links.

## Settings

- Use a desktop category sidebar and a focused editor region.
- Separate data sources, Telegram/X, Douyin, AI, system health, and general
  settings.
- On mobile, replace the sidebar with a horizontally scrollable category tab
  strip while keeping page-level horizontal overflow disabled.
- Show whether secrets are configured, but never show their values.
- Use consistent save, test-connection, retry, and delete controls.
- Preserve current validation, persistence, and permission behavior.

## Login

- Keep a simple single-screen login experience.
- Show Signal Hub identity, password input, submit action, lockout state, and
  error feedback.
- Do not add marketing content or a landing page.
- Use the same light and dark theme tokens and mobile safe-area behavior.

## Loading, Empty, And Error States

- Keep the previous successful data visible during background refreshes.
- Use compact inline refresh indicators instead of blocking full-page loaders.
- A provider failure must not blank unrelated page regions.
- Show retry actions for recoverable failures.
- Empty states explain what is missing without describing product features or
  adding decorative illustrations.
- AI summary failure falls back to cached summary or deterministic content where
  available.

## Responsive Rules

- At widths of 1024px and above, use persistent side navigation and multi-pane
  workspaces where the page design calls for them.
- Tablet layouts reduce secondary metadata before reducing primary content.
- Mobile layouts stack or page between modules instead of shrinking columns.
- Buttons maintain practical touch targets.
- Long stock names, usernames, tags, translations, and report titles wrap
  cleanly without overlapping adjacent content.
- Charts reserve space for their longest labels at every supported width.
- No fixed-format control may resize because of hover, loading, selection, or
  dynamic values.

## Component Boundaries

- `src/app/globals.css` owns semantic theme tokens, global typography, shared
  surfaces, spacing scales, and responsive foundations.
- `src/components/app-shell.tsx` owns shared navigation and global chrome.
- Page components own page hierarchy and layout only.
- Existing feature components retain business logic and data ownership.
- Small presentational primitives may be extracted only when they remove real
  duplication across multiple pages.
- No new state-management layer is introduced.

## Verification

### Contract Tests

- Extend global theme and AppShell contracts for the new tokens and navigation.
- Add or update page layout contracts for Signal, Holding, Stocks, Douyin,
  Settings, and Login.
- Keep behavior tests for reading position, mobile paging, refresh, filters,
  settings persistence, and holdings intact.

### Visual Verification

- Verify desktop and mobile viewports with browser screenshots.
- Check dark and light themes.
- Check longest Chinese and English labels.
- Check loading, cached, empty, and error states.
- Check that charts, bottom navigation, floating reading controls, and sticky
  toolbars do not overlap.

### Project Verification

- Run focused UI contract tests during implementation.
- Run the complete test suite.
- Run ESLint.
- Run the production build.
- Deploy only after local verification succeeds.

## Rollout

Implement the redesign as one coordinated feature set, but organize commits by
shared design system, AppShell, core operational pages, supporting pages, and
responsive polish. Do not deploy partially restyled production pages.

After all tests and browser checks pass:

1. Push the complete redesign to GitHub.
2. Deploy the same commit to the VPS.
3. Verify the deployed commit, service health, login page, Signal, Holding,
   Stocks, Douyin, and Settings.
