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

During the initial implementation pass, the Node runtime was not found through the PATH lookup used at that time. The following commands were attempted before the bundled executable was located:

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

Those component-test commands were not executed during the initial pass. Fix Round 1 below supersedes this historical limitation with successful bundled-runtime evidence for the full covering set:

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

- The initial PATH lookup did not expose Node.js. The bundled runtime was subsequently located and used for both component tests and real project TypeScript verification in the fix rounds below.
- The original source-contract tests and several implementation edits were already present or changed concurrently in the isolated worktree. They were reviewed and retained; the runtime filter test was expanded during this task.

## Fix Round 1/5

### Fix Details

- Added complete successful-PUT response validation before reconciliation. The page now requires a non-empty ticker, one of the four persisted statuses, valid nullable conviction, all four text fields, nullable string `updatedAt`, and boolean `persisted`.
- A malformed `200` response throws `Research state save returned an invalid response.` and leaves the existing state map unchanged.
- Added `alpha-research-page.behavior.test.mjs`, which mounts the actual page workflow and verifies:
  - research-state GET runs exactly once and is not registered with the page polling intervals;
  - PUT receives the complete editor input;
  - successful reconciliation replaces only the returned ticker;
  - malformed successful responses for every required field are rejected without entering state;
  - a failed save propagates through the page callback into the real controlled editor while preserving its draft.
- The tracked-report metadata Minor remains unchanged for final triage, as required for this fix round.

### Executed Test Evidence

The following evidence supersedes the earlier unexecuted-test concern. Commands were run from `D:\Vibe coding\signal-hub\.worktrees\stocks-history-research-state`.

```powershell
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' src\components\alpha-research-page.behavior.test.mjs
```

```text
ok - alpha research page research-state workflow behavior
react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer
(node:72500) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///D:/Vibe%20coding/signal-hub/.worktrees/stocks-history-research-state/src/components/stocks-research-state-form.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to D:\Vibe coding\signal-hub\.worktrees\stocks-history-research-state\package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer
```

```powershell
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' src\components\alpha-research-page.test.mjs
```

```text
ok - alpha research page sticky controls
```

```powershell
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' src\components\alpha-sector-list.behavior.test.mjs
```

```text
ok - alpha sector list research-status filtering
```

```powershell
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' src\components\alpha-sector-list.test.mjs
```

```text
ok - alpha sector list sticky layout
```

```powershell
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' src\components\stocks-research-layout.test.mjs
```

```text
ok - stocks research layout uses desktop split and mobile pager
```

```powershell
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' src\components\stocks-research-state-panel.behavior.test.mjs
```

```text
ok - stocks research state panel behavior
react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer
(node:79552) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///D:/Vibe%20coding/signal-hub/.worktrees/stocks-history-research-state/src/components/stocks-research-state-form.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to D:\Vibe coding\signal-hub\.worktrees\stocks-history-research-state\package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
```

```powershell
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' src\components\stocks-research-state-panel.test.mjs
```

```text
ok - stocks research state editor contract
```

```powershell
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' src\components\alpha-stock-detail.test.mjs
```

```text
ok - alpha stock detail research review UI
```

## Fix Round 2/5

### Fix Details

- Replaced the stale statement that TypeScript verification was unexecuted with the current bundled-runtime evidence.
- Ran the installed project compiler against the full workspace configuration. No Task 6 or other project type errors were reported, so product code and tests were unchanged in this round.

### TypeScript Verification Evidence

Command, executed from `D:\Vibe coding\signal-hub\.worktrees\stocks-history-research-state`:

```powershell
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\typescript\bin\tsc --noEmit
```

Exit code:

```text
0
```

Output:

```text
(no output)
```
