import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getRuntimeDataPath } from "./runtime-storage.ts";
import { validateWecomPacket } from "./wecom-contract.ts";
import { WecomError } from "./wecom-errors.ts";
import type {
  WecomAccess, WecomAck, WecomCaAlert, WecomCadence, WecomCaItem, WecomCaList,
  WecomEnv, WecomHeartbeat, WecomPacket, WecomReport, WecomReportDetail,
  WecomReportList, WecomReportListItem, WecomSyncStatus,
} from "./wecom-types.ts";

type ReadOptions = WecomAccess & { now?: number; env?: WecomEnv };
type ReportOptions = ReadOptions & { cadence?: WecomCadence; limit?: number; before?: string };
type CaOptions = ReadOptions & { active?: boolean; limit?: number; before?: string };
type IngestOptions = ReadOptions & { body: Uint8Array; nonce: string };
type ObjectType = "report" | "ca_alert";
type Row = Record<string, unknown>;
type Cursor = {
  v: 2; ownerId: string; deviceId: string; type: ObjectType;
  filter: string; time: string; id: string;
};

const MAX_BYTES = 256 * 1024 * 1024;
const STORE_VERSION = 2;
const NONCE_RETENTION_MS = 610000;
const DEVICE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,1023}$/;
const CADENCES: readonly string[] = ["two_hour", "six_hour", "daily"];
const FILE_SUFFIXES = ["", "-wal", "-shm", "-journal"];
const UNKNOWN_HEARTBEAT: WecomHeartbeat = {
  listener: "unknown", worker: "unknown", pendingReports: 0, lastError: null,
  caDetector: "unknown", pendingAlerts: 0, lastMessageObservedAt: null, lastCaEvaluatedAt: null,
};

const SCHEMA = `
  CREATE TABLE wecom_objects (
    owner_id TEXT NOT NULL, device_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('report', 'ca_alert')), id TEXT NOT NULL,
    revision INTEGER NOT NULL, body_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
    summary_json TEXT, cadence TEXT, sort_time TEXT NOT NULL,
    active_status TEXT, expires_at INTEGER,
    first_received_at INTEGER NOT NULL, synced_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, device_id, type, id)
  ) WITHOUT ROWID;
  CREATE INDEX wecom_object_history ON wecom_objects
    (owner_id, device_id, type, sort_time DESC, id DESC);
  CREATE INDEX wecom_report_cadence ON wecom_objects
    (owner_id, device_id, type, cadence, sort_time DESC, id DESC);
  CREATE INDEX wecom_active_ca ON wecom_objects
    (owner_id, device_id, type, active_status, expires_at);
  CREATE TABLE wecom_nonces (
    owner_id TEXT NOT NULL, device_id TEXT NOT NULL, nonce TEXT NOT NULL,
    accepted_at INTEGER NOT NULL, PRIMARY KEY (owner_id, device_id, nonce)
  ) WITHOUT ROWID;
  CREATE INDEX wecom_nonce_expiry ON wecom_nonces (accepted_at);
  CREATE TABLE wecom_status (
    owner_id TEXT NOT NULL, device_id TEXT NOT NULL, heartbeat_json TEXT,
    last_seen_at INTEGER NOT NULL, last_report_at INTEGER,
    PRIMARY KEY (owner_id, device_id)
  ) WITHOUT ROWID;
  PRAGMA user_version = 2;
`;

function unavailable(): never {
  throw new WecomError("storage_unavailable", 503);
}

function storageError(error: unknown): never {
  if (error instanceof WecomError) throw error;
  return unavailable();
}

function checkedTime(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000) {
    throw new WecomError("invalid_query");
  }
  return now;
}

function checkAccess(access: WecomAccess) {
  if (typeof access.ownerId !== "string" || !access.ownerId.length || access.ownerId.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(access.ownerId) ||
      typeof access.deviceId !== "string" || !DEVICE.test(access.deviceId)) {
    throw new WecomError("invalid_query");
  }
}

function iso(time: number) {
  return new Date(time).toISOString();
}

function timestampKey(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  const milliseconds = Date.parse(value);
  if (!match || !Number.isFinite(milliseconds) || iso(milliseconds).slice(0, 19) !== match[1]) unavailable();
  // Fixed-width UTC text preserves microseconds and lexical chronological order.
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}

