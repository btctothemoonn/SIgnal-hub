import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getCachedTigerHoldingData,
  invalidateCachedTigerHoldingData,
} from "../src/lib/tiger-holdings-cache.ts";

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

function intervalMs() {
  const configured = Number(process.env.TIGER_HOLDINGS_WORKER_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

function isOnceMode() {
  return process.argv.includes("--once");
}

async function refreshOnce() {
  invalidateCachedTigerHoldingData();
  const data = await getCachedTigerHoldingData({ force: true });
  const snapshot = data.snapshot;
  console.log(
    `[tiger-holdings] ${snapshot.updatedAt} positions=${snapshot.positions.length} market=${snapshot.reportedMarketValue} pnl=${snapshot.reportedPnl}`,
  );
}

async function main() {
  await loadEnv();

  if (isOnceMode()) {
    await refreshOnce();
    return;
  }

  const delay = intervalMs();
  console.log(`[tiger-holdings] worker started intervalMs=${delay}`);

  for (;;) {
    try {
      await refreshOnce();
    } catch (error) {
      console.error(
        "[tiger-holdings] refresh failed",
        error instanceof Error ? error.message : error,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
