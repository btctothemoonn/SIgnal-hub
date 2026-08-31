import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function logWorker(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

export async function loadWorkerEnv() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));
}

export function installWorkerShutdown(controller, name) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      logWorker(`${name}.stop`, { signal });
      controller.abort();
    });
  }
}

export function waitFor(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveWait) => {
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolveWait();
    };
    timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export function nextWorkerDelay(intervalMs, startedAt, finishedAt = Date.now()) {
  return Math.max(0, intervalMs - (finishedAt - startedAt));
}
