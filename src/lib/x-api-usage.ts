import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getXPipelineConfig } from "./x-pipeline-config.ts";

type EnvLike = Record<string, string | undefined>;

export type XApiUsageKind = "tweet_by_id" | "user_tweets";

export type XApiUsageSnapshot = {
  dateKey: string;
  timeZone: string;
  limit: number;
  pointsUsed: number;
  remaining: number;
  authorized: boolean;
  blocked: boolean;
  updatedAt: string | null;
  authorizedAt: string | null;
};

export type XApiUsageReservation = {
  allowed: boolean;
  kind: XApiUsageKind;
  points: number;
  snapshot: XApiUsageSnapshot;
  reason: string | null;
};

type DbRow = Record<string, unknown>;

const DEFAULT_DAILY_LIMIT = 500;
const DEFAULT_TIME_ZONE = "Asia/Shanghai";

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boolValue(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

export function getXApiUsageTimeZone(env: EnvLike = process.env): string {
  return env.X_API_USAGE_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
}

export function getXApiDailyPointLimit(env: EnvLike = process.env): number {
  return positiveInt(env.X_DAILY_POINT_LIMIT, DEFAULT_DAILY_LIMIT);
}

export function getXApiPointCost(
  kind: XApiUsageKind,
  env: EnvLike = process.env,
): number {
  if (kind === "user_tweets") {
    return positiveInt(env.X_USER_TWEETS_POINTS, 3);
  }
  return positiveInt(env.X_TWEET_BY_ID_POINTS, 1);
}

export function getXApiUsageDateKey(
  now = new Date(),
  env: EnvLike = process.env,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getXApiUsageTimeZone(env),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function openXApiUsageDb(path = getXPipelineConfig().dbPath): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal");
  db.exec("pragma synchronous = normal");
  db.exec("pragma busy_timeout = 5000");
  initXApiUsageDb(db);
  return db;
}

export function initXApiUsageDb(db: DatabaseSync) {
  db.exec(`
    create table if not exists x_api_usage_daily (
      date_key text primary key,
      time_zone text not null,
      points_used integer not null default 0,
      authorized integer not null default 0,
      authorized_at text,
      updated_at text not null
    );

    create table if not exists x_api_usage_events (
      id integer primary key autoincrement,
      date_key text not null,
      kind text not null,
      points integer not null,
      status text not null,
      detail text not null default '',
      created_at text not null
    );
  `);
}

function ensureDailyRow(
  db: DatabaseSync,
  dateKey: string,
  timeZone: string,
  now: Date,
) {
  initXApiUsageDb(db);
  db.prepare(
    `
    insert into x_api_usage_daily(date_key, time_zone, points_used, authorized, authorized_at, updated_at)
    values (?, ?, 0, 0, null, ?)
    on conflict(date_key) do nothing
  `,
  ).run(dateKey, timeZone, nowIso(now));
}

function snapshotFromRow(
  row: DbRow,
  env: EnvLike,
): XApiUsageSnapshot {
  const limit = getXApiDailyPointLimit(env);
  const pointsUsed = numberValue(row.points_used);
  const authorized = boolValue(row.authorized);
  return {
    dateKey: String(row.date_key || ""),
    timeZone: String(row.time_zone || getXApiUsageTimeZone(env)),
    limit,
    pointsUsed,
    remaining: Math.max(0, limit - pointsUsed),
    authorized,
    blocked: !authorized && pointsUsed >= limit,
    updatedAt: nullableString(row.updated_at),
    authorizedAt: nullableString(row.authorized_at),
  };
}

export function getXApiUsageSnapshot({
  db,
  env = process.env,
  now = new Date(),
}: {
  db?: DatabaseSync;
  env?: EnvLike;
  now?: Date;
} = {}): XApiUsageSnapshot {
  const ownedDb = db ?? openXApiUsageDb();
  try {
    const dateKey = getXApiUsageDateKey(now, env);
    const timeZone = getXApiUsageTimeZone(env);
    ensureDailyRow(ownedDb, dateKey, timeZone, now);
    const row = ownedDb
      .prepare("select * from x_api_usage_daily where date_key = ?")
      .get(dateKey) as DbRow;
    return snapshotFromRow(row, env);
  } finally {
    if (!db) ownedDb.close();
  }
}

export function authorizeXApiUsageToday({
  db,
  env = process.env,
  now = new Date(),
}: {
  db?: DatabaseSync;
  env?: EnvLike;
  now?: Date;
} = {}): XApiUsageSnapshot {
  const ownedDb = db ?? openXApiUsageDb();
  try {
    const dateKey = getXApiUsageDateKey(now, env);
    const timeZone = getXApiUsageTimeZone(env);
    ensureDailyRow(ownedDb, dateKey, timeZone, now);
    const at = nowIso(now);
    ownedDb
      .prepare(
        `
        update x_api_usage_daily
        set authorized = 1, authorized_at = ?, updated_at = ?
        where date_key = ?
      `,
      )
      .run(at, at, dateKey);
    const row = ownedDb
      .prepare("select * from x_api_usage_daily where date_key = ?")
      .get(dateKey) as DbRow;
    return snapshotFromRow(row, env);
  } finally {
    if (!db) ownedDb.close();
  }
}

export function reserveXApiPoints({
  db,
  env = process.env,
  now = new Date(),
  kind,
  points = getXApiPointCost(kind, env),
  detail = "",
}: {
  db?: DatabaseSync;
  env?: EnvLike;
  now?: Date;
  kind: XApiUsageKind;
  points?: number;
  detail?: string;
}): XApiUsageReservation {
  const ownedDb = db ?? openXApiUsageDb();
  try {
    const dateKey = getXApiUsageDateKey(now, env);
    const timeZone = getXApiUsageTimeZone(env);
    ensureDailyRow(ownedDb, dateKey, timeZone, now);
    const current = getXApiUsageSnapshot({ db: ownedDb, env, now });

    if (!current.authorized && current.pointsUsed + points > current.limit) {
      return {
        allowed: false,
        kind,
        points,
        snapshot: current,
        reason: `daily X API point limit reached (${current.pointsUsed}/${current.limit})`,
      };
    }

    const at = nowIso(now);
    ownedDb
      .prepare(
        `
        update x_api_usage_daily
        set points_used = points_used + ?, updated_at = ?
        where date_key = ?
      `,
      )
      .run(points, at, dateKey);
    ownedDb
      .prepare(
        `
        insert into x_api_usage_events(date_key, kind, points, status, detail, created_at)
        values (?, ?, ?, 'reserved', ?, ?)
      `,
      )
      .run(dateKey, kind, points, detail, at);

    return {
      allowed: true,
      kind,
      points,
      snapshot: getXApiUsageSnapshot({ db: ownedDb, env, now }),
      reason: null,
    };
  } finally {
    if (!db) ownedDb.close();
  }
}
