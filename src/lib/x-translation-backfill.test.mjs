import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

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
      export async function translateText(text, options = {}) {
        calls.push({ text, options });
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
    join(dir, "x-pipeline-store.mjs"),
    ts.transpileModule(storeSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-translation-backfill.mjs"),
    ts.transpileModule(backfillSource, { compilerOptions }).outputText,
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
  };
}

const { store, backfill, translate } = await transpileToTemp();
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
});

assert.ok(ensured.translation?.text.startsWith("译文 Main text"));
assert.ok(ensured.quotedTweet?.translation?.text.startsWith("译文 Is it a buy"));

console.log("ok - x translation backfill repairs missing and partial X translations");
