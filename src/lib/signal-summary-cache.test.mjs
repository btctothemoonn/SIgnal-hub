import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAlphaSummaryPeriod, getOrCreateAlphaSummary } from "./alpha-summary.ts";
import { openTelegramPipelineDb, upsertTelegramPipelineChannel, upsertTelegramPipelineMessage } from "./telegram-pipeline-store.ts";
import { openXPipelineDb } from "./x-pipeline-store.ts";

// Catches replacing successful-result metadata with a failed attempt's metadata.
const directory = mkdtempSync(join(tmpdir(), "signal-summary-cache-"));
const originalFetch = globalThis.fetch;
const originalTelegramPath = process.env.TELEGRAM_PIPELINE_DB;
const originalXPath = process.env.X_PIPELINE_DB;
const now = new Date("2026-10-02T04:00:00.000Z");
const env = {
  AI_SUMMARY_API_KEY: "fixture-key",
  AI_SUMMARY_BASE_URL: "https://signal-summary.fixture/v1",
  AI_SUMMARY_MODEL: "fixture-model",
  SIGNAL_SUMMARY_DB: join(directory, "summaries.sqlite"),
  TELEGRAM_PIPELINE_DB: join(directory, "telegram.sqlite"),
  X_PIPELINE_DB: join(directory, "x.sqlite"),
};
process.env.TELEGRAM_PIPELINE_DB = env.TELEGRAM_PIPELINE_DB;
process.env.X_PIPELINE_DB = env.X_PIPELINE_DB;
let calls = 0;
let mode = "success";
const message = (id) => ({
  channelRef: "research", channelTitle: "Research", channelUsername: "research",
  channelId: "100", channelLink: "https://t.me/research", channelAvatar: null,
  messageId: id, messageUrl: `https://t.me/research/${id}`,
  text: `Project ${id} announces a new protocol release with documented testing milestones.`,
  createdAt: `2026-10-02T03:0${id}:00.000Z`, views: 0, forwards: 0,
  origin: "realtime", media: null,
});
const summary = {
  headline: "A protocol release deserves follow-up",
  stocks: [],
  crypto: [{ target: "Protocol", opinions: [{ author: "Research", view: "The testing milestone deserves follow-up" }] }],
  events: [{
    title: "Protocol release", change: "A release was announced",
    whyTrack: "The testing milestone is observable", evidenceType: "reported",
    watch: ["Check published test results"], invalidate: ["Release is withdrawn"],
    sourceIds: ["telegram:100:1"],
  }],
};
globalThis.fetch = async () => {
  calls += 1;
  if (mode === "failure") throw new Error("fixture provider timeout");
  const content = mode === "unsupported"
    ? { ...summary, events: [{ ...summary.events[0], sourceIds: ["x:invented"] }] }
    : summary;
  return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
};
try {
  const telegram = openTelegramPipelineDb(env.TELEGRAM_PIPELINE_DB);
  upsertTelegramPipelineChannel({ ref: "research", title: "Research", username: "research", channelId: "100", link: "https://t.me/research", avatar: null, avatarUpdatedAt: null }, telegram);
  upsertTelegramPipelineMessage(message(1), telegram);
  telegram.close();
  openXPipelineDb(env.X_PIPELINE_DB).close();

  const first = await getOrCreateAlphaSummary({ now, env, force: true });
  assert.equal(first.status, "generated");
  assert.equal(first.lastAttemptAt, first.generatedAt, "a successful attempt identifies its actual completion time");
  assert.equal(first.summary.events[0].sources[0].link, "https://t.me/research/1");
  assert.deepEqual(first.summary.crypto, [{ target: "Protocol", opinions: [{ author: "Research", view: "The testing milestone deserves follow-up" }] }]);
  assert.equal(first.coverage.selectedCount, 1);
  assert.equal(first.coverage.startAt, "2026-10-02T03:01:00.000Z");
  const persisted = await getOrCreateAlphaSummary({ now, env });
  assert.deepEqual(persisted.summary.events, first.summary.events, "source links must survive SQLite cache reads");
  assert.equal(calls, 1, "reading a fresh result should not regenerate it");

  const updatedTelegram = openTelegramPipelineDb(env.TELEGRAM_PIPELINE_DB);
  upsertTelegramPipelineMessage(message(2), updatedTelegram);
  updatedTelegram.close();
  await new Promise((resolve) => setTimeout(resolve, 12));
  mode = "failure";
  const failed = await getOrCreateAlphaSummary({ now, env, force: true });
  assert.equal(failed.status, "error");
  assert.equal(failed.generatedAt, first.generatedAt, "a failure must not advance the success time");
  assert.notEqual(failed.lastAttemptAt, failed.generatedAt);
  assert.deepEqual(failed.summary, first.summary);
  assert.deepEqual(failed.coverage, first.coverage, "displayed coverage must describe the retained content");
  assert.deepEqual(failed.sourceCounts, first.sourceCounts);
  assert.equal(failed.itemCount, first.itemCount);
  const cachedFailure = await getOrCreateAlphaSummary({ now, env });
  assert.equal(cachedFailure.status, "error");
  assert.equal(cachedFailure.generatedAt, first.generatedAt);
  assert.equal(cachedFailure.lastAttemptAt, failed.lastAttemptAt);
  assert.equal(calls, 2, "failure backoff should prevent repeated automatic attempts");

  mode = "unsupported";
  const invalid = await getOrCreateAlphaSummary({ now, env, force: true });
  assert.equal(invalid.status, "error", "invented source IDs must not replace a valid result");
  assert.deepEqual(invalid.summary, first.summary);
  assert.equal(invalid.generatedAt, first.generatedAt);

  mode = "failure";
  const changedModelEnv = { ...env, AI_SUMMARY_MODEL: "fixture-model-next" };
  const changedModelFailure = await getOrCreateAlphaSummary({ now, env: changedModelEnv, force: true });
  assert.equal(changedModelFailure.model, "fixture-model", "retained content still belongs to its successful model");
  const callsBeforeRetry = calls;
  await getOrCreateAlphaSummary({ now, env: changedModelEnv });
  assert.equal(calls, callsBeforeRetry, "a model switch must not bypass the failed-attempt backoff");

  const emptyCacheEnv = { ...env, SIGNAL_SUMMARY_DB: join(directory, "first-failure.sqlite") };
  const firstFailure = await getOrCreateAlphaSummary({ now, env: emptyCacheEnv });
  assert.equal(firstFailure.status, "error");
  assert.equal(firstFailure.generatedAt, null);
  assert.equal(firstFailure.summary, null);
  const callsBeforeEmptyRetry = calls;
  await getOrCreateAlphaSummary({ now, env: emptyCacheEnv });
  assert.equal(calls, callsBeforeEmptyRetry, "a failed first generation also needs a short automatic backoff");

  const nextWindowTelegram = openTelegramPipelineDb(env.TELEGRAM_PIPELINE_DB);
  upsertTelegramPipelineMessage({ ...message(3), createdAt: "2026-10-02T15:00:00.000Z" }, nextWindowTelegram);
  nextWindowTelegram.close();
  const nextWindowFailure = await getOrCreateAlphaSummary({ now: new Date("2026-10-02T16:01:00.000Z"), env });
  assert.equal(nextWindowFailure.status, "error");
  assert.deepEqual(nextWindowFailure.summary, first.summary, "period rollover must not lose the last successful result during an outage");
  assert.equal(nextWindowFailure.generatedAt, first.generatedAt);
  assert.deepEqual(nextWindowFailure.coverage, first.coverage);

  // Old error rows recorded their attempt as generated_at; do not call it a success.
  const legacyPath = join(directory, "legacy.sqlite");
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`CREATE TABLE alpha_summary_cache (
    period_key TEXT PRIMARY KEY,period_json TEXT NOT NULL,model TEXT NOT NULL,
    input_hash TEXT NOT NULL,item_count INTEGER NOT NULL,source_counts_json TEXT NOT NULL,
    summary_json TEXT,status TEXT NOT NULL,error TEXT,generated_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`);
  const period = getAlphaSummaryPeriod({ now });
  const legacyPeriod = { ...period };
  delete legacyPeriod.signalContentVersion;
  legacy.prepare("INSERT INTO alpha_summary_cache VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    period.key, JSON.stringify(legacyPeriod), "fixture-model", "legacy", 1,
    '{"telegram":1,"x":0,"stocks":0}', JSON.stringify({ headline: "Legacy retained content", authors: [], consensus: [], risks: [], watchlist: [] }),
    "error", "prior timeout", now.toISOString(), now.toISOString(),
  );
  legacy.close();
  mode = "failure";
  const legacyFailure = await getOrCreateAlphaSummary({ now, env: { ...env, SIGNAL_SUMMARY_DB: legacyPath }, force: true });
  assert.equal(legacyFailure.summary.headline, "Legacy retained content");
  assert.equal(legacyFailure.generatedAt, null, "legacy failed-attempt timestamps cannot establish a successful generation time");
  assert.ok(legacyFailure.lastAttemptAt);

  // A format migration must not bypass the Stocks audience's existing error-cache policy.
  const stockPeriod = getAlphaSummaryPeriod({ now, audience: "stocks" });
  const stockLegacyDb = new DatabaseSync(legacyPath);
  stockLegacyDb.prepare("update alpha_summary_cache set period_key = ?, period_json = ?, generated_at = ?").run(
    stockPeriod.key, JSON.stringify(stockPeriod), now.toISOString(),
  );
  stockLegacyDb.close();
  const callsBeforeStockFallback = calls;
  const stockFallback = await getOrCreateAlphaSummary({ now, audience: "stocks", env: { ...env, STOCKS_SUMMARY_DB: legacyPath } });
  assert.equal(stockFallback.status, "error", "a retained Stocks error still observes its existing cache interval during migration");
  assert.equal(stockFallback.summary.headline, "Legacy retained content");
  assert.equal(stockFallback.summary.stocks, undefined);
  assert.equal(calls, callsBeforeStockFallback, "a legacy Stocks error must not trigger a provider request before its cache interval expires");
  console.log("ok - signal summary keeps successful evidence and honest cache freshness on failure");
} finally {
  globalThis.fetch = originalFetch;
  if (originalTelegramPath === undefined) delete process.env.TELEGRAM_PIPELINE_DB;
  else process.env.TELEGRAM_PIPELINE_DB = originalTelegramPath;
  if (originalXPath === undefined) delete process.env.X_PIPELINE_DB;
  else process.env.X_PIPELINE_DB = originalXPath;
  rmSync(directory, { recursive: true, force: true });
}
