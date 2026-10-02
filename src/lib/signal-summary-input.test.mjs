import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectSignalSummaryInput, selectSignalSummaryItems } from "./signal-summary-input.ts";

function period(scope = "7d") {
  return {
    key: `signals:${scope}`,
    scope,
    audience: "signals",
    inputBudgetVersion: 4,
    label: scope,
    startAt: "2026-09-24T00:00:00.000Z",
    endAt: "2026-10-01T00:00:00.000Z",
    timeZone: "Asia/Shanghai",
  };
}

function item(id, author, createdAt, text = `observation ${id}`) {
  return {
    id,
    source: "X",
    author,
    createdAt,
    text,
    translation: null,
    link: `https://x.com/${author.replace(/^@/, "")}/status/${id}`,
  };
}

test("week sampling covers every day despite a high-frequency author on the last day", () => {
  const items = [];
  for (let day = 24; day <= 30; day += 1) {
    for (let author = 0; author < 3; author += 1) {
      items.push(item(`day-${day}-${author}`, `@analyst${author}`, `2026-09-${day}T12:00:00.000Z`));
    }
  }
  for (let index = 0; index < 600; index += 1) {
    items.push(item(`busy-${index}`, "@busy", new Date(Date.parse("2026-09-30T13:00:00.000Z") + index * 1000).toISOString()));
  }

  const selected = selectSignalSummaryItems(items, period(), 14);
  assert.equal(selected.length, 14);
  assert.deepEqual([...new Set(selected.map((entry) => entry.createdAt.slice(0, 10)))], [
    "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30",
  ]);
  assert.ok(selected.filter((entry) => entry.author === "@busy").length <= 2);
  assert.equal(selected[0].createdAt, "2026-09-24T12:00:00.000Z");
});

test("selection removes duplicate IDs, normalized duplicate content and media placeholders while retaining changed updates", () => {
  const at = "2026-09-25T12:00:00.000Z";
  const selected = selectSignalSummaryItems([
    item("original", "@one", at, "Rate cut   confirmed"),
    item("copy", "@two", at, "  RATE CUT confirmed\n"),
    item("original", "@one", at, "Same ID copy"),
    item("update", "@one", at, "Rate cut delayed"),
    item("empty", "@one", at, "  \n "),
    item("photo", "@one", at, "图片消息"),
    item("media", "@one", at, "[media]"),
    item("link-only", "@one", at, "https://t.co/abc"),
    item("out-of-window", "@one", "2026-10-01T00:00:00.000Z"),
  ], period(), 20);

  assert.deepEqual(new Set(selected.map((entry) => entry.id)), new Set(["original", "update"]));
});

test("short scopes cover the full rolling window and normalize legacy timestamps", () => {
  const shortPeriod = { ...period("12h"), startAt: "2026-09-30T00:00:00.000Z", endAt: "2026-09-30T12:00:00.000Z" };
  const selected = selectSignalSummaryItems([
    item("start", "@one", "Wed Sep 30 00:00:00 +0000 2026"),
    item("early", "@one", "2026-09-30T02:00:00.000Z"),
    item("mid", "@two", "2026-09-30T04:00:00.000Z"),
    item("later", "@two", "2026-09-30T06:00:00.000Z"),
    item("late", "@one", "2026-09-30T08:00:00.000Z"),
    item("end", "@one", "2026-09-30T11:59:59.000Z"),
    ...Array.from({ length: 100 }, (_, index) => item(`latest-${index}`, "@busy", `2026-09-30T11:59:${String(index % 60).padStart(2, "0")}.000Z`)),
  ], shortPeriod, 6);

  assert.equal(selected.length, 6);
  assert.equal(selected[0].createdAt, "2026-09-30T00:00:00.000Z");
  assert.equal(selected.filter((entry) => entry.createdAt < "2026-09-30T10:00:00.000Z").length, 5);
  assert.ok(selected.every((entry, index) => index === 0 || selected[index - 1].createdAt <= entry.createdAt));
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "signal-summary-input-"));
  const env = { TELEGRAM_PIPELINE_DB: join(dir, "telegram.sqlite"), X_PIPELINE_DB: join(dir, "x.sqlite") };
  const telegram = new DatabaseSync(env.TELEGRAM_PIPELINE_DB);
  const x = new DatabaseSync(env.X_PIPELINE_DB);
  telegram.exec("pragma journal_mode = memory; pragma synchronous = off");
  x.exec("pragma journal_mode = memory; pragma synchronous = off");
  telegram.exec(`
    create table telegram_channels (ref text primary key, title text, username text, channel_id text, enabled integer);
    create table telegram_messages (id text primary key, channel_ref text, channel_title text, channel_username text, channel_id text, message_id integer, message_url text, text text, created_at text, quoted_message_json text, translation_json text);
  `);
  x.exec(`
    create table x_accounts (username_key text primary key, username text, enabled integer);
    create table x_feed (id text primary key, account_username_key text, username text, text text, created_at text, tweet_url text, quoted_tweet_json text, translation_json text);
  `);
  t.after(() => { telegram.close(); x.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    dir,
    env,
    telegram,
    x,
    channel(ref, enabled = 1, username = ref, title = ref) {
      telegram.prepare("insert into telegram_channels values (?, ?, ?, ?, ?)").run(ref, title, username, ref, enabled);
    },
    message(ref, id, at, text, quote = null, translation = null) {
      telegram.prepare("insert into telegram_messages values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        `${ref}:${id}`, ref, ref, ref, ref, id, `https://t.me/${ref}/${id}`, text, at,
        quote ? JSON.stringify(quote) : null, translation ? JSON.stringify({ text: translation }) : null,
      );
    },
    account(username, enabled = 1) { x.prepare("insert into x_accounts values (?, ?, ?)").run(username.toLowerCase(), username, enabled); },
    tweet(username, id, at, text, quote = null, translation = null) {
      x.prepare("insert into x_feed values (?, ?, ?, ?, ?, ?, ?, ?)").run(
        id, username.toLowerCase(), username, text, at, `https://x.com/${username}/status/${id}`,
        quote ? JSON.stringify(quote) : null, translation ? JSON.stringify({ text: translation }) : null,
      );
    },
  };
}

