import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { prepareTelegramSnapshotForClient } from "../../../lib/telegram-client-snapshot.ts";
import { createSnapshotEventStream } from "../../../lib/snapshot-event-stream.ts";
import { getTelegramPipelineLatestUpdatedAt, getTelegramPipelineSnapshot, openTelegramPipelineDb, upsertTelegramPipelineChannel, upsertTelegramPipelineMessage } from "../../../lib/telegram-pipeline-store.ts";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const feedLimit = getSignalFeedRangeLimit\(range,\s*"telegram"\)/,
);
assert.match(
  source,
  /getTelegramPipelineSnapshot\(feedLimit,[\s\S]*?since: getSignalFeedRangeSince\(range\)/,
);
assert.match(
  source,
  /prepareTelegramSnapshotForClient\([\s\S]*?\{\s*feedLimit\s*\},?\s*\)/,
);

console.log("ok - telegram range limit reaches the client snapshot");

const db = openTelegramPipelineDb(":memory:");
const abort = new AbortController();
try {
  upsertTelegramPipelineChannel({ ref: "reader", title: "Reader", username: "reader", channelId: "1", link: "https://t.me/reader", avatar: null, avatarUpdatedAt: null, tags: [] }, db);
  const addMessages = (start, count) => {
    for (let index = start; index < start + count; index += 1) {
      upsertTelegramPipelineMessage({
        channelRef: "reader", channelTitle: "Reader", channelUsername: "reader", channelId: "1",
        channelLink: "https://t.me/reader", channelAvatar: null, messageId: index,
        messageUrl: `https://t.me/reader/${index}`, text: `message ${index}`,
        createdAt: new Date(Date.UTC(2026, 9, 4, 0, index)).toISOString(),
        views: 0, forwards: 0, origin: "history", media: null, translation: null,
        quotedMessage: null, raw: {},
      }, db);
    }
  };
  addMessages(1, 305);
  // A later channel revision avoids replaying messages at the inclusive cursor boundary.
  db.exec("update telegram_messages set updated_at = '2099-01-01T00:00:00.000Z'; update telegram_channels set updated_at = '2099-01-01T00:00:30.000Z'");
  const dependencies = {
    "@/lib/telegram-client-snapshot": { prepareTelegramSnapshotForClient },
    "@/lib/telegram-pipeline-store": {
      getTelegramPipelineLatestUpdatedAt: () => getTelegramPipelineLatestUpdatedAt(db),
      getTelegramPipelineSnapshot: (limit, _db, options) => getTelegramPipelineSnapshot(limit, db, options),
    },
    "@/lib/snapshot-event-stream": {
      createSnapshotEventStream: (options) => createSnapshotEventStream({ ...options, pollMs: 5 }),
    },
  };
  const eventRouteSource = await readFile(new URL("./events/route.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(eventRouteSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "exports", "module", output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected Telegram event route dependency: ${name}`);
    return dependencies[name];
  }, compiledModule.exports, compiledModule);
  const response = await compiledModule.exports.GET(new Request("http://localhost/api/telegram/events", { signal: abort.signal }));
  const reader = response.body.getReader();
  const readSnapshot = async () => {
    const frame = new TextDecoder().decode((await reader.read()).value);
    assert.match(frame, /^event: telegram-snapshot\n/);
    return JSON.parse(frame.split("\ndata: ")[1].trim());
  };
  const initial = await readSnapshot();
  assert.equal(initial.feed.length, 300, "the initial Telegram SSE snapshot stays bounded");
  addMessages(1000, 400);
  db.exec("update telegram_messages set updated_at = '2099-01-01T00:01:00.000Z' where message_id >= 1000");
  const delta = await readSnapshot();
  assert.equal(delta.feed.length, 400, "Telegram SSE must deliver every item in a delta larger than 300 before advancing the cursor");
  assert.equal(delta.feed[399].id, "1:1000");
} finally {
  abort.abort();
  db.close();
}
console.log("ok - Telegram SSE keeps the initial limit and preserves larger deltas");
