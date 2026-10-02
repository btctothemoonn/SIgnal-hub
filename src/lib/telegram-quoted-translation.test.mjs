import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../components/unified-news-panel.tsx", import.meta.url), "utf8");
const functionSource = source.slice(source.indexOf("function toUnifiedTelegramItems("), source.indexOf("function isTruthUsername("));
const quality = await readFile(new URL("./translation-quality.ts", import.meta.url), "utf8");
const policy = await readFile(new URL("./telegram-translation-policy.ts", import.meta.url), "utf8");
const runtime = ts.transpileModule(
  `${quality.replace(/export /g, "")}\n${policy.replace(/export /g, "")}\n${functionSource}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;
const convert = new Function("telegramOriginalAction", `${runtime}\nreturn toUnifiedTelegramItems;`)(
  (item) => ({ link: item.messageUrl || item.channelLink || "#", linkLabel: "原文" }),
);
const translation = { provider: "mymemory", text: "现在需要等待市场价格下跌之后，再重新开始买入。", sourceLanguage: "en", targetLanguage: "zh-CN" };
const message = {
  id: "1:2", channelTitle: "AU", channelUsername: "au_call", channelRef: "@au_call",
  text: "A new message", translation: null,
  quotedMessage: { id: "1:1", text: "Now wait for the price to drop before buying again.", translation },
};
assert.deepEqual(convert({ channels: [], feed: [message] })[0].quotedTweet.translation, translation);
assert.equal(convert({ channels: [], feed: [{ ...message, quotedMessage: { ...message.quotedMessage, translation: null } }] })[0].quotedTweet.translation, null);
assert.equal(convert({ channels: [], feed: [{ ...message, channelUsername: "bwetradfi", channelRef: "@bwetradfi" }] })[0].quotedTweet.translation, null);
assert.equal(convert({ channels: [], feed: [{ ...message, quotedMessage: { ...message.quotedMessage, translation: { ...translation, text: message.quotedMessage.text } } }] })[0].quotedTweet.translation, null);

const worker = await readFile(new URL("../../scripts/telegram-pipeline-worker.mjs", import.meta.url), "utf8");
const workerFunction = worker.slice(worker.indexOf("async function toTranslatedMessageInput("), worker.indexOf("async function backfillMissingTranslations("));
const calls = [];
const build = new Function("resolveQuotedMessage", "toMessageInput", "translateTelegramText", `${workerFunction}\nreturn toTranslatedMessageInput;`)(
  async () => ({ ...message.quotedMessage, translation: null }),
  (_message, _channel, _origin, _media, quote) => ({ text: message.text, quotedMessage: quote }),
  async (text) => { calls.push(text); return translation; },
);
const result = await build(null, null, {}, {}, "live", null);
assert.deepEqual(result.quotedMessage.translation, translation);
assert.deepEqual(calls, [message.quotedMessage.text, message.text]);
const backfillSource = worker.slice(worker.indexOf("let translationBackfillOffset"), worker.indexOf("async function createClient("));
const queue = [
  { id: "fail-1", text: "failed text one" },
  { id: "fail-2", text: "failed text two" },
  { id: "quote", text: message.quotedMessage.text, kind: "quoted" },
];
const writes = [];
const backfill = new Function("translationBackfillLimit", "listTelegramPipelineTranslationCandidates", "translateTelegramText", "setTelegramPipelineQuotedTranslation", "setTelegramPipelineMessageTranslation", "log", `${backfillSource}\nreturn backfillMissingTranslations;`)(
  () => 1,
  (limit, _db, offset = 0) => queue.slice(offset, offset + limit),
  async (text) => text === message.quotedMessage.text ? translation : null,
  (...args) => { writes.push(args); queue.splice(2, 1); },
  () => assert.fail("quote backfill must not update the parent body"),
  () => {},
);
await Promise.all([backfill(), backfill()]);
await backfill();
await backfill();
assert.deepEqual(writes, [["quote", message.quotedMessage.text, translation]], "failed newest rows and concurrent calls must not starve historical quote backfill");
console.log("ok - Telegram quote translation survives collection and UI mapping with quality/channel rules");
