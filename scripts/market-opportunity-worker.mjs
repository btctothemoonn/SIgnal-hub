import { getMarketAlertsConfig } from "../src/lib/market-alerts-config.ts";
import { runMarketOpportunityScan } from "../src/lib/market-opportunity-worker.ts";
import {
  installWorkerShutdown,
  loadWorkerEnv,
  logWorker,
  nextWorkerDelay,
  waitFor,
} from "./market-alerts-worker-runtime.mjs";

await loadWorkerEnv();
const controller = new AbortController();
installWorkerShutdown(controller, "market.opportunity");
const once = process.argv.includes("--once");
const config = getMarketAlertsConfig(process.env);

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

if (!config.enabled) {
  logWorker("market.opportunity.disabled");
  process.exit(0);
}

do {
  const cycleStartedAt = Date.now();
  try {
    logWorker("market.opportunity.start", { reason: once ? "once" : "interval" });
    const result = await runMarketOpportunityScan();
    logWorker("market.opportunity.done", {
      durationMs: Date.now() - cycleStartedAt,
      ...result,
    });
  } catch (error) {
    logWorker("market.opportunity.error", { error: safeError(error) });
    if (once) process.exitCode = 1;
  }
  if (!once && !controller.signal.aborted) {
    await waitFor(nextWorkerDelay(60_000, cycleStartedAt), controller.signal);
  }
} while (!once && !controller.signal.aborted);
