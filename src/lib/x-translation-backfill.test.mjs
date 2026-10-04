import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { spawnSync } from "node:child_process";

async function transpileToTemp() {
  const dir = await mkdtemp(join(tmpdir(), "x-translation-backfill-test-"));
  const runtimeStorageSource = await readFile(
    new URL("./runtime-storage.ts", import.meta.url),
    "utf8",
  );
  const configSource = (
    await readFile(new URL("./x-pipeline-config.ts", import.meta.url), "utf8")
  ).replace('from "./runtime-storage.ts"', 'from "./runtime-storage.mjs"');
  const usageSource = (
    await readFile(new URL("./x-api-usage.ts", import.meta.url), "utf8")
  ).replace('from "./x-pipeline-config.ts"', 'from "./x-pipeline-config.mjs"');
  const qualitySource = await readFile(
    new URL("./translation-quality.ts", import.meta.url),
    "utf8",
  );
  const storeSource = (
    await readFile(new URL("./x-pipeline-store.ts", import.meta.url), "utf8")
  )
    .replace('from "@/lib/6551-twitter"', 'from "./6551-twitter.mjs"')
    .replace('from "./x-pipeline-config.ts"', 'from "./x-pipeline-config.mjs"')
    .replace('from "./x-api-usage.ts"', 'from "./x-api-usage.mjs"')
    .replace('from "./translate.ts"', 'from "./translate.mjs"')
    .replace('from "./translation-quality.ts"', 'from "./translation-quality.mjs"');
  const backfillSource = (
    await readFile(new URL("./x-translation-backfill.ts", import.meta.url), "utf8")
  )
    .replace('from "./6551-twitter.ts"', 'from "./6551-twitter.mjs"')
    .replace('from "./translate.ts"', 'from "./translate.mjs"')
    .replace('from "./x-pipeline-store.ts"', 'from "./x-pipeline-store.mjs"');

  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  };
  await writeFile(
    join(dir, "runtime-storage.mjs"),
    ts.transpileModule(runtimeStorageSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-pipeline-config.mjs"),
    ts.transpileModule(configSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-api-usage.mjs"),
    ts.transpileModule(usageSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "translation-quality.mjs"),
    ts.transpileModule(qualitySource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "translate.mjs"),
    `
      import { isUsefulTranslation } from "./translation-quality.mjs";
      export { isUsefulTranslation };
      export const calls = [];
      let hook = null;
      export function setTranslateHook(value) { hook = value; }
      export async function translateText(text, options = {}) {
        calls.push({ text, options });
        await hook?.(text, options);
        if (text.includes("untranslatable")) return null;
        return {
          provider: "minimax",
          sourceLanguage: "auto",
          targetLanguage: options.targetLanguage || "zh-CN",
          text: "译文 " + text,
        };
      }
    `,
    "utf8",
  );
  await writeFile(
    join(dir, "6551-twitter.mjs"),
    "export {};",
    "utf8",
  );
  await writeFile(
    join(dir, "x-feed-merge.mjs"),
    ts.transpileModule((await readFile(new URL("./x-feed-merge.ts", import.meta.url), "utf8"))
      .replace('from "./translation-quality.ts"', 'from "./translation-quality.mjs"'), { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-pipeline-store.mjs"),
    ts.transpileModule(storeSource.replace('from "./x-feed-merge.ts"', 'from "./x-feed-merge.mjs"'), { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-translation-backfill.mjs"),
    ts.transpileModule(backfillSource.replace('from "./x-feed-merge.ts"', 'from "./x-feed-merge.mjs"'), { compilerOptions }).outputText,
    "utf8",
  );
  const loaded = await Promise.all([
    import(`file:///${join(dir, "x-pipeline-store.mjs").replace(/\\/g, "/")}`),
    import(`file:///${join(dir, "x-translation-backfill.mjs").replace(/\\/g, "/")}`),
    import(`file:///${join(dir, "translate.mjs").replace(/\\/g, "/")}`),
  ]);
  return {
    store: loaded[0],
    backfill: loaded[1],
    translate: loaded[2],
    independentBackfill: () => import(`file:///${join(dir, "x-translation-backfill.mjs").replace(/\\/g, "/")}?independent-worker`),
    moduleDirectory: dir,
  };
}

const { store, backfill, translate, independentBackfill, moduleDirectory } = await transpileToTemp();
const db = store.openXPipelineDb(":memory:");

store.upsertXPipelineAccount(
  {
    username: "Serenity",
    name: "Serenity",
    profileUrl: "https://x.com/Serenity",
    avatar: "",
    note: "test",
    tags: [],
  },
  db,
);

store.upsertXPipelineRealtimeUpdate(
  {
    eventType: "NEW_TWEET_REPLY",
    account: "Serenity",
    displayName: "Serenity",
    createdAt: "2026-05-20T10:00:00.000Z",
    profileUrl: "https://x.com/Serenity",
    remark: "",
    feedItem: {
      id: "needs-main-translation",
      text: "I don't have positions anymore, so no comment there. It is probably not a good short if someone can buy the company outright.",
      createdAt: "2026-05-20T10:00:00.000Z",
      username: "Serenity",
      displayName: "Serenity",
      profileUrl: "https://x.com/Serenity",
      userAvatar: "",
      tweetUrl: "https://x.com/Serenity/status/needs-main-translation",
      hashtags: [],
      likes: 0,
      retweets: 0,
      replies: 0,
      quotes: 0,
      views: 0,
      media: [],
      quotedTweet: null,
      origin: "watch",
      queryLabel: "985monitor / NEW_TWEET_REPLY",
      translation: {
        provider: "985monitor",
        sourceLanguage: "auto",
        targetLanguage: "zh-CN",
        text: "不适合做空。",
      },
    },
  },
  db,
);

assert.equal(
  store.getXPipelineSnapshot(10, db).feed[0].translation,
  null,
);
assert.deepEqual(store.listXPipelineTranslationCandidates(10, db), [
  {
    id: "needs-main-translation",
    text: "I don't have positions anymore, so no comment there. It is probably not a good short if someone can buy the company outright.",
  },
]);

const stats = await backfill.backfillMissingXTranslations({
  db,
  limit: 10,
  targetLanguage: "zh-CN",
  cacheNamespace: "test",
  retryCooldownMs: 0,
});

assert.equal(stats.checked, 1);
assert.equal(stats.attempted, 1);
assert.equal(stats.translated, 1);
assert.equal(translate.calls.length, 1);
assert.equal(
  store.getXPipelineSnapshot(10, db).feed[0].translation?.text,
  "译文 I don't have positions anymore, so no comment there. It is probably not a good short if someone can buy the company outright.",
);

const ensured = await backfill.ensureXFeedItemTranslation({
  id: "with-quote",
  text: "Main text can move markets if the financing pressure changes.",
  createdAt: "2026-05-20T10:01:00.000Z",
  username: "Serenity",
  displayName: "Serenity",
  profileUrl: "https://x.com/Serenity",
  userAvatar: "",
  tweetUrl: "https://x.com/Serenity/status/with-quote",
  hashtags: [],
  likes: 0,
  retweets: 0,
  replies: 0,
  quotes: 0,
  views: 0,
  media: [],
  quotedTweet: {
    id: "quote",
    text: "Is it a buy serenity?",
    createdAt: "2026-05-20T09:59:00.000Z",
    username: "Sid",
    displayName: "Sid",
    profileUrl: "https://x.com/Sid",
    userAvatar: "",
    tweetUrl: "https://x.com/Sid/status/quote",
    media: [],
    translation: null,
    relation: "reply",
  },
  origin: "watch",
  queryLabel: "985monitor / NEW_TWEET_REPLY",
  translation: null,
}, { db });

assert.ok(ensured.translation?.text.startsWith("译文 Main text"));
assert.ok(ensured.quotedTweet?.translation?.text.startsWith("译文 Is it a buy"));

store.upsertXPipelineRealtimeUpdate(
  {
    eventType: "NEW_TWEET_REPLY",
    account: "Serenity",
    displayName: "Serenity",
    createdAt: "2026-05-20T10:02:00.000Z",
    profileUrl: "https://x.com/Serenity",
    remark: "",
    feedItem: {
      id: "korean-quoted-tweet",
      text: "\u4e2d\u6587\u4e3b\u6587\u5df2\u7ecf\u53ef\u8bfb",
      createdAt: "2026-05-20T10:02:00.000Z",
      username: "Serenity",
      displayName: "Serenity",
      profileUrl: "https://x.com/Serenity",
      userAvatar: "",
      tweetUrl: "https://x.com/Serenity/status/korean-quoted-tweet",
      hashtags: [],
      likes: 0,
      retweets: 0,
      replies: 0,
      quotes: 0,
      views: 0,
      media: [],
      quotedTweet: {
        id: "korean-quote",
        text: "\uc544 \uc194\uc9c1\ud788 \uc774\ub534 \uac78 \ubcf4\ub294 \uac74 Low IQ \uc778\uc99d\ud558\ub294 \uac70 \uc544\ub2cc\uac00",
        createdAt: "2026-05-20T09:59:00.000Z",
        username: "WhitePeach",
        displayName: "WhitePeach",
        profileUrl: "https://x.com/WhitePeach",
        userAvatar: "",
        tweetUrl: "https://x.com/WhitePeach/status/korean-quote",
        media: [],
        translation: null,
        relation: "reply",
      },
      origin: "watch",
      queryLabel: "985monitor / NEW_TWEET_REPLY",
      translation: null,
    },
  },
  db,
);

const koreanStats = await backfill.backfillMissingXTranslations({
  db,
  limit: 10,
  targetLanguage: "zh-CN",
  cacheNamespace: "test",
  retryCooldownMs: 0,
});
assert.equal(koreanStats.checked, 1);
assert.equal(koreanStats.translated, 1);
const koreanItem = store.getXPipelineFeedItem("korean-quoted-tweet", db);
assert.equal(koreanItem?.translation, null);
assert.ok(koreanItem?.quotedTweet?.translation?.text.startsWith("\u8bd1\u6587 "));

const base = store.getXPipelineFeedItem("needs-main-translation", db);
function write(targetDb, feedItem) {
  store.upsertXPipelineRealtimeUpdate({ eventType: "NEW_TWEET", account: feedItem.username, displayName: feedItem.displayName,
    createdAt: feedItem.createdAt, profileUrl: feedItem.profileUrl, remark: "", feedItem }, targetDb);
}

// A real edit lands after model input was captured but before model output.
const raceDb = store.openXPipelineDb(":memory:");
const oldItem = { ...base, id: "body-race", translation: null, contentVersion: "1", quotedTweet: null };
write(raceDb, oldItem);
translate.setTranslateHook(async (text) => {
  if (text === oldItem.text) write(raceDb, { ...oldItem, text: "The edited original now gives a different market view.", contentVersion: "2" });
});
const raceStats = await backfill.backfillMissingXTranslations({ db: raceDb, retryCooldownMs: 60_000 });
assert.equal(raceStats.translated, 0, "rejected stale model output must not count as a translated item");
assert.equal(store.getXPipelineFeedItem(oldItem.id, raceDb).translation, null);
translate.setTranslateHook(null);
const retried = await backfill.backfillMissingXTranslations({ db: raceDb });
assert.equal(retried.translated, 1, "CAS rejection immediately requeues the current version without model-failure cooldown");
raceDb.close();

const quoteDb = store.openXPipelineDb(":memory:");
const oldQuote = { ...JSON.parse(JSON.stringify(ensured)), id: "quote-race", translation: ensured.translation,
  quotedTweet: { ...ensured.quotedTweet, translation: null } };
write(quoteDb, oldQuote);
translate.setTranslateHook(async (text) => {
  if (text === oldQuote.quotedTweet.text) write(quoteDb, { ...oldQuote, quotedTweet: { ...oldQuote.quotedTweet, id: "replacement-quote", text: "A different quoted market view.", translation: null } });
});
const quoteRaceStats = await backfill.backfillMissingXTranslations({ db: quoteDb });
assert.equal(quoteRaceStats.translated, 0);
assert.equal(store.getXPipelineFeedItem(oldQuote.id, quoteDb).quotedTweet.id, "replacement-quote");
assert.equal(store.getXPipelineQuotedTweet(oldQuote.quotedTweet.id, quoteDb).translation, null);
translate.setTranslateHook(null);
quoteDb.close();

// Ingestion also awaited a model before upsert. A newer persisted version wins.
const ingestionDb = store.openXPipelineDb(":memory:");
const ingestionOld = { ...oldItem, id: "ingestion-race" };
write(ingestionDb, ingestionOld);
translate.setTranslateHook(async () => write(ingestionDb, { ...ingestionOld, text: "This is the current edited original statement.", contentVersion: "2" }));
const staleEnsured = await backfill.ensureXFeedItemTranslation(ingestionOld, { db: ingestionDb });
write(ingestionDb, staleEnsured);
assert.equal(store.getXPipelineFeedItem(ingestionOld.id, ingestionDb).text, "This is the current edited original statement.");
assert.equal(store.getXPipelineFeedItem(ingestionOld.id, ingestionDb).translation, null);
translate.setTranslateHook(null);
ingestionDb.close();

const ingestionQuoteDb = store.openXPipelineDb(":memory:");
const ingestionQuoteOld = { ...oldQuote, id: "ingestion-same-quote-race" };
const currentQuoteTranslation = { provider: "minimax", sourceLanguage: "auto", targetLanguage: "zh-CN", text: "引用已经更新，这是当前引用正文对应的完整译文。" };
const ingestionQuoteCurrent = { ...ingestionQuoteOld.quotedTweet, text: "The quoted original now has a different market view.", translation: currentQuoteTranslation };
write(ingestionQuoteDb, ingestionQuoteOld);
translate.setTranslateHook(async (text) => {
  if (text === ingestionQuoteOld.quotedTweet.text) write(ingestionQuoteDb, { ...ingestionQuoteOld, quotedTweet: ingestionQuoteCurrent });
});
const staleQuoteEnsured = await backfill.ensureXFeedItemTranslation(ingestionQuoteOld, { db: ingestionQuoteDb });
write(ingestionQuoteDb, staleQuoteEnsured);
for (const result of [store.getXPipelineFeedItem(ingestionQuoteOld.id, ingestionQuoteDb).quotedTweet,
  store.getXPipelineQuotedTweet(ingestionQuoteCurrent.id, ingestionQuoteDb)]) {
  assert.equal(result.text, ingestionQuoteCurrent.text);
  assert.deepEqual(result.translation, currentQuoteTranslation);
}
assert.equal(ingestionQuoteDb.prepare("select count(*) as n from x_translation_leases").get().n, 0);
translate.setTranslateHook(null);
ingestionQuoteDb.close();

const crossRootDb = store.openXPipelineDb(":memory:");
const crossRootOld = { ...oldQuote, id: "cross-root-ingestion-race" };
const crossRootCurrentQuote = { ...crossRootOld.quotedTweet, text: "Another root observes a different quoted market view.", translation: currentQuoteTranslation };
write(crossRootDb, crossRootOld);
translate.setTranslateHook(async (text) => {
  if (text === crossRootOld.quotedTweet.text) write(crossRootDb, { ...crossRootOld, id: "cross-root-writer", quotedTweet: crossRootCurrentQuote });
});
const crossRootStaleEnsured = await backfill.ensureXFeedItemTranslation(crossRootOld, { db: crossRootDb });
write(crossRootDb, crossRootStaleEnsured);
for (const result of [store.getXPipelineFeedItem(crossRootOld.id, crossRootDb).quotedTweet,
  store.getXPipelineFeedItem("cross-root-writer", crossRootDb).quotedTweet,
  store.getXPipelineQuotedTweet(crossRootCurrentQuote.id, crossRootDb)]) {
  assert.equal(result.text, crossRootCurrentQuote.text);
  assert.deepEqual(result.translation, currentQuoteTranslation);
}
assert.equal(crossRootDb.prepare("select count(*) as n from x_translation_leases").get().n, 0);
translate.setTranslateHook(null);
crossRootDb.close();

const alreadyCurrentDb = store.openXPipelineDb(":memory:");
const alreadyCurrentOld = { ...oldQuote, id: "already-current-root" };
const alreadyCurrentQuote = { ...alreadyCurrentOld.quotedTweet, text: "The shared quoted original was updated before this task started.", translation: currentQuoteTranslation };
write(alreadyCurrentDb, alreadyCurrentOld);
write(alreadyCurrentDb, { ...alreadyCurrentOld, id: "already-current-writer", quotedTweet: alreadyCurrentQuote });
const callsBeforeCurrent = translate.calls.length;
const alreadyCurrentEnsured = await backfill.ensureXFeedItemTranslation(alreadyCurrentOld, { db: alreadyCurrentDb });
write(alreadyCurrentDb, alreadyCurrentEnsured);
assert.equal(store.getXPipelineFeedItem(alreadyCurrentOld.id, alreadyCurrentDb).quotedTweet.text, alreadyCurrentQuote.text);
assert.equal(store.getXPipelineQuotedTweet(alreadyCurrentQuote.id, alreadyCurrentDb).text, alreadyCurrentQuote.text);
assert.equal(translate.calls.length, callsBeforeCurrent, "known current translated shared context avoids paying for obsolete quoted text");
alreadyCurrentDb.close();

const crossRootBackfillDb = store.openXPipelineDb(":memory:");
const crossRootBackfillOld = { ...oldQuote, id: "cross-root-backfill-race" };
const crossRootBackfillCurrent = { ...crossRootBackfillOld.quotedTweet, text: "A current quoted original from another backfill root.", translation: currentQuoteTranslation };
write(crossRootBackfillDb, crossRootBackfillOld);
translate.setTranslateHook(async (text) => {
  if (text === crossRootBackfillOld.quotedTweet.text) write(crossRootBackfillDb, { ...crossRootBackfillOld, id: "cross-root-backfill-writer", quotedTweet: crossRootBackfillCurrent });
});
const crossRootBackfillStats = await backfill.backfillMissingXTranslations({ db: crossRootBackfillDb });
assert.equal(crossRootBackfillStats.translated, 0, "changed shared quote context must reject old backfill output");
for (const result of [store.getXPipelineFeedItem(crossRootBackfillOld.id, crossRootBackfillDb).quotedTweet,
  store.getXPipelineQuotedTweet(crossRootBackfillCurrent.id, crossRootBackfillDb)]) {
  assert.equal(result.text, crossRootBackfillCurrent.text);
  assert.deepEqual(result.translation, currentQuoteTranslation);
}
translate.setTranslateHook(null);
crossRootBackfillDb.close();

// Separate module instances model independent workers; two SQLite connections
// share the durable lease rather than relying on either module's in-flight Set.
const leaseDir = await mkdtemp(join(tmpdir(), "x-backfill-workers-"));
const leasePath = join(leaseDir, "feed.sqlite");
const leaseDb1 = store.openXPipelineDb(leasePath); const leaseDb2 = store.openXPipelineDb(leasePath);
write(leaseDb1, { ...oldItem, id: "worker-lease" });
let startedResolve; const started = new Promise((resolve) => { startedResolve = resolve; });
let unblock; const blocked = new Promise((resolve) => { unblock = resolve; });
translate.setTranslateHook(async () => { startedResolve(); await blocked; });
const beforeCalls = translate.calls.length;
const worker1 = backfill.backfillMissingXTranslations({ db: leaseDb1 });
await started;
const secondWorker = await independentBackfill();
const worker2 = secondWorker.backfillMissingXTranslations({ db: leaseDb2 });
const childResult = spawnSync(process.execPath, ["--input-type=module", "-e", `
  import * as store from ${JSON.stringify(`file:///${join(moduleDirectory, "x-pipeline-store.mjs").replace(/\\/g, "/")}`)};
  import * as backfill from ${JSON.stringify(`file:///${join(moduleDirectory, "x-translation-backfill.mjs").replace(/\\/g, "/")}`)};
  const db = store.openXPipelineDb(${JSON.stringify(leasePath)});
  const stats = await backfill.backfillMissingXTranslations({ db });
  process.stdout.write(JSON.stringify(stats));
  db.close();
`], { encoding: "utf8", timeout: 10_000 });
assert.equal(childResult.status, 0, childResult.stderr);
assert.equal(JSON.parse(childResult.stdout).attempted, 0, "another OS process also honors the SQLite lease");
unblock();
const [, worker2Stats] = await Promise.all([worker1, worker2]);
assert.equal(worker2Stats.attempted, 0, "the second worker cannot start another paid translation");
assert.equal(translate.calls.length - beforeCalls, 1);
assert.equal(leaseDb1.prepare("select count(*) as n from x_translation_leases").get().n, 0);
leaseDb1.close(); leaseDb2.close(); await rm(leaseDir, { recursive: true, force: true });
translate.setTranslateHook(null);
db.close();

console.log("ok - x translation backfill repairs missing and partial X translations");
