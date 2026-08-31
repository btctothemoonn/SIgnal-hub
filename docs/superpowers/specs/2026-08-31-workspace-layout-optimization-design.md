# Signal Hub Workspace Layout Optimization Design

## Goal

Improve first-screen usefulness and route-switch responsiveness without removing any data source, dashboard, filter, chart, saved-reading action, or mobile swipe behavior.

## Accepted Direction

- Keep the current neutral dark workspace and gold active accent.
- Keep the desktop sidebar and the five primary product areas.
- Make the mobile top bar a compact single row and keep Settings in the top bar instead of duplicating it in the bottom navigation.
- Keep the Hynix premium tool on Signal, but show a compact market strip first and expand the full chart on demand.
- Render Signal messages progressively so the initial DOM does not contain the full multi-day feed. Saved position and oldest-message actions must still reveal their target before scrolling.
- Remove repeated page-heading layers in Holding and Stocks while retaining every account, metric, chart, and earnings view.
- Keep Daily Brief history and categories, but collapse the long market pulse/watch list on small screens.
- Reduce nested card borders and repeated per-row loading labels where the page already has a source-level health state.

## Verification Targets

- At 390 x 844, the Signal Flow toolbar is visible within the first viewport when the premium tool is collapsed.
- Signal initially mounts no more than 30 message articles and can progressively reveal the complete filtered result.
- Mobile bottom navigation contains five product destinations; Settings remains available in the top bar.
- Holding reaches account metrics and positions with fewer repeated headings.
- Stocks preserves pool, performance, details, and earnings views on desktop and mobile.
- Daily Brief categories remain reachable without removing market context.
- Existing tests, new behavior tests, `npm run build`, and desktop/mobile browser verification pass.

