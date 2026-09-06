import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as store from "./wecom-store.ts";

const T = Date.parse("2026-09-06T00:30:20.000Z");
const iso = milliseconds => new Date(milliseconds).toISOString();
const fixture = name => JSON.parse(readFileSync(new URL(`../../docs/integrations/wecom-summary/${name}.example.json`, import.meta.url), "utf8"));
const access = { ownerId: "synthetic-owner", deviceId: "fixture-device" };
const code = (expected, status) => error => error.message === expected && error.status === status;

function sandbox(t) {
  const directory = mkdtempSync(join(tmpdir(), "wecom-store-test-"));
  t.after(() => {
    const path = resolve(directory);
    assert.ok(path.startsWith(resolve(tmpdir()) + sep) && path !== resolve(tmpdir()));
    rmSync(path, { recursive: true, force: true });
  });
  const env = {
    SIGNAL_HUB_RUNTIME_DIR: join(directory, "runtime"),
    WECOM_SYNC_ENABLED: "true",
    WECOM_SYNC_DEVICE_ID: access.deviceId,
    WECOM_SYNC_SECRET: "synthetic-only-secret-never-configure-000000000000",
  };
  const options = { ...access, env, now: T };
  let sequence = 0;
  const send = (packet, override = {}) => store.ingestWecomPacket(packet, {
    ...options, nonce: (++sequence).toString(16).padStart(32, "0"),
    body: Buffer.from(JSON.stringify(packet)), ...override,
  });
  return { directory, env, options, send };
}

function dbPath(env) {
  const directory = join(env.SIGNAL_HUB_RUNTIME_DIR, "wecom");
  const files = readdirSync(directory).filter(name => /\.(?:sqlite|sqlite3|db)$/.test(name));
  assert.equal(files.length, 1, "exactly one dedicated SQLite file");
  return join(directory, files[0]);
}

function report(index = 1, changes = {}) {
  const packet = fixture("report");
  packet.report.id = `wecom:fixture-device:00000000-0000-4000-8000-000000000001:${index.toString(16).padStart(64, "0")}`;
  Object.assign(packet.report, changes);
  return packet;
}

function ca(index = 1, changes = {}) {
  const packet = fixture("ca-alert");
  packet.alert.id = `wecom-ca:fixture-device:00000000-0000-4000-8000-000000000001:${index}`;
  Object.assign(packet.alert, changes);
  return packet;
}

test("missing storage reads return empty DTOs without creating runtime files", t => {
  const { env, options } = sandbox(t);
  const status = store.getWecomStatus(options);
  assert.deepEqual(status, {
    listener: "unknown", worker: "unknown", pendingReports: 0, lastError: null,
    caDetector: "unknown", pendingAlerts: 0, lastMessageObservedAt: null, lastCaEvaluatedAt: null,
    configured: true, connection: "waiting", lastSeenAt: null, lastReportAt: null,
  });
  assert.deepEqual(store.getWecomReports(options), { items: [], nextCursor: null, status });
  assert.deepEqual(store.getWecomCaAlerts(options), { items: [], nextCursor: null, status });
  assert.deepEqual(store.getWecomCaAlerts({ ...options, active: true }), { items: [], nextCursor: null, status, total: 0, truncated: false });
  assert.equal(store.getWecomReport(report().report.id, options), null);
  assert.equal(existsSync(env.SIGNAL_HUB_RUNTIME_DIR), false);
});

