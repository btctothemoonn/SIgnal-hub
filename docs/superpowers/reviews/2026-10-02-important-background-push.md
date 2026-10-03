# Important background push — local acceptance

Branch: `feat/important-background-push`. Base: `6ce12af`.
Fresh whole-branch independent review at `0289679`: five Important findings, no Critical or Minor findings. Root verified all five and fixed them in one TDD pass, without a second reviewer.

## Findings and verification

- Historical opportunity inputs: old seed remains visible with its original score but cannot become a fresh push. Actual input timestamps and candle windows survive cache/storage and send-time revalidation. `market-push-freshness.test.mjs`: RED→GREEN.
- Raw squeeze candles: old, missing, future or gapped intervals cannot qualify; a live interval is accepted without using its planned close as an observation timestamp. Raw-only regression: RED→GREEN; persisted send-time regression: GREEN.
- Send deadline: continuously active response reproduced the missing hard abort. Default transport now retains web-push AES/VAPID generation and destroys HTTPS requests at the total deadline, expiry or shutdown. DNS/connect and no-request-after-abort checks also pass. `web-push-deadline.test.mjs`: RED→GREEN.
- News navigation: crypto/macro target cards were absent; notification IDs now resolve an immutable dated edition, initialize the correct category, then scroll after rendering. Ordinary opens retain the original AI default. Component and storage regressions: RED→GREEN; real Chrome navigation: GREEN.
- Rollback enablement: actual rollback body executed under Bash with local systemctl doubles reproduced an enabled missing-script worker. Rollback now disables and stops unavailable workers before activation/restart. `deploy-vps-rollback-state.test.mjs`: RED→GREEN. Full Linux fixture now checks persisted enablement, but its Linux execution remains pending.

## Final checks

- `node scripts/run-tests.mjs`: all **252 test files passed**, isolated runtime and fake external providers. The Linux-only fixture skips on Windows; that skip does not count as Linux acceptance.
- `pnpm lint`: exit 0, no warnings/errors. `pnpm exec tsc --noEmit`: exit 0.
- `pnpm build`: final isolated production build exit 0.
- `pnpm exec playwright test e2e/important-push.spec.ts`: **2 passed (5.3s)** using installed Chrome and temporary test credentials/databases.
- Chrome verifies enrollment/control/logout with a fake PushManager/provider, plus real Service Worker simulated CDP delivery after all website pages close. It also verifies crypto/macro archived news targeting through the actual Next page.
- `sh -n scripts/deploy-vps.sh` and `git diff --check`: exit 0.
- Desktop/mobile layout and keyboard checks were completed before the final review. React hooks, typed props, category initialization and post-render scrolling checked against the React best-practices skill.

No production deployment or secrets were created/read during feature implementation. Real FCM/APNs enrollment, Windows/iPhone actual display and full Linux rollback execution remain pending. Primary checkout changes were left untouched during feature implementation. The user subsequently chose local main integration; see the dated integration record below.

## Local main integration — 2026-10-03

The user selected merging into local `main`. The feature fast-forwarded from `6ce12af` to `22e9e0b`. All 13 pre-existing modified/untracked files retained identical SHA-256 hashes across the merge. Dependencies were installed from the frozen lockfile with `pnpm install --frozen-lockfile --offline`.

- Merged primary workspace: all **254 test files passed**, including its two pre-existing untracked tests, with isolated runtime databases.
- `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`, and `git diff --check`: exit 0.
- `pnpm exec playwright test e2e/important-push.spec.ts`: **2 passed (6.6s)** on installed Chrome, with temporary authentication/databases, disabled live push and AI generation, and an explicit local origin. Provider delivery remains simulated.
- `git pull --ff-only` could not contact GitHub because the connection was reset. This local integration did not verify or reconcile the current remote head. No GitHub push or VPS deployment was performed.

Windows/iPhone real provider delivery and the complete Linux rollback fixture remain pending; the prior feature acceptance limitations still apply.

## Rulings I made

