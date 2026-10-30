import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openWebPushStore } from "./web-push-store.ts";
import { readWebPushDiagnostics } from "./web-push-diagnostics.ts";

const dir = mkdtempSync(join(tmpdir(), "push-diagnostics-"));
const now = new Date("2026-10-30T08:00:00.000Z");
const nowMs = now.getTime();
const ec = createECDH("prime256v1");
ec.generateKeys();
const privateKey = ec.getPrivateKey().toString("base64url");
const env = {
  SIGNAL_HUB_RUNTIME_DIR: dir,
  WEB_PUSH_ENABLED: "true",
  WEB_PUSH_VAPID_PUBLIC_KEY: ec.getPublicKey().toString("base64url"),
  WEB_PUSH_VAPID_PRIVATE_KEY: privateKey,
  WEB_PUSH_VAPID_SUBJECT: "mailto:ops@example.com",
  SIGNAL_HUB_PUBLIC_ORIGIN: "https://hub.example.com",
};
const endpoint = "https://fcm.googleapis.com/secret-endpoint";
try {
  const store = openWebPushStore(join(dir, "web-push.sqlite"));
  const keys = { p256dh: ec.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
  const device = store.enrollDevice({
    subscription: { endpoint, keys },
    device: { deviceId: randomUUID(), deviceKey: randomBytes(32).toString("base64url") },
    baseline: { sources: { market: 4, news: 2 }, marketEpisodes: [], enabledAt: new Date(nowMs - 1000).toISOString() },
    nowMs: nowMs - 1000,
  });
  const event = {
    id: "market-1",
    source: "market",
    episodeId: "ep-1",
    stage: "confirmed",
    priority: 0,
    title: "BTC 异动",
    body: "secret-body-should-not-leak",
    target: "/alerts",
    occurredAt: now.toISOString(),
    expiresAt: new Date(nowMs + 120_000).toISOString(),
    sourcePublishedAt: null,
    ruleVersion: "v1",
    evidence: [endpoint],
  };
  store.ingestSourceEventsAndAdvanceCursor("market", [{ sequence: 5, event }], 0, nowMs);
  store.setWorkerHealth({ status: "live", updatedAt: now.toISOString(), errorCode: null, counts: { pending: 1 } });
  store.close();
  mkdirSync(join(dir, "market-alerts"), { recursive: true });
  const marketDb = new DatabaseSync(join(dir, "market-alerts", "alerts.sqlite"));
  marketDb.exec("CREATE TABLE important_push_outbox (sequence INTEGER PRIMARY KEY, event_id TEXT, event_json TEXT)");
  marketDb.prepare("INSERT INTO important_push_outbox(sequence, event_id, event_json) VALUES (?,?,?)").run(9, event.id, JSON.stringify(event));
  marketDb.close();

  const report = readWebPushDiagnostics(env, now);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(privateKey), false);
  assert.equal(serialized.includes(endpoint), false);
  assert.equal(serialized.includes("secret-body-should-not-leak"), false);
  assert.equal(report.worker?.status, "live");
  assert.equal(report.worker?.stale, false);
  assert.equal(report.cursors.market, 5);
  assert.equal(report.devices.length, 1);
  assert.equal(report.devices[0].epoch, device.epoch);
  assert.equal(report.devices[0].enabled, true);
  assert.equal(report.devices[0].baseline.market, 4);
  assert.equal(report.deliveries[0].state, "pending");
  assert.equal(report.deliveries[0].title, "BTC 异动");
  assert.equal(report.outbox[0].sequence, 9);
  assert.equal(report.outbox[0].source, "market");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("ok - web push diagnostics");