test("full report round-trips while listing only a Unicode-safe 450-unit preview", t => {
  const { options, send, env } = sandbox(t);
  const packet = report(1, { summary: "x".repeat(449) + "\u{1f680}" + "ending" });
  assert.deepEqual(send(packet), { ok: true, id: packet.report.id, revision: packet.report.revision, disposition: "stored" });
  assert.deepEqual(store.getWecomReport(packet.report.id, options), { report: packet.report, syncedAt: iso(T) });
  const { items, status } = store.getWecomReports(options);
  assert.equal(items[0].summary, "x".repeat(449));
  assert.equal(items[0].syncedAt, iso(T));
  assert.deepEqual(Object.keys(items[0]).sort(), ["id", "cadence", "windowStart", "windowEnd", "generatedAt", "summary", "model", "sourceCount", "sourceComplete", "sourcesTruncated", "syncedAt"].sort());
  assert.equal(status.lastReportAt, iso(T));
  assert.deepEqual(readdirSync(env.SIGNAL_HUB_RUNTIME_DIR), ["wecom"]);
  const db = new DatabaseSync(dbPath(env), { readOnly: true });
  try { assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal"); } finally { db.close(); }
});

test("raw byte hashes, revisions, duplicate/stale sync times and nonce rollback", t => {
  const { options, send } = sandbox(t);
  const packet = report(1, { revision: 3 });
  send(packet);
  const duplicate = send(packet, { now: T + 1000 });
  assert.equal(duplicate.disposition, "duplicate");
  const nonce = "e".repeat(32);
  assert.throws(() => send(packet, { body: Buffer.from(JSON.stringify(packet, null, 2)), nonce }), code("revision_conflict", 409));
  assert.equal(send(packet, { nonce }).disposition, "duplicate", "failed transactions do not consume nonce");
  assert.equal(send(report(1, { revision: 2 }), { now: T + 2000 }).disposition, "stale");
  assert.equal(store.getWecomReport(packet.report.id, options).syncedAt, iso(T));
  const revised = report(1, { revision: 4, summary: "Revised synthetic preview" });
  assert.equal(send(revised, { now: T + 3000 }).disposition, "stored");
  assert.deepEqual(store.getWecomReport(packet.report.id, options), { report: revised.report, syncedAt: iso(T + 3000) });
});

test("nonce replay persists across process restart for at least 610 seconds", t => {
  const { send, options, env } = sandbox(t);
  const packet = fixture("heartbeat");
  const nonce = "a".repeat(32);
  send(packet, { nonce });
  const moduleUrl = new URL("./wecom-store.ts", import.meta.url).href;
  const script = `import { ingestWecomPacket } from ${JSON.stringify(moduleUrl)};
    const p = ${JSON.stringify(packet)};
    try { ingestWecomPacket(p, { ...${JSON.stringify({ ...options, now: T + 610000, nonce })}, body: Buffer.from(JSON.stringify(p)) }); process.exit(9); }
    catch (error) { if (error.message !== "replay" || error.status !== 409) throw error; }`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(send(packet, { nonce, ownerId: "second-owner" }).ok, true);
  assert.equal(send(packet, { nonce, deviceId: "second-device" }).ok, true);
  assert.equal(store.getWecomStatus({ ...options, env }).lastSeenAt, iso(T));
  assert.equal(send(packet, { nonce, now: T + 610001 }).ok, true);
});

test("CA first receipt, delayed threshold and read-time expiry do not mutate snapshots", t => {
  const { send, options } = sandbox(t);
  const triggered = Date.parse(ca().alert.triggeredAt);
  const packet = ca();
  send(packet, { now: triggered + 60000 });
  send(ca(2), { now: triggered + 60001 });
  let items = store.getWecomCaAlerts(options).items;
  assert.equal(items.find(item => item.id === packet.alert.id).delayed, false);
  assert.equal(items.find(item => item.id === ca(2).alert.id).delayed, true);
  const higher = ca(1, { revision: 2, evaluatedAt: iso(T + 10000), mentionCount: 3, duplicateCount: 2 });
  send(higher, { now: triggered + 120000 });
  send(higher, { now: triggered + 180000 });
  send(packet, { now: triggered + 240000 });
  const item = store.getWecomCaAlerts(options).items.find(item => item.id === packet.alert.id);
  assert.equal(item.firstReceivedAt, iso(triggered + 60000));
  assert.equal(item.syncedAt, iso(triggered + 120000));
  assert.equal(item.delayed, false);
  items = store.getWecomCaAlerts({ ...options, now: Date.parse(packet.alert.expiresAt) }).items;
  assert.ok(items.every(item => item.effectiveStatus === "expired" && item.status === "active"));
  assert.equal(store.getWecomCaAlerts({ ...options, active: true, now: Date.parse(packet.alert.expiresAt) }).total, 0);
});

test("early CA closure preserves last valid snapshot and cannot be resurrected", t => {
  const { send, options } = sandbox(t);
  const packet = ca();
  send(packet);
  const closed = ca(1, { revision: 3, status: "expired", evaluatedAt: iso(T + 1000) });
  assert.ok(Date.parse(closed.alert.evaluatedAt) < Date.parse(closed.alert.expiresAt));
  assert.equal(send(closed).disposition, "stored");
  assert.equal(send(ca(1, { revision: 2 })).disposition, "stale");
  assert.throws(() => send(ca(1, { revision: 4, evaluatedAt: iso(T + 2000) })), code("revision_conflict", 409));
  assert.equal(store.getWecomCaAlerts({ ...options, active: true }).total, 0);
  const firstClose = ca(2, { revision: 5, status: "expired", evaluatedAt: iso(T + 1000), mentionCount: 8, duplicateCount: 7 });
  assert.equal(send(firstClose).disposition, "stored");
  assert.equal(send(ca(2, { revision: 4 })).disposition, "stale");
  assert.ok(store.getWecomCaAlerts(options).items.every(item => item.status === "expired"));
});

test("higher CA revisions cannot rewrite episode identity, rewind evaluation or alter a closing snapshot", t => {
  const { send } = sandbox(t);
  const mutations = [
    { address: "0xCdCdCdCdCdCdCdCdCdCdCdCdCdCdCdCdCdCdCdCd" }, { network: "ethereum" },
    { triggeredAt: "2026-09-06T00:30:09.000Z" }, { catchup: true, notificationVersion: 0 },
    { notificationVersion: 0 }, { evaluatedAt: "2026-09-06T00:30:15.000Z" },
    { status: "expired", mentionCount: 3, duplicateCount: 2 },
    { status: "expired", groups: ["synthetic group A", "synthetic group B"] },
    { status: "expired", firstSeenAt: "2026-09-06T00:11:00.000Z" },
    { status: "expired", lastSeenAt: "2026-09-06T00:29:00.000Z" },
    { status: "expired", expiresAt: "2026-09-06T01:09:00.000Z" },
  ];
  for (const [index, mutation] of mutations.entries()) {
    send(ca(index + 1, { evaluatedAt: iso(T) }));
    assert.throws(() => send(ca(index + 1, { revision: 2, evaluatedAt: iso(T + 1000), ...mutation })), code("revision_conflict", 409), JSON.stringify(mutation));
  }
});

test("closure after a revision gap carries an unseen last-valid snapshot without reviving the episode", t => {
  const { send, options } = sandbox(t);
  send(ca());
  const missed=ca(1,{revision:2,mentionCount:3,duplicateCount:2,evaluatedAt:iso(T+1000)});
  const close=structuredClone(missed); Object.assign(close.alert,{revision:3,status:"expired",evaluatedAt:iso(T+2000)});
  assert.equal(send(close).disposition,"stored");
  assert.equal(send(missed).disposition,"stale");
  assert.equal(store.getWecomCaAlerts(options).items[0].mentionCount,3);
  assert.equal(store.getWecomCaAlerts({...options,active:true}).total,0);
  assert.throws(()=>send(ca(1,{revision:5,mentionCount:4,duplicateCount:3,status:"expired",evaluatedAt:iso(T+3000)})),code("revision_conflict",409));
});

test("report keyset pagination scopes owner/device/cadence before limiting and binds cursors", t => {
  const { send, options } = sandbox(t);
  for (let index = 1; index <= 13; index++) send(report(index));
  for (let index = 50; index < 63; index++) send(report(index), { ownerId: "other-owner" });
  send(report(70, { cadence: "daily" }));
  send(report(80), { deviceId: "other-device" });
  const first = store.getWecomReports({ ...options, cadence: "two_hour" });
  assert.equal(first.items.length, 10);
  const second = store.getWecomReports({ ...options, cadence: "two_hour", before: first.nextCursor });
  assert.equal(second.items.length, 3);
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items].map(item => item.id), Array.from({ length: 13 }, (_, index) => report(13 - index).report.id));
  for (const change of [{ ownerId: "other-owner" }, { deviceId: "other-device" }, { cadence: "daily" }, { cadence: undefined }]) {
    assert.throws(() => store.getWecomReports({ ...options, cadence: "two_hour", ...change, before: first.nextCursor }), code("invalid_query", 400));
  }
  assert.throws(() => store.getWecomCaAlerts({ ...options, before: first.nextCursor }), code("invalid_query", 400));
  assert.equal(store.getWecomReport(report(50).report.id, options), null);
  assert.equal(store.getWecomReport(report(80).report.id, options), null);
  assert.equal(store.getWecomReports({ ...options, cadence: "daily" }).items.length, 1);
});

