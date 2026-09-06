# WeCom Summary Sync Implementation Plan

**Goal:** Display the Mac's existing WeCom summaries in Signal Hub without running collection or AI generation on the VPS.

**Current Scope (updated September 6):** The user redirected implementation to a documentation-first handoff. Publish only this plan and the [cross-repository contract](../../integrations/wecom-summary/README.md) to Signal Git. The user's Mac Codex will review its actual running code and coordinate implementation. Do not deploy incomplete drafts or activate real synchronization yet.

**Approved Design:** Result-only synchronization approved in this conversation on September 6, 2026. Keep 2h/6h/24h reports separate from market briefs and X/TG.

**Architecture (v2):** The Mac exports complete structured briefings with authorized group names, nicknames and referenced metadata, never raw chat. A separate real-time CA detector uses its own cursor and episode state. Both channels share a durable outbox and authenticated HTTPS sender. Signal uses an isolated receiver and SQLite plus owner-authorized reads; browser requests never depend on Mac availability. Align with Mac design commit `dc259a93ab41a8b00f64a638a5a3ab0c762ffb95`; this remains documentation-only.

**Stack:** Existing Python 3.7 stdlib Mac collector, Node SQLite receiver, Next.js/React page, systemd deployment. No new package dependencies.

## Contract

- Endpoint: POST /api/wecom/ingest; one v2 report, ca_alert or heartbeat per request, <=262144 bytes.
- Headers: X-Wecom-Device, X-Wecom-Timestamp (Unix seconds), X-Wecom-Nonce (32 lowercase hex), X-Wecom-Signature (64 lowercase hex).
- Signature: HMAC-SHA256 with the UTF-8 secret over `POST\n/api/wecom/ingest\n{device}\n{timestamp}\n{nonce}\n{sha256(rawBody)}`.
- Timestamp tolerance: 300 seconds; receiver persists nonces to reject replay. Retries create a new nonce, reports remain idempotent by id/revision.
- Body: schemaVersion=2; report includes briefing/scope/sourceReferences/caCoverage, ca_alert has independent episode semantics, heartbeat has eight fields. Full strict definitions are in the cross-repository contract.
- Contract authority for this handoff: `docs/integrations/wecom-summary/README.md` and its synthetic JSON examples. Local uncommitted TypeScript drafts are not a published interface.
- Acknowledgment: `{ok:true,id,revision,disposition:"stored"|"duplicate"|"stale"}`. Only a matching acknowledgment advances Mac delivery progress.
- Mac configuration: private JSON outside Git; target HTTPS URL, device ID, secret. Never reuse the website login or MiniMax credentials.
- Server configuration: WECOM_SYNC_DEVICE_ID, WECOM_SYNC_SECRET; optional WECOM_RECEIVER_PORT (default 3041).
- Retain original message databases and relay attribution boundary. Export through read-only connections; never reschedule paid AI jobs.
- Preserve authorized group names, nicknames and source metadata; sources must remain empty. No automatic history backfill. Initialize separate report/message watermarks only with explicit activation. All reads require login and data ownership authorization.

## Documentation Phase

- [x] Confirm renamed Mac repository `btctothemoonn/wecom-summary` and document the inspected branch/commit without assuming it is still the running revision.
- [x] Write endpoint, authentication, payload, privacy scope, frequency, duplicate/retry behavior, resource boundaries and joint acceptance checklist.
- [x] Publish the initial v1 document-only handoff as `55dfa50`; leave application drafts and credentials out.
- [x] Read Mac dc259a9 design and plan, inspect briefing and network/auth source boundaries, and document v2 compatibility and implementation gaps.
- [x] Update the v2 contract and synthetic market/business, CA lifecycle and heartbeat examples; preserve names without raw chat.
- [x] Validate six v2 fixtures and 26 invalid variants, citation closure, Mac dc259a9 briefing compatibility, Unicode boundaries and all three cross-language signature vectors. These are offline documentation checks, not receiver/UI integration tests.
- [ ] Coordinate subsequent offline implementation separately; no deployment or real-data activation in this phase.

## Delivery Checklist

- [ ] Add bounded report validation, authenticated isolated receiver and read-only store APIs. Test signatures, replay, stale/duplicate writes, invalid/oversized payloads and unavailable database.
- [ ] Add Mac read-only incremental exporter, durable outbox, retry/backoff, heartbeat and optional startup installation. Test >30 reports, restart, missing acknowledgments, source bounds and no AI calls.
- [ ] Add owner-authorized complete briefing views, on-demand source metadata, CA history/active reads and independent device status. Test 15-second visible CA refresh, cooldown/catchup, first receipt and auth-expiry cache clearing.
- [ ] Integrate receiver resource limits, deployment readiness and rollback; document private configuration and first synchronization.
- [ ] Run regression/build/browser desktop-mobile checks and source-to-receiver contract integration. Verify receiver outage leaves existing pages available.
- [ ] After joint review and tests, push source changes and deploy VPS. Mac activation is performed by the user's Mac Codex only after endpoint readiness and private configuration. Clearly distinguish deployed UI from actual Mac synchronization.

## Verification Targets

- No sensitive raw chat dumps, AI credentials or sync secrets in logs, Git or browser assets.
- No iframe or public Mac HTTP exposure; private GET endpoints keep existing login protection.
- List loads at most 10 compact reports; full structured details and metadata load on demand. CA active lists cap at 50 with total/truncated indicators.
- Receiver process has bounded body size, request timeout, connection count, disk budget and memory allocation.
- Mac outage retains the latest good report and shows last sync time. Delivery retries do not repeat AI work.
- Authentication/network/invalid-input failure does not acknowledge unsaved work.
