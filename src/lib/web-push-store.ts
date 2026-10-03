import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeDataPath } from './runtime-storage.ts';
import { decodePushKey, validatePushSubscription, type ValidatedPushSubscription } from './web-push-config.ts';
import type { MarketPushStage, PushEvent, SequencedPushEvent } from './important-push-types.ts';

export type DeviceBaseline = { sources: { market: number; news: number }; marketEpisodes: Array<{ episodeId: string; highestStage: MarketPushStage }>; enabledAt: string };
export type ClaimedDelivery = { deliveryId: number; deviceId: string; epoch: number; leaseOwner: string; subscription: ValidatedPushSubscription; event: PushEvent; attempts: number };
export type WorkerHealth = { status: 'disabled' | 'starting' | 'live' | 'error'; updatedAt: string; errorCode: string | null; counts: Record<string, number> };
type LeaseInput = { deliveryId: number; leaseOwner: string; epoch: number; nowMs: number };
type DeviceRow = { device_id: string; key_hash: string; endpoint: string; subscription_json: string; enabled: number; epoch: number; baseline_json: string; enabled_at: number };
type DeliveryRow = { id: number; device_id: string; epoch: number; event_json: string; attempts: number; subscription_json: string };
const stageRank = (stage: string) => stage === 'squeeze_acceleration' ? 2 : 1;
const keyHash = (key: string) => createHash('sha256').update(key).digest('hex');

