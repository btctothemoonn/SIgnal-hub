import type { EnvLike, PushEvent, SequencedPushEvent } from './important-push-types.ts';
import { qualifyOpportunity, qualifySqueeze } from './important-push-policy.ts';
import { qualifyImportantNews } from './important-news-push.ts';
import { readDailyBriefPushEvidence, readDailyBriefPushOutboxAfter, getDailyBriefPushBaseline } from './daily-investment-brief.ts';
import type { openMarketAlertsStore } from './market-alerts-store.ts';
import type { WebPushSender } from './web-push-sender.ts';
import type { DeviceBaseline, WebPushStore } from './web-push-store.ts';
export type PushSourceAdapter = { readAfter(sequence: number, limit: number): SequencedPushEvent[]; getBaseline(): { lastSequence: number }; revalidate(event: PushEvent, nowMs: number): boolean };
export function createMarketPushSource(store: ReturnType<typeof openMarketAlertsStore>): PushSourceAdapter {
  return { readAfter: store.readMarketPushOutboxAfter, getBaseline: store.getMarketPushBaseline, revalidate(event, nowMs) {
    const episode = store.readMarketPushEpisode(event.episodeId);
    if (!episode || episode.endedAt || Date.parse(event.expiresAt) <= nowMs) return false;
    return Object.entries(episode.participants).some(([key, participant]) => {
      if (participant.ended) return false;
      const evaluation = store.readMarketPushEvaluation(episode.symbol, key);
      if (!evaluation || evaluation.direction !== episode.direction || evaluation.classification !== 'qualified') return false;
      const fresh = evaluation.producer === 'opportunity' && evaluation.opportunityDecision
        ? qualifyOpportunity({ decision: evaluation.opportunityDecision, enrichment: { fetchedAt: evaluation.fetchedAt, stale: false, error: null }, scanId: evaluation.scanId }, nowMs)
        : evaluation.producer === 'squeeze' && evaluation.squeezeMetrics && evaluation.minOiNotional != null
          ? qualifySqueeze({ symbol: evaluation.symbol, metrics: evaluation.squeezeMetrics, minOiNotional: evaluation.minOiNotional, observedAt: evaluation.observedAt, fetchedAt: evaluation.fetchedAt, scanId: evaluation.scanId, recovered: false, candleWindow: evaluation.candleWindow }, nowMs) : null;
      return fresh?.classification === 'qualified' && (event.stage !== 'squeeze_acceleration' || fresh.stage === 'squeeze_acceleration');
    });
  } };
}
export function createNewsPushSource(env: EnvLike = process.env): PushSourceAdapter {
  return { readAfter: (sequence, limit) => readDailyBriefPushOutboxAfter(sequence, limit, env), getBaseline: () => getDailyBriefPushBaseline(env), revalidate(event, nowMs) {
    const evidence = readDailyBriefPushEvidence(event.id, env);
    return Boolean(evidence && qualifyImportantNews(evidence, nowMs)?.id === event.id && Date.parse(event.expiresAt) > nowMs);
  } };
}
export function capturePushBaseline(market: ReturnType<typeof openMarketAlertsStore>, news: PushSourceAdapter, nowMs: number): DeviceBaseline {
  const baseline = market.getMarketPushBaseline();
  return { sources: { market: baseline.lastSequence, news: news.getBaseline().lastSequence }, marketEpisodes: baseline.episodes.map(episode => ({ episodeId: episode.episodeId, highestStage: episode.highestStage })), enabledAt: new Date(nowMs).toISOString() };
}
export async function runWebPushCycle(input: { pushStore: WebPushStore; marketSource: PushSourceAdapter; newsSource: PushSourceAdapter; sender: WebPushSender; nowMs: number; owner: string; readNews?: boolean; now?: () => number; random?: () => number; signal?: AbortSignal }) {
  const started = Date.now(); const now = input.now ?? (() => input.nowMs + Date.now() - started);
  const result = { marketSent: 0, newsSent: 0, expired: 0, failed: 0 };
  let errorCode: string | null = null;
  for (const kind of ['market', 'news'] as const) {
    if ((kind === 'news' && input.readNews === false) || input.signal?.aborted) continue;
    const adapter = kind === 'market' ? input.marketSource : input.newsSource;
    let cursor = input.pushStore.readSourceCursor(kind);
    while (!input.signal?.aborted) {
      const events = adapter.readAfter(cursor, 1000); if (!events.length) break;
      const update = input.pushStore.ingestSourceEventsAndAdvanceCursor(kind, events, cursor, now());
      if (update.cursor <= cursor) break; cursor = update.cursor;
      if (events.length < 1000) break;
    }
  }
  const jobs = input.signal?.aborted ? [] : [
    ...input.pushStore.claimDeliveries({ kind: 'market', limit: 3, leaseOwner: input.owner, leaseMs: 30000, nowMs: now() }),
    ...input.pushStore.claimDeliveries({ kind: 'news', limit: 1, leaseOwner: input.owner, leaseMs: 30000, nowMs: now() }),
  ];
  await Promise.all(jobs.map(async job => {
    const current = now(); const adapter = job.event.source === 'market' ? input.marketSource : input.newsSource;
    if (input.signal?.aborted || !input.pushStore.isDeliveryActive({ ...job, nowMs: current })) return;
    const ttlSeconds = Math.floor((Date.parse(job.event.expiresAt) - current) / 1000);
    if (ttlSeconds <= 0 || !adapter.revalidate(job.event, current)) {
      if (input.pushStore.expireDelivery({ ...job, nowMs: current, reason: 'source_no_longer_qualified' })) result.expired++; return;
    }
    if (!input.pushStore.isDeliveryActive({ ...job, nowMs: now() })) return;
    const remainingMs = Date.parse(job.event.expiresAt) - now();
    const sent = await input.sender.send(job.subscription, job.event, { ttlSeconds, urgency: job.event.source === 'market' ? 'high' : 'normal', timeoutMs: 10000, expiresAtMs: Date.now() + remainingMs, signal: input.signal });
    const finished = now();
    if (sent.kind === 'accepted') {
      if (input.pushStore.finishDelivery({ ...job, nowMs: finished })) { if (job.event.source === 'market') result.marketSent++; else result.newsSent++; }
    } else if (sent.kind === 'gone') {
      input.pushStore.invalidateSubscription({ deviceId: job.deviceId, epoch: job.epoch, nowMs: finished }); result.failed++;
    } else if (sent.kind === 'retry') {
      const delay = sent.retryAfterMs ?? [5000, 15000, 30000][Math.min(job.attempts - 1, 2)];
      const nextAttemptAt = finished + Math.max(1000, delay) + Math.floor((input.random ?? Math.random)() * 500);
      if (nextAttemptAt >= Date.parse(job.event.expiresAt) - 1000) { input.pushStore.expireDelivery({ ...job, nowMs: finished, reason: 'retry_after_expiry' }); result.expired++; }
      else input.pushStore.retryDelivery({ ...job, nowMs: finished, nextAttemptAt, errorCode: sent.errorCode ?? 'push_retry' }); result.failed++;
    } else {
      input.pushStore.expireDelivery({ ...job, nowMs: finished, reason: sent.errorCode ?? 'push_rejected' }); result.failed++;
      if (sent.errorCode === 'push_auth_failed' || sent.errorCode === 'push_not_configured') errorCode = sent.errorCode;
    }
  }));
  const previousError = input.pushStore.readWorkerHealth()?.errorCode;
  if (!errorCode && previousError === 'push_auth_failed' && result.marketSent + result.newsSent === 0) errorCode = previousError;
  input.pushStore.setWorkerHealth({ status: errorCode ? 'error' : 'live', updatedAt: new Date(now()).toISOString(), errorCode, counts: input.pushStore.readDeliveryCounts() });
  return result;
}
