import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as summaries from "./alpha-summary.ts";

assert.equal(typeof summaries.readPreviousAlphaSummary, "function", "progress comparison needs a same-scope prior cache across period boundaries");
const db = new DatabaseSync(":memory:");
try {
  db.exec("create table alpha_summary_cache (period_key text, period_json text, summary_json text, source_counts_json text, generated_at text, model text, item_count integer, status text, error text)");
  const insert = (scope, now, headline, audience = "signals") => {
    const period = summaries.getAlphaSummaryPeriod({ scope, now: new Date(now), audience });
    db.prepare("insert into alpha_summary_cache values (?, ?, ?, '{}', ?, 'test', 1, 'generated', null)").run(period.key, JSON.stringify(period), JSON.stringify({ headline, authors: [], consensus: [], risks: [], watchlist: [] }), now);
    return period;
  };
  insert("7d", "2026-09-15T01:00:00.000Z", "older weekly summary");
  insert("7d", "2026-09-16T01:00:00.000Z", "previous weekly summary");
  insert("3d", "2026-09-16T02:00:00.000Z", "wrong scope");
  insert("7d", "2026-09-16T03:00:00.000Z", "wrong audience", "stocks");
  insert("7d", "2026-09-18T01:00:00.000Z", "future summary");
  const current = insert("7d", "2026-09-17T01:00:00.000Z", "current summary");
  const previous = summaries.readPreviousAlphaSummary(current, db);
  assert.equal(previous.summary.headline, "previous weekly summary");
  assert.equal(summaries.readPreviousAlphaSummary(summaries.getAlphaSummaryPeriod({ scope: "12h", now: new Date(current.endAt) }), db), null);
} finally { db.close(); }
console.log("ok - previous summary lookup isolates scope, audience and time across period rollover");
