# Signal Hub Production Hardening Batch 1 Design

## Goal

Remove the highest-risk security, AI-cost, and Telegram correctness problems without removing features or changing the visible product workflow.

## Scope

This batch contains four changes:

1. Upgrade Next.js and `eslint-config-next` from 16.2.1 to a patched 16.2.x release at or above 16.2.6.
2. Add bounded login-failure throttling to the public admin login endpoint.
3. Stop browser tabs from automatically forcing AI summary regeneration while preserving background generation, cached polling, and the manual regenerate command.
4. Exclude Telegram channels used only as X ingestion sources before applying the Signal Flow feed limit.

The batch does not change Signal Flow layout, Stocks/Holding behavior, worker schedules, AI providers, authentication cookie duration, or the configured watch lists.

## Security Upgrade

`next` and `eslint-config-next` will be upgraded together to the same patched version. React stays on the current version unless the package resolver requires a compatible patch. The lockfile must be regenerated with pnpm, followed by dependency audit, lint, tests, and production build.

The login endpoint will use an in-process failure limiter keyed by the client IP resolved from the trusted reverse-proxy headers. The policy is five failed attempts in fifteen minutes, followed by a fifteen-minute lock. Successful login clears the key. Responses continue redirecting to the existing login page and do not reveal whether a password was close or whether an IP is locked. The limiter is intentionally process-local: Signal Hub runs one web process, and a restart safely clears temporary failures.

## AI Summary Scheduling

The browser keeps polling cached summaries but no longer starts a timer that sends `POST` requests with `force: true`. The existing manual regenerate button remains the only browser action that forces generation.

The alpha-summary worker remains the owner of scheduled generation. A server-side single-flight guard will coalesce simultaneous generation requests for the same audience and scope inside each process. This protects repeated clicks and overlapping web requests. The removal of browser auto-force calls eliminates the main cross-process duplication with the worker.

The UI continues to show the latest cached summary if generation fails.

## Telegram Feed Correctness

`getTelegramPipelineSnapshot` will identify enabled channels configured as X ingestion sources and exclude their channel IDs in the SQL query before `ORDER BY ... LIMIT`. The existing JavaScript filter remains as defense in depth for unmatched legacy rows.

This guarantees that a burst from a hidden X-source channel cannot consume the row budget intended for visible Telegram messages. The public snapshot shape and channel filtering behavior remain unchanged.

## Error Handling

- Dependency upgrade failures stop the batch before deployment.
- Login throttling never throws on malformed proxy headers; it falls back to a stable unknown-client key.
- AI single-flight entries are removed in `finally`, including provider failures.
- Telegram exclusion with no hidden channel IDs uses the existing simple query and does not emit an empty `NOT IN` clause.

## Testing

- Add unit tests for login throttling: threshold, lock duration, successful reset, and independent IP keys.
- Update login route tests to verify throttled invalid attempts remain rejected.
- Add an AI summary scheduling contract test proving there is no automatic forced-generation timer while cached polling and manual POST remain.
- Add a single-flight test proving concurrent requests for one audience/scope share one generation promise.
- Keep and fix the Telegram regression test where more than the overfetch window consists of hidden X-source messages.
- Refresh the two stale UI source-contract assertions discovered during the audit.
- Run all `*.test.mjs` files, ESLint, dependency audit, and `next build`.

## Deployment

Commit the batch as focused changes. Push to GitHub and deploy using the existing VPS script only after all verification passes. Confirm the website login, Signal Flow TG feed, cached AI summary, and manual regenerate action after restart.
