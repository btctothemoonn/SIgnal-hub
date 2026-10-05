import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initXPipelineDb } from './x-pipeline-store.ts';
import { runXOwnedReaderCycle } from './x-owned-reader-cycle.ts';
import { getXOwnedReaderConfig } from './x-owned-reader-config.ts';
import { initXOwnedReaderStateDb, pauseXOwnedReader } from './x-owned-reader-state.ts';
import {
  initX985AuditDb,
  prepare985AuditAccounts,
  complete985Audit,
  record985StreamState,
  get985Promotions,
  get985AuditSnapshot,
} from './x-985-audit.ts';

const base = Date.parse('2026-10-04T17:07:00Z');
const at = minute => base + minute * 60_000;
const iso = minute => new Date(at(minute)).toISOString();

function createStore(username = 'primary', legacy = false) {
  const db = new DatabaseSync(':memory:');
  initXPipelineDb(db);
  if (legacy) {
    // A pre-migration audit row proves past attempts, not continuous monitoring.
    db.exec(`create table x_985_audit_state (
      username_key text primary key, user_id text, last_attempt_at text,
      last_successful_check_at text, status text not null, reason text,
      checked_count integer not null default 0
    )`);
    db.prepare('insert into x_985_audit_state values(?,?,?,?,?,?,?)')
      .run(username, '321', iso(-90), iso(-90), 'verified', null, 20);
  }
  initX985AuditDb(db);
  record985StreamState('connected', db, at(-120));
  return { db, username };
}

function post(store, minute, id = '2106500000000000000') {
  return {
    id, username: store.username, displayName: store.username,
    text: 'independently verified full public post', createdAt: iso(minute),
    profileUrl: `https://x.com/${store.username}`, userAvatar: '',
    tweetUrl: `https://x.com/${store.username}/status/${id}`,
    hashtags: [], likes: 0, retweets: 0, replies: 0, quotes: 0, views: 0,
    media: [], quotedTweet: null, origin: 'watch', queryLabel: 'owned-reader / full',
    translation: null, contentSource: 'owned-reader', contentComplete: true,
  };
}

function check(store, minute, items = [], options = {}) {
  const { db, username } = store;
  prepare985AuditAccounts(options.configured ?? [username], [], db, at(minute));
  record985StreamState('heartbeat', db, at(minute));
  return complete985Audit({
    username, userId: '321', complete: options.complete ?? true,
    checkedAt: iso(minute), throughAt: iso(minute),
    reason: options.complete === false ? 'upstream_evidence_unavailable' : null,
  }, items, {
    healthy: options.healthy ?? true,
    monitored: options.monitored ?? [username], tweetIds: [],
  }, db, at(minute));
}

test('posts published before local follow cannot promote an author after two checks', () => {
  const store = createStore('_0xkenny');
  try {
    prepare985AuditAccounts([store.username], [], store.db, at(0));
    check(store, 0);
    const beforeFollow = post(store, -38);
    assert.deepEqual(check(store, 12, [beforeFollow]).promotedIds, []);
    assert.deepEqual(check(store, 22, [beforeFollow]).promotedIds, [],
      'a 16:29 public post predating the 17:07 local follow is not a 985 omission');
    assert.deepEqual(get985Promotions(store.db), []);
  } finally { store.db.close(); }
});

test('posts before the first healthy per-author 985 confirmation are not omissions', () => {
  const store = createStore();
  try {
    prepare985AuditAccounts([store.username], [], store.db, at(-60));
    const before985Confirmation = post(store, -10);
    assert.deepEqual(check(store, 0, [before985Confirmation]).promotedIds, []);
    assert.deepEqual(check(store, 10, [before985Confirmation]).promotedIds, [],
      'local follow and an old global SSE connection do not backdate per-author 985 coverage');
    assert.deepEqual(get985Promotions(store.db), []);
  } finally { store.db.close(); }
});

