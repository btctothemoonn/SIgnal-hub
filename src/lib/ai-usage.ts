import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getRuntimeDataPath } from "./runtime-storage.ts";

type EnvLike = Record<string, string | undefined>;

export type AiUsageSummary = {
  windowDays: number;
  generatedAt: string;
  totals: { calls: number; errors: number };
  byDay: Array<{ day: string; calls: number; errors: number }>;
  byProvider: Array<{ providerId: string; model: string; calls: number; errors: number }>;
};

const WINDOW_DAYS = 7;
const RETENTION_DAYS = 8;

function dayKey(atMs: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atMs));
}

function usagePath(env: EnvLike) {
  return getRuntimeDataPath(env, "ai-usage.sqlite");
}

function openUsageDb(env: EnvLike) {
  const path = usagePath(env);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS ai_usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at_ms INTEGER NOT NULL,
    day TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    ok INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage_events(day);`);
  return db;
}

export function recordAiProviderAttempt(input: {
  providerId: string;
  model: string;
  ok: boolean;
  atMs?: number;
  env?: EnvLike;
}) {
  const providerId = input.providerId.replace(/[^\w.-]/g, "").slice(0, 40) || "unknown";
  const model = input.model.replace(/[^\w.+-]/g, "").slice(0, 80) || "unknown";
  const atMs = input.atMs ?? Date.now();
  const db = openUsageDb(input.env ?? process.env);
  try {
    db.prepare("INSERT INTO ai_usage_events(at_ms, day, provider_id, model, ok) VALUES (?,?,?,?,?)")
      .run(atMs, dayKey(atMs), providerId, model, input.ok ? 1 : 0);
    const cutoff = dayKey(atMs - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    db.prepare("DELETE FROM ai_usage_events WHERE day < ?").run(cutoff);
  } finally {
    db.close();
  }
}

export function readAiUsageSummary(env: EnvLike = process.env, nowMs = Date.now()): AiUsageSummary {
  const db = openUsageDb(env);
  try {
    const start = dayKey(nowMs - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
    const rows = db.prepare(`SELECT day, provider_id, model,
      SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS calls,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors
      FROM ai_usage_events WHERE day >= ? GROUP BY day, provider_id, model ORDER BY day, provider_id, model`).all(start) as Array<{ day: string; provider_id: string; model: string; calls: number; errors: number }>;
    const byDay = new Map<string, { day: string; calls: number; errors: number }>();
    const byProvider = new Map<string, { providerId: string; model: string; calls: number; errors: number }>();
    let calls = 0;
    let errors = 0;
    for (const row of rows) {
      const rowCalls = Number(row.calls) || 0;
      const rowErrors = Number(row.errors) || 0;
      calls += rowCalls;
      errors += rowErrors;
      const day = byDay.get(row.day) ?? { day: row.day, calls: 0, errors: 0 };
      day.calls += rowCalls;
      day.errors += rowErrors;
      byDay.set(row.day, day);
      const key = `${row.provider_id}\n${row.model}`;
      const provider = byProvider.get(key) ?? { providerId: row.provider_id, model: row.model, calls: 0, errors: 0 };
      provider.calls += rowCalls;
      provider.errors += rowErrors;
      byProvider.set(key, provider);
    }
    return {
      windowDays: WINDOW_DAYS,
      generatedAt: new Date(nowMs).toISOString(),
      totals: { calls, errors },
      byDay: [...byDay.values()],
      byProvider: [...byProvider.values()],
    };
  } finally {
    db.close();
  }
}