test("keyset ordering handles equivalent UTC formats and mixed timestamps", t => {
  const { send, options } = sandbox(t);
  send(report(1, { windowEnd: "2026-09-06T00:30:00Z" }));
  send(report(2, { windowEnd: "2026-09-06T00:30:00.000Z" }));
  send(report(3, { windowEnd: "2026-09-06T00:29:59.999Z" }));
  const page = store.getWecomReports({ ...options, limit: 1 });
  assert.equal(page.items[0].id, report(2).report.id);
  const next = store.getWecomReports({ ...options, limit: 1, before: page.nextCursor });
  assert.equal(next.items[0].id, report(1).report.id);
});

test("CA active totals and history pagination are scoped, bounded and distinct", t => {
  const { send, options } = sandbox(t);
  for (let index = 1; index <= 52; index++) send(ca(index));
  send(ca(100, { status: "expired" }));
  send(ca(101), { ownerId: "other-owner" });
  send(ca(102), { deviceId: "other-device" });
  const active = store.getWecomCaAlerts({ ...options, active: true });
  assert.equal(active.items.length, 50);
  assert.equal(active.total, 52);
  assert.equal(active.truncated, true);
  assert.equal(active.nextCursor, null);
  const history = store.getWecomCaAlerts(options);
  assert.equal(history.items.length, 10);
  const next = store.getWecomCaAlerts({ ...options, before: history.nextCursor });
  assert.equal(new Set([...history.items, ...next.items].map(item => item.id)).size, 20);
  for (const change of [{ ownerId: "other-owner" }, { deviceId: "other-device" }, { active: true }]) {
    assert.throws(() => store.getWecomCaAlerts({ ...options, ...change, before: history.nextCursor }), code("invalid_query", 400));
  }
});

