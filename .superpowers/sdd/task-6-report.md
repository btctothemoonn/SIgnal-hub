# Task 6 Report: Authenticated Opportunity APIs

## Status

Implemented the authenticated Opportunity Radar API routes and focused contract tests.

## Scope

- Added list and cache-only refresh endpoints under `src/app/api/opportunities`.
- Added follow and dismiss preference endpoints with positive integer ID validation,
  missing-cluster handling, and parameterized store writes.
- Added focused API contract tests for query validation, cache boundaries, mutation
  requirements, and proxy-auth non-duplication.

## TDD Evidence

- RED: both new contract tests failed with `ENOENT` because the route files did
  not exist.
- GREEN: list/refresh and mutation contract tests passed after the minimal route
  implementation.

## Verification

- `node src/app/api/opportunities/route.test.mjs`: passed (via the bundled Node runtime because `node` is absent from PATH).
- `node src/app/api/opportunities/mutations.test.mjs`: passed (via the bundled Node runtime).
- `node src/proxy.test.mjs`: passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec eslint src/app/api/opportunities --max-warnings 0`: passed.
- `git diff --check`: passed.

## Concerns

- The shell environment does not expose `node` on PATH; verification used the
  bundled Codex runtime executable while preserving the requested commands.
- The existing proxy regression emits the repository's pre-existing typeless
  package ESM warning. No package metadata was changed because it is outside
  this task's scope.

## Review Fixes

- History snapshots now retain dismissed opportunities; dismissal filtering is
  applied only to active lists.
- `setOpportunityPreference()` now accepts a partial preference patch. A single
  parameterized UPSERT preserves unspecified values for existing rows and
  defaults unspecified values to `false` for new rows. Follow and dismiss
  routes now submit only their respective field.
- All opportunity route database opens occur inside `try` blocks and use an
  optional close in `finally`, so open failures produce the existing generic
  JSON error responses without exposing backend details.
- List limit handling now follows the task reference: absent, non-numeric, and
  zero values use 10; negative values clamp to 1; positive values clamp to
  1-100.
- API tests now seed temporary SQLite databases and call the actual route
  handlers. They cover dismissed history results, list limits, generic DB-open
  failure output, preference preservation, invalid IDs, and missing clusters.

## Review Verification

- RED: store partial-patch test observed `dismissed` changing from `1` to `0`.
- RED: handler tests exposed the direct module-load boundary and then failed
  against the prior history/preservation behavior.
- GREEN: API behavior tests, store tests, proxy regression, `tsc --noEmit`,
  and focused ESLint all passed after the fixes.
