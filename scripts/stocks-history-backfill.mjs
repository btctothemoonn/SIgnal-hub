import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ALPHA_RESEARCH_POOL_TRACKING_START_DATE,
  ALPHA_RESEARCH_STOCK_UNIVERSE,
} from "../src/lib/alpha-research-pool.ts";
import { backfillStocksHistory } from "../src/lib/stocks-history-backfill.ts";

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

await loadEnvFile(resolve(process.cwd(), ".env.local"));
await loadEnvFile(resolve(process.cwd(), ".env"));

log("stocks_history.backfill.start", { tickers: ALPHA_RESEARCH_STOCK_UNIVERSE });
const results = await backfillStocksHistory({
  tickers: ALPHA_RESEARCH_STOCK_UNIVERSE,
  startDate: ALPHA_RESEARCH_POOL_TRACKING_START_DATE,
  env: process.env,
});
for (const result of results) log("stocks_history.backfill.result", result);

const succeeded = results.filter((result) => result.status === "success").length;
log("stocks_history.backfill.summary", {
  tickerCount: results.length,
  succeeded,
  failed: results.length - succeeded,
});

if (results.length > 0 && succeeded === 0) process.exitCode = 1;
