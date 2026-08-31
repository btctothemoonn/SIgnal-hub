import { getMarketAlertsConfig } from "../src/lib/market-alerts-config.ts";
import { startVolatilityWebSocketWorker } from "../src/lib/market-alerts-binance.ts";
import { createMarketAlertDeliverer } from "../src/lib/market-alerts-delivery.ts";
import { writeMarketAlertKlineChart } from "../src/lib/market-alerts-chart.ts";
import {
  installWorkerShutdown,
  loadWorkerEnv,
  logWorker,
  waitFor,
} from "./market-alerts-worker-runtime.mjs";

await loadWorkerEnv();
const controller = new AbortController();
installWorkerShutdown(controller, "market.volatility_ws");
const once = process.argv.includes("--once");
const config = getMarketAlertsConfig(process.env);
const deliverAlert = createMarketAlertDeliverer({ env: process.env });

if (!config.enabled) {
  logWorker("market.volatility_ws.disabled");
  process.exit(0);
}

do {
  try {
    logWorker("market.volatility_ws.start", { once });
    const result = await startVolatilityWebSocketWorker({
      config,
      deliverAlert,
      writeChart: writeMarketAlertKlineChart,
      once,
      signal: controller.signal,
    });
    logWorker("market.volatility_ws.done", result);
  } catch (error) {
    logWorker("market.volatility_ws.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (once) process.exitCode = 1;
  }
  if (!once && !controller.signal.aborted) {
    await waitFor(3_000, controller.signal);
  }
} while (!once && !controller.signal.aborted);