test("query validation rejects malformed, oversized and cross-context cursors even without a DB", t => {
  const { options } = sandbox(t);
  for (const limit of [0, -1, 11, 1.5, NaN, Infinity, "2", true, null]) {
    assert.throws(() => store.getWecomReports({ ...options, limit }), code("invalid_query", 400));
    assert.throws(() => store.getWecomCaAlerts({ ...options, limit }), code("invalid_query", 400));
  }
  for (const before of ["", "bad+cursor", "x".repeat(4097), Buffer.from("{}").toString("base64url")]) {
    assert.throws(() => store.getWecomReports({ ...options, before }), code("invalid_query", 400));
  }
  assert.throws(() => store.getWecomReports({ ...options, cadence: "weekly" }), code("invalid_query", 400));
  assert.throws(() => store.getWecomCaAlerts({ ...options, active: "true" }), code("invalid_query", 400));
  assert.throws(() => store.getWecomCaAlerts({ ...options, active: true, limit: 51 }), code("invalid_query", 400));
  assert.throws(() => store.getWecomCaAlerts({ ...options, active: true, before: "" }), code("invalid_query", 400));
});

test("status retains all heartbeat evidence, uses receipt activity and never exposes config", t => {
  const { send, options, env } = sandbox(t);
  const packet = fixture("heartbeat");
  send(packet);
  assert.deepEqual(store.getWecomStatus(options), { ...packet.status, configured: true, connection: "online", lastSeenAt: iso(T), lastReportAt: null });
  assert.equal(store.getWecomStatus({ ...options, now: T + 179999 }).connection, "online");
  const offline = store.getWecomStatus({ ...options, now: T + 180000 });
  assert.equal(offline.connection, "offline");
  for (const [key, value] of Object.entries(packet.status)) assert.deepEqual(offline[key], value);
  send(report(), { now: T + 180001 });
  assert.equal(store.getWecomStatus({ ...options, now: T + 180001 }).connection, "online");
  assert.equal(store.getWecomStatus({ ...options, ownerId: "other" }).connection, "waiting");
  assert.equal(store.getWecomStatus({ ...options, deviceId: "other" }).lastReportAt, null);
  for (const change of [{ WECOM_SYNC_ENABLED: "false" }, { WECOM_SYNC_ENABLED: undefined }, { WECOM_SYNC_SECRET: "short" }, { WECOM_SYNC_DEVICE_ID: "bad device" }, { WECOM_SYNC_DEVICE_ID: "another-device" }]) {
    assert.equal(store.getWecomStatus({ ...options, env: { ...env, ...change } }).configured, false);
  }
  assert.ok(!JSON.stringify(offline).includes(env.WECOM_SYNC_SECRET));
});

