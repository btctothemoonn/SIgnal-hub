import type { DatabaseSync } from 'node:sqlite';
import { normalizeXOwnedUsername } from './x-owned-reader-config.ts';

export const X_985_FAILOVER_BATCH = 4;
const GRACE_MS = 10 * 60_000;
const HEARTBEAT_MS = 3 * 60_000;

function exists(db: DatabaseSync, name: string) {
  return Boolean(db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name));
}

export function record985FailoverStream(state: 'connected' | 'heartbeat' | 'disconnected', db: DatabaseSync, nowMs: number) {
  db.exec('create table if not exists x_985_failover_control (id integer primary key check(id=1), unavailable_since_at text)');
  if (state === 'disconnected') {
    const inferred = Date.parse(get985FailoverStatus(db,nowMs).unavailableSinceAt ?? '');
    const since = Number.isFinite(inferred) ? Math.min(nowMs,inferred) : nowMs;
    db.prepare(`insert into x_985_failover_control values(1,?) on conflict(id) do update
      set unavailable_since_at=coalesce(unavailable_since_at,excluded.unavailable_since_at)`)
      .run(new Date(since).toISOString());
  } else if (state === 'connected') {
    db.prepare('insert into x_985_failover_control values(1,null) on conflict(id) do update set unavailable_since_at=null').run();
  }
}

// Read-only: a quiet feed or an old error message alone cannot prove a transport outage.
export function get985FailoverStatus(db: DatabaseSync, nowMs: number) {
  const stream = exists(db,'x_985_stream') ? db.prepare('select * from x_985_stream where id=1').get() : undefined;
  const activity = Date.parse(String(stream?.last_activity_at ?? ''));
  const connected = Date.parse(String(stream?.connected_since_at ?? ''));
  if (Number.isFinite(connected) && activity >= connected && activity >= nowMs - HEARTBEAT_MS && activity <= nowMs + 60_000) {
    return { active:false, unavailableSinceAt:null as string | null };
  }
  const control = exists(db,'x_985_failover_control') ? db.prepare('select unavailable_since_at from x_985_failover_control where id=1').get() : undefined;
  const since = Number.isFinite(connected) && Number.isFinite(activity)
    ? activity + HEARTBEAT_MS : Date.parse(String(control?.unavailable_since_at ?? ''));
  return { active:Number.isFinite(since) && nowMs - since >= GRACE_MS,
    unavailableSinceAt:Number.isFinite(since) ? new Date(since).toISOString() : null };
}

export function select985FailoverAccounts(usernames: readonly string[], owned: readonly string[], db: DatabaseSync, nowMs: number) {
  db.exec('create table if not exists x_985_failover_turns(username_key text primary key,scheduled_at text not null)');
  const assigned = new Set(owned);
  const selected = [...new Set(usernames.map(normalizeXOwnedUsername).filter(Boolean))]
    .filter(name => !assigned.has(name))
    .map(name => ({ name, at:String(db.prepare('select scheduled_at from x_985_failover_turns where username_key=?').get(name)?.scheduled_at ?? '') }))
    .sort((a,b) => a.at.localeCompare(b.at) || a.name.localeCompare(b.name))
    .slice(0,X_985_FAILOVER_BATCH);
  const turn = db.prepare('insert into x_985_failover_turns values(?,?) on conflict(username_key) do update set scheduled_at=excluded.scheduled_at');
  for (const {name} of selected) turn.run(name,new Date(nowMs).toISOString());
  return selected.map(row=>row.name);
}
