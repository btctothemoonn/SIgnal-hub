import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getOpportunityWorkerIntervalMs,
  runOpportunityCycle,
} from "../src/lib/opportunity-worker.ts";

let running = false;
let stopRequested = false;
let wakeSleep = null;

function log(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

function errorClass(error) {
  return error instanceof Error && error.name ? error.name : "Error";
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
      const value = trimmed
        .slice(eqIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

async function loadEnv() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));
}

async function runCycle(reason) {
  if (running) {
    log("opportunity.cycle.skip", { reason, cause: "already_running" });
    return true;
  }

  running = true;
  const startedAt = Date.now();
  try {
    log("opportunity.cycle.start", { reason });
    const result = await runOpportunityCycle();
    log("opportunity.cycle.done", {
      reason,
      durationMs: Date.now() - startedAt,
      candidates: result.candidateCount,
      evaluated: result.evaluatedCount,
      selected: result.selectedToday,
      provider: result.provider,
      model: result.model,
      errorClass: result.lastError,
    });
    return true;
  } catch (error) {
    log("opportunity.cycle.error", {
      reason,
      durationMs: Date.now() - startedAt,
      errorClass: errorClass(error),
    });
    return false;
  } finally {
    running = false;
  }
}

function installShutdownHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopRequested = true;
      log("opportunity.worker.stop", { signal });
      wakeSleep?.();
    });
  }
}

function sleepUntilNextCycle(intervalMs) {
  return new Promise((resolveSleep) => {
    const timer = setTimeout(() => {
      wakeSleep = null;
      resolveSleep();
    }, intervalMs);
    wakeSleep = () => {
      clearTimeout(timer);
      wakeSleep = null;
      resolveSleep();
    };
  });
}

await loadEnv();
installShutdownHandlers();

const once = process.argv.includes("--once");
const startupSucceeded = await runCycle("startup");

if (once) {
  if (!startupSucceeded) process.exitCode = 1;
} else {
  const intervalMs = getOpportunityWorkerIntervalMs(process.env);
  log("opportunity.worker.ready", { intervalMs });
  while (!stopRequested) {
    await sleepUntilNextCycle(intervalMs);
    if (!stopRequested) await runCycle("interval");
  }
}
