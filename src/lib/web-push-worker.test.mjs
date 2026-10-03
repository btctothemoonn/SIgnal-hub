import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { openWebPushStore } from './web-push-store.ts';
import { runWebPushCycle } from './web-push-worker.ts';
const nowMs = Date.parse('2026-10-02T02:00:00Z');
const ec = createECDH('prime256v1'); ec.generateKeys();
const keys = { p256dh: ec.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
const store = openWebPushStore(':memory:');
const device = store.enrollDevice({ subscription: { endpoint: 'https://fcm.googleapis.com/a', keys }, device: { deviceId: randomUUID(), deviceKey: randomBytes(32).toString('base64url') }, baseline: { sources: { market: 0, news: 0 }, marketEpisodes: [], enabledAt: new Date(nowMs - 1000).toISOString() }, nowMs: nowMs - 1000 });
const event = (id, source = 'market', extra = {}) => ({ id, source, episodeId: id, stage: source === 'market' ? 'confirmed' : 'exceptional_news', priority: source === 'market' ? 0 : 1, title: id, body: 'valid', target: '/alerts', occurredAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + 120000).toISOString(), sourcePublishedAt: source === 'news' ? new Date(nowMs).toISOString() : null, ruleVersion: 'v1', evidence: [], ...extra });
const source = events => ({ readAfter: seq => events.filter(row => row.sequence > seq), getBaseline: () => ({ lastSequence: events.length }), revalidate: () => true });
const market = Array.from({ length: 8 }, (_, i) => ({ sequence: i + 1, event: event('market-' + i) }));
const news = [{ sequence: 1, event: event('news', 'news') }];
const sent = [];
const sender = { send: async (_, payload) => { sent.push(payload); if (payload.source === 'market') await new Promise(resolve => setTimeout(resolve, 1)); return { kind: 'accepted', statusCode: 201, retryAfterMs: null, errorCode: null }; } };
try {
 await runWebPushCycle({ pushStore: store, marketSource: source(market), newsSource: source([]), sender, nowMs, now: () => nowMs, owner: 'one' });
 assert.equal(sent.length, 0);
 const result = await runWebPushCycle({ pushStore: store, marketSource: source(market), newsSource: source(news), sender, nowMs: nowMs + 5000, now: () => nowMs + 5000, owner: 'one' });
 assert.equal(result.marketSent, 3); assert.equal(result.newsSent, 1);
 assert.deepEqual(sent.map(x => x.source), ['market', 'market', 'market', 'news']);
 for (const offset of [10000, 15000]) await runWebPushCycle({ pushStore: store, marketSource: source(market), newsSource: source([]), sender, nowMs: nowMs + offset, now: () => nowMs + offset, owner: 'one' });
 assert.equal(sent.filter(x => x.source === 'market').length, 8, 'all eight delivered over successive claims');
 store.ingestSourceEventsAndAdvanceCursor('market', [{ sequence: 9, event: event('stale') }], 8, nowMs + 20000);
 const invalid = await runWebPushCycle({ pushStore: store, marketSource: { ...source([]), revalidate: () => false }, newsSource: source([]), sender, nowMs: nowMs + 25000, now: () => nowMs + 25000, owner: 'one' });
 assert.equal(invalid.expired, 1); assert.equal(sent.some(x => x.id === 'stale'), false);
 store.ingestSourceEventsAndAdvanceCursor('market', [{ sequence: 10, event: event('gone') }], 9, nowMs + 30000);
 await runWebPushCycle({ pushStore: store, marketSource: source([]), newsSource: source([]), sender: { send: async () => ({ kind: 'gone', statusCode: 410, retryAfterMs: null, errorCode: 'push_gone' }) }, nowMs: nowMs + 35000, now: () => nowMs + 35000, owner: 'one' });
 assert.equal(store.getDeviceStatus(device.deviceId, device.deviceKey).enabled, false);
} finally { store.close(); }
console.log('prioritized background push cycle tests passed');
const { openMarketAlertsStore } = await import('./market-alerts-store.ts');
const { createMarketPushSource } = await import('./web-push-worker.ts');
const { qualifyOpportunity } = await import('./important-push-policy.ts');
const { opportunityDecision, pushNow, pushNowMs } = await import('./important-push-test-fixtures.mjs');
const marketStore = openMarketAlertsStore(':memory:');
try {
 const observation = qualifyOpportunity({ decision: opportunityDecision(), enrichment: { fetchedAt: pushNow, stale: false, error: null }, scanId: 'baseline' }, pushNowMs);
 marketStore.commitOpportunityScan({ states: [], pushObservations: [observation], scannedAt: pushNow });
 const episode = marketStore.getMarketPushBaseline().episodes[0];
 const adapter = createMarketPushSource(marketStore);
 const candidate = event('real', 'market', { episodeId: episode.episodeId, occurredAt: pushNow, expiresAt: new Date(pushNowMs + 120000).toISOString() });
 assert.equal(adapter.revalidate(candidate, pushNowMs), true);
 assert.equal(adapter.revalidate(candidate, pushNowMs + 120001), false);
 marketStore.commitOpportunityScan({ states: [], pushObservations: [{ ...observation, scanId: 'missing', classification: 'incomplete' }], scannedAt: pushNow });
 assert.equal(adapter.revalidate(candidate, pushNowMs), false, 'latest missing input invalidates sending without ending episode');
} finally { marketStore.close(); }
const unhealthy = openWebPushStore(':memory:');
try {
 unhealthy.setWorkerHealth({ status: 'error', updatedAt: new Date(nowMs).toISOString(), errorCode: 'push_auth_failed', counts: {} });
 await runWebPushCycle({ pushStore: unhealthy, marketSource: source([]), newsSource: source([]), sender, nowMs, now: () => nowMs, owner: 'health' });
 assert.equal(unhealthy.readWorkerHealth().status, 'error', 'idle cycle must not hide an unresolved authentication failure');
} finally { unhealthy.close(); }
