# Signal Hub Reliability Implementation Plan

**Goal:** Apply the approved audit findings, verify locally and on the VPS, then publish the changes.

**Architecture:** Preserve the existing SQLite stores and worker boundaries. Add incremental snapshot queries and bounded AI recovery. Build versioned releases beside the active application and switch only after validation.

**Tech Stack:** Next.js 16, React 19, Node.js SQLite, pnpm, systemd.

**Spec:** Approved Signal Hub audit in this task, September 5, 2026.

## Delivery Checklist

- [x] Check each of the four current AI summary scopes; use configured stock refresh intervals for freshness.
- [x] Retry malformed AI summary output once; preserve provider fallback and error reporting.
- [x] Send feed changes by update timestamp; reconcile full snapshots every five minutes; close streams on shutdown.
- [x] Cache remote 985 watch configuration for one hour, retaining local configuration checks each tick.
- [x] Serve compact Hynix snapshots, default to 5m, and reconcile history every 15 minutes while WebSocket prices remain live.
- [x] Upgrade vulnerable runtime dependencies and verify the production audit.
- [x] Build isolated VPS releases with shared runtime data, atomic activation and rollback on failed startup.
- [x] Add and run authenticated browser smoke coverage, regression tests, lint, typecheck and build.
- [x] Commit, push, deploy and verify service/API behavior on the VPS.

## Validation Cases

Summary health must report an errored 12h scope even when today was generated later, identify missing current scopes, and accept a 10-hour-old financial cache on a 12-hour schedule. AI generation must recover from one malformed response, stop after a second malformed response, and avoid retrying HTTP failures as JSON errors.

Incremental feed queries must include a newly edited old message and exclude unchanged messages. SSE must send an initial snapshot, advance its timestamp after sending changes, and release timers on client disconnect and process shutdown.

Hynix compact transport must round-trip all candle fields and reuse the same cache as full responses. Remote watch configuration must reuse successful data between refreshes and after a failed refresh.

Deployment must complete install, tests, lint and build before changing the active release. Runtime databases and environment files stay in the stable application directory. Failed startup must restore the previous release and restart services there.

## Verification Record

- Local and VPS regression suite: 211 files passed. Browser smoke suite: 6 checks passed.
- Production dependency audit: zero known vulnerabilities; Next.js 16.2.12.
- VPS isolated deployment exercise: successful activation, build failure isolation and startup rollback passed.
- Initial production release a292c1d: all 13 services active; public login and authenticated feed returned HTTP 200.
- Hynix 5m snapshot: 1,440 points, 774,433 bytes full versus 256,937 bytes compact (66.8% smaller).
- Idle X and Telegram SSE frames: 62-byte heartbeats. Isolated server with three open streams exited normally in 6,012 ms, without SIGKILL.
- Summary freshness uses each scope's generation interval plus the worker interval, preserving daily 7d and four-hour 3d cache schedules.
- Remaining provider issue observed: financial cache contains upstream errors; health reports these separately from cache freshness.
