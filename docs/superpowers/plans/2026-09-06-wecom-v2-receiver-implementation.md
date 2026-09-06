# WeCom v2 Website Receiver Implementation

Scope: implement on `codex/wecom-v2-receiver`, based on Signal `8f6df4f` and Mac handoff `bcb544a746dac7f2b7c55476eb5ec66672d1113f` / implementation `d9ddae971bf98d4340e4a67da3cda25513dcae99`. No production deployment, credentials, real messages, source database access or Mac service changes.

## Decisions

- Use the current checkout on a feature branch; preserve the user's untracked monitor-codex-handoff directory. No shared-main merge or deployment.
- Keep published 8f6df4f fixtures as historical evidence. Adopt the Mac 2/0 corrected market fixture and its exact signed bytes; CA/heartbeat vectors unchanged.
- Fail closed for personal data: existing single-admin session AND explicit `WECOM_OWNER_ADMIN_ONLY=true` AND a configured device are required for reads. No implicit multi-user authorization. Real enablement remains a separate user decision.
- `WECOM_SYNC_ENABLED=true` plus valid dedicated credentials are required for ingest. Default disabled. Tests use temporary environments and public synthetic keys only.
- Independent loopback receiver and SQLite. Main app only bounded authenticated forwarding/read access; no AI or remote market calls in this feature.
- Parent implements strict contract, signing, auth, receiver and APIs. Separate workers can implement storage and UI in disjoint files after shared types are available. Review the integrated branch before completion.

## Progress

- [x] Read the latest handoff, foundation, candidate fixture notes and actual Mac contract code.
- [x] Baseline: all 212 existing test files passed (Linux-only deployment integration skipped on Windows).
- [x] Correct and freeze synthetic fixtures; add strict v2 parsing, HMAC and auth tests first.
- [x] Implement independent atomic store, typed idempotency, nonce persistence, pagination, first receipt and device isolation; test temp databases and failures.
- [x] Implement bounded receiver, machine-only exact POST forwarding, private read APIs and direct server authorization tests.
- [x] Implement full /wecom view, metadata, CA history/active and device state, polling/notification/auth-expiry behavior; desktop/mobile tests.
- [x] Cross-language Mac exporter/signing to real isolated Node receiver to authorized browser synthetic test; no production URL requests.
- [x] Full regression, type/lint/build/browser checks, security review and documentation receipt.

Publication target is only `origin/codex/wecom-v2-receiver`; return the actual commit hash after pushing. Do not merge or deploy. Native Mac POSIX outbox and VPS resource acceptance remain explicitly outside this Windows synthetic run.

## Verification Gates

All new behavior starts with failing tests. Test unsupported version/fields/raw chat, duplicate JSON keys, Unicode and body bounds, broken references/counts, signature tamper/expiry/replay, readonly owner/device isolation, no false ack on failure, same bytes duplicate, stale updates, CA closure/no resurrection, stable first receipt, pagination and active limits. Test hidden polling, initial historical silence, catchup/delay suppression, logout cache clearing and preserved last-good data only for transient errors.

Receipt must distinguish code completed, synthetic tested, production disabled. Report actual commands/results and remaining limits; do not claim 60-second capture-to-display performance from HTTP-only tests.
