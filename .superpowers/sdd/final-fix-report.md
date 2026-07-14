# Opportunity Watch Tier Final Fix Report

## Scope

- Worktree: `D:\Vibe coding\signal-hub\.worktrees\opportunity-watch-tier`
- Starting HEAD: `58be90ffed0433eb5beb8a3dc642982b4e12727d`
- Commit: one new commit on top of `58be90f`, subject `fix: address opportunity watch review findings`
- Exact commit hash: reported after commit creation. A commit cannot contain its own final hash because changing this report would change that hash.

## Findings

### 1. Watch query indexes

- Added four partial indexes for `all/market` x `score/latest`.
- Every index is limited to `selected_at IS NULL`, `status != 'expired'`, and scores `60 <= final_score < 75`, so confirmed, expired, and below-threshold rows do not add index write/storage cost.
- The watch query uses literal threshold predicates, preserving the existing 60-74 semantics while allowing SQLite to prove the partial-index predicate.
- The query explicitly selects the matching index through a closed four-way mapping. This avoids unstable planner choices between score and latest indexes and avoids interpolating unchecked runtime input into an SQL identifier.
- The test intercepts the actual watch SQL and bindings executed by `listOpportunities`, then runs `EXPLAIN QUERY PLAN` on that exact statement for all four option combinations. Each plan uses the expected partial index and contains no `USE TEMP B-TREE`.

### 2. Real React rendering coverage

- Extracted and exported the presentational `OpportunityResults` component without changing fetch/cache/mutation behavior.
- Added `react-dom/server` `renderToStaticMarkup` coverage using existing dependencies.
- The rendered HTML proves confirmed and watch cards appear only in their labeled sections.
- Separate watch-only and confirmed-only renders prove the two empty states are independent.
- Existing executable production-helper tests continue to cover follow and dismiss snapshot mutations. SSR also verifies follow, dismiss, and collapsed expand button contracts. No DOM event renderer is installed, so expand click simulation was not added and no dependency was introduced.

### 3. Color token

- Replaced nonexistent `text-positive` with the existing `text-success` token.
- Added explicit source-contract assertions for presence of `text-success` and absence of `text-positive`.

### 4. Store filter boundaries

- Added isolated US/CN confirmed and watch fixtures.
- Added an expired US watch fixture.
- The US active query proves market filtering applies to both confirmed and watch tiers and excludes the expired watch row.

## RED

Direct Node used for every test command:

`C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --experimental-strip-types --experimental-transform-types <test>`

Initial focused RED:

- `src/lib/opportunity-store.test.mjs`: failed as expected with `0 !== 4` because none of the four watch indexes existed.
- `src/components/opportunity-radar.test.mjs`: failed as expected with `typeof OpportunityResults === 'undefined'` instead of `function`.

Planner investigation after the first implementation:

- The all/score plan selected `idx_opportunity_clusters_selected` and reported `USE TEMP B-TREE FOR ORDER BY`.
- Adding `selected_at` as an index key made score plans pass, but latest still selected the score index and reported `USE TEMP B-TREE FOR ORDER BY`.
- The final test intercepts production SQL, and the final implementation explicitly chooses the matching lean partial index. This removed both unstable choices without requiring `ANALYZE` or wider indexes.

## GREEN

Focused GREEN:

- Direct Node + `src/lib/opportunity-store.test.mjs`: exit 0, `ok - opportunity store`.
- Direct Node + `src/components/opportunity-radar.test.mjs`: exit 0, `ok - opportunity radar cached cards and actions`.

Required regression verification:

- Direct Node + `src/lib/opportunity-store.test.mjs`: exit 0.
- Direct Node + `src/app/api/opportunities/route.test.mjs`: exit 0, `ok - opportunity list and refresh API behavior`.
- Direct Node + `src/components/opportunity-radar.test.mjs`: exit 0.
- Direct Node + `node_modules/eslint/bin/eslint.js` against the four modified source/test files: exit 0, no findings.
- Direct Node + `node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `git diff --check`: exit 0.

## Self-review

- No query result semantics changed: confirmed behavior is untouched; watch remains unselected, non-expired, score 60-74, non-dismissed, market-filtered, limited to five, and ordered by the selected mode.
- The index-name mapping is closed over typed market/sort branches; no caller-provided SQL identifier is interpolated.
- `initOpportunityDb` creates all four indexes before any watch query can run through the normal database-opening path.
- `OpportunityResults` contains the prior rendering branches; cache, refresh, follow, dismiss, request sequencing, and history behavior remain in `OpportunityRadar` and use the same handlers.
- Changed business files remain within the user-approved list. The requested report is the only additional artifact.

## Concerns

- `INDEXED BY` intentionally couples the watch query to these four schema indexes. Renaming or removing an index requires updating the closed mapping in the same change; `initOpportunityDb` currently guarantees their presence.
- Node emits existing experimental SQLite/type-transform and module-type warnings during tests. They do not affect exit status and were not changed because dependency/package metadata was outside scope.
- Expand interaction is covered only at rendered initial-state/source-contract level because the repository has no DOM/test renderer; follow/dismiss mutations have executable production-helper coverage.

## Interaction Re-review Fix

### Finding handled

- Added `react-test-renderer` as an exact `19.2.4` devDependency, matching the installed React and React DOM versions. No production dependency was added.
- Rendered the production `OpportunityResults` tree and directly asserted the heading texts `确认机会` and `候选观察`.
- Invoked the confirmed card follow button's real `onClick`; asserted `onFollow` received the exact card object and target `followed: true`.
- Invoked the real dismiss button's `onClick`; asserted `onDismiss` received the exact card object. The existing executable `applyOpportunitySnapshotMutation` test still proves an active snapshot removes the dismissed card.
- Invoked the real expand button's `onClick`; asserted the button changed to `aria-expanded: true` and the rendered reason detail appeared. Invoked it again; asserted `aria-expanded: false` and detail list removal.
- The production component required no changes.

### RED

Command:

`C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --experimental-strip-types --experimental-transform-types src/components/opportunity-radar.test.mjs`

Actual result: exit 1 with `MODULE_NOT_FOUND: react-test-renderer`, proving the existing test stack could not execute React interactions.

### Dependency installation

Command: `pnpm add --save-dev --save-exact react-test-renderer@19.2.4`

Actual result: the dependency and lockfile entries installed successfully, then pnpm 11 returned `ERR_PNPM_IGNORED_BUILDS` for pre-existing unapproved native-package scripts. pnpm also generated `allowBuilds` placeholders in `pnpm-workspace.yaml`; those generated lines were removed immediately, and the forbidden workspace file has zero final diff. No build scripts were approved or run.

### GREEN and regression verification

- Direct Node + `src/components/opportunity-radar.test.mjs`: exit 0, including real follow/dismiss/expand/collapse assertions.
- Direct Node + `src/lib/opportunity-store.test.mjs`: exit 0.
- Direct Node + `src/app/api/opportunities/route.test.mjs`: exit 0.
- Direct Node + ESLint on `src/components/opportunity-radar.test.mjs`: exit 0.
- Direct Node + `node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `git diff --check`: exit 0.

### Commit

- Parent: `12a8ea6`
- New commit subject: `test: cover opportunity card interactions`
- Exact hash is reported after commit creation because a commit cannot contain its own final hash.

### Concerns

- React 19 prints the upstream `react-test-renderer is deprecated` warning. The package is test-only, version-matched, and was explicitly allowed for this review fix; replacing it later requires a DOM-capable interaction test stack.
- Existing Node experimental SQLite/type-transform and module-type warnings remain unchanged and outside this component-test scope.
