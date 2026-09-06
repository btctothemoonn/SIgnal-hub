import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { alert, alerts, fixture, flush, harness, reports, status } from "./wecom-test-utils.mjs";

assert.ok(existsSync(new URL("./wecom-session.ts", import.meta.url)), "WeCom needs a session-scoped polling controller");
const { WecomSession } = await import("./wecom-session.ts");
const setup = (initial = {}) => {
  const h = harness();
  const session = new WecomSession({ initialReports: reports(), initialAlerts: alerts(), ...initial }, h.runtime);
  return { ...h, session };
};

test("visible content polls CA at 15s and reports at 60s; hidden keeps only bounded auth checks", async () => {
  const h = setup();
  h.session.start(true);
  await flush();
  assert.equal(h.requests.length, 3);
  assert.ok(h.requests.every(({ options }) => options.cache === "no-store" && options.credentials === "same-origin" && options.signal));
  await h.tick(15_000);
  assert.equal(h.requests.filter((r) => r.url.includes("ca-alerts")).length, 2);
  assert.equal(h.requests.filter((r) => r.url.includes("reports")).length, 1);
  await h.tick(45_000);
  assert.equal(h.requests.filter((r) => r.url.includes("reports")).length, 2);
  h.session.setVisible(false);
  const count = h.requests.length;
  await h.tick(60_000);
  assert.deepEqual(h.requests.slice(count).map((r) => r.url), ["/api/wecom/status"]);
  h.session.setVisible(true);
  await flush();
  assert.equal(h.requests.slice(count + 1).length, 3);
  h.session.stop();
  assert.equal(h.timers.size, 0);
});

test("in-flight polls do not overlap and hidden abort prevents late content", async () => {
  const h = setup();
  let release;
  h.respond((url) => url.includes("ca-alerts") ? new Promise((resolve) => { release = resolve; }) : url.includes("status") ? status() : reports());
  h.session.start(true);
  await flush();
  await h.tick(5_000);
  h.session.refresh();
  await flush();
  assert.equal(h.requests.filter((r) => r.url.includes("ca-alerts")).length, 1);
  h.session.setVisible(false);
  assert.equal(h.requests.find((r) => r.url.includes("ca-alerts")).options.signal.aborted, true);
  release(alerts([alert("late-private")]));
  await flush();
  assert.equal(h.session.getSnapshot().activeAlerts.items[0].id, "episode-1");
  h.session.stop();
});

test("initial/resume/StrictMode loads are silent; only fresh new episodes notify once", async () => {
  const h = setup();
  let items = [alert("first")];
  h.respond((url) => url.includes("ca-alerts") ? alerts(items) : url.includes("status") ? status() : reports());
  h.session.start(true);
  h.session.stop();
  h.session.start(true);
  await flush();
  assert.deepEqual(h.session.getSnapshot().toasts, []);
  items = [alert("fresh"), alert("catchup", { catchup: true }), alert("suppressed", { notificationVersion: 0 }), alert("expired", { status: "expired" }), alert("late", { firstReceivedAt: "2026-09-06T00:31:11.000Z" }), alert("clock-expired", { expiresAt: "2026-09-06T00:30:30.000Z" })];
  await h.tick(15_000);
  assert.deepEqual(h.session.getSnapshot().toasts.map((item) => item.id), ["fresh"]);
  h.session.dismissToast("fresh");
  items = [alert("fresh", { revision: 2 }), alert("suppressed", { notificationVersion: 1, revision: 2 })];
  await h.tick(15_000);
  assert.deepEqual(h.session.getSnapshot().toasts, []);
  h.session.setVisible(false);
  items = [alert("resume-history")];
  h.session.setVisible(true);
  await flush();
  assert.deepEqual(h.session.getSnapshot().toasts, []);
  h.session.stop();
});

test("ordinary network errors retain last good data and expose a safe error", async () => {
  const h = setup();
  h.respond(() => { throw new Error("private-path-secret"); });
  h.session.start(true);
  await flush();
  const state = h.session.getSnapshot();
  assert.equal(state.reports.items.length, 1);
  assert.equal(state.activeAlerts.items.length, 1);
  assert.ok(state.errors.reports);
  assert.doesNotMatch(JSON.stringify(state.errors), /private-path-secret/);
  h.session.stop();
});