- Setup Ruling: Native worktree tool cannot resolve the chat's parent directory as a Git repository; use an ignored project-local git worktree — preserves the approved isolation — cleanup requires manual git worktree remove.
- Setup Ruling: Bash runtime is unavailable; reproduce task-start/task-done workspace, brief, BASE, test-log and completion bookkeeping with PowerShell — same durable records and pass gate — cost if wrong: bookkeeping must be audited against git commits.
- Task 1: Ruling: transitionPushEpisode returns state:null before any qualified observation — only confirmed events establish an episode — cost if wrong: consumers must handle null explicitly.
- Task 2: Ruling: Persist producer initialization and suppress the first complete batch, retaining episode highest stage — approved first-evaluation baseline must not replay existing confirmations — cost if wrong: cold-start events wait for a real new stage or episode.
- Task 2: Ruling: Add recovery_observation with coarse funding/OI evidence and three distinct OI source samples, independent of Telegram guards — approved valid recovery and existing three-scan semantics; missing detail must not block verified recovery — cost if wrong: raw episode reset can be delayed while samples stay unchanged.
- Task 2: Ruling: Add optional timed positioning client path, using the same three existing requests; use earliest actual premium/OI/position timestamp and actual completion clock, retain candle open/close metadata without treating planned close as observation — no invented freshness — cost if wrong: 5-minute provider samples older than 2 minutes suppress raw pushes.
- Task 3: Ruling: Only final consolidated current items are eligible; attach server pushAssessedAt and preserve older item provenance, reject old title rebound to unrelated current candidate — approved brief scope and no cross-batch indexes — cost if wrong: a discarded or ambiguous item remains visible in source feeds without push.
- Task 3: Ruling: Search discovery, date-only or timezone-unspecified timestamps do not count as publication; push checks actual publisher URL against existing allowed domains plus existing BlockBeats domains — source labels are insufficient — cost if wrong: trusted content lacking exact publication metadata is conservatively skipped.
- Task 4: Ruling: claim example changed from eight simultaneous leases to three while retaining all sixteen queued deliveries — spec requires three market concurrency slots, not a notification quota — cost if wrong: remaining events wait for the next cycle.
- Task 4: Ruling: Add typed validated subscription and internal epoch-checked invalidateSubscription/readDeliveryCounts — internal sender must revoke gone endpoints without recovering device secrets and health needs safe counters — cost if wrong: internal store surface is slightly larger.
- Task 6: Ruling: Add proof-gated internal subscription lookup for direct test sending; logout ignores absent or unregistered device proof but blocks cross-origin valid-session POST — incomplete enrollment must not trap sign-out, invalid proof cannot affect another device — cost if wrong: an unregistered local credential cannot revoke a subscription.
- Task 7: Ruling: agent-browser CLI is absent; use installed Playwright with actual Chrome for local desktop/mobile screenshots and keyboard focus — fulfills browser inspection without provisioning tools — cost if wrong: agent-browser-specific checks are not run.
- Task 7: Ruling: Populate native logout hidden proof synchronously on submit from current storage — reads latest enrollment even after settings changes without async delaying native POST — cost if wrong: disabled JavaScript signs out without device revocation.
- Task 8: Ruling: Use enabled service filtering for optional push and old-release script existence for all rollback workers — disabled services must not fail readiness and unavailable old scripts must not restart — cost if wrong: an older worker absent from the release stays stopped.
- Task 8: Ruling: Keep authentication error until a successful worker delivery — idle cycles cannot prove recovered credentials — cost if wrong: health remains error after a configuration fix until the next eligible delivery.
- Task 8: Ruling: Linux execution unavailable; run bundled MSYS sh (discovered to be GNU Bash) syntax validation and Windows tests, preserve Linux fixture as pending while continuing independent local acceptance — no provisioning/deployment authorized or needed for code — cost if wrong: actual Linux rollback remains unverified.
- Task 9: Ruling: Set explicit Turbopack root to current project directory — Next inferred the parent checkout because nested worktrees have multiple lockfiles — cost if wrong: launching Next from another directory needs that project as cwd.
- Task 9: Ruling: Canonical configured origin remains authoritative; fallback uses actual Host with request protocol and never forwarded-host. No-device logout preserves existing behavior — real Next local hostname normalization caused false same-origin rejection — cost if wrong: a proxy without explicit public origin must preserve Host for device-aware logout.
- Final: Ruling: Real FCM/APNs enrollment, OS display and production connectivity remain device acceptance work — local Chrome verifies actual Service Worker display with simulated delivery, not real provider enrollment — cost if wrong: production/device setup may reveal an interoperability problem.
- Final: Ruling: Actual Linux rollback fixture remains pending — this host has no Linux execution environment; strengthen fixtures and syntax checks locally without claiming Linux execution — cost if wrong: a Linux-only deployment defect remains possible.
- Final: Ruling: Semantic news deduplication and factual truth remain conservative, source-backed assessment limits — URL/title aliases and verified publication provenance gate delivery, but cannot prove every real-world identity or AI assertion — cost if wrong: a duplicate or mistaken exceptional assessment can pass.
- Final: Ruling: An already accepted in-flight provider request cannot be retracted — epoch checks block later delivery attempts while hard abort bounds unaccepted requests — cost if wrong: a notification accepted just before disable/logout may still arrive.
- Final: Ruling: Production throughput and indefinite retention require later workload evidence — retain all important messages with bounded concurrent delivery and persistent deduplication, without introducing a user quota or unapproved retention rule — cost if wrong: a large workload may require tuning or database maintenance.
- Final: Ruling: First empty producer scan initializes the durable baseline — later first observed confirmations count as new because no historical episode was observed; provenance does not establish a replay defect — cost if wrong: an earlier unobserved condition can notify on the next scan.
- Final: Ruling: Installed web-push sendNotification is bound by its module export — no unbound-method defect to fix; replace its socket-only timeout transport for the confirmed deadline finding — cost if wrong: a future dependency binding change needs renewed validation.
- Final: Ruling: Primary checkout changes, real credentials and secret files remain outside this feature — keep the isolated branch and do not inspect or modify unrelated work or production secrets — cost if wrong: integration must reconcile intervening primary changes later.
- Final: Ruling: Preserve per-input push provenance and contiguous candle intervals without changing display scoring — reuse timed positioning requests and reject missing/old evidence at qualification and send time — cost if wrong: some legacy or partially timestamped signals are skipped; mixed reused inputs can need up to two extra existing ratio requests within the current rate limiter.
- Final: Ruling: Store one immutable brief edition per generation that creates push events — notification IDs resolve their original dated content after latest/history replacement, then select the category before scrolling — cost if wrong: brief-edition storage grows with important-news generations.
- Final: Ruling: Add a portable Bash check of the actual rollback function using local systemctl doubles — proves enabled state is cleared on Windows/MSYS while retaining the full Linux fixture as pending — cost if wrong: Linux-specific shell/systemd integration can still differ.

