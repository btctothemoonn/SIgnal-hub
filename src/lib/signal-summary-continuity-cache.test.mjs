import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAlphaSummaryPeriod, getOrCreateAlphaSummary } from "./alpha-summary.ts";
import { openTelegramPipelineDb, upsertTelegramPipelineChannel, upsertTelegramPipelineMessage } from "./telegram-pipeline-store.ts";
import { openXPipelineDb } from "./x-pipeline-store.ts";

// Catches dropping history/identity while reading SQLite, rolling a period, or retaining a failed result.
const directory = mkdtempSync(join(tmpdir(), "signal-continuity-"));
const originalFetch = globalThis.fetch;
const originalTelegramPath = process.env.TELEGRAM_PIPELINE_DB;
const originalXPath = process.env.X_PIPELINE_DB;
const env = {
  AI_SUMMARY_API_KEY: "fixture-key", AI_SUMMARY_BASE_URL: "https://continuity.fixture/v1", AI_SUMMARY_MODEL: "fixture-model",
  SIGNAL_SUMMARY_DB: join(directory, "summary.sqlite"), TELEGRAM_PIPELINE_DB: join(directory, "telegram.sqlite"), X_PIPELINE_DB: join(directory, "x.sqlite"),
};
process.env.TELEGRAM_PIPELINE_DB = env.TELEGRAM_PIPELINE_DB;
process.env.X_PIPELINE_DB = env.X_PIPELINE_DB;
const firstNow = new Date("2026-10-02T03:59:00.000Z");
const message = (id, createdAt, text) => ({
  channelRef: "research", channelTitle: "Research", channelUsername: "research", channelId: "100", channelLink: "https://t.me/research", channelAvatar: null,
  messageId: id, messageUrl: `https://t.me/research/${id}`, text, createdAt, views: 0, forwards: 0, origin: "realtime", media: null,
});
const card = {
  title: "Acme protocol testing", change: "Acme schedules protocol testing.", whyTrack: "Testing results can affect deployment.", evidenceType: "reported",
  watch: ["Protocol testing completes"], invalidate: ["Acme protocol testing is withdrawn"], sourceIds: ["telegram:100:1"],
};
let events = [card];
let fail = false;
let lastPrompt = "";
let calls = 0;
globalThis.fetch = async (_url, request) => {
  calls += 1;
  if (fail) throw new Error("fixture outage");
  lastPrompt = JSON.parse(request.body).messages[1].content;
  return Response.json({ choices: [{ message: { content: JSON.stringify({ headline: "Track protocol testing", stocks: [], crypto: [{ target: "Acme", opinions: [{ author: "Research", view: "Track protocol testing" }] }], events,
    eventHistory: [{ ...card, tracking: { id: "injected:history", state: "invalidated" } }],
  }) } }] });
};
function insert(item) {
  const db = openTelegramPipelineDb(env.TELEGRAM_PIPELINE_DB);
  upsertTelegramPipelineMessage(item, db);
  db.close();
}
try {
  const db = openTelegramPipelineDb(env.TELEGRAM_PIPELINE_DB);
  upsertTelegramPipelineChannel({ ref: "research", title: "Research", username: "research", channelId: "100", link: "https://t.me/research", avatar: null, avatarUpdatedAt: null }, db);
  db.close();
  openXPipelineDb(env.X_PIPELINE_DB).close();
  insert(message(1, "2026-10-02T03:00:00.000Z", "Acme protocol testing opens next week."));
  const first = await getOrCreateAlphaSummary({ now: firstNow, env, force: true });
  assert.equal(first.status, "generated");
  assert.equal(first.summary.events[0].tracking?.state, "new", "first successful generation must initialize server identity");
  const id = first.summary.events[0].tracking.id;
  assert.equal(first.summary.events[0].tracking.lastSeenAt, first.generatedAt);
  assert.equal(first.summary.eventHistory.length, 1);
  assert.equal(first.summary.eventHistory[0].tracking.id, id, "model history must be discarded");
  const read = await getOrCreateAlphaSummary({ now: firstNow, env });
  assert.deepEqual(read.summary, first.summary, "tracking and history must round trip through SQLite");
  assert.equal(calls, 1);

  const updateText = "Acme protocol testing completed stage two successfully.";
  insert(message(2, "2026-10-02T04:01:00.000Z", updateText));
  events = [{ ...card, title: "Acme protocol testing results", sourceIds: ["telegram:100:2"], previousEventId: id,
    tracking: { ...first.summary.events[0].tracking, id: "signal:12h:model_forgery", state: "new" },
    progressProof: { kind: "progress", sourceId: "telegram:100:2", quote: updateText, reason: "Stage two finished." },
  }];
  const nextNow = new Date("2026-10-02T04:02:00.000Z");
  const rollover = await getOrCreateAlphaSummary({ now: nextNow, env, force: true });
  assert.notEqual(rollover.period.key, first.period.key);
  assert.equal(rollover.summary.events[0].tracking.id, id);
  assert.equal(rollover.summary.events[0].tracking.state, "updated");
  assert.deepEqual(rollover.summary.events[0].sourceIds, ["telegram:100:2", "telegram:100:1"]);
  assert.match(lastPrompt, new RegExp(id));
  assert.equal("previousEventId" in rollover.summary.events[0], false);

  fail = true;
  const failed = await getOrCreateAlphaSummary({ now: nextNow, env, force: true });
  assert.equal(failed.status, "error");
  assert.deepEqual(failed.summary, rollover.summary);
  assert.equal(failed.generatedAt, rollover.generatedAt);
  assert.deepEqual(failed.coverage, rollover.coverage);
  const beforeBackoff = calls;
  const retained = await getOrCreateAlphaSummary({ now: nextNow, env });
  assert.equal(calls, beforeBackoff);
  assert.deepEqual(retained.summary, rollover.summary);

  fail = false;
  events = [];
  const omitted = await getOrCreateAlphaSummary({ now: nextNow, env, force: true });
  assert.equal(omitted.summary.events.length, 0);
  assert.equal(omitted.summary.eventHistory[0].tracking.id, id);
  assert.equal(omitted.summary.eventHistory[0].tracking.state, "updated", "selection omission cannot close an event");
  events = [{ ...card, sourceIds: ["telegram:100:2"] }];
  const reappeared = await getOrCreateAlphaSummary({ now: nextNow, env, force: true });
  assert.equal(reappeared.summary.events[0].tracking.id, id);
  assert.equal(reappeared.summary.events[0].tracking.state, "continuing");

  const separate = await getOrCreateAlphaSummary({ now: nextNow, env, scope: "today", force: true });
  assert.equal(separate.summary.events[0].tracking.state, "new");
  assert.notEqual(separate.summary.events[0].tracking.id, id);

  // Old versions refresh once; their source-bound cards become a seeded baseline.
  const cache = new DatabaseSync(env.SIGNAL_SUMMARY_DB);
  const row = cache.prepare("select period_json,summary_json from alpha_summary_cache where period_key = ?").get(reappeared.period.key);
  const oldPeriod = { ...JSON.parse(row.period_json), signalContentVersion: 1 };
  cache.prepare("update alpha_summary_cache set period_json = ? where period_key = ?").run(JSON.stringify(oldPeriod), reappeared.period.key);
  cache.close();
  const priorCalls = calls;
  const refreshed = await getOrCreateAlphaSummary({ now: nextNow, env });
  assert.equal(calls, priorCalls + 1);
  assert.equal(refreshed.summary.events[0].tracking.id, id);
  assert.equal(refreshed.summary.events[0].tracking.state, "continuing");
  assert.equal(getAlphaSummaryPeriod({ now: nextNow, audience: "stocks" }).signalContentVersion, undefined);

  // New display fields invalidate only reuse, not evidence or continuity baselines.
  const legacySummary = { ...refreshed.summary, authors: [], consensus: [], risks: [], watchlist: [] };
  delete legacySummary.stocks;
  delete legacySummary.crypto;
  const migrationDb = new DatabaseSync(env.SIGNAL_SUMMARY_DB);
  migrationDb.prepare("update alpha_summary_cache set summary_json = ? where period_key = ?").run(JSON.stringify(legacySummary), refreshed.period.key);
  migrationDb.close();
  fail = true;
  const callsBeforeMigration = calls;
  const migrationFailure = await getOrCreateAlphaSummary({ now: nextNow, env });
  assert.equal(migrationFailure.status, "error", "legacy successful content must be refreshed instead of being reused as a target summary");
  assert.equal(calls, callsBeforeMigration + 1);
  assert.equal(migrationFailure.summary.stocks, undefined, "a legacy fallback must not pretend the stock category was empty");
  assert.equal(migrationFailure.summary.crypto, undefined, "a legacy fallback must not pretend the crypto category was empty");
  assert.deepEqual(migrationFailure.summary.events, refreshed.summary.events);
  assert.deepEqual(migrationFailure.summary.eventHistory, refreshed.summary.eventHistory);
  assert.deepEqual(migrationFailure.coverage, refreshed.coverage);
  assert.equal(migrationFailure.generatedAt, refreshed.generatedAt);
  const callsBeforeMigrationBackoff = calls;
  const migrationBackoff = await getOrCreateAlphaSummary({ now: nextNow, env });
  assert.equal(migrationBackoff.status, "error");
  assert.equal(calls, callsBeforeMigrationBackoff, "a legacy fallback still needs failed-attempt backoff");
  const expiryDb = new DatabaseSync(env.SIGNAL_SUMMARY_DB);
  expiryDb.prepare("update alpha_summary_cache set last_attempt_at = ? where period_key = ?").run(
    new Date(nextNow.getTime() - 5 * 60_000 - 1).toISOString(), refreshed.period.key,
  );
  expiryDb.close();
  fail = false;
  const migrated = await getOrCreateAlphaSummary({ now: nextNow, env });
  assert.equal(migrated.status, "generated");
  assert.equal(calls, callsBeforeMigrationBackoff + 1);
  assert.match(lastPrompt, new RegExp(id));
  assert.equal(migrated.summary.events[0].tracking.id, id);
  assert.equal(migrated.summary.events[0].tracking.state, "continuing");
  assert.deepEqual(migrated.summary.crypto, [{ target: "Acme", opinions: [{ author: "Research", view: "Track protocol testing" }] }]);
  const callsBeforeMigratedRead = calls;
  await getOrCreateAlphaSummary({ now: nextNow, env });
  assert.equal(calls, callsBeforeMigratedRead, "the migrated target summary is reusable");

  const partialDb = new DatabaseSync(env.SIGNAL_SUMMARY_DB);
  const partialSummary = { ...migrated.summary };
  delete partialSummary.crypto;
  partialDb.prepare("update alpha_summary_cache set summary_json = ? where period_key = ?").run(JSON.stringify(partialSummary), migrated.period.key);
  partialDb.close();
  const callsBeforePartial = calls;
  const completeCategories = await getOrCreateAlphaSummary({ now: nextNow, env });
  assert.equal(completeCategories.status, "generated");
  assert.equal(calls, callsBeforePartial + 1, "a missing category must trigger refresh rather than be filled with an empty array");
  assert.equal(completeCategories.summary.events[0].tracking.id, id);
  console.log("ok - signal continuity SQLite, period/version rollover, failure retention and scope isolation");
} finally {
  globalThis.fetch = originalFetch;
  if (originalTelegramPath === undefined) delete process.env.TELEGRAM_PIPELINE_DB;
  else process.env.TELEGRAM_PIPELINE_DB = originalTelegramPath;
  if (originalXPath === undefined) delete process.env.X_PIPELINE_DB;
  else process.env.X_PIPELINE_DB = originalXPath;
  rmSync(directory, { recursive: true, force: true });
}
