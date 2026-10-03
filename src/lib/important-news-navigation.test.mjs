import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImportantNewsPushStore } from './important-news-push.ts';
import { getDailyInvestmentBriefForPush } from './daily-investment-brief.ts';
import { pushNow, pushNowMs } from './important-push-test-fixtures.mjs';
const db = new DatabaseSync(':memory:');
try {
  const news = createImportantNewsPushStore(db);
  const item = { rank: 1, importance: 'high', title: '已正式公布的重要政策', topic: '宏观 / 地缘政治 / 原油', sourceNames: ['Reuters'], sourceUrls: ['https://www.reuters.com/world/policy'], imageUrl: null,
    whatHappened: '正式政策', investmentImpact: '市场影响', watchNext: '执行',
    pushAssessment: { exceptional: true, category: '已公布的重大政策决定', fact: '事实', impact: '影响', candidateIndexes: [1] }, pushAssessedAt: pushNow,
    validatedSources: [{ sourceId: 'policy', canonicalUrl: 'https://www.reuters.com/world/policy', source: 'Reuters', publishedAt: pushNow, timeBasis: 'publication' }] };
  const snapshot = { success: true, status: 'generated', configured: true, generatedAt: pushNow, error: null, period: { dateKey: '2026-10-02', key: '2026-10-02', label: '10月2日' }, sourceCounts: {}, brief: { title: '原始简报', items: [item], marketPulse: '', priorityLine: '', watchVariables: [] } };
  const result = news.appendGeneratedBrief(snapshot, pushNowMs), event = result.events[0];
  assert.equal(new URL(event.target, 'https://signal.test').searchParams.get('push'), event.id, 'notification URL must identify its persisted edition');
  const original = news.readSnapshot(event.id);
  assert.equal(original.period.dateKey, '2026-10-02');
  assert.equal(original.brief.items[0].pushEventId, event.id);
  news.appendGeneratedBrief({ ...snapshot, generatedAt: new Date(pushNowMs + 1000).toISOString(), brief: { ...snapshot.brief, title: '已替换的最新简报', items: [] } }, pushNowMs + 1000);
  assert.equal(news.readSnapshot(event.id).brief.title, '原始简报', 'later edits or dated/latest brief replacement cannot erase the notification target');
  assert.equal(news.readSnapshot('news:' + '0'.repeat(32)), null);
  const dir = mkdtempSync(join(tmpdir(), 'news-push-route-'));
  try {
    const env = { DAILY_BRIEF_DB: join(dir, 'brief.sqlite') }, persisted = new DatabaseSync(env.DAILY_BRIEF_DB);
    try { createImportantNewsPushStore(persisted).appendGeneratedBrief(original, pushNowMs); } finally { persisted.close(); }
    const routeSnapshot = getDailyInvestmentBriefForPush(event.id, env);
    assert.equal(routeSnapshot.status, 'cached');
    assert.equal(routeSnapshot.period.dateKey, '2026-10-02');
    assert.equal(routeSnapshot.brief.items[0].pushEventId, event.id);
    assert.equal(getDailyInvestmentBriefForPush('malformed', env), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
} finally { db.close(); }
console.log('news notification retains its original dated edition');
