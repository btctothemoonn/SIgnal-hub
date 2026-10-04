import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { getXPipelineSnapshot, openXPipelineDb, upsertXPipelineAccount, upsertXPipelineRealtimeUpdate } from "../lib/x-pipeline-store.ts";
import * as signalFeedRange from "../lib/signal-feed-range.ts";
import { prepareTelegramSnapshotForClient } from "../lib/telegram-client-snapshot.ts";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const responsiveLayout = readFileSync(
  new URL("../components/signals-responsive-layout.tsx", import.meta.url),
  "utf8",
);

assert.match(page, /import \{ SignalsResponsiveLayout \}/);
assert.doesNotMatch(page, /getCached6551TwitterSnapshot/);
assert.match(page, /mainClassName="[^"]*min-h-0[^"]*"/);
assert.match(responsiveLayout, /data-mobile-signal-pager/);
assert.match(responsiveLayout, /snap-x snap-mandatory/);
assert.match(responsiveLayout, /MOBILE_PANEL_INDEX\[panel\]/);
assert.doesNotMatch(
  responsiveLayout,
  /OpportunityRadar|opportunityEnabled|opportunities/,
);
assert.match(responsiveLayout, /grid grid-cols-2 gap-1/);
assert.doesNotMatch(responsiveLayout, /grid-cols-3/);
assert.match(responsiveLayout, /w-full shrink-0 snap-start/);
assert.match(responsiveLayout, /lg:gap-4/);
assert.match(responsiveLayout, /<section id="signals"/);
assert.match(responsiveLayout, /<aside\s+id="alpha"/);
assert.match(responsiveLayout, /className="[^"]*mobile-command-summary[^"]*"/);
assert.doesNotMatch(page, /OPPORTUNITY_RADAR_UI_ENABLED|opportunityEnabled/);

const db = openXPipelineDb(":memory:");
try {
  upsertXPipelineAccount({ username: "reader", name: "Reader", profileUrl: "https://x.com/reader", avatar: null, note: "", tags: [] }, db);
  for (let index = 0; index < 205; index += 1) {
    const createdAt = new Date(Date.UTC(2026, 9, 4, 0, index)).toISOString();
    upsertXPipelineRealtimeUpdate({
      eventType: "NEW_TWEET",
      account: "reader",
      displayName: "Reader",
      createdAt,
      profileUrl: "https://x.com/reader",
      remark: "",
      feedItem: {
        id: `post-${index}`, text: `post ${index}`, createdAt,
        username: "reader", displayName: "Reader", profileUrl: "https://x.com/reader",
        userAvatar: null, tweetUrl: `https://x.com/reader/status/${index}`,
        hashtags: [], likes: 0, retweets: 0, replies: 0, quotes: 0, views: 0,
        media: [], quotedTweet: null, origin: "watch", queryLabel: "", translation: null,
      },
    }, db);
  }
  const emptyTelegramSnapshot = {
    provider: "telegram", mode: "mtproto", isConfigured: true, isConnected: true,
    status: "live", channels: [], feed: [], note: "", errors: [],
  };
  const dependencies = {
    "react/jsx-runtime": jsxRuntime,
    "@/components/app-shell": { AppShell: "app-shell" },
    "@/components/signals-responsive-layout": { SignalsResponsiveLayout: "signals-responsive-layout" },
    "@/lib/signal-feed-range": signalFeedRange,
    "@/lib/telegram-client-snapshot": { prepareTelegramSnapshotForClient },
    "@/lib/telegram-pipeline-store": { getTelegramPipelineSnapshot: () => emptyTelegramSnapshot },
    "@/lib/x-pipeline-store": { getXPipelineSnapshot: (limit) => getXPipelineSnapshot(limit, db) },
    "@/lib/x-snapshot-mode": { isXRestSnapshotMode: () => false },
  };
  const output = ts.transpileModule(page, {
    fileName: "page.tsx",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "exports", "module", output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected homepage dependency: ${name}`);
    return dependencies[name];
  }, compiledModule.exports, compiledModule);
  const home = await compiledModule.exports.default();
  const snapshot = home.props.children.props.initialXSnapshot;
  assert.equal(snapshot.feed.length, 200, "the server-rendered homepage must include its bounded local X feed");
  assert.equal(snapshot.feed[0].id, "post-204");
  assert.equal(snapshot.feed[199].id, "post-5");
} finally {
  db.close();
}

console.log("ok - homepage mobile signal pager layout");
