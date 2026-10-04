# 985 Primary and Owned X Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Preserve the 42 established985 accounts and enable a VPS owned-reader trial for the seven approved gap accounts.

**Architecture:** A bounded Python bridge reads author timelines with one private session. A Node worker validates its JSONL protocol, writes through the shared feed store, persists account checkpoints and exposes independent coverage health. Existing985 and translation paths remain active, with safe merge and conditional translation writes.

**Tech Stack:** Next16.2.12, Node>=22.5, node:sqlite, Python3.12, isolated twscrape0.20.1, Linux systemd.

**Spec:** `docs/superpowers/specs/2026-10-04-985-owned-reader-routing-design.md`.

## Global Constraints

- Fixed owned allowlist: Hzzzz666, PhotonCap, woody168888, fi56622380, chaoxiangooo, 1kbxx, fffffiyes_yu; intersect with the site's configured accounts, case-insensitively.
- Default disabled; enabled VPS trial uses one session, 5-minute start-to-start scheduling, no overlapping runs.
- 80 actual HTTP requests, 180-second cycle deadline, at least2seconds between request starts, at most5timeline pages/account.
- Fixed48-hour bootstrap origin; subsequent15-minute overlap from coveredThroughAt; incomplete scans never advance coverage.
- No session credentials in Git, logs, process arguments or public endpoints. Pause globally on429/challenge/authfailure and retain cooldown.
- Preserve existing6551 behavior, original post IDs, valid translation, full body and quote data. Owned status never updates the985 collector scope.
- User requested push and deployment after reviewing the concrete design; complete implementation and validation before publishing without another authorization prompt.

## Review Focus

- A removed watched account cannot be queried or globally disable accounts assigned to another source: worker/state and manual catchup tests.
- More than20posts, pinned old posts or conversation parents cannot silently advance a checkpoint: bridge parser/pagination tests.
- A late partial985 event cannot shorten an owned full post or erase translated quotes: store merge tests.
- A translation generated before an edit cannot overwrite the edited body/quote: conditional write tests.
- A running unrelated worker cannot hide stale owned checks, and a paused bridge cannot silently resume or issue extra requests: health/protocol/HTTP guard tests.

## Files and ownership

Python task owns `scripts/x-owned-reader-bridge.py`, `scripts/x-owned-reader-bridge-core.py`, `scripts/x-owned-reader-bridge.test.py` and safe SDK requirements/documentation. Node task owns new `src/lib/x-owned-reader-*.ts`, their `.test.mjs`, `scripts/x-owned-reader-worker.mjs`, its tests and `/api/x/coverage/route.ts`. Store task owns `src/lib/x-pipeline-store.ts`, store tests, `src/lib/x-feed-merge.ts`, translation backfill/tests and optional feed type additions. Root owns985catchup/account-union, source display/cache classification, health/service/deploy wiring, plan/ledger and integration.

## Task1: guarded Python protocol and timeline parsing

**Interface:** stdin task `{version:1,runId,sessionDbPath,cooldownFilePath,maxRequests,deadlineMs,minIntervalMs,maxPages,accounts:[{username,userId?,fromAt,throughAt}]}`. JSONL events always carry `{version:1,runId,type}`. `tweet` contains `account` and `feedItem` in existing TwitterFeedItem shape plus entry evidence and `contentComplete:true`. `account_complete` contains username,userId,complete,throughAt,checkedAt,pages,accepted,quarantined,reason. `paused` carries reason,nextRetryAt; `error` is sanitized. End with cycle_complete. Exit0 means protocol completion, not all accounts complete.

- [ ] Write unittest fixtures proving standalone focal/root selection, exclusion of nested quotes/parents/retweets, pin-safe boundary detection, valid empty/end and incomplete5page behavior. Add transport tests for budget, redirect origin/auth paths,401/403/429, malformed JSON and persisted cooldown.
- [ ] Run `python scripts/x-owned-reader-bridge.test.py`; observe failures for missing production helpers.
- [ ] Implement core pure parsing/boundary helpers and the SDK bridge; preserve minimal HTTP guards from the reviewed throwaway source while adding explicit pagination and stable account validation.
- [ ] Run Python tests on Linux isolated environment; verify stdin/stdout protocol without exposing session values. Keep live calls for the final controlled7account trial.