test("reader excludes disabled channels and Telegram X relays before quotas and counts only selected evidence", (t) => {
  const data = fixture(t);
  data.channel("research");
  data.channel("disabled", 0);
  data.channel("relay-ref", 1, "customrelay");
  data.env.TELEGRAM_X_SOURCE_CHANNELS = "@customrelay";
  data.account("Analyst");
  data.account("Disabled", 0);
  for (let index = 0; index < 1200; index += 1) data.message("relay-ref", index, "2026-09-30T23:00:00.000Z", `relay message ${index}`);
  data.message("research", 1, "2026-09-24T00:00:00.000Z", "Supply chain observation without a crypto ticker");
  data.message("research", 2, "2026-09-30T23:30:00.000Z", "A changed supply chain update");
  data.message("disabled", 1, "2026-09-28T12:00:00.000Z", "disabled message");
  data.message("research", 3, "2026-09-27T12:00:00.000Z", "图片消息");
  data.tweet("Analyst", "legacy", "Wed Sep 30 12:00:00 +0000 2026", "Macro outlook outside crypto");
  data.tweet("Analyst", "duplicate", "2026-09-30T12:01:00.000Z", "  MACRO outlook outside   crypto ");
  data.tweet("Disabled", "disabled", "2026-09-30T12:00:00.000Z", "disabled tweet");
  data.tweet("Analyst", "future", "2026-10-01T00:00:00.000Z", "future tweet");

  const result = collectSignalSummaryInput(period(), data.env);
  assert.deepEqual(result.sourceCounts, { telegram: 2, x: 1, stocks: 0 });
  assert.deepEqual(result.coverage, { candidateCount: 3, selectedCount: 3, startAt: "2026-09-24T00:00:00.000Z", endAt: "2026-09-30T23:30:00.000Z" });
  assert.deepEqual(result.items.map((entry) => entry.id), ["telegram:research:1", "x:legacy", "telegram:research:2"]);
  assert.equal(result.items[1].createdAt, "2026-09-30T12:00:00.000Z");
});

test("reader keeps enabled Telegram history after a channel reference rename", (t) => {
  const data = fixture(t);
  data.channel("research");
  data.message("research", 1, "2026-09-24T12:00:00.000Z", "Research published before the channel rename");
  data.telegram.prepare("update telegram_channels set ref = ?, username = ? where channel_id = ?").run("renamed", "renamed", "research");
  const result = collectSignalSummaryInput(period(), data.env);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "telegram:research:1");
});

