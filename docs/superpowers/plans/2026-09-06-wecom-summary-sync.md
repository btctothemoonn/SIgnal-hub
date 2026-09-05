# WeCom Summary Sync Implementation Plan

**Goal:** Display the Mac's existing WeCom summaries in Signal Hub without running collection or AI generation on the VPS.

**Current Scope (updated September 6):** The user redirected implementation to a documentation-first handoff. Publish only this plan and the [cross-repository contract](../../integrations/wecom-summary/README.md) to Signal Git. The user's Mac Codex will review its actual running code and coordinate implementation. Do not deploy incomplete drafts or activate real synchronization yet.

**Approved Design:** Result-only synchronization approved in this conversation on September 6, 2026. Keep 2h/6h/24h reports separate from market briefs and X/TG.

**Architecture:** The Mac reads completed reports, projects bounded summaries and existing CA aggregates, and saves a durable delivery queue before HTTPS upload. Raw citations are disabled by default and require separate approval. A separate loopback receiver authenticates and persists reports in its own SQLite database. Next.js only forwards bounded authenticated ingest requests and reads local cached reports. No browser request depends on Mac availability.

**Stack:** Existing Python 3.7 stdlib Mac collector, Node SQLite receiver, Next.js/React page, systemd deployment. No new package dependencies.

## Contract

- Endpoint: POST /api/wecom/ingest; one report or heartbeat per request, <=262144 bytes.
- Headers: X-Wecom-Device, X-Wecom-Timestamp (Unix seconds), X-Wecom-Nonce (32 lowercase hex), X-Wecom-Signature (64 lowercase hex).
- Signature: HMAC-SHA256 with the UTF-8 secret over `POST\n/api/wecom/ingest\n{device}\n{timestamp}\n{nonce}\n{sha256(rawBody)}`.
- Timestamp tolerance: 300 seconds; receiver persists nonces to reject replay. Retries create a new nonce, reports remain idempotent by id/revision.
- Body: `{schemaVersion:1,type:"report",report:WecomReport}` or `{schemaVersion:1,type:"heartbeat",status:{listener,worker,pendingReports,lastError}}`.
- Contract authority for this handoff: `docs/integrations/wecom-summary/README.md` and its synthetic JSON examples. Local uncommitted TypeScript drafts are not a published interface.
- Acknowledgment: `{ok:true,id,revision,disposition:"stored"|"duplicate"|"stale"}`. Only a matching acknowledgment advances Mac delivery progress.
- Mac configuration: private JSON outside Git; target HTTPS URL, device ID, secret. Never reuse the website login or MiniMax credentials.
- Server configuration: WECOM_SYNC_DEVICE_ID, WECOM_SYNC_SECRET; optional WECOM_RECEIVER_PORT (default 3041).
- Retain original message databases and relay attribution boundary. Export through read-only connections; never reschedule paid AI jobs.
- Default to summary-only payloads: no raw sources, member identities, group names or automatic history backfill. Establish an activation watermark after two-party review; historical summary bootstrap requires an explicit scope choice.

## Documentation Phase

- [x] Confirm renamed Mac repository `btctothemoonn/wecom-summary` and document the inspected branch/commit without assuming it is still the running revision.
- [x] Write endpoint, authentication, payload, privacy scope, frequency, duplicate/retry behavior, resource boundaries and joint acceptance checklist.
- [x] Validate synthetic report/heartbeat against the draft validator, confirm summary-only privacy defaults and relative documentation links, and verify the same HMAC test vector independently in Node and Python.
- [ ] Publish only these documents and synthetic examples to Signal Git; leave all application drafts and credentials out of the commit.
- [ ] Receive Mac Codex review and resolve differences before resuming implementation.

## Delivery Checklist

- [ ] Add bounded report validation, authenticated isolated receiver and read-only store APIs. Test signatures, replay, stale/duplicate writes, invalid/oversized payloads and unavailable database.
- [ ] Add Mac read-only incremental exporter, durable outbox, retry/backoff, heartbeat and optional startup installation. Test >30 reports, restart, missing acknowledgments, source bounds and no AI calls.
- [ ] Add independent group-summary navigation/page with cadence tabs, paginated history, on-demand citations, last-good cache and visible sync state. Test races and failure states.
- [ ] Integrate receiver resource limits, deployment readiness and rollback; document private configuration and first synchronization.
- [ ] Run regression/build/browser desktop-mobile checks and source-to-receiver contract integration. Verify receiver outage leaves existing pages available.
- [ ] After joint review and tests, push source changes and deploy VPS. Mac activation is performed by the user's Mac Codex only after endpoint readiness and private configuration. Clearly distinguish deployed UI from actual Mac synchronization.

## Verification Targets

- No sensitive raw chat dumps, AI credentials or sync secrets in logs, Git or browser assets.
- No iframe or public Mac HTTP exposure; private GET endpoints keep existing login protection.
- List loads at most 10 compact report records; details and limited citations load on demand.
- Receiver process has bounded body size, request timeout, connection count, disk budget and memory allocation.
- Mac outage retains the latest good report and shows last sync time. Delivery retries do not repeat AI work.
- Authentication/network/invalid-input failure does not acknowledge unsaved work.
