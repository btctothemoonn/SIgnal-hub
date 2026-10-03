import { randomUUID } from 'node:crypto';
import { getWebPushConfig } from '../src/lib/web-push-config.ts';
import { openWebPushStore } from '../src/lib/web-push-store.ts';
import { openMarketAlertsStore } from '../src/lib/market-alerts-store.ts';
import { createWebPushSender } from '../src/lib/web-push-sender.ts';
import { createMarketPushSource, createNewsPushSource, runWebPushCycle } from '../src/lib/web-push-worker.ts';
import { loadWorkerEnv, installWorkerShutdown, waitFor, nextWorkerDelay, logWorker } from './market-alerts-worker-runtime.mjs';
await loadWorkerEnv();
const controller = new AbortController(); installWorkerShutdown(controller, 'web.push');
const once = process.argv.includes('--once'); const owner = randomUUID();
const config = getWebPushConfig(); const pushStore = openWebPushStore();
let market;
try {
  if (!config.enabled || !config.configured) {
    pushStore.setWorkerHealth({ status: config.enabled ? 'error' : 'disabled', updatedAt: new Date().toISOString(), errorCode: config.enabled ? config.errorCode : null, counts: pushStore.readDeliveryCounts() });
    logWorker(config.enabled ? 'web.push.not_configured' : 'web.push.disabled');
    if (!once) while (!controller.signal.aborted) { await waitFor(10000, controller.signal); pushStore.setWorkerHealth({ status: config.enabled ? 'error' : 'disabled', updatedAt: new Date().toISOString(), errorCode: config.enabled ? config.errorCode : null, counts: pushStore.readDeliveryCounts() }); }
  } else {
    market = openMarketAlertsStore();
    const marketSource = createMarketPushSource(market), newsSource = createNewsPushSource(); const sender = createWebPushSender(config);
    let nextNewsAt = 0;
    do {
      const nowMs = Date.now();
      try {
        const readNews = nowMs >= nextNewsAt; if (readNews) nextNewsAt = nowMs + 60000;
        const counts = await runWebPushCycle({ pushStore, marketSource, newsSource, sender, nowMs, now: Date.now, owner, readNews, signal: controller.signal });
        if (counts.marketSent || counts.newsSent || counts.failed) logWorker('web.push.cycle', counts);
      } catch {
        pushStore.setWorkerHealth({ status: 'error', updatedAt: new Date().toISOString(), errorCode: 'push_cycle_failed', counts: pushStore.readDeliveryCounts() }); logWorker('web.push.cycle_failed'); if (once) process.exitCode = 1;
      }
      if (!once && !controller.signal.aborted) await waitFor(nextWorkerDelay(5000, nowMs), controller.signal);
    } while (!once && !controller.signal.aborted);
  }
} finally { market?.close(); pushStore.close(); }