test("corrupt storage and a non-directory runtime root are unavailable, never fake empty", t => {
  const { send, options, env } = sandbox(t);
  send(report());
  writeFileSync(dbPath(env), "synthetic corrupt database");
  for (const read of [store.getWecomReports, store.getWecomCaAlerts, store.getWecomStatus]) {
    assert.throws(() => read(options), code("storage_unavailable", 503));
  }
  assert.throws(() => store.getWecomReport(report().report.id, options), code("storage_unavailable", 503));
  assert.throws(() => send(report(2)), code("storage_unavailable", 503));
  const badRoot = join(dirname(env.SIGNAL_HUB_RUNTIME_DIR), "not-a-directory");
  writeFileSync(badRoot, "synthetic");
  assert.throws(() => store.getWecomStatus({ ...options, env: { ...env, SIGNAL_HUB_RUNTIME_DIR: badRoot } }), code("storage_unavailable", 503));
});

test("disk budget includes WAL, preserves good data, and rolls back nonce with rejected objects", t => {
  const { send, options, env } = sandbox(t);
  send(report());
  const path = dbPath(env);
  const bytes = lstatSync(path).size;
  const nonce = "c".repeat(32);
  const constrained = { ...env, WECOM_STORE_MAX_BYTES: String(bytes + 1) };
  assert.throws(() => send(report(2), { env: constrained, nonce }), code("disk_limit", 503));
  assert.equal(store.getWecomReports(options).items.length, 1);
  assert.equal(send(report(2), { nonce }).disposition, "stored");
  const reader = new DatabaseSync(path, { readOnly: true });
  try {
    reader.exec("BEGIN");
    reader.prepare("SELECT name FROM sqlite_schema").all();
    send(report(3));
    const walSize = lstatSync(path + "-wal").size;
    assert.ok(walSize > 0);
    assert.throws(() => send(report(4), { env: { ...env, WECOM_STORE_MAX_BYTES: String(lstatSync(path).size + walSize - 1) } }), code("disk_limit", 503));
    reader.exec("ROLLBACK");
  } finally { reader.close(); }
  assert.equal(store.getWecomReports(options).items.length, 3);
});

test("a held writer lock fails within the busy bound and does not consume the nonce", t => {
  const { send, env } = sandbox(t);
  send(report());
  const db = new DatabaseSync(dbPath(env));
  const nonce = "d".repeat(32);
  try {
    db.exec("BEGIN IMMEDIATE");
    const started = Date.now();
    assert.throws(() => send(report(2), { nonce }), code("storage_unavailable", 503));
    assert.ok(Date.now() - started < 2500);
    db.exec("ROLLBACK");
  } finally { db.close(); }
  assert.equal(send(report(2), { nonce }).disposition, "stored");
});

test("storage rejects linked database files and directory junctions without altering their targets", t => {
  const { send, options, env, directory } = sandbox(t);
  send(report());
  const path = dbPath(env);
  const hardlink = join(directory, "linked.sqlite");
  linkSync(path, hardlink);
  assert.throws(() => send(report(2)), code("storage_unavailable", 503));
  assert.throws(() => store.getWecomReports(options), code("storage_unavailable", 503));
  const target = join(directory, "junction-target");
  mkdirSync(target);
  const linkedRoot = join(directory, "junction-runtime");
  symlinkSync(target, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => send(report(2), { env: { ...env, SIGNAL_HUB_RUNTIME_DIR: linkedRoot } }), code("storage_unavailable", 503));
  assert.deepEqual(readdirSync(target), []);
});

test("read-only APIs leave database contents untouched and private permissions are set on POSIX", t => {
  const { send, options, env } = sandbox(t);
  send(report());
  const path = dbPath(env);
  const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
  const before = hash();
  store.getWecomReports(options);
  store.getWecomReport(report().report.id, options);
  store.getWecomCaAlerts(options);
  store.getWecomStatus(options);
  assert.equal(hash(), before);
  if (process.platform !== "win32") {
    assert.equal(lstatSync(dirname(path)).mode & 0o777, 0o700);
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
  }
  assert.ok(relative(env.SIGNAL_HUB_RUNTIME_DIR, path).startsWith("wecom" + sep));
});