export function openWebPushStore(path = getRuntimeDataPath(process.env, 'web-push.sqlite')) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS push_devices(device_id TEXT PRIMARY KEY,key_hash TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,subscription_json TEXT NOT NULL,enabled INTEGER NOT NULL,epoch INTEGER NOT NULL,baseline_json TEXT NOT NULL,enabled_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS push_cursors(source TEXT PRIMARY KEY,sequence INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS push_episode_stages(device_id TEXT NOT NULL,epoch INTEGER NOT NULL,episode_id TEXT NOT NULL,rank INTEGER NOT NULL,PRIMARY KEY(device_id,epoch,episode_id));
    CREATE TABLE IF NOT EXISTS push_deliveries(id INTEGER PRIMARY KEY AUTOINCREMENT,device_id TEXT NOT NULL,epoch INTEGER NOT NULL,event_id TEXT NOT NULL,episode_id TEXT NOT NULL,kind TEXT NOT NULL,rank INTEGER NOT NULL,event_json TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,next_attempt_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease_owner TEXT,lease_until INTEGER,error_code TEXT,UNIQUE(device_id,epoch,event_id));
    CREATE INDEX IF NOT EXISTS push_claim ON push_deliveries(kind,state,next_attempt_at,id);
    CREATE TABLE IF NOT EXISTS push_control_budget(key TEXT PRIMARY KEY,window_start INTEGER NOT NULL,count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS push_worker_health(id INTEGER PRIMARY KEY CHECK(id=1),health_json TEXT NOT NULL);`);
  function transaction<T>(fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function readDevice(id: string) { return db.prepare('SELECT * FROM push_devices WHERE device_id=?').get(id) as DeviceRow | undefined; }
  function proof(id: string, key: string) {
    const row = readDevice(id); if (!row || typeof key !== 'string') return null;
    const a = Buffer.from(row.key_hash, 'hex'); const b = Buffer.from(keyHash(key), 'hex');
    return timingSafeEqual(a, b) ? row : null;
  }
  function deactivate(row: DeviceRow, nowMs: number) {
    db.prepare('UPDATE push_devices SET enabled=0,epoch=epoch+1 WHERE device_id=? AND epoch=?').run(row.device_id, row.epoch);
    db.prepare("UPDATE push_deliveries SET state='expired',error_code='device_revoked',lease_owner=NULL,lease_until=NULL WHERE device_id=? AND epoch=? AND state IN ('pending','retry','sending')").run(row.device_id, row.epoch);
    void nowMs;
  }
  function leaseActive(input: LeaseInput) {
    return Boolean(db.prepare(`SELECT j.id FROM push_deliveries j JOIN push_devices d ON d.device_id=j.device_id
      WHERE j.id=? AND j.epoch=? AND j.lease_owner=? AND j.state='sending' AND j.lease_until>? AND j.expires_at>? AND d.enabled=1 AND d.epoch=j.epoch`).get(input.deliveryId, input.epoch, input.leaseOwner, input.nowMs, input.nowMs));
  }
  function complete(input: LeaseInput, state: string, errorCode: string | null, nextAttemptAt?: number) {
    return transaction(() => {
      if (!leaseActive(input)) return false;
      db.prepare('UPDATE push_deliveries SET state=?,error_code=?,next_attempt_at=COALESCE(?,next_attempt_at),lease_owner=NULL,lease_until=NULL WHERE id=?').run(state, errorCode, nextAttemptAt ?? null, input.deliveryId);
      return true;
    });
  }
  return {
    enrollDevice(input: { subscription: ValidatedPushSubscription; device: { deviceId: string; deviceKey: string }; baseline: DeviceBaseline; nowMs: number }) {
      const { deviceId, deviceKey } = input.device;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) throw new Error('invalid_device');
      decodePushKey(deviceKey, 32);
      const subscription = validatePushSubscription(input.subscription); const serialized = JSON.stringify(subscription);
      return transaction(() => {
        const existing = readDevice(deviceId);
        if (existing && !proof(deviceId, deviceKey)) throw new Error('device_conflict');
        const occupied = db.prepare('SELECT device_id FROM push_devices WHERE endpoint=?').get(subscription.endpoint) as { device_id: string } | undefined;
        if (occupied && occupied.device_id !== deviceId) throw new Error('device_conflict');
        if (existing?.enabled && existing.subscription_json === serialized) return { deviceId, deviceKey, epoch: existing.epoch };
        const epoch = (existing?.epoch ?? 0) + 1;
        if (existing) db.prepare("UPDATE push_deliveries SET state='expired',error_code='new_epoch' WHERE device_id=? AND state IN ('pending','retry','sending')").run(deviceId);
        db.prepare(`INSERT INTO push_devices VALUES(?,?,?,?,1,?,?,?) ON CONFLICT(device_id) DO UPDATE SET endpoint=excluded.endpoint,subscription_json=excluded.subscription_json,enabled=1,epoch=excluded.epoch,baseline_json=excluded.baseline_json,enabled_at=excluded.enabled_at`).run(deviceId, keyHash(deviceKey), subscription.endpoint, serialized, epoch, JSON.stringify(input.baseline), input.nowMs);
        for (const episode of input.baseline.marketEpisodes) db.prepare('INSERT INTO push_episode_stages VALUES(?,?,?,?)').run(deviceId, epoch, episode.episodeId, stageRank(episode.highestStage));
        return { deviceId, deviceKey, epoch };
      });
    },
    getDeviceStatus(id: string, key: string) { const row = proof(id, key); return row ? { enabled: Boolean(row.enabled), epoch: row.epoch } : null; },
    getSubscriptionForControl(id: string, key: string): ValidatedPushSubscription | null { const row = proof(id, key); return row?.enabled ? JSON.parse(row.subscription_json) : null; },
    revokeDevice(id: string, key: string, nowMs: number) { return transaction(() => { const row = proof(id, key); if (!row) return false; if (row.enabled) deactivate(row, nowMs); return true; }); },
    invalidateSubscription(input: { deviceId: string; epoch: number; nowMs: number }) { return transaction(() => { const row = readDevice(input.deviceId); if (!row?.enabled || row.epoch !== input.epoch) return false; deactivate(row, input.nowMs); return true; }); },
    readSourceCursor(source: 'market' | 'news') { return Number((db.prepare('SELECT sequence FROM push_cursors WHERE source=?').get(source) as { sequence: number } | undefined)?.sequence ?? 0); },
    ingestSourceEventsAndAdvanceCursor(source: 'market' | 'news', events: SequencedPushEvent[], expectedCursor: number, nowMs: number) {
      return transaction(() => {
        const cursor = Number((db.prepare('SELECT sequence FROM push_cursors WHERE source=?').get(source) as { sequence: number } | undefined)?.sequence ?? 0);
        if (cursor !== expectedCursor) return { cursor, enqueued: 0 };
        let latest = cursor, enqueued = 0;
        const devices = db.prepare('SELECT * FROM push_devices WHERE enabled=1').all() as DeviceRow[];
        for (const { sequence, event } of [...events].sort((a, b) => a.sequence - b.sequence)) {
          if (!Number.isSafeInteger(sequence) || sequence <= latest || event.source !== source) throw new Error('invalid_source_batch');
          const occurred = Date.parse(event.occurredAt), expires = Date.parse(event.expiresAt);
          if (!Number.isFinite(occurred) || !Number.isFinite(expires) || expires <= occurred || occurred > nowMs + 1000) throw new Error('invalid_event_time');
          latest = sequence;
          for (const device of devices) {
            const baseline = JSON.parse(device.baseline_json) as DeviceBaseline;
            if (sequence <= baseline.sources[source] || occurred < device.enabled_at || (source === 'news' && (!event.sourcePublishedAt || Date.parse(event.sourcePublishedAt) <= device.enabled_at))) continue;
            const rank = stageRank(event.stage);
            const previous = db.prepare('SELECT rank FROM push_episode_stages WHERE device_id=? AND epoch=? AND episode_id=?').get(device.device_id, device.epoch, event.episodeId) as { rank: number } | undefined;
            if (previous && previous.rank >= rank) continue;
            let notBefore = source === 'market' ? nowMs + 5000 : nowMs;
            if (source === 'market') {
              const pending = db.prepare("SELECT MIN(next_attempt_at) AS due FROM push_deliveries WHERE device_id=? AND epoch=? AND episode_id=? AND state IN ('pending','retry')").get(device.device_id, device.epoch, event.episodeId) as { due: number | null };
              if (pending.due != null) notBefore = pending.due;
              db.prepare("UPDATE push_deliveries SET state='expired',error_code='superseded' WHERE device_id=? AND epoch=? AND episode_id=? AND rank<? AND state IN ('pending','retry')").run(device.device_id, device.epoch, event.episodeId, rank);
            }
            db.prepare('INSERT INTO push_episode_stages VALUES(?,?,?,?) ON CONFLICT(device_id,epoch,episode_id) DO UPDATE SET rank=MAX(rank,excluded.rank)').run(device.device_id, device.epoch, event.episodeId, rank);
            const changes = db.prepare('INSERT OR IGNORE INTO push_deliveries(device_id,epoch,event_id,episode_id,kind,rank,event_json,state,created_at,expires_at,next_attempt_at,error_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(device.device_id, device.epoch, event.id, event.episodeId, source, rank, JSON.stringify(event), expires <= nowMs ? 'expired' : 'pending', nowMs, expires, notBefore, expires <= nowMs ? 'event_expired' : null).changes;
            if (expires > nowMs) enqueued += Number(changes);
          }
        }
        db.prepare('INSERT INTO push_cursors VALUES(?,?) ON CONFLICT(source) DO UPDATE SET sequence=excluded.sequence').run(source, latest);
        return { cursor: latest, enqueued };
      });
    },
    claimDeliveries(input: { kind: 'market' | 'news'; limit: number; leaseOwner: string; leaseMs: number; nowMs: number }): ClaimedDelivery[] {
      return transaction(() => {
        db.prepare("UPDATE push_deliveries SET state='expired',error_code='event_expired',lease_owner=NULL,lease_until=NULL WHERE state IN ('pending','retry','sending') AND expires_at<=?").run(input.nowMs);
        db.prepare("UPDATE push_deliveries SET state='retry',lease_owner=NULL,lease_until=NULL WHERE state='sending' AND lease_until<=?").run(input.nowMs);
        const active = Number((db.prepare("SELECT COUNT(*) AS n FROM push_deliveries WHERE kind=? AND state='sending' AND lease_until>?").get(input.kind, input.nowMs) as { n: number }).n);
        const available = Math.max(0, Math.min(input.limit, (input.kind === 'market' ? 3 : 1) - active));
        const rows = db.prepare(`SELECT j.*,d.subscription_json FROM push_deliveries j JOIN push_devices d ON d.device_id=j.device_id AND d.epoch=j.epoch AND d.enabled=1 WHERE j.kind=? AND j.state IN ('pending','retry') AND j.next_attempt_at<=? AND j.expires_at>? ORDER BY j.id LIMIT ?`).all(input.kind, input.nowMs, input.nowMs, available) as DeliveryRow[];
        return rows.map(row => {
          db.prepare("UPDATE push_deliveries SET state='sending',attempts=attempts+1,lease_owner=?,lease_until=? WHERE id=?").run(input.leaseOwner, input.nowMs + Math.min(30000, Math.max(1, input.leaseMs)), row.id);
          return { deliveryId: row.id, deviceId: row.device_id, epoch: row.epoch, leaseOwner: input.leaseOwner, subscription: JSON.parse(row.subscription_json), event: JSON.parse(row.event_json), attempts: row.attempts + 1 };
        });
      });
    },
    isDeliveryActive(input: LeaseInput & { deviceId: string }) { return readDevice(input.deviceId)?.epoch === input.epoch && leaseActive(input); },
    finishDelivery(input: LeaseInput) { return complete(input, 'sent', null); },
    retryDelivery(input: LeaseInput & { nextAttemptAt: number; errorCode: string }) { return complete(input, 'retry', input.errorCode, input.nextAttemptAt); },
    expireDelivery(input: LeaseInput & { reason: string }) { return complete(input, 'expired', input.reason); },
    consumeControlBudget(input: { key: string; limit: number; windowMs: number; nowMs: number }) {
      return transaction(() => {
        const old = db.prepare('SELECT window_start,count FROM push_control_budget WHERE key=?').get(input.key) as { window_start: number; count: number } | undefined;
        const same = old && input.nowMs >= old.window_start && input.nowMs < old.window_start + input.windowMs;
        if (same && old.count >= input.limit) return false;
        db.prepare('INSERT INTO push_control_budget VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=excluded.count').run(input.key, same ? old.window_start : input.nowMs, same ? old.count + 1 : 1); return true;
      });
    },
    readDeliveryCounts() { const result: Record<string, number> = { pending: 0, retry: 0, sending: 0, sent: 0, expired: 0 }; for (const row of db.prepare('SELECT state,COUNT(*) AS n FROM push_deliveries GROUP BY state').all() as Array<{ state: string; n: number }>) result[row.state] = row.n; return result; },
    setWorkerHealth(health: WorkerHealth) { db.prepare('INSERT INTO push_worker_health VALUES(1,?) ON CONFLICT(id) DO UPDATE SET health_json=excluded.health_json').run(JSON.stringify(health)); },
    readWorkerHealth(): WorkerHealth | null { const row = db.prepare('SELECT health_json FROM push_worker_health WHERE id=1').get() as { health_json: string } | undefined; return row ? JSON.parse(row.health_json) : null; },
    close() { db.close(); },
  };
}
export type WebPushStore = ReturnType<typeof openWebPushStore>;