test("reader preserves actual quote and reply context within the text budget", (t) => {
  const data = fixture(t);
  data.channel("research");
  data.account("Analyst");
  data.message("research", 1, "2026-09-25T12:00:00.000Z", "This may change the earlier view", {
    id: "earlier", text: "Earlier demand projection", channelTitle: "Original research", channelUsername: "original", messageUrl: "https://t.me/original/1",
  });
  data.tweet("Analyst", "reply", "2026-09-26T12:00:00.000Z", "Risk is higher now. ".repeat(80), {
    id: "quoted", text: "The original expectation was unchanged rates", username: "PolicyExpert", tweetUrl: "https://x.com/PolicyExpert/status/quoted", relation: "reply",
  }, "利率风险提高");
  data.tweet("Analyst", "quote", "2026-09-27T12:00:00.000Z", "", {
    id: "shared", text: "Evidence from a cited study", username: "Researcher", tweetUrl: "https://x.com/Researcher/status/shared", relation: "quote",
  });

  const result = collectSignalSummaryInput(period(), data.env);
  assert.equal(result.items.length, 3);
  assert.match(result.items[0].text, /Original research.*Earlier demand projection/);
  assert.match(result.items[1].text, /Reply to @PolicyExpert.*original expectation was unchanged rates/);
  assert.equal(result.items[1].translation, "利率风险提高");
  assert.match(result.items[2].text, /Quote @Researcher.*Evidence from a cited study/);
  assert.ok(result.items.every((entry) => entry.text.length <= 320));
});

test("bounded reader retains every day and minority authors beyond the old newest-row cap", (t) => {
  const data = fixture(t);
  data.account("Busy");
  data.account("Quiet");
  for (let day = 24; day <= 30; day += 1) data.tweet("Quiet", `quiet-${day}`, `2026-09-${day}T12:00:00.000Z`, `Distinct finding on September ${day}`);
  for (let index = 0; index < 1800; index += 1) data.tweet("Busy", `busy-${index}`, new Date(Date.parse("2026-09-30T13:00:00.000Z") + index * 1000).toISOString(), `Busy author update ${index}`);
  const result = collectSignalSummaryInput(period(), data.env);

  assert.equal(result.items.length, 110);
  assert.equal(result.sourceCounts.x, 110);
  assert.equal(result.coverage.selectedCount, 110);
  assert.ok(result.coverage.candidateCount > 110 && result.coverage.candidateCount < 1807);
  assert.deepEqual([...new Set(result.items.map((entry) => entry.createdAt.slice(0, 10)))], ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
  assert.equal(result.items.filter((entry) => entry.author === "@Quiet").length, 7);
});

test("reader never creates missing source databases", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "signal-summary-missing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { TELEGRAM_PIPELINE_DB: join(dir, "missing-tg.sqlite"), X_PIPELINE_DB: join(dir, "missing-x.sqlite") };
  const result = collectSignalSummaryInput(period(), env);
  assert.deepEqual(result.items, []);
  assert.equal(existsSync(env.TELEGRAM_PIPELINE_DB), false);
  assert.equal(existsSync(env.X_PIPELINE_DB), false);
});

test("reader keeps whole-window evidence on Node versions without SQLite user functions", (t) => {
  const data = fixture(t);
  data.account("Busy");
  data.account("Quiet");
  data.channel("relay");
  data.env.TELEGRAM_X_SOURCE_CHANNELS = "relay";
  for (let day = 24; day <= 30; day += 1) data.tweet("Quiet", `quiet-${day}`, `2026-09-${day}T12:00:00.000Z`, `Finding on September ${day}`);
  data.tweet("Quiet", "legacy", "Sat Sep 26 12:01:00 +0000 2026", "This changes the earlier view", {
    id: "context", text: "Earlier forecast", username: "Forecast", relation: "reply",
  });
  for (let index = 0; index < 1200; index += 1) {
    data.tweet("Busy", `busy-${index}`, new Date(Date.parse("2026-09-30T13:00:00.000Z") + index * 1000).toISOString(), `Busy update ${index}`);
    data.message("relay", index, "2026-09-30T23:00:00.000Z", `Excluded relay update ${index}`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, "function");
  Object.defineProperty(DatabaseSync.prototype, "function", { value: undefined, configurable: true });
  try {
    const result = collectSignalSummaryInput(period(), data.env);
    assert.equal(result.items.length, 110);
    assert.equal(result.sourceCounts.telegram, 0);
    assert.equal(result.sourceCounts.x, 110);
    assert.deepEqual([...new Set(result.items.map((entry) => entry.createdAt.slice(0, 10)))], ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
    const legacy = result.items.find((entry) => entry.id === "x:legacy");
    assert.ok(legacy);
    assert.equal(legacy.createdAt, "2026-09-26T12:01:00.000Z");
    assert.match(legacy.text, /Reply to @Forecast.*Earlier forecast/);
  } finally {
    if (descriptor) Object.defineProperty(DatabaseSync.prototype, "function", descriptor);
    else delete DatabaseSync.prototype.function;
  }
});