function storedSortKey(value: unknown) {
  if (typeof value !== "string" || timestampKey(value) !== value) unavailable();
  return value;
}

function expiryBoundary(value: string) {
  // Receipt/read clocks use integer milliseconds; expire at the first clock tick
  // at or after the full-precision source instant, never the preceding tick.
  const subMillisecond = timestampKey(value).slice(23, 26) !== "000";
  return Date.parse(value) + Number(subMillisecond);
}

function stat(path: string) {
  try { return lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function own(statValue: NonNullable<ReturnType<typeof stat>>) {
  if (process.platform !== "win32" && typeof process.getuid === "function" && statValue.uid !== process.getuid()) unavailable();
}

function directories(path: string, create: boolean) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const segment of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, segment);
    let info = stat(current);
    if (!info) {
      if (!create) return false;
      try { mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      info = stat(current);
    }
    if (!info || info.isSymbolicLink() || !info.isDirectory()) unavailable();
  }
  const info = stat(absolute);
  if (!info) return false;
  own(info);
  if (create && process.platform !== "win32") chmodSync(absolute, 0o700);
  return true;
}

function inspectFiles(path: string, writer: boolean) {
  let total = 0;
  for (const suffix of FILE_SUFFIXES) {
    const info = stat(path + suffix);
    if (!info) continue;
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) unavailable();
    own(info);
    if (writer && process.platform !== "win32") chmodSync(path + suffix, 0o600);
    total += info.size;
  }
  return total;
}

function location(env: WecomEnv) {
  return resolve(getRuntimeDataPath(env, "wecom", "store.sqlite"));
}

function limitBytes(env: WecomEnv) {
  const value = env.WECOM_STORE_MAX_BYTES;
  if (value === undefined) return MAX_BYTES;
  if (!/^[1-9][0-9]*$/.test(value)) unavailable();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > MAX_BYTES) unavailable();
  return result;
}

function pragmaNumber(db: DatabaseSync, sql: string, field: string) {
  const result = db.prepare(sql).get()?.[field];
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) unavailable();
  return result;
}

function reserveCommit(db: DatabaseSync, path: string, maxBytes: number) {
  const pageSize = pragmaNumber(db, "PRAGMA page_size", "page_size");
  const pages = pragmaNumber(db, "PRAGMA page_count", "page_count");
  const walSize = stat(path + "-wal")?.size ?? 0;
  // With cache spilling disabled, reserve one WAL frame per possible dirty page,
  // plus the checkpointed DB and shared-memory index, before the durable commit.
  const walBound = walSize + 32 + pages * (pageSize + 24);
  const shmBound = Math.max(stat(path + "-shm")?.size ?? 0, Math.ceil(walBound / (pageSize + 24) / 4062) * 32768);
  const mainBound = Math.max(stat(path)?.size ?? 0, pages * pageSize);
  if (mainBound + walBound + shmBound > maxBytes || inspectFiles(path, true) > maxBytes) {
    throw new WecomError("disk_limit", 503);
  }
}

function parsed<T>(value: unknown): T {
  if (typeof value !== "string") unavailable();
  const result: unknown = JSON.parse(value);
  if (!result || typeof result !== "object" || Array.isArray(result)) unavailable();
  return result as T;
}

function storedPacket(value: unknown, type: ObjectType): WecomReport | WecomCaAlert {
  try {
    const payload = parsed<WecomReport | WecomCaAlert>(value);
    const packet = validateWecomPacket(type === "report"
      ? { schemaVersion: 2, type, report: payload }
      : { schemaVersion: 2, type, alert: payload });
    if (packet.type === "report") return packet.report;
    if (packet.type === "ca_alert") return packet.alert;
    return unavailable();
  } catch { return unavailable(); }
}

function closeDatabase(db: DatabaseSync, transaction: boolean) {
  let failed = false;
  try { if (transaction) db.exec("ROLLBACK"); } catch { failed = true; }
  try { db.close(); } catch { failed = true; }
  if (failed) unavailable();
}

function withReader<T>(options: ReadOptions, read: (db: DatabaseSync | null) => T): T {
  checkAccess(options);
  const path = location(options.env ?? process.env);
  let db: DatabaseSync | undefined;
  let transaction = false;
  try {
    if (!directories(dirname(path), false)) return read(null);
    inspectFiles(path, false);
    if (!stat(path)) return read(null);
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 250; PRAGMA query_only = ON; BEGIN;");
    transaction = true;
    if (pragmaNumber(db, "PRAGMA user_version", "user_version") !== STORE_VERSION) unavailable();
    return read(db);
  } catch (error) { return storageError(error); }
  finally {
    if (db) closeDatabase(db, transaction);
  }
}