## Task2: Node routing/state/worker and coverage endpoint

**Interfaces:** `getXOwnedReaderConfig(env)`; `getXAccountCoverageSnapshot(usernames,db?,env?,nowMs?)`; `runXOwnedReaderCycle({accounts,config,db?,nowMs?,bridgeRunner?})`; persisted state includes bootstrapFromAt, pendingThroughAt, coveredThroughAt,lastAttemptAt,lastSuccessfulCheckAt,userId,status,reason,nextRetryAt. `runOwnedReaderBridge(task,config,onEvent)` validates bounded JSONL before callbacks. Use `getXPipelineDb()` and `upsertXPipelineRealtimeUpdate()`; checkpoint commit follows durable feed writes.

- [ ] Write Node tests for fixed7intersection, remaining985 routes, stable bootstrap/checkpoint on incomplete/restart, empty complete checks, invalid/foreign protocol messages, pause persistence and nonoverlapping start-to-start scheduling.
- [ ] Run relevant `.test.mjs` under Node type stripping, observe failures.
- [ ] Implement independent state tables, configuration, protocol decoder/spawn and cycle persistence. Add only-authenticated read-only `/api/x/coverage`, no credentials/paths in response. Worker uses independent owned-reader health and asynchronous bounded translation after raw commit.
- [ ] Run scoped tests and inspect persisted rows through an in-memory DB; do not create or mutate production DB during unit tests.

## Task3: source observations, safe field merge and translation compare-and-swap

**Interfaces:** existing feed API remains compatible. Add feed content provenance/completeness metadata only if needed; save `(tweet_id,source)` observations independently. Extend `setXPipelineFeedTranslation(id,translation,db,quotedTweet,expected?)` with expected original body and quote snapshot/hash; return whether conditional update succeeded.

- [ ] Write failing store tests for full owned→partial985 preservation, same-content translation retention, valid edits, quote/media retention, and source observation persistence. Write failing body/quote translation race tests.
- [ ] Run scoped tests; observe intended failures.
- [ ] Implement transactional merge and source observations, preserving original IDs and existing avatar safeguards. Add conditional translation writes and a DB translation lease for cross-process deduplication.
- [ ] Run store/backfill suites and existing quote/reply regression tests.

## Task4: existing flow integration, labels and health

- [ ] Add a failing catchup regression where the local49account union includes a reader-only author absent from985watch-config; verify it remains enabled and accepted events are restricted to the local union.
- [ ] Correct manual catchup and confirm985/hybrid sync use the same union. Add datasource enablement for owned-only operation.
- [ ] Add failing source/cache classification tests for owned full text and keep unified X tab semantics; implement `X · 自有采集` display without relabeling existing985/6551 data.
- [ ] Add failing health/service tests for an enabled but stale reader despite other X heartbeats; implement independent account-age status and optional service registration.
- [ ] Run all affected Node tests, then inspect integration diffs for file ownership collisions.

## Task5: release wiring and independent review

- [ ] Add deployment checks for optional enabled `signal-hub-x-owned-reader`, Python/SDK/session preflight and rollback disabling unsupported new service. Document safe VPS environment variables, trial status and restart behavior.
- [ ] Run complete project tests, all Python tests, lint and Next production build in the isolated branch; record all exit codes.
- [ ] Fresh reviewer checks whole change against spec, transport/parse/progress correctness and field merge; fix material findings with failing regression tests before retesting.
- [ ] Commit only this feature, then fetch latestmain and preserve subsequent unrelated commits when publishing via authenticated GitHub connector.

## Task6: VPS deployment and evidence

- [ ] Enable the agreed trial configuration in private VPS env using existing session/venv paths, without printing secrets or running the throwaway probe concurrently.
- [ ] Run the existing atomic deploy script; await tests/lint/build, service activation and authenticated readiness. Retain deployment lock/automatic rollback.
- [ ] Verify active release SHA equals publishedGitHub SHA; web/985/owned services active; coverage42+7; bridge7account results; inserted feed items/source/quote/translation state and separate health.
- [ ] Report first-cycle actual results and any incomplete/paused author honestly.24-hour stability remains an observation outcome and is not claimed from the first cycle.