test('a new post after all monitoring baselines still requires two checks ten minutes apart', () => {
  const store = createStore();
  try {
    check(store, 0);
    const newPost = post(store, 1);
    assert.deepEqual(check(store, 11, [newPost]).promotedIds, []);
    assert.equal(get985AuditSnapshot(store.username, store.db).status, 'suspected_missing');
    assert.deepEqual(check(store, 16, [newPost]).promotedIds, [],
      'a repeat only five minutes after the first missing check cannot confirm');
    assert.deepEqual(check(store, 21, [newPost]).promotedIds, ['2106500000000000000']);
    assert.deepEqual(get985Promotions(store.db), ['primary']);
  } finally { store.db.close(); }
});

test('local removal and re-addition cannot promote a candidate from the earlier follow period', () => {
  const store = createStore();
  try {
    check(store, 0);
    const oldCandidate = post(store, 1);
    assert.deepEqual(check(store, 11, [oldCandidate]).promotedIds, []);
    assert.equal(get985AuditSnapshot(store.username, store.db).status, 'suspected_missing');
    prepare985AuditAccounts([], [], store.db, at(12));
    prepare985AuditAccounts([store.username], [], store.db, at(20));
    check(store, 20);
    assert.deepEqual(check(store, 31, [oldCandidate]).promotedIds, [],
      'an old first missing check cannot survive a local follow interruption');
    assert.deepEqual(check(store, 41, [oldCandidate]).promotedIds, []);
    assert.deepEqual(get985Promotions(store.db), []);
    const afterReAdd = post(store, 42, '2106500000000000001');
    assert.deepEqual(check(store, 52, [afterReAdd]).promotedIds, []);
    assert.deepEqual(check(store, 62, [afterReAdd]).promotedIds, ['2106500000000000001']);
  } finally { store.db.close(); }
});

for (const [name, interruption] of [
  ['985 unfollow and re-addition', { monitored: [] }],
  ['unavailable 985 evidence and recovery', { healthy: false, complete: false }],
]) {
  test(`${name} cannot reuse an earlier missing candidate`, () => {
    const store = createStore();
    try {
      check(store, 0);
      const oldCandidate = post(store, 1);
      assert.deepEqual(check(store, 11, [oldCandidate]).promotedIds, []);
      assert.equal(get985AuditSnapshot(store.username, store.db).status, 'suspected_missing');
      check(store, 12, [], interruption);
      check(store, 20);
      assert.deepEqual(check(store, 31, [oldCandidate]).promotedIds, [],
        'the first healthy observation after a coverage gap starts a new monitoring period');
      assert.deepEqual(check(store, 41, [oldCandidate]).promotedIds, []);
      assert.deepEqual(get985Promotions(store.db), []);
      const afterRecovery = post(store, 42, '2106500000000000001');
      assert.deepEqual(check(store, 52, [afterRecovery]).promotedIds, []);
      assert.deepEqual(check(store, 62, [afterRecovery]).promotedIds, ['2106500000000000001']);
    } finally { store.db.close(); }
  });
}

test('legacy audit rows and candidates cannot backdate a newly recorded monitoring baseline', () => {
  const store = createStore('primary', true);
  try {
    store.db.prepare('insert into x_985_audit_candidates values(?,?,?,?,?,?,?)')
      .run('2106500000000000000', store.username, iso(-10), iso(-5), iso(-5), 1, 'missing');
    prepare985AuditAccounts([store.username], [], store.db, at(0));
    check(store, 0);
    const oldPost = post(store, -10);
    assert.deepEqual(check(store, 11, [oldPost]).promotedIds, [],
      'a pre-migration checkpoint and candidate do not establish when the author became monitored');
    assert.deepEqual(check(store, 21, [oldPost]).promotedIds, []);
    assert.deepEqual(get985Promotions(store.db), []);
  } finally { store.db.close(); }
});

