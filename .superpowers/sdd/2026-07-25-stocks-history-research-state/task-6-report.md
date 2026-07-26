# Task 6 Report: Stocks Research State Workflow

## Changed Files

- `src/components/alpha-research-page.tsx`
- `src/components/stocks-research-layout.tsx`
- `src/components/alpha-sector-list.tsx`
- `src/components/alpha-stock-detail.tsx`
- `src/components/alpha-research-page.test.mjs`
- `src/components/stocks-research-layout.test.mjs`
- `src/components/alpha-sector-list.test.mjs`
- `src/components/alpha-stock-detail.test.mjs`
- `src/components/alpha-sector-list.behavior.test.mjs`

## Implementation Notes

- `AlphaResearchPage` owns the controlled research-state map, loading state, error state, and status filter. It makes one mount-only GET request to `/api/stocks-research-state` and does not poll.
- The page saves complete editor input with PUT, rejects non-OK or malformed responses, reconciles only the returned ticker, and rethrows errors to preserve the controlled editor draft and display its error.
- `StocksResearchLayout` threads research state, loading, errors, save handling, and filters to the pool and selected detail. The selected detail and chart remain independent of pool filtering.
- `AlphaSectorList` provides a five-option wrapping filter control. Missing persisted state is `watch`; empty sectors are omitted; sector ticker order remains stable.
- `AlphaStockDetail` surfaces research-state availability errors. Chinese UI strings remain UTF-8. Signal Flow files were not modified.

## Test Commands And Outputs

The Node runtime required by the repository tests is not available on PATH or at an accessible `node.exe` location. The following commands were attempted from the isolated worktree:

```powershell
node src/components/alpha-research-page.test.mjs
node src/components/alpha-sector-list.test.mjs
node src/components/stocks-research-layout.test.mjs
node src/components/alpha-sector-list.behavior.test.mjs
```

Output for each command:

```text
node : The term 'node' is not recognized as the name of a cmdlet, function, script file, or operable program.
```

The final requested component-test commands remain blocked by the same missing runner:

```powershell
node src/components/alpha-research-page.test.mjs
node src/components/alpha-sector-list.test.mjs
node src/components/stocks-research-layout.test.mjs
node src/components/stocks-research-state-panel.test.mjs
node src/components/alpha-stock-detail.test.mjs
```

Completed non-Node checks:

```powershell
git -c safe.directory='D:/Vibe coding/signal-hub/.worktrees/stocks-history-research-state' diff --check
```

```text
(no output; exit code 0)
```

```text
ok - Task 6 static contract check
ok - UTF-8 src\components\alpha-research-page.tsx
ok - UTF-8 src\components\stocks-research-layout.tsx
ok - UTF-8 src\components\alpha-sector-list.tsx
ok - UTF-8 src\components\alpha-sector-list.behavior.test.mjs
```

## Self-Review

- Confirmed the GET effect has an empty dependency list and no timer.
- Confirmed save uses complete input, validates `response.ok`, replaces only `[saved.ticker]`, and rethrows failures.
- Confirmed research-state errors flow from page to layout to selected detail, and save failures reach the editor directly.
- Confirmed filtering defaults missing entries to `watch`, preserves ticker rank, hides empty sectors, and cannot remove the independent detail or chart.
- Added runtime behavior coverage for `all`, `watch`, `waiting`, `holding`, and `avoid`, including empty-sector removal and rank ordering.
- Confirmed task changes are restricted to Stocks research components, tests, and this report.

## Concerns

- Node.js, npm, npx, pnpm, yarn, bun, deno, and tsc are unavailable on PATH, and no accessible `node.exe` was found. The component suite and TypeScript check are unexecuted in this environment.
- The original source-contract tests and several implementation edits were already present or changed concurrently in the isolated worktree. They were reviewed and retained; the runtime filter test was expanded during this task.
