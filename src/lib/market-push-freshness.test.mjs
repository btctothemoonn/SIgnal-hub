import assert from 'node:assert/strict';
import { enrichOpportunitySeeds } from './market-opportunity-enrichment.ts';
import { scoreSqueezeLong } from './market-opportunity-core.ts';
import { qualifyOpportunity, qualifySqueeze } from './important-push-policy.ts';
import { openMarketAlertsStore } from './market-alerts-store.ts';
import { createMarketPushSource } from './web-push-worker.ts';
import { pushNow, pushNowMs, squeezeMetrics } from './important-push-test-fixtures.mjs';

const rows = interval => Array.from({ length: interval === 300000 ? 288 : 30 }, (_, i) => {
  const count = interval === 300000 ? 288 : 30;
  const open = pushNowMs - (count - 1 - i) * interval;
  const price = i === count - 1 ? 106 : 100;
  return [open, String(price), '101', '99', String(price), i >= count - 3 ? '30' : '10', open + interval - 1, '1000'];
});
const oldAt = new Date(pushNowMs - 3600000).toISOString();
const seed = { symbol: 'TESTUSDT', price: 106, pct24h: 18, quoteVolume: 80000000,
  marketCapUsd: 120000000, fdvUsd: 140000000, latestEventAt: oldAt,
  maxLevel: 3, maxAbsChangePct: 10, maxVolumeRatio: 3, active: true,
  alertCounts: { pump: 3, crash: 0, squeeze: 3, total: 6 }, preliminaryScore: 90,
  squeezeMetrics: { ...squeezeMetrics(), observedAt: oldAt } };
const baseClient = { getKlines: async (_symbol, interval) => rows(interval === '1m' ? 60000 : 300000), getSpotContext: async () => null };
if (!process.argv.includes('--raw-only')) {
const [oldSeed] = await enrichOpportunitySeeds({ seeds: [seed], client: baseClient, getCached: () => null, nowMs: pushNowMs });
const oldDecision = scoreSqueezeLong(oldSeed.metrics);
assert.equal(oldSeed.metrics.funding, null, 'historical seed fields cannot replace missing current inputs');
assert.equal(qualifyOpportunity({ decision: oldDecision, enrichment: oldSeed, scanId: 'old-seed' }, pushNowMs).classification,
  'incomplete', 'an hour-old squeeze seed cannot replace current collection or push evidence');
const cached = await enrichOpportunitySeeds({ seeds: [seed], client: baseClient, getCached: () => oldSeed, nowMs: pushNowMs + 1000 });
assert.equal(qualifyOpportunity({ decision: scoreSqueezeLong(cached[0].metrics), enrichment: cached[0], scanId: 'cached-old' }, pushNowMs + 1000).classification, 'incomplete');
const freshSqueeze = { ...squeezeMetrics(), observedAt: pushNow,
  candleWindow: { openAt: pushNow, closeAt: new Date(pushNowMs + 299999).toISOString(), intervalMs: 300000, contiguous: true } };
const [freshSeed] = await enrichOpportunitySeeds({ seeds: [{ ...seed, squeezeMetrics: freshSqueeze }], client: baseClient, getCached: () => null, nowMs: pushNowMs });
assert.equal(qualifyOpportunity({ decision: scoreSqueezeLong(freshSeed.metrics), enrichment: freshSeed, scanId: 'fresh' }, pushNowMs).classification,
  'incomplete', 'even a fresh seed cannot replace unavailable current metrics');
const [network] = await enrichOpportunitySeeds({ seeds: [{ ...seed, squeezeMetrics: null }], getCached: () => null, nowMs: pushNowMs,
  client: { ...baseClient,
    getPremiumIndex: async () => [{ symbol: seed.symbol, time: pushNowMs, markPrice: '106', indexPrice: '107', lastFundingRate: '-0.0012' }],
    getOpenInterestHistory: async () => [
      { timestamp: pushNowMs, sumOpenInterestValue: '8000000' },
      { timestamp: pushNowMs + 60000, sumOpenInterestValue: '9000000' },
      { timestamp: pushNowMs - 900000, sumOpenInterestValue: '6000000' },
    ],
    getSqueezePositioning: async () => ({ global: { value: 0.72, observedAt: pushNow }, top: { value: 0.81, observedAt: pushNow }, taker: { value: 1.35, observedAt: pushNow } }),
  } });
assert.equal(network.metrics.pushEvidence.sourceTimes.funding, pushNow);
assert.equal(network.metrics.pushEvidence.sourceTimes.takerBuySellRatio, pushNow);
assert.equal(network.metrics.pushEvidence.sourceTimes.oiGrowth15m, pushNow,
  'push provenance must use the same sorted, non-future OI sample as scoring');
assert.equal(network.metrics.pushEvidence.sourceTimes.oiNotional, pushNow);
assert.equal(qualifyOpportunity({ decision: scoreSqueezeLong(network.metrics), enrichment: network, scanId: 'current-network' }, pushNowMs).classification, 'qualified');
const badNetwork = { ...network.metrics, pushEvidence: { ...network.metrics.pushEvidence, sourceTimes: { ...network.metrics.pushEvidence.sourceTimes, funding: oldAt } } };
assert.equal(qualifyOpportunity({ decision: scoreSqueezeLong(badNetwork), enrichment: network, scanId: 'old-premium' }, pushNowMs).classification, 'incomplete');
}

const candleWindow = { openAt: pushNow, closeAt: new Date(pushNowMs + 299999).toISOString(), intervalMs: 300000, contiguous: true };
const squeeze = extra => qualifySqueeze({ symbol: seed.symbol, metrics: squeezeMetrics(), minOiNotional: 2000000,
  observedAt: pushNow, fetchedAt: pushNow, scanId: 'raw', recovered: false, candleWindow, ...extra }, pushNowMs);
assert.equal(squeeze({ candleWindow: { ...candleWindow, openAt: oldAt, closeAt: new Date(pushNowMs - 3300001).toISOString() } }).classification,
  'incomplete', 'fresh premium/OI/positioning cannot hide hour-old price and volume candles');
assert.equal(squeeze({ candleWindow: undefined }).classification, 'incomplete');
assert.equal(squeeze({ candleWindow: { ...candleWindow, openAt: new Date(pushNowMs + 1).toISOString() } }).classification, 'incomplete');
assert.equal(squeeze({ candleWindow: { ...candleWindow, contiguous: false } }).classification, 'incomplete');
assert.equal(squeeze({}).classification, 'qualified', 'a current live interval is allowed without using its planned close as an observation');
const store = openMarketAlertsStore(':memory:');
try {
  store.commitSqueezePushScan({ pushObservations: [squeeze({})], scannedAt: pushNow });
  const episode = store.getMarketPushBaseline().episodes[0];
  const event = { source: 'market', episodeId: episode.episodeId, stage: 'squeeze_acceleration', expiresAt: new Date(pushNowMs + 120000).toISOString() };
  assert.equal(createMarketPushSource(store).revalidate(event, pushNowMs), true);
  const stale = squeeze({ candleWindow: { ...candleWindow, openAt: oldAt, closeAt: new Date(pushNowMs - 3300001).toISOString() } });
  // Simulate a persisted older producer claiming qualification: sender must check its evidence again.
  store.commitSqueezePushScan({ pushObservations: [{ ...stale, scanId: 'stale-persisted', classification: 'qualified' }], scannedAt: pushNow });
  assert.equal(createMarketPushSource(store).revalidate(event, pushNowMs), false);
} finally { store.close(); }
console.log('market push source freshness regressions passed');
