# Signal Hub Production Hardening Batch 2 Design

## Summary

Continue production hardening without removing or changing product features. The work is split into two independently deployable releases:

1. Dependency and build hygiene.
2. React state and effect cleanup.

The first release removes known dependency advisories and the Turbopack whole-project tracing warning. The second release removes the remaining React lint warnings while preserving Signal Flow reading behavior, Stocks polling, Holding refreshes, settings health checks, and AI summary controls.

## Current Baseline

- `pnpm audit --prod` reports two moderate advisories:
  - `postcss@8.4.31`, pulled by `next@16.2.6`.
  - `ip-address@10.1.0`, pulled by `telegram -> socks`.
- ESLint completes with zero errors and 17 warnings.
- The production build completes with one Turbopack NFT warning because dynamic Stocks cache paths can cause the whole project to be traced.
- The project test runner discovers 125 test files.
- GitHub, local `main`, and the VPS are aligned before this batch starts.

## Constraints

- Do not remove Signal Flow, Stocks, Holding, Douyin, subscription research, AI summaries, Telegram, X, or background workers.
- Do not change login permissions, API response shapes, runtime configuration keys, or cache file formats.
- Preserve Signal Flow reading position, new-item counts, author favorites, filters, and live updates.
- Preserve current Stocks refresh intervals and stale-cache fallback behavior.
- Each release must pass the complete test suite, ESLint, dependency audit, and production build before deployment.
- Each release is pushed to GitHub and deployed to the VPS independently.

## Release 2A: Dependency And Build Hygiene

### Dependency Overrides

Add narrow `overrides` entries in `pnpm-workspace.yaml`, which is the
authoritative pnpm 11 override source for installs. Do not duplicate them in
`package.json.pnpm`, because pnpm 11 ignores that field and warns on every
command:

- `postcss: 8.5.16`
- `ip-address: 10.2.0`

If later audits require toolchain overrides, scope incompatible major versions
to their direct consumer rather than forcing one version globally.

These versions contain the upstream fixes while preserving the existing direct dependency versions for Next.js and Telegram. The lockfile is regenerated and the actual resolved graph is verified with `pnpm why` and `pnpm audit --prod`.

### Runtime Cache Path Tracing

Keep all existing cache paths and environment overrides. Adjust the path construction boundary used by Stocks catalyst caching so Turbopack treats runtime paths as runtime-only instead of statically tracing arbitrary filesystem locations.

The implementation must not hard-code the VPS path. It must continue to support:

- The default `.signal-hub` runtime directory.
- `SIGNAL_HUB_RUNTIME_DIR`.
- Existing Stocks catalyst and Patreon cache path overrides.

A focused source contract test protects the runtime-only path annotation or helper boundary. The production build is the authoritative regression test: the NFT whole-project tracing warning must disappear.

### Low-Risk Lint Cleanup

- Remove `shanghaiLocalToUtcIso` if it has no callers.
- Remove `fmpApiKey` from the financial data module if it has no callers.
- Initialize the Telegram refresh timestamp without calling `Date.now()` during render; set the timestamp after mount or on the first refresh event.

### Release 2A Acceptance

- `pnpm audit --prod`: zero vulnerabilities.
- ESLint: zero errors and no unused-variable or render-purity warning from the three targeted locations.
- `next build`: succeeds without the whole-project NFT tracing warning.
- All tests pass.
- VPS resolves `postcss@8.5.16` and `ip-address@10.2.0`.

## Release 2B: React State And Effect Cleanup

### Stocks Polling State

Move cache reads into lazy state initialization where the cache key is stable. For sector-dependent performance data, model the cache key together with the snapshot so a stale snapshot cannot be displayed for the newly selected sector.

Polling effects remain responsible for subscriptions and timers. State changes happen in asynchronous fetch completion paths rather than synchronously at effect entry. Existing intervals remain unchanged:

- Market data: 5 minutes.
- Relative performance: 5 minutes.
- Financial data: 30 minutes.
- Catalysts: 2 minutes.

### AI Summary Scope State

Keep the AI summary header and scope tabs stable in `AlphaSummaryCard`. The
parent owns scope-indexed records for the selected snapshot, busy state, manual
message, in-flight request set, poll lifecycle, and abort controllers. The
presentational `AlphaSummaryScopeResult` receives the current scope and matching
record values without a React `key`, so scope changes do not remount the tabs or
the result shell. Cached polling and manual regeneration behavior remain
unchanged, and old or aborted responses cannot update the wrong scope.

### Holding And Health Loaders

Refactor Binance, tracked-account, Tiger, and system-health initial loaders so effects establish the request lifecycle but do not synchronously trigger loading-state cascades. Abort handling, refresh buttons, polling, and error fallback behavior remain intact.

### Signal Flow Client State

Use explicit state boundaries instead of repair effects:

- Portal target: expose a hydration-safe client DOM subscription.
- Author favorites: expose a small local-storage-backed external store with a subscribe/get-snapshot interface.
- Author filter: derive an effective valid filter when the selected source is no longer present, instead of repairing it in an effect.
- Seen items: update seen watermarks through feed/tab events while preserving the current meaning of unread counts.

The implementation must not move the reading viewport when new items arrive. The existing `latest`, `last read`, and `bottom` navigation actions remain unchanged.

### Navigation State

Remove the AppShell effect that mirrors `activeNav` into optimistic state. Represent optimistic navigation as a pending target and derive the displayed active navigation from the current route plus that pending target.

### Release 2B Acceptance

- ESLint: zero errors and zero warnings.
- All 125 or more discovered test files pass.
- Production build succeeds.
- Signal Flow tests cover new-item counts, author filtering/favorites, and reading-position stability.
- Stocks tests cover initial cached display, sector changes, and polling refreshes.
- AI summary tests cover stable parent-owned tabs/header, unkeyed
  presentational scope result rendering, scope-record isolation, no synchronous
  reset effect, GET polling, manual POST regeneration, and abort cleanup.
- Holding and health tests cover initial load, refresh, abort, and failure states.
- Manual VPS smoke tests confirm Signal Flow, Stocks, Holding, settings health, and AI summary scope switching.

## Error Handling

- Dependency override incompatibility fails the test/build gate and blocks deployment.
- Cache path failures continue to use the existing stale cache or mock fallback paths.
- Client storage access failures return an empty favorites set without breaking Signal Flow.
- Fetch failures keep the last usable snapshot and expose the existing error labels.
- Aborted requests do not overwrite newer state.

## Testing And Deployment

For each release:

1. Add failing regression tests before implementation.
2. Run focused tests until green.
3. Run `node scripts/run-tests.mjs`.
4. Run ESLint with zero errors; Release 2B additionally requires zero warnings.
5. Run `pnpm audit --prod`.
6. Run the Next.js production build and inspect warnings.
7. Commit and push `main`.
8. Run `scripts/deploy-vps.sh` on the VPS.
9. Verify the deployed commit, dependency versions, service states, and HTTPS login response.

## Deferred Work

- Converting the entire project to ESM to remove Node's module-type warnings.
- Replacing experimental Node SQLite APIs.
- Larger UI redesigns or feature changes.
- New data providers or paid services.