function configured(options: ReadOptions) {
  const env = options.env ?? process.env;
  const device = env.WECOM_SYNC_DEVICE_ID?.trim();
  const secret = env.WECOM_SYNC_SECRET;
  return env.WECOM_SYNC_ENABLED === "true" && typeof device === "string" && DEVICE.test(device) &&
    device === options.deviceId && typeof secret === "string" && secret.length >= 32;
}

function statusFrom(db: DatabaseSync | null, options: ReadOptions, now: number): WecomSyncStatus {
  const row = db?.prepare("SELECT heartbeat_json, last_seen_at, last_report_at FROM wecom_status WHERE owner_id = ? AND device_id = ?")
    .get(options.ownerId, options.deviceId);
  let heartbeat = { ...UNKNOWN_HEARTBEAT };
  if (row?.heartbeat_json != null) {
    try {
      const packet = validateWecomPacket({ schemaVersion: 2, type: "heartbeat", status: parsed<WecomHeartbeat>(row.heartbeat_json) });
      if (packet.type !== "heartbeat") unavailable();
      heartbeat = packet.status;
    } catch { unavailable(); }
  }
  const lastSeen = row ? numeric(row.last_seen_at) : null;
  const lastReport = row?.last_report_at == null ? null : numeric(row.last_report_at);
  return {
    ...heartbeat, configured: configured(options),
    connection: lastSeen === null ? "waiting" : now - lastSeen >= 180000 ? "offline" : "online",
    lastSeenAt: lastSeen === null ? null : iso(lastSeen), lastReportAt: lastReport === null ? null : iso(lastReport),
  };
}

function numeric(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) unavailable();
  return value;
}

function summaryOf(report: WecomReport): Omit<WecomReportListItem, "syncedAt"> {
  let summary = report.summary.slice(0, 450);
  if (/[\ud800-\udbff]$/.test(summary)) summary = summary.slice(0, -1);
  return {
    id: report.id, cadence: report.cadence, windowStart: report.windowStart, windowEnd: report.windowEnd,
    generatedAt: report.generatedAt, summary, model: report.model, sourceCount: report.sourceCount,
    sourceComplete: report.sourceComplete, sourcesTruncated: report.sourcesTruncated,
  };
}

function reportListItem(row: Row): WecomReportListItem {
  const value = parsed<Omit<WecomReportListItem, "syncedAt">>(row.summary_json);
  const expected = "cadence,generatedAt,id,model,sourceComplete,sourceCount,sourcesTruncated,summary,windowEnd,windowStart";
  if (Object.keys(value).sort().join(",") !== expected || value.id !== row.id ||
      typeof value.id !== "string" || !ID.test(value.id) || !CADENCES.includes(value.cadence) ||
      typeof value.summary !== "string" || !value.summary.length || value.summary.length > 450 || !value.summary.isWellFormed() ||
      typeof value.model !== "string" || !value.model.length || value.model.length > 256 ||
      !Number.isSafeInteger(value.sourceCount) || value.sourceCount < 0 ||
      typeof value.sourceComplete !== "boolean" || value.sourcesTruncated !== (value.sourceCount > 0) ||
      [value.windowStart, value.windowEnd, value.generatedAt].some(time => typeof time !== "string" || !Number.isFinite(Date.parse(time))) ||
      timestampKey(value.windowStart) >= timestampKey(value.windowEnd) || timestampKey(value.windowEnd) !== row.sort_time) unavailable();
  return { ...value, syncedAt: iso(numeric(row.synced_at)) };
}