for (const code of [401, 403]) test(`${code} clears all session data, selections and toasts, including late success and original SSR seed`, async () => {
  const h = setup();
  h.session.start(true);
  await flush();
  h.session.selectReport(fixture("report").report.id);
  h.session.setCaMode("history");
  await flush();
  h.respond(() => new Response("private diagnostic", { status: code }));
  h.session.checkAccess();
  await flush();
  const state = h.session.getSnapshot();
  assert.equal(state.auth, code);
  for (const key of ["reports", "activeAlerts", "caHistory", "status", "detail", "selectedId"]) assert.equal(state[key], null, key);
  assert.deepEqual(state.toasts, []);
  assert.deepEqual(state.errors, {});
  assert.equal(h.redirects.length, code === 401 ? 1 : 0);
  h.session.stop();
  h.session.start(true);
  h.session.refresh();
  await flush();
  assert.equal(h.session.getSnapshot().reports, null);
  assert.equal(h.timers.size, 0);
});

test("hidden session checks revoke content without waiting for visible content polling", async () => {
  const h = setup();
  h.session.start(false);
  h.respond(() => new Response(null, { status: 403 }));
  await h.tick(60_000);
  assert.equal(h.session.getSnapshot().auth, 403);
  assert.equal(h.session.getSnapshot().activeAlerts, null);
});

test("cadence changes and detail changes abort old requests and reject late responses", async () => {
  const h = setup();
  const pending = [];
  h.respond((url) => url.includes("reports") ? new Promise((resolve) => pending.push({ url, resolve })) : url.includes("status") ? status() : alerts());
  h.session.start(true);
  h.session.setCadence("daily");
  await flush();
  assert.ok(h.requests.find((r) => r.url.includes("cadence=two_hour")).options.signal.aborted);
  pending.find((p) => p.url.includes("daily")).resolve(reports([{ ...fixture("report").report, id: "daily", cadence: "daily" }]));
  pending.find((p) => p.url.includes("two_hour")).resolve(reports());
  await flush();
  assert.equal(h.session.getSnapshot().reports.items[0].id, "daily");
  h.session.selectReport("a:with+symbols");
  h.session.selectReport("b");
  await flush();
  pending.find((p) => p.url.includes("id=b")).resolve({ report: { ...fixture("report").report, id: "b" }, syncedAt: "2026-09-06T00:30:20Z" });
  pending.find((p) => p.url.includes("id=a%3Awith%2Bsymbols")).resolve({ report: { ...fixture("report").report, id: "a:with+symbols" }, syncedAt: "2026-09-06T00:30:20Z" });
  await flush();
  assert.equal(h.session.getSnapshot().detail.report.id, "b");
  h.session.stop();
});

test("history paging sends opaque cursor once, preserves pages on refresh, and mode change ignores late pages", async () => {
  const h = setup({ initialReports: reports(undefined, "opaque+/=" ) });
  let releaseHistory;
  h.respond((url) => {
    if (url.includes("/status")) return status();
    if (url.includes("reports")) return url.includes("before=") ? reports([{ ...fixture("report").report, id: "older" }]) : reports(undefined, "opaque+/=");
    if (url.includes("active=1")) return alerts();
    if (url.includes("before=")) return new Promise((resolve) => { releaseHistory = resolve; });
    return alerts([alert("history")], { nextCursor: "history+/=" });
  });
  h.session.start(true);
  await flush();
  h.session.loadMoreReports();
  h.session.loadMoreReports();
  await flush();
  assert.equal(h.requests.filter((r) => r.url.includes("before=opaque%2B%2F%3D")).length, 1);
  assert.equal(h.session.getSnapshot().reports.items.length, 2);
  h.session.refresh();
  await flush();
  assert.equal(h.session.getSnapshot().reports.items.length, 2);
  assert.equal(h.session.getSnapshot().reports.nextCursor, null);
  h.session.setCaMode("history");
  await flush();
  h.session.loadMoreCa();
  await flush();
  assert.ok(h.requests.some((r) => r.url.includes("limit=10&before=history%2B%2F%3D")));
  h.session.setCaMode("active");
  releaseHistory(alerts([alert("late-history")]));
  await flush();
  assert.ok(!JSON.stringify(h.session.getSnapshot().caHistory).includes("late-history"));
  h.session.stop();
});

test("retrying an expanded report retains the last good detail until a newer response succeeds", async () => {
  const h = setup();
  const report = fixture("report").report;
  let fail = false;
  h.respond((url) => {
    if (url.includes("id=")) { if (fail) throw new Error("offline"); return { report, syncedAt: "2026-09-06T02:06:00Z" }; }
    return url.includes("status") ? status() : url.includes("ca-alerts") ? alerts() : reports();
  });
  h.session.start(true); await flush();
  h.session.selectReport(report.id); await flush();
  fail = true;
  h.session.selectReport(report.id); await flush();
  assert.equal(h.session.getSnapshot().detail.report.id, report.id);
  assert.ok(h.session.getSnapshot().errors.detail);
  h.session.stop();
});