test("idempotency is independently keyed by owner, device and object type", t => {
  const { send, options } = sandbox(t);
  const packet = report();
  const sameIdCa = ca(1, { id: packet.report.id, revision: packet.report.revision });
  assert.equal(send(packet).disposition, "stored");
  assert.equal(send(sameIdCa).disposition, "stored");
  const privateReport = report(1, { summary: "Only the other owner sees this" });
  assert.equal(send(privateReport, { ownerId: "other-owner" }).disposition, "stored");
  assert.equal(send(privateReport, { deviceId: "other-device" }).disposition, "stored");
  assert.equal(store.getWecomReport(packet.report.id, options).report.summary, packet.report.summary);
  assert.equal(store.getWecomReport(packet.report.id, { ...options, ownerId: "other-owner" }).report.summary, privateReport.report.summary);
  assert.equal(store.getWecomCaAlerts(options).items[0].address, sameIdCa.alert.address);
  assert.equal(store.getWecomCaAlerts({ ...options, ownerId: "other-owner" }).items.length, 0);
});

test("valid UTC dates before 1970 remain pageable without being confused with receipt timestamps", t => {
  const { send, options } = sandbox(t);
  for (let index = 1; index <= 2; index++) {
    send(report(index, { windowStart: "1969-12-31T00:00:00.000Z", windowEnd: "1969-12-31T01:00:00.000Z" }));
  }
  const page = store.getWecomReports({ ...options, limit: 1 });
  const next = store.getWecomReports({ ...options, before: page.nextCursor, limit: 1 });
  assert.equal(page.items[0].id, report(2).report.id);
  assert.equal(next.items[0].id, report(1).report.id);
});

test("invalid stored report previews fail closed instead of leaking malformed DTOs", t => {
  const { send, options, env } = sandbox(t);
  send(report());
  const db = new DatabaseSync(dbPath(env));
  try { db.prepare("UPDATE wecom_objects SET summary_json = ? WHERE type = 'report'").run("{}"); }
  finally { db.close(); }
  assert.throws(() => store.getWecomReports(options), code("storage_unavailable", 503));
  assert.ok(store.getWecomReport(report().report.id, options), "the unchanged full snapshot remains readable");
});

test("tiny initial budgets create no DB and unknown schema versions are unavailable", t => {
  const { send, options, env } = sandbox(t);
  assert.throws(() => send(report(), { env: { ...env, WECOM_STORE_MAX_BYTES: "1" } }), code("disk_limit", 503));
  assert.equal(existsSync(env.SIGNAL_HUB_RUNTIME_DIR), false);
  send(report());
  const db = new DatabaseSync(dbPath(env));
  try { db.exec("PRAGMA user_version = 99"); } finally { db.close(); }
  assert.throws(() => store.getWecomStatus(options), code("storage_unavailable", 503));
  assert.throws(() => send(report(2)), code("storage_unavailable", 503));
});

test("projected quota rejection rolls back the object, nonce and heartbeat activity together", t => {
  const { send, options, env } = sandbox(t);
  send(fixture("heartbeat"));
  const before = store.getWecomStatus(options);
  const path = dbPath(env);
  const nonce = "f".repeat(32);
  const large = report(2, { summary: "z".repeat(10000) });
  assert.throws(() => send(large, { nonce, now: T + 10000, env: { ...env, WECOM_STORE_MAX_BYTES: String(lstatSync(path).size + 32768) } }), code("disk_limit", 503));
  assert.equal(store.getWecomReport(large.report.id, options), null);
  assert.deepEqual(store.getWecomStatus(options), before);
  assert.equal(send(large, { nonce }).disposition, "stored");
});