function checkCaRevision(previous: WecomCaAlert, next: WecomCaAlert) {
  const immutable = ["address", "network", "catchup", "notificationVersion"] as const;
  if (immutable.some(key => previous[key] !== next[key]) ||
      timestampKey(previous.triggeredAt) !== timestampKey(next.triggeredAt) ||
      timestampKey(next.evaluatedAt) < timestampKey(previous.evaluatedAt) ||
      (previous.status === "expired" && next.status === "active")) {
    throw new WecomError("revision_conflict", 409);
  }
  // A skipped active revision may contain the final snapshot we never received.
  if (next.status === "expired" && (previous.status === "expired" || next.revision === previous.revision + 1)) {
    const counts = ["groupCount", "mentionCount", "uniqueStatementCount", "duplicateCount"] as const;
    const times = ["firstSeenAt", "lastSeenAt", "expiresAt"] as const;
    if (counts.some(key => previous[key] !== next[key]) ||
        times.some(key => timestampKey(previous[key]) !== timestampKey(next[key])) ||
        JSON.stringify(previous.groups) !== JSON.stringify(next.groups)) {
      throw new WecomError("revision_conflict", 409);
    }
  }
}

function writeObject(db: DatabaseSync, packet: Exclude<WecomPacket, { type: "heartbeat" }>, options: IngestOptions, now: number): WecomAck {
  const object = packet.type === "report" ? packet.report : packet.alert;
  const hash = createHash("sha256").update(options.body).digest("hex");
  const previous = db.prepare("SELECT revision, body_hash, payload_json FROM wecom_objects WHERE owner_id = ? AND device_id = ? AND type = ? AND id = ?")
    .get(options.ownerId, options.deviceId, packet.type, object.id);
  let disposition: "stored" | "duplicate" | "stale" = "stored";
  if (previous) {
    const revision = numeric(previous.revision);
    if (object.revision < revision) disposition = "stale";
    else if (object.revision === revision) {
      if (hash !== previous.body_hash) throw new WecomError("revision_conflict", 409);
      disposition = "duplicate";
    } else if (packet.type === "ca_alert") {
      checkCaRevision(storedPacket(previous.payload_json, "ca_alert") as WecomCaAlert, packet.alert);
    }
  }
  if (disposition === "stored") {
    const report = packet.type === "report" ? packet.report : null;
    const alert = packet.type === "ca_alert" ? packet.alert : null;
    db.prepare(`INSERT INTO wecom_objects
      (owner_id, device_id, type, id, revision, body_hash, payload_json, summary_json, cadence,
       sort_time, active_status, expires_at, first_received_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner_id, device_id, type, id) DO UPDATE SET
        revision = excluded.revision, body_hash = excluded.body_hash, payload_json = excluded.payload_json,
        summary_json = excluded.summary_json, cadence = excluded.cadence, sort_time = excluded.sort_time,
        active_status = excluded.active_status, expires_at = excluded.expires_at, synced_at = excluded.synced_at`)
      .run(options.ownerId, options.deviceId, packet.type, object.id, object.revision, hash, JSON.stringify(object),
        report ? JSON.stringify(summaryOf(report)) : null, report?.cadence ?? null,
        timestampKey(report ? report.windowEnd : alert!.triggeredAt), alert?.status ?? null,
        alert ? expiryBoundary(alert.expiresAt) : null, now, now);
  }
  return { ok: true, id: object.id, revision: object.revision, disposition };
}

