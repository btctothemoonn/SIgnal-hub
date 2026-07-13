# Opportunity Radar Final Review Fix Report

## Status

Local final-review fixes are complete. Production deployment and the one-to-two-day shadow review remain pending.

Commit: `fbff1bf3c6f83f87dccb79b93fa35384a18de256`

## Fixes

- Enforced the 75-point active display threshold in store/API results and cached UI snapshots.
- Reused clusters by stable `sourceType + sourceId` identity when source text changes.
- Persisted and serialized market reaction, score context, score components, and penalties.
- Preserved per-claim evidence IDs through AI validation, persistence, API serialization, and card links.
- Added bounded Minimax/DeepSeek attempt, success, failure, and fallback telemetry to AI results, worker state/logs, and health metadata.
- Split current generated-evaluation coverage from evaluations performed in the latest cycle so hash hits remain healthy.
- Replaced the nullable market-reaction workaround with a discriminated domain type.

## Files Changed

- `src/lib/opportunity-types.ts`
- `src/lib/opportunity-rules.ts`
- `src/lib/opportunity-sources.ts`
- `src/lib/opportunity-store.ts`
- `src/lib/opportunity-store.test.mjs`
- `src/lib/opportunity-ai.ts`
- `src/lib/opportunity-ai.test.mjs`
- `src/lib/opportunity-worker.ts`
- `src/lib/opportunity-worker.test.mjs`
- `src/lib/system-health.ts`
- `src/lib/system-health.test.mjs`
- `src/components/opportunity-radar.tsx`
- `src/components/opportunity-radar.test.mjs`
- `src/app/api/opportunities/route.test.mjs`
- `scripts/opportunity-worker.mjs`
- `scripts/opportunity-worker-contract.test.mjs`
- `.superpowers/sdd/progress.md`
- `.superpowers/sdd/final-review-fix-report.md`

## Verification

- PASS: `node src/lib/opportunity-store.test.mjs`
- PASS: `node src/lib/opportunity-worker.test.mjs`
- PASS: `node src/lib/opportunity-ai.test.mjs`
- PASS: `node src/lib/opportunity-rules.test.mjs`
- PASS: `node src/lib/opportunity-sources.test.mjs`
- PASS: `node src/lib/system-health.test.mjs`
- PASS: `node src/components/opportunity-radar.test.mjs`
- PASS: `node src/app/api/opportunities/route.test.mjs`
- PASS: `node src/app/api/opportunities/mutations.test.mjs`
- PASS: `node scripts/opportunity-worker-contract.test.mjs`
- PASS: bundled Node `node_modules/typescript/bin/tsc --noEmit`
- PASS: bundled Node `node_modules/eslint/bin/eslint.js . --max-warnings 0`
- PASS: bundled Node `scripts/run-tests.mjs` (138/138 test files)
- PASS: `git diff --check`

These are equivalent to the requested `pnpm exec tsc --noEmit`, `pnpm exec eslint . --max-warnings 0`, and `pnpm test`; `node` and `pnpm` are not on this PowerShell session's `PATH`.

## Final Review Follow-up (2026-07-14)

- AI claim validation now accepts only evidence IDs whose original URLs sanitize to usable `http(s)` links, preventing unlinked AI claims from reaching cards.
- No-link catalyst IDs now hash stable source metadata (source type/name, ticker, publication timestamp, and provider category) instead of editable title or summary text.
- Outer-cycle failures retain bounded provider telemetry in `last_cycle`; the worker script includes that telemetry in structured error logs when an AI result had already completed.
- Added regressions for unlinked AI evidence, edited no-link catalysts retaining a single evidence/cluster identity, and late cycle failure preserving successful Minimax telemetry.

### Follow-up Verification

- PASS: `node src/lib/opportunity-ai.test.mjs`
- PASS: `node src/lib/opportunity-sources.test.mjs`
- PASS: `node src/lib/opportunity-worker.test.mjs`
- PASS: `node scripts/opportunity-worker-contract.test.mjs`
- PASS: `node src/lib/system-health.test.mjs`
- PASS: bundled Node `node_modules/typescript/bin/tsc --noEmit` (the `pnpm exec tsc --noEmit` launcher could not find `node` on PATH)

## Final Review Identity Fixes (2026-07-14)

- AI evaluation input hashes now include each evidence item's sanitized URL and linkability state, and worker evaluation persistence uses that same hash. Invalidating an evidence URL therefore prevents reuse of linked cached claims.
- Catalyst snapshots preserve the durable upstream `StocksCatalystSourceItem.id` as `sourceItemId`; no-link opportunity evidence IDs use it when present, so editorial edits retain identity while distinct same-timestamp catalysts remain distinct.

### Verification

- PASS: `node src/lib/opportunity-ai.test.mjs`
- PASS: `node src/lib/opportunity-sources.test.mjs`
- PASS: `node src/lib/stocks-catalyst-data.test.mjs`
- PASS: `node src/lib/opportunity-worker.test.mjs`
- PASS: `node src/components/opportunity-radar.test.mjs`
- PASS: `pnpm exec tsc --noEmit`