test("periodic report refresh also refreshes the expanded full briefing", async () => {
  const h = setup();
  let report = fixture("report").report;
  h.respond((url) => url.includes("id=") ? { report, syncedAt: "2026-09-06T02:06:00Z" } : url.includes("status") ? status() : url.includes("ca-alerts") ? alerts() : reports());
  h.session.start(true); await flush();
  h.session.selectReport(report.id); await flush();
  report = { ...report, revision: 2, summary: "new version" };
  await h.tick(60_000);
  assert.equal(h.session.getSnapshot().detail.report.revision, 2);
  h.session.stop();
});

for (const code of [401, 403]) test(`auth ${code} from a detail request clears loaded histories and a live toast, late list cannot restore them`, async () => {
  const h = setup();
  let current = alerts();
  let delayedList;
  let deny = false;
  h.respond((url) => {
    if (url.includes("id=")) return deny ? new Response(null, { status: code }) : { report: fixture("report").report, syncedAt: "2026-09-06T02:06:00Z" };
    if (url.includes("reports") && deny) return new Promise((resolve) => { delayedList = resolve; });
    return url.includes("status") ? status() : url.includes("ca-alerts") ? current : reports();
  });
  h.session.start(true); await flush();
  h.session.selectReport(fixture("report").report.id);
  h.session.setCaMode("history"); await flush();
  current = alerts([alert("new-live")]);
  await h.tick(15_000);
  assert.equal(h.session.getSnapshot().toasts.length, 1);
  assert.ok(h.session.getSnapshot().caHistory.items.length);
  deny = true;
  h.session.refresh(); await flush();
  assert.equal(h.session.getSnapshot().auth, code);
  delayedList(reports()); await flush();
  const state = h.session.getSnapshot();
  for (const key of ["reports", "activeAlerts", "caHistory", "status", "detail", "selectedId"]) assert.equal(state[key], null, key);
  assert.deepEqual(state.toasts, []);
  assert.equal(h.timers.size, 0);
});

test("hung requests time out, abort and retry later without overlapping", async () => {
  const h = setup();
  h.respond((url) => url.includes("ca-alerts") ? new Promise(() => {}) : url.includes("status") ? status() : reports());
  h.session.start(true); await flush();
  await h.tick(9_999);
  assert.equal(h.requests.filter((r) => r.url.includes("ca-alerts")).length, 1);
  await h.tick(1);
  assert.equal(h.requests.find((r) => r.url.includes("ca-alerts")).options.signal.aborted, true);
  assert.ok(h.session.getSnapshot().errors.active);
  await h.tick(15_000);
  assert.equal(h.requests.filter((r) => r.url.includes("ca-alerts")).length, 2);
  h.session.stop();
});

test("an existing toast expires even if the next CA refresh fails", async () => {
  const h = setup();
  let fail = false;
  let items = [];
  h.respond((url) => {
    if (url.includes("ca-alerts")) { if (fail) throw new Error("offline"); return alerts(items); }
    return url.includes("status") ? status() : reports();
  });
  h.session.start(true); await flush();
  items = [alert("brief-toast", { expiresAt: "2026-09-06T00:30:40.000Z" })];
  await h.tick(15_000);
  assert.equal(h.session.getSnapshot().toasts.length, 1);
  fail = true;
  await h.tick(15_000);
  assert.deepEqual(h.session.getSnapshot().toasts, []);
  h.session.stop();
});

test("fresh CA list status updates the independent device channels without regressing to older status evidence", async () => {
  const h = setup();
  let fresh = false;
  h.respond((url) => url.includes("ca-alerts") ? alerts(undefined, { status: fresh ? status({ lastSeenAt: "2026-09-06T00:30:35Z", lastCaEvaluatedAt: "2026-09-06T00:30:34Z", caDetector: "online", worker: "offline" }) : status() }) : url.includes("status") ? status() : reports());
  h.session.start(true); await flush();
  fresh = true;
  await h.tick(15_000);
  assert.equal(h.session.getSnapshot().status.lastCaEvaluatedAt, "2026-09-06T00:30:34Z");
  h.session.checkAccess(); await flush();
  assert.equal(h.session.getSnapshot().status.lastSeenAt, "2026-09-06T00:30:35Z");
  h.session.stop();
});