export function ingestWecomPacket(value: WecomPacket, options: IngestOptions): WecomAck {
  const packet = validateWecomPacket(value);
  checkAccess(options);
  const now = checkedTime(options.now);
  if (typeof options.nonce !== "string" || !/^[a-f0-9]{32}$/.test(options.nonce)) throw new WecomError("payload_invalid");
  if (!(options.body instanceof Uint8Array)) throw new WecomError("payload_invalid");
  if (options.body.byteLength > 262144) throw new WecomError("payload_too_large", 413);
  const env = options.env ?? process.env;
  let db: DatabaseSync | undefined;
  let transaction = false;
  try {
    const maxBytes = limitBytes(env);
    const path = location(env);
    // Do not create any storage when even an empty private database cannot fit.
    if (maxBytes < 131072 && !stat(path)) throw new WecomError("disk_limit", 503);
    directories(dirname(path), true);
    if (inspectFiles(path, true) >= maxBytes) throw new WecomError("disk_limit", 503);
    if (!stat(path)) {
      try {
        const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
        closeSync(fd);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    inspectFiles(path, true);
    db = new DatabaseSync(path);
    db.exec("PRAGMA busy_timeout = 250; PRAGMA cache_spill = OFF; PRAGMA wal_autocheckpoint = 0;");
    const journal = db.prepare("PRAGMA journal_mode = WAL").get();
    if (journal?.journal_mode !== "wal") unavailable();
    db.exec("PRAGMA synchronous = FULL; BEGIN IMMEDIATE;");
    transaction = true;
    const version = pragmaNumber(db, "PRAGMA user_version", "user_version");
    if (version === 0) {
      if (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' LIMIT 1").get()) unavailable();
      db.exec(SCHEMA);
    } else if (version !== STORE_VERSION) unavailable();
    db.prepare("DELETE FROM wecom_nonces WHERE accepted_at < ?").run(now - NONCE_RETENTION_MS);
    if (db.prepare("SELECT 1 FROM wecom_nonces WHERE owner_id = ? AND device_id = ? AND nonce = ?")
      .get(options.ownerId, options.deviceId, options.nonce)) throw new WecomError("replay", 409);
    db.prepare("INSERT INTO wecom_nonces (owner_id, device_id, nonce, accepted_at) VALUES (?, ?, ?, ?)")
      .run(options.ownerId, options.deviceId, options.nonce, now);
    const ack = packet.type === "heartbeat" ? { ok: true } as const : writeObject(db, packet, options, now);
    const reportAt = packet.type === "report" && "disposition" in ack && ack.disposition === "stored" ? now : null;
    db.prepare(`INSERT INTO wecom_status (owner_id, device_id, heartbeat_json, last_seen_at, last_report_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (owner_id, device_id) DO UPDATE SET
        heartbeat_json = CASE WHEN excluded.heartbeat_json IS NOT NULL AND excluded.last_seen_at >= wecom_status.last_seen_at
          THEN excluded.heartbeat_json ELSE wecom_status.heartbeat_json END,
        last_seen_at = MAX(wecom_status.last_seen_at, excluded.last_seen_at),
        last_report_at = CASE WHEN excluded.last_report_at IS NULL THEN wecom_status.last_report_at
          ELSE MAX(COALESCE(wecom_status.last_report_at, 0), excluded.last_report_at) END`)
      .run(options.ownerId, options.deviceId, packet.type === "heartbeat" ? JSON.stringify(packet.status) : null, now, reportAt);
    reserveCommit(db, path, maxBytes);
    db.exec("COMMIT");
    transaction = false;
    return ack;
  } catch (error) { return storageError(error); }
  finally {
    if (db) closeDatabase(db, transaction);
  }
}

function pageLimit(value: number | undefined, max: number) {
  if (value === undefined) return max;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new WecomError("invalid_query");
  return value;
}

function cursorContext(options: WecomAccess, type: ObjectType, filter: string) {
  return { v: 2 as const, ownerId: options.ownerId, deviceId: options.deviceId, type, filter };
}

function decodeCursor(before: string | undefined, context: ReturnType<typeof cursorContext>): Cursor | null {
  if (before === undefined) return null;
  try {
    if (typeof before !== "string" || before.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(before)) throw new Error();
    const bytes = Buffer.from(before, "base64url");
    if (bytes.toString("base64url") !== before) throw new Error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const cursor: unknown = JSON.parse(text);
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) throw new Error();
    const value = cursor as Cursor;
    const keys = Object.keys(value).sort().join(",");
    if (keys !== "deviceId,filter,id,ownerId,time,type,v" ||
        value.v !== context.v || value.ownerId !== context.ownerId || value.deviceId !== context.deviceId ||
        value.type !== context.type || value.filter !== context.filter ||
        typeof value.time !== "string" || storedSortKey(value.time) !== value.time ||
        typeof value.id !== "string" || !ID.test(value.id)) throw new Error();
    // Only the canonical encoding emitted here is accepted, including JSON keys.
    const canonical = { ...context, time: value.time, id: value.id };
    if (JSON.stringify(canonical) !== text) throw new Error();
    return value;
  } catch { throw new WecomError("invalid_query"); }
}

function nextCursor(rows: Row[], limit: number, context: ReturnType<typeof cursorContext>) {
  if (rows.length <= limit) return null;
  const last = rows[limit - 1];
  if (typeof last.id !== "string") unavailable();
  return Buffer.from(JSON.stringify({ ...context, time: storedSortKey(last.sort_time), id: last.id })).toString("base64url");
}

export function getWecomReports(options: ReportOptions): WecomReportList {
  const now = checkedTime(options.now);
  const limit = pageLimit(options.limit, 10);
  if (options.cadence !== undefined && !CADENCES.includes(options.cadence)) throw new WecomError("invalid_query");
  const context = cursorContext(options, "report", options.cadence ?? "all");
  const cursor = decodeCursor(options.before, context);
  return withReader(options, db => {
    const rows = db?.prepare(`SELECT id, sort_time, summary_json, synced_at FROM wecom_objects
      WHERE owner_id = ? AND device_id = ? AND type = 'report'
        AND (? IS NULL OR cadence = ?) AND (? IS NULL OR sort_time < ? OR (sort_time = ? AND id < ?))
      ORDER BY sort_time DESC, id DESC LIMIT ?`)
      .all(options.ownerId, options.deviceId, options.cadence ?? null, options.cadence ?? null,
        cursor?.time ?? null, cursor?.time ?? null, cursor?.time ?? null, cursor?.id ?? null, limit + 1) ?? [];
    return {
      items: rows.slice(0, limit).map(reportListItem),
      nextCursor: nextCursor(rows, limit, context), status: statusFrom(db, options, now),
    };
  });
}

export function getWecomReport(id: string, options: WecomAccess & { env?: WecomEnv }): WecomReportDetail | null {
  if (typeof id !== "string" || !ID.test(id)) throw new WecomError("invalid_query");
  return withReader(options, db => {
    const row = db?.prepare("SELECT payload_json, synced_at FROM wecom_objects WHERE owner_id = ? AND device_id = ? AND type = 'report' AND id = ?")
      .get(options.ownerId, options.deviceId, id);
    return row ? { report: storedPacket(row.payload_json, "report") as WecomReport, syncedAt: iso(numeric(row.synced_at)) } : null;
  });
}

function caItem(row: Row, now: number): WecomCaItem {
  const alert = storedPacket(row.payload_json, "ca_alert") as WecomCaAlert;
  const received = numeric(row.first_received_at);
  return {
    ...alert, firstReceivedAt: iso(received), syncedAt: iso(numeric(row.synced_at)),
    effectiveStatus: alert.status === "expired" || now >= expiryBoundary(alert.expiresAt) ? "expired" : "active",
    delayed: received - Date.parse(alert.triggeredAt) > 60000,
  };
}

export function getWecomCaAlerts(options: CaOptions): WecomCaList {
  const now = checkedTime(options.now);
  if (options.active !== undefined && typeof options.active !== "boolean") throw new WecomError("invalid_query");
  if (options.active && options.before !== undefined) throw new WecomError("invalid_query");
  const limit = pageLimit(options.limit, options.active ? 50 : 10);
  const context = cursorContext(options, "ca_alert", options.active ? "active" : "history");
  const cursor = decodeCursor(options.before, context);
  return withReader(options, db => {
    if (options.active) {
      const rows = db?.prepare(`SELECT payload_json, first_received_at, synced_at FROM wecom_objects
        WHERE owner_id = ? AND device_id = ? AND type = 'ca_alert' AND active_status = 'active' AND expires_at > ?
        ORDER BY sort_time DESC, id DESC LIMIT ?`).all(options.ownerId, options.deviceId, now, limit) ?? [];
      const total = db ? numeric(db.prepare(`SELECT COUNT(*) AS total FROM wecom_objects
        WHERE owner_id = ? AND device_id = ? AND type = 'ca_alert' AND active_status = 'active' AND expires_at > ?`)
        .get(options.ownerId, options.deviceId, now)?.total) : 0;
      return { items: rows.map(row => caItem(row, now)), nextCursor: null, status: statusFrom(db, options, now), total, truncated: rows.length < total };
    }
    const rows = db?.prepare(`SELECT id, sort_time, payload_json, first_received_at, synced_at FROM wecom_objects
      WHERE owner_id = ? AND device_id = ? AND type = 'ca_alert'
        AND (? IS NULL OR sort_time < ? OR (sort_time = ? AND id < ?))
      ORDER BY sort_time DESC, id DESC LIMIT ?`)
      .all(options.ownerId, options.deviceId, cursor?.time ?? null, cursor?.time ?? null, cursor?.time ?? null, cursor?.id ?? null, limit + 1) ?? [];
    return { items: rows.slice(0, limit).map(row => caItem(row, now)), nextCursor: nextCursor(rows, limit, context), status: statusFrom(db, options, now) };
  });
}

export function getWecomStatus(options: ReadOptions): WecomSyncStatus {
  const now = checkedTime(options.now);
  return withReader(options, db => statusFrom(db, options, now));
}
