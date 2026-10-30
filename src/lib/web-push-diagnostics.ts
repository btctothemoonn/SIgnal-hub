import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getDailyBriefDbPath } from "./daily-investment-brief.ts";
import { getWebPushConfig } from "./web-push-config.ts";
import type { EnvLike } from "./important-push-types.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

export type PushDiagnosticEvent = {
  sequence: number | null;
  source: string;
  stage: string;
  title: string;
  occurredAt: string | null;
  expiresAt: string | null;
};

export type PushDiagnosticDelivery = PushDiagnosticEvent & {
  kind: string;
  state: string;
  attempts: number;
  errorCode: string | null;
  epoch: number;
  createdAt: string | null;
};

export type PushDiagnostics = {
  generatedAt: string;
  configured: boolean;
  enabled: boolean;
  worker: { status: string; updatedAt: string | null; stale: boolean; errorCode: string | null; counts: Record<string, number> } | null;
  cursors: Record<string, number>;
  devices: Array<{
    epoch: number;
    enabled: boolean;
    enabledAt: string | null;
    baseline: { market: number | null; news: number | null; hynix: number | null };
  }>;
  outbox: PushDiagnosticEvent[];
  deliveries: PushDiagnosticDelivery[];
};

function text(value: unknown, limit = 80) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function eventSummary(raw: string, sequence: number | null): PushDiagnosticEvent | null {
  try {
    const event = JSON.parse(raw) as Record<string, unknown>;
    return {
      sequence,
      source: text(event.source, 24) || "unknown",
      stage: text(event.stage, 40),
      title: text(event.title, 80),
      occurredAt: text(event.occurredAt, 40) || null,
      expiresAt: text(event.expiresAt, 40) || null,
    };
  } catch {
    return null;
  }
}

function readDatabase<T>(path: string, read: (db: DatabaseSync) => T, fallback: T): T {
  if (!existsSync(path)) return fallback;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    return read(db);
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

function readOutbox(path: string, limit = 8): PushDiagnosticEvent[] {
  return readDatabase(path, (db) => {
    const rows = db.prepare("SELECT sequence, event_json FROM important_push_outbox ORDER BY sequence DESC LIMIT ?").all(limit) as Array<{ sequence: number; event_json: string }>;
    return rows.flatMap((row) => {
      const event = eventSummary(row.event_json, Number(row.sequence));
      return event ? [event] : [];
    });
  }, []);
}

export function readWebPushDiagnostics(env: EnvLike = process.env, now = new Date()): PushDiagnostics {
  const config = getWebPushConfig(env);
  const pushPath = getRuntimeDataPath(env, "web-push.sqlite");
  const marketPath = env.MARKET_ALERTS_DB?.trim() || getRuntimeDataPath(env, "market-alerts", "alerts.sqlite");
  const hynixPath = getRuntimeDataPath(env, "hynix-premium-push.sqlite");
  const stored = readDatabase(pushPath, (db) => {
    const healthRow = db.prepare("SELECT health_json FROM push_worker_health WHERE id=1").get() as { health_json: string } | undefined;
    const health = healthRow ? JSON.parse(healthRow.health_json) as { status?: string; updatedAt?: string; errorCode?: string | null; counts?: Record<string, number> } : null;
    const cursors: Record<string, number> = {};
    for (const row of db.prepare("SELECT source, sequence FROM push_cursors").all() as Array<{ source: string; sequence: number }>) {
      cursors[text(row.source, 24)] = Number(row.sequence);
    }
    const devices = (db.prepare("SELECT epoch, enabled, enabled_at, baseline_json FROM push_devices ORDER BY enabled_at DESC LIMIT 20").all() as Array<{ epoch: number; enabled: number; enabled_at: number; baseline_json: string }>).map((row) => {
      let baseline = { market: null as number | null, news: null as number | null, hynix: null as number | null };
      try {
        const parsed = JSON.parse(row.baseline_json) as { sources?: Record<string, unknown> };
        const sources = parsed.sources ?? {};
        const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
        baseline = { market: numberOrNull(sources.market), news: numberOrNull(sources.news), hynix: numberOrNull(sources.hynix) };
      } catch { /* ignore malformed baseline */ }
      return {
        epoch: Number(row.epoch),
        enabled: row.enabled === 1,
        enabledAt: Number.isFinite(row.enabled_at) ? new Date(row.enabled_at).toISOString() : null,
        baseline,
      };
    });
    const deliveries = (db.prepare("SELECT epoch, kind, state, attempts, error_code, created_at, event_json FROM push_deliveries ORDER BY id DESC LIMIT 12").all() as Array<{ epoch: number; kind: string; state: string; attempts: number; error_code: string | null; created_at: number; event_json: string }>).flatMap((row) => {
      const event = eventSummary(row.event_json, null);
      if (!event) return [];
      return [{
        ...event,
        kind: text(row.kind, 24),
        state: text(row.state, 24),
        attempts: Number(row.attempts) || 0,
        errorCode: row.error_code && /^[a-z0-9_]+$/i.test(row.error_code) ? row.error_code : null,
        epoch: Number(row.epoch),
        createdAt: Number.isFinite(row.created_at) ? new Date(row.created_at).toISOString() : null,
      }];
    });
    const updatedAt = health?.updatedAt && Number.isFinite(Date.parse(health.updatedAt)) ? health.updatedAt : null;
    const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    return {
      worker: health ? {
        status: text(health.status, 24) || "unknown",
        updatedAt,
        stale: !Number.isFinite(updatedMs) || now.getTime() - updatedMs > 30_000 || updatedMs > now.getTime() + 1000,
        errorCode: health.errorCode && /^push_[a-z0-9_]+$/i.test(health.errorCode) ? health.errorCode : null,
        counts: health.counts && typeof health.counts === "object" ? health.counts : {},
      } : null,
      cursors,
      devices,
      deliveries,
    };
  }, { worker: null, cursors: {}, devices: [], deliveries: [] });
  return {
    generatedAt: now.toISOString(),
    configured: config.configured,
    enabled: config.enabled,
    worker: stored.worker,
    cursors: stored.cursors,
    devices: stored.devices,
    outbox: [
      ...readOutbox(marketPath),
      ...readOutbox(getDailyBriefDbPath(env)),
      ...readOutbox(hynixPath),
    ].sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0)).slice(0, 12),
    deliveries: stored.deliveries,
  };
}
