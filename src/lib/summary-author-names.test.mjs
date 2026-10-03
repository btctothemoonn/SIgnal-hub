import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSignalSummaryInput, selectSignalSummaryItems } from "./signal-summary-input.ts";
import { getOrCreateAlphaSummary, getAlphaSummaryPeriod, parseAlphaSummaryContent } from "./alpha-summary.ts";
import { withSummaryAuthorNames } from "./summary-author-names.ts";
import { openXPipelineDb, upsertXPipelineAccount } from "./x-pipeline-store.ts";
import { DatabaseSync } from "node:sqlite";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "summary-author-names-"));
  const env = { X_PIPELINE_DB: join(dir, "x.sqlite"), TELEGRAM_PIPELINE_DB: join(dir, "missing.sqlite"), SIGNAL_SUMMARY_DB: join(dir, "summary.sqlite") };
  const x = openXPipelineDb(env.X_PIPELINE_DB);
  t.after(() => { x.close(); rmSync(dir, { recursive: true, force: true }); });
  upsertXPipelineAccount({ username: "Alice", name: "爱丽丝研究" }, x);
  x.prepare("insert into x_feed(id, account_username_key, username, display_name, text, created_at, tweet_url, updated_at, quoted_tweet_json, profile_url, user_avatar, event_type, origin, query_label, inserted_at) values (?,?,?,?,?,?,?,?,?,'https://x.com/Alice','','tweet','realtime','','2026-10-02')").run(
    "1", "alice", "Alice", "Alice", "BTC adoption is growing", "2026-10-02T03:00:00.000Z", "https://x.com/Alice/status/1", "2026-10-02", JSON.stringify({ id: "2", username: "bob", displayName: "鲍勃观察", text: "BTC demand remains steady", tweetUrl: "https://x.com/bob/status/2" }),
  );
  return { env, x };
}

test("summary input supplies Twitter display names for posters and quoted authors", (t) => {
  const { env } = fixture(t);
  const period = getAlphaSummaryPeriod({ now: new Date("2026-10-02T04:00:00.000Z"), env });
  const { items } = collectSignalSummaryInput(period, env);
  assert.equal(items.length, 1);
  assert.equal(items[0].author, "爱丽丝研究", "a username placeholder must not mask the known profile name");
  assert.equal(items[0].authorUsername, "Alice");
  assert.match(items[0].text, /\[Quote 鲍勃观察\]/);
});

test("same display names do not merge separate accounts during balanced sampling", () => {
  const period = getAlphaSummaryPeriod({ now: new Date("2026-10-02T04:00:00.000Z") });
  const source = (id, username, at) => ({ id, source: "X", author: "同名博主", authorUsername: username, createdAt: at, text: `BTC observation ${id}`, translation: null, link: `https://x.com/${username}/status/${id}` });
  const items = selectSignalSummaryItems([
    source("alice-early", "Alice", "2026-10-02T03:00:00.000Z"),
    source("alice-late", "Alice", "2026-10-02T03:10:00.000Z"),
    source("bob", "Bob", "2026-10-02T03:05:00.000Z"),
  ], period, 2);
  assert.deepEqual(items.map((item) => item.id), ["alice-early", "bob"]);
});

test("existing cached handles resolve to current display names without AI regeneration", async (t) => {
  const { env, x } = fixture(t);
  const now = new Date("2026-10-02T04:00:00.000Z");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("cached name display must not call the provider"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  await getOrCreateAlphaSummary({ now, env }); // Create the summary cache schema without a provider.
  const period = getAlphaSummaryPeriod({ now, env });
  const cached = { headline: "BTC outlook", stocks: [], crypto: [{ target: "BTC", opinions: [{ author: "@ALICE", view: "需求增长" }, { author: "研究频道", view: "继续观察" }, { author: "@unknown", view: "等待确认" }] }], authors: [], consensus: [], risks: [], watchlist: [], events: [] };
  const db = new DatabaseSync(env.SIGNAL_SUMMARY_DB);
  db.prepare("insert into alpha_summary_cache(period_key,period_json,model,input_hash,item_count,source_counts_json,summary_json,status,error,generated_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)").run(period.key, JSON.stringify(period), "fixture", "fixture", 1, '{"x":1,"telegram":0,"stocks":0}', JSON.stringify(cached), "error", "prior timeout", now.toISOString(), now.toISOString());
  x.prepare("update x_accounts set enabled = 0").run();
  const result = await getOrCreateAlphaSummary({ now, env: { ...env, AI_SUMMARY_API_KEY: "fixture-key", AI_SUMMARY_MODEL: "fixture" } });
  assert.deepEqual(result.summary.crypto[0].opinions.map((entry) => entry.author), ["爱丽丝研究", "研究频道", "@unknown"]);
  assert.equal(db.prepare("select summary_json from alpha_summary_cache").get().summary_json, JSON.stringify(cached), "name display must not rewrite cache history");
  db.close();
});

test("a real display name resembling another account handle keeps its speaker", (t) => {
  const { env, x } = fixture(t);
  upsertXPipelineAccount({ username: "Alice", name: "@Bob" }, x);
  upsertXPipelineAccount({ username: "Bob", name: "鲍勃观察" }, x);
  const snapshot = { summary: { headline: "观点", stocks: [], crypto: [{ target: "BTC", opinions: [{ author: "@Bob", view: "Alice 的看法" }] }], authors: [] } };
  assert.equal(withSummaryAuthorNames(snapshot, env).summary.crypto[0].opinions[0].author, "@Bob");
});

test("distinct opinions from same-name authors are not combined by display name alone", () => {
  const summary = parseAlphaSummaryContent(JSON.stringify({ headline: "分歧", stocks: [{ target: "NVDA", opinions: [{ author: "同名博主", view: "看好需求" }, { author: "同名博主", view: "估值过高" }] }], crypto: [] }));
  assert.deepEqual(summary.stocks[0].opinions, [{ author: "同名博主", view: "看好需求" }, { author: "同名博主", view: "估值过高" }]);
});
