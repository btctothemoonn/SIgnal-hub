#!/usr/bin/env node
// Translation health check, run by signal-hub-translation-watch.timer (every 4h).
// Read-only: inspects worker state, the shared translation cooldown database and
// the workers' journal events. Prints one JSON line; exits 0 only when "ok", so a
// non-ok result shows up as a failed unit in `systemctl list-units --failed`.
//
// Covers every translating worker: monitor985 (X backfill), x-pipeline (6551
// async translation) and telegram. "deferred" texts are ones the model cannot
// translate usefully; they are in per-text backoff (src/lib/translate.ts) and are
// reported, not counted as fresh failures.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const WORKERS = {
  monitor985: "signal-hub-monitor985.service",
  x6551: "signal-hub-x-pipeline.service",
  telegram: "signal-hub-telegram.service",
};
const WINDOW = process.env.TRANSLATION_HEALTH_WINDOW?.trim() || "4 hours ago";
// With per-text backoff a hopeless text fails only a few times a day; this many
// failures in one window means something systematic (bad output, timeouts...).
const MAX_WINDOW_FAILURES = Number(process.env.TRANSLATION_HEALTH_MAX_FAILURES) || 60;

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function journalEvents(unit, since) {
  const events = [];
  for (const line of run("journalctl", ["-u", unit, "--since", since, "-o", "cat", "--no-pager"]).split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object") events.push(event);
    } catch {
      // Non-JSON log lines are ignored.
    }
  }
  return events;
}

function runtimeDir() {
  return process.env.SIGNAL_HUB_RUNTIME_DIR?.trim() || join(process.cwd(), ".signal-hub");
}

function readCooldowns(now) {
  const path = join(runtimeDir(), "translation-cooldown.sqlite");
  const result = { providerCooldownUntil: 0, deferredTexts: 0, repeatedlyFailingTexts: 0 };
  if (!existsSync(path)) return result;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const base = (process.env.AI_TRANSLATION_BASE_URL?.trim() || "https://api.minimaxi.com/v1").replace(/\/+$/, "");
    const key = process.env.AI_TRANSLATION_API_KEY?.trim() || process.env.MINIMAX_API_KEY?.trim() || "";
    const digest = createHash("sha256").update(JSON.stringify([base, key])).digest("hex");
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (tables.has("cooldown")) {
      result.providerCooldownUntil = Number(db.prepare("SELECT until_ms FROM cooldown WHERE key = ?").get(digest)?.until_ms ?? 0);
    }
    if (tables.has("text_failure")) {
      result.deferredTexts = Number(db.prepare("SELECT count(*) AS n FROM text_failure WHERE retry_at_ms > ?").get(now).n);
      result.repeatedlyFailingTexts = Number(db.prepare("SELECT count(*) AS n FROM text_failure WHERE failures >= 3").get().n);
    }
  } finally {
    db.close();
  }
  return result;
}

export function summarizeWorker(name, events) {
  const failures = {};
  let translated = 0;
  let backlog = null;
  for (const event of events) {
    if (event.event === "minimax_translation_failure") {
      const reason = String(event.failure || "unknown");
      failures[reason] = (failures[reason] || 0) + 1;
    }
    if (name === "monitor985" && event.event === "x_translation_backfill") {
      translated += Number(event.translated) || 0;
      backlog = Number(event.checked) || 0;
    }
    if (name === "x6551" && event.event === "x_6551_translation") translated += Number(event.translated) || 0;
    if (name === "telegram" && event.event === "telegram_translation_backfilled") translated += Number(event.translated) || 0;
  }
  const failed = Object.values(failures).reduce((sum, count) => sum + count, 0);
  return { translated, failed, failures, ...(backlog === null ? {} : { backlog }) };
}

export function check(now = Date.now()) {
  for (const [name, unit] of Object.entries(WORKERS)) {
    if (run("systemctl", ["show", "-p", "ActiveState", "--value", unit]) !== "active") {
      return { status: "worker_inactive", worker: name };
    }
  }
  if (!(process.env.AI_TRANSLATION_API_KEY?.trim() || process.env.MINIMAX_API_KEY?.trim())) {
    return { status: "key_missing" };
  }
  const cooldowns = readCooldowns(now);
  if (cooldowns.providerCooldownUntil > now + 5 * 60_000) {
    return { status: "long_cooldown", retry_at: Math.floor(cooldowns.providerCooldownUntil / 1000) };
  }

  // The 985 worker logs a backfill batch or catch-up heartbeat every minute.
  const recent985 = journalEvents(WORKERS.monitor985, "15 minutes ago");
  const alive = recent985.some((event) => event.event === "x_translation_backfill" || event.event === "monitor985_catchup");

  const workers = Object.fromEntries(Object.entries(WORKERS).map(([name, unit]) => [name, summarizeWorker(name, journalEvents(unit, WINDOW))]));
  const translated = Object.values(workers).reduce((sum, worker) => sum + worker.translated, 0);
  const failed = Object.values(workers).reduce((sum, worker) => sum + worker.failed, 0);

  let status = "ok";
  if (!alive) status = "no_worker_activity";
  else if (failed >= 10 && translated === 0) status = "failing_without_progress";
  else if (failed > MAX_WINDOW_FAILURES) status = "excessive_failures";

  return {
    status,
    window: WINDOW,
    translated,
    failed,
    deferredTexts: cooldowns.deferredTexts,
    repeatedlyFailingTexts: cooldowns.repeatedlyFailingTexts,
    workers,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let result;
  try {
    result = check();
  } catch (error) {
    result = { status: "check_failed", error_type: error instanceof Error ? error.name : typeof error, error: String(error).slice(0, 200) };
  }
  console.log(JSON.stringify(result));
  process.exitCode = result.status === "ok" ? 0 : 1;
}