test("linked WAL sidecars and nested linked runtime ancestors are rejected before use", t => {
  const { send, options, env, directory } = sandbox(t);
  send(report());
  const path = dbPath(env);
  const sidecar = join(directory, "synthetic-sidecar");
  writeFileSync(sidecar, "not a WAL");
  linkSync(sidecar, path + "-wal");
  assert.throws(() => send(report(2)), code("storage_unavailable", 503));
  assert.throws(() => store.getWecomStatus(options), code("storage_unavailable", 503));
  assert.equal(readFileSync(sidecar, "utf8"), "not a WAL");
  const target = join(directory, "ancestor-target");
  mkdirSync(target);
  const alias = join(directory, "ancestor-alias");
  symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
  const linkedEnv = { ...env, SIGNAL_HUB_RUNTIME_DIR: join(alias, "child") };
  assert.throws(() => send(report(2), { env: linkedEnv }), code("storage_unavailable", 503));
  assert.throws(() => store.getWecomReports({ ...options, env: linkedEnv }), code("storage_unavailable", 503));
  assert.deepEqual(readdirSync(target), []);
});

test("configured status follows the dedicated signature credential rules", t => {
  const { options, env } = sandbox(t);
  assert.equal(store.getWecomStatus({ ...options, env: { ...env, WECOM_SYNC_DEVICE_ID: " fixture-device " } }).configured, true);
  assert.equal(store.getWecomStatus({ ...options, env: { ...env, WECOM_SYNC_SECRET: "\u6d4b".repeat(32) } }).configured, true);
});

test("catchup remains immutable independently of notificationVersion", t => {
  const { send } = sandbox(t);
  send(ca(1, { notificationVersion: 0 }));
  assert.throws(() => send(ca(1, { revision: 2, notificationVersion: 0, catchup: true, evaluatedAt: iso(T) })), code("revision_conflict", 409));
});

test("SQL-like access identifiers are data and cannot widen a query", t => {
  const { send, options } = sandbox(t);
  send(report());
  send(report(2), { ownerId: "owner' OR 1=1 --" });
  assert.deepEqual(store.getWecomReports({ ...options, ownerId: "owner' OR 1=1 --" }).items.map(item => item.id), [report(2).report.id]);
  assert.equal(store.getWecomReport(report().report.id, { ...options, ownerId: "owner' OR 1=1 --" }), null);
  assert.equal(store.getWecomReports(options).items.length, 1);
});

const fractionalSuffixes = [
  ".123499+00:00", ".123498Z", ".1235Z", ".123500+00:00",
  ".1Z", ".10+00:00", ".100Z", ".1000+00:00", ".10000Z", ".100000+00:00",
  "Z", "+00:00",
];
const chronologicalIndices = [4, 3, 1, 2, 10, 9, 8, 7, 6, 5, 12, 11];

test("report pagination preserves microsecond order across Z and UTC-offset spellings", t => {
  const { send, options } = sandbox(t);
  const packets = fractionalSuffixes.map((suffix, index) => report(index + 1, { windowEnd: "2026-09-06T00:30:00" + suffix }));
  packets.forEach(packet => send(packet));
  const ids = [];
  let before;
  do {
    const page = store.getWecomReports({ ...options, limit: 2, before });
    ids.push(...page.items.map(item => item.id));
    before = page.nextCursor;
  } while (before && ids.length <= packets.length);
  assert.deepEqual(ids, chronologicalIndices.map(index => packets[index - 1].report.id));
  assert.equal(before, null);
  for (const packet of packets) {
    assert.deepEqual(store.getWecomReport(packet.report.id, options).report, packet.report, "sorting must not rewrite payload timestamps");
  }
});

test("CA history and active lists order trigger instants at full six-digit precision", t => {
  const { send, options } = sandbox(t);
  const packets = fractionalSuffixes.map((suffix, index) => ca(index + 1, {
    id: `wecom-ca:fixture-device:00000000-0000-4000-8000-000000000001:${String(index + 1).padStart(3, "0")}`,
    triggeredAt: "2026-09-06T00:30:10" + suffix, evaluatedAt: iso(T),
  }));
  packets.forEach(packet => send(packet));
  const items = [];
  let before;
  do {
    const page = store.getWecomCaAlerts({ ...options, limit: 2, before });
    items.push(...page.items);
    before = page.nextCursor;
  } while (before && items.length <= packets.length);
  const ids = chronologicalIndices.map(index => packets[index - 1].alert.id);
  assert.deepEqual(items.map(item => item.id), ids);
  assert.equal(before, null);
  assert.deepEqual(store.getWecomCaAlerts({ ...options, active: true }).items.map(item => item.id), ids);
  for (const item of items) {
    const { firstReceivedAt, syncedAt, delayed, effectiveStatus, ...payload } = item;
    assert.deepEqual(payload, packets.find(packet => packet.alert.id === item.id).alert);
    assert.equal(firstReceivedAt, iso(T));
    assert.equal(syncedAt, iso(T));
    assert.equal(delayed, false);
    assert.equal(effectiveStatus, "active");
  }
});

