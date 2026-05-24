import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getDouyinWorkerIntervalMs,
  refreshDouyinMonitor,
} from "../src/lib/douyin-monitor.ts";

let running = false;
let stopRequested = false;

function log(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

async function loadEnv() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));
}

function installShutdownHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopRequested = true;
      log("douyin.worker.stop", { signal });
      setTimeout(() => process.exit(0), 200).unref();
    });
  }
}

async function runRefresh(reason) {
  if (running) {
    log("douyin.refresh.skip", { reason, cause: "already_running" });
    return;
  }

  running = true;
  const startedAt = Date.now();
  try {
    log("douyin.refresh.start", { reason });
    const snapshot = await refreshDouyinMonitor({ env: process.env });
    log("douyin.refresh.done", {
      reason,
      durationMs: Date.now() - startedAt,
      status: snapshot.status,
      creators: snapshot.creators.length,
      videos: snapshot.videos.length,
      errors: snapshot.errors.length,
    });
  } catch (error) {
    log("douyin.refresh.error", {
      reason,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

await loadEnv();
installShutdownHandlers();

const once = process.argv.includes("--once");
await runRefresh("startup");

if (once) process.exit(0);

const intervalMs = getDouyinWorkerIntervalMs(process.env);
log("douyin.worker.ready", { intervalMs });

while (!stopRequested) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs));
  if (!stopRequested) {
    await runRefresh("interval");
  }
}