## Deferred minors

None. All Important findings were fixed; external acceptance items are explicitly pending.

## Release integration — 2026-10-03

The user authorized GitHub push and VPS deployment. GitHub and the active VPS release were both `6b83f67` before this release. An isolated release worktree merges those subsequent updates with local `c34221e`, retaining the primary workspace's uncommitted work.

The enrichment conflict preserves the existing current-data fix: current funding, OI, positioning and candles are collected rather than replaced by historical seed values. Push provenance follows those actual inputs; OI evidence uses the same sorted, non-future sample as scoring. The new unsorted/future OI regression failed at the expected timestamp assertion, then passed after sharing the selected sample's timestamp. Missing current inputs remain incomplete even with a fresh seed.

- Integrated release: **271 test files passed**, lint, TypeScript and production build passed.
- Actual Chrome: **5 passed (10.4s)**, covering notification controls/closed-page simulated delivery/news targeting plus desktop/mobile release notices and authenticated version access.
- Actual VPS Linux: the full seven-scenario `deploy-vps.integration.test.mjs`, portable rollback-state test and Bash syntax check passed in a temporary directory, with fake systemd commands and no production service changes.
- VPS HTTPS is reachable. Google FCM and Apple push hosts responded over HTTPS (404/405 on their root URLs); this verifies connectivity, not authenticated notification delivery.
- Fixed VAPID credentials were provisioned privately on the server, with a private environment backup and atomic configuration update. Environment/key files are mode 0600. Unrelated configuration and existing valid keys are preserved; key values are not printed or committed.

The prior Linux acceptance gap is closed. GitHub push and production activation are the subsequent release steps; real Windows/iPhone subscription, notification display and click-through still require the user's devices.