test("CA immutable times and evaluation monotonicity retain sub-millisecond precision", t => {
  const { send } = sandbox(t);
  const packet = ca(1, { triggeredAt: "2026-09-06T00:30:10.123456Z", evaluatedAt: "2026-09-06T00:30:20.123456Z" });
  send(packet);
  const rewind = structuredClone(packet);
  rewind.alert.revision++;
  rewind.alert.evaluatedAt = "2026-09-06T00:30:20.123455+00:00";
  assert.throws(() => send(rewind), code("revision_conflict", 409));
  const changed = structuredClone(packet);
  changed.alert.revision++;
  changed.alert.triggeredAt = "2026-09-06T00:30:10.123457+00:00";
  assert.throws(() => send(changed), code("revision_conflict", 409));
  const equivalent = structuredClone(packet);
  equivalent.alert.revision++;
  equivalent.alert.triggeredAt = "2026-09-06T00:30:10.123456+00:00";
  assert.equal(send(equivalent).disposition, "stored");
});

test("CA closure cannot alter last-valid snapshot times by a microsecond", t => {
  const { send } = sandbox(t);
  for (const [index, field] of ["firstSeenAt", "lastSeenAt", "expiresAt"].entries()) {
    const packet = ca(index + 1);
    packet.alert[field] = packet.alert[field].replace(".000Z", ".000001Z");
    send(packet);
    const closed = structuredClone(packet);
    Object.assign(closed.alert, { revision: 2, status: "expired", evaluatedAt: iso(T) });
    closed.alert[field] = packet.alert[field].replace(".000001Z", ".000002+00:00");
    assert.throws(() => send(closed), code("revision_conflict", 409), field);
  }
});

test("active filtering and effectiveStatus do not round expiry down by a microsecond", t => {
  const { send, options } = sandbox(t);
  send(ca(1, { evaluatedAt: iso(T - 1000), expiresAt: "2026-09-06T00:30:20.000001+00:00" }));
  assert.equal(store.getWecomCaAlerts({ ...options, active: true }).total, 1);
  assert.equal(store.getWecomCaAlerts(options).items[0].effectiveStatus, "active");
  assert.equal(store.getWecomCaAlerts({ ...options, active: true, now: T + 1 }).total, 0);
  assert.equal(store.getWecomCaAlerts({ ...options, now: T + 1 }).items[0].effectiveStatus, "expired");
});

test("precision cursors reject older numeric keys and noncanonical timestamp spellings", t => {
  const { send, options } = sandbox(t);
  send(report(1, { windowEnd: "2026-09-06T00:30:00.123456+00:00" }));
  send(report(2));
  const cursor = store.getWecomReports({ ...options, limit: 1 }).nextCursor;
  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  assert.equal(decoded.v, 2);
  assert.match(decoded.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  for (const changes of [
    { v: 1, time: Date.parse(decoded.time) }, { time: Date.parse(decoded.time) },
    { time: decoded.time.replace(/Z$/, "+00:00") },
    { time: "2026-09-06T00:30:00.1234567Z" }, { time: "2026-02-30T00:30:00.123456Z" },
  ]) {
    const before = Buffer.from(JSON.stringify({ ...decoded, ...changes })).toString("base64url");
    assert.throws(() => store.getWecomReports({ ...options, before }), code("invalid_query", 400));
  }
});

test("earlier prototype store versions fail closed without migrating or changing payload hashes", t => {
  const { send, options, env } = sandbox(t);
  send(report());
  const db = new DatabaseSync(dbPath(env));
  const snapshot = () => db.prepare("SELECT payload_json, body_hash FROM wecom_objects").all();
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
    const before = snapshot();
    db.exec("PRAGMA user_version = 1");
    assert.throws(() => store.getWecomReports(options), code("storage_unavailable", 503));
    assert.throws(() => send(report(2)), code("storage_unavailable", 503));
    assert.deepEqual(snapshot(), before);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
  } finally { db.close(); }
});
