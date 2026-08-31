import { getMarketAlertsConfig } from "../src/lib/market-alerts-config.ts";
import { runVolatilityRestScan } from "../src/lib/market-alerts-binance.ts";
import { createMarketAlertDeliverer } from "../src/lib/market-alerts-delivery.ts";
import {
  installWorkerShutdown,
  loadWorkerEnv,
  logWorker,
  nextWorkerDelay,
  waitFor,
} from "./market-alerts-worker-runtime.mjs";

await loadWorkerEnv();
const controller = new AbortController();
installWorkerShutdown(controller, "market.volatility_rest");
const once = process.argv.includes("--once");
const config = getMarketAlertsConfig(process.env);
const deliverAlert = createMarketAlertDeliverer({ env: process.env });

async function run(reason) {
  const startedAt = Date.now();
  logWorker("market.volatility_rest.start", { reason });
  const result = await runVolatilityRestScan({ config, deliverAlert });
  logWorker("market.volatility_rest.done", {
    reason,
    durationMs: Date.now() - startedAt,
    ...result,
  });
}

if (!config.enabled) {
  logWorker("market.volatility_rest.disabled");
  process.exit(0);
}

do {
  const cycleStartedAt = Date.now();
  try {
    await run(once ? "once" : "interval");
  } catch (error) {
    logWorker("market.volatility_rest.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (once) process.exitCode = 1;
  }
  if (!once && !controller.signal.aborted) {
    await waitFor(nextWorkerDelay(config.restIntervalMs, cycleStartedAt), controller.signal);
  }
} while (!once && !controller.signal.aborted);
