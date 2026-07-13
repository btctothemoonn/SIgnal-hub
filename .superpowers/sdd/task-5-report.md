# Task 5 Report: Opportunity Worker

## Status

Implemented the hourly Opportunity Radar worker, one-cycle orchestration,
idempotent AI recovery, rule-only fallback, and the `--once` script entry point.

## Scope

- Added `src/lib/opportunity-worker.ts`.
- Added focused cycle and recovery coverage in
  `src/lib/opportunity-worker.test.mjs`.
- Added `scripts/opportunity-worker.mjs` and its contract test.
- Added `opportunity:worker` and `opportunity:worker:once` package scripts.

The worker reads only the Task 3 cache loaders. It scores every cluster, sends
only rule scores of at least 60 to AI in batches of at most 20, hashes each
actual `{ candidate, ruleScore }` input, reuses generated evaluations, retries
error evaluations, and preserves older generated analysis when a new attempt
fails. Rule-only analysis uses adjustment 0 and `AI 待补充`; final scores are
clamped to 0-100. Shanghai daily selection remains threshold 75 and limit 10.

Worker state is written after successful data writes and also records fatal
cycle failures without persisting exception messages. Script logs contain only
event names, counts, duration, provider/model, and error classes.

## TDD Evidence

- Initial RED: worker test failed with `ERR_MODULE_NOT_FOUND` for
  `opportunity-worker.ts`; contract test failed because
  `scripts/opportunity-worker.mjs` did not exist.
- GREEN: both new test files passed after the minimal implementation.
- Review RED: the low-score rule-only assertion failed because thesis was
  empty instead of `AI 待补充`.
- Review GREEN: all candidates without a generated evaluation now receive a
  transactional rule-only analysis before optional AI evaluation.

## Verification

- Opportunity tests: 6/6 passed (`ai`, `rules`, `sources`, `store`, `worker`,
  and worker script contract).
- `pnpm exec tsc --noEmit`: passed.
- Focused ESLint with `--max-warnings 0`: passed.
- Isolated `pnpm opportunity:worker:once`: exited 0 and persisted a zero-item
  cycle without reading the existing runtime cache.
- `git diff --check`: passed before report generation.

## Concerns

- Node 24 emits existing experimental warnings for type transformation,
  `node:sqlite`, and typeless package ESM reparsing. No new package-level module
  setting was added because it is outside Task 5 scope.

## Review Fixes

- Pending AI work is now built for every `ruleScore >= 60` candidate by first
  computing its actual `{ candidate, ruleScore }` input hash, then removing
  generated evaluations, sorting deterministically by rule score and
  canonical key, and only then applying the 20-item batch limit. The 21-item
  regression evaluates 20 items in cycle one and the remaining item in cycle
  two, with every canonical key evaluated exactly once.
- Every cycle now independently recalculates lifecycle status for every
  persisted non-expired cluster after AI application and before daily
  selection. The recalculation uses persisted `valid_until`,
  `invalidated_at`, final score, confidence, and independent evidence-source
  count, so expiry works both on a generated-hash cache hit and after the
  candidate leaves the seven-day source cache.
- Task 2 store files were not changed; the lifecycle sweep is transactionally
  contained in the worker.

Review TDD evidence:

- Starvation RED produced actual AI batch lengths `[20]` instead of expected
  `[20, 1]`; GREEN now completes the pending item in the next cycle.
- Lifecycle RED left the persisted status as `tracking` instead of `expired`;
  GREEN now expires both hash-hit and source-cache-miss paths.