test('evidence observed while only author A is checked resets an absent author B monitoring period', () => {
  const authorA = createStore('authora');
  const authorB = { db: authorA.db, username: 'authorb' };
  const configured = ['authora', 'authorb'];
  const bothMonitored = { configured, monitored: ['authora', 'authorb'] };
  try {
    const firstBatch = prepare985AuditAccounts(configured, [], authorA.db, at(0), 1);
    assert.deepEqual(firstBatch.map(account => account.username), ['authora']);
    check(authorA, 0, [], bothMonitored);
    const oldCandidate = post(authorB, 1);
    assert.deepEqual(check(authorB, 11, [oldCandidate], bothMonitored).promotedIds, []);
    assert.equal(get985AuditSnapshot('authorb', authorA.db).status, 'suspected_missing');

    // B is not checked during this interval: A's existing evidence must update B.
    check(authorA, 12, [], { configured, monitored: ['authora'] });
    check(authorA, 20, [], bothMonitored);
    assert.deepEqual(check(authorB, 31, [oldCandidate], bothMonitored).promotedIds, [],
      'a 985 unfollow observed outside B\'s audit batch must invalidate B\'s earlier candidate');
    assert.deepEqual(check(authorB, 41, [oldCandidate], bothMonitored).promotedIds, []);
    assert.deepEqual(get985Promotions(authorA.db), []);

    const afterReAdd = post(authorB, 42, '2106500000000000001');
    assert.deepEqual(check(authorB, 52, [afterReAdd], bothMonitored).promotedIds, []);
    assert.deepEqual(check(authorB, 62, [afterReAdd], bothMonitored).promotedIds, ['2106500000000000001']);
  } finally { authorA.db.close(); }
});

test('a post exactly at the monitoring baseline is excluded until a later public post exists', () => {
  const store = createStore();
  try {
    check(store, 0);
    const atBaseline = post(store, 0);
    assert.deepEqual(check(store, 11, [atBaseline]).promotedIds, []);
    assert.deepEqual(check(store, 21, [atBaseline]).promotedIds, [],
      'publication must be strictly after the monitoring baseline');
    assert.deepEqual(get985Promotions(store.db), []);
  } finally { store.db.close(); }
});

for (const mode of ['paused', 'disabled']) {
  test(`a ${mode} worker records local removal before returning without collection`, async () => {
    const store = createStore();
    try {
      check(store, 0);
      const oldCandidate = post(store, 1);
      assert.deepEqual(check(store, 11, [oldCandidate]).promotedIds, []);
      assert.equal(get985AuditSnapshot(store.username, store.db).status, 'suspected_missing');
      initXOwnedReaderStateDb(store.db);
      if (mode === 'paused') pauseXOwnedReader('rate_limited', iso(20), store.db, at(12));
      const config = getXOwnedReaderConfig({
        X_OWNED_READER_ENABLED: mode === 'disabled' ? 'false' : 'true',
        X_985_AUDIT_ENABLED: 'true',
        X_OWNED_READER_USERNAMES: store.username,
        X_OWNED_READER_SESSION_DB: '/offline-unused/session.db',
        X_OWNED_READER_COOLDOWN_FILE: '/offline-unused/cooldown.json',
      });
      let bridgeCalls = 0;
      let providerCalls = 0;
      const cycle = await runXOwnedReaderCycle({
        accounts: [], config, db: store.db, nowMs: at(12), clock: () => at(12),
        bridgeRunner: async () => { bridgeCalls += 1; assert.fail('paused collection must not start a bridge'); },
        auditEvidenceProvider: async () => { providerCalls += 1; assert.fail('paused collection must not request evidence'); },
      });
      assert.equal(cycle.status, 'paused');
      assert.equal(cycle.reason, mode === 'paused' ? 'rate_limited' : 'disabled');
      assert.equal(bridgeCalls, 0);
      assert.equal(providerCalls, 0);

      check(store, 20);
      assert.deepEqual(check(store, 31, [oldCandidate]).promotedIds, [],
        'a local follow interruption must be recorded even while worker collection is paused');
      assert.deepEqual(check(store, 41, [oldCandidate]).promotedIds, []);
      assert.deepEqual(get985Promotions(store.db), []);
      const afterResume = post(store, 42, '2106500000000000001');
      assert.deepEqual(check(store, 52, [afterResume]).promotedIds, []);
      assert.deepEqual(check(store, 62, [afterResume]).promotedIds, ['2106500000000000001']);
    } finally { store.db.close(); }
  });
}
