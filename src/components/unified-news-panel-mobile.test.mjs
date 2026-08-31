import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./unified-news-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /data-mobile-command-feed/);
assert.match(source, /Signal Flow/);
assert.match(source, /SIGNAL_FEED_RANGE_OPTIONS/);
assert.match(source, /setFeedRange\(option\.id\)/);
assert.match(source, /按博主或频道筛选/);
assert.match(source, /全部博主 \/ 频道/);
assert.match(source, /buildSignalFeedAuthorOptions/);
assert.match(source, /matchesSignalFeedAuthorFilter/);
assert.match(source, /SIGNAL_FEED_AUTHOR_FAVORITES_KEY/);
assert.match(source, /signal-hub:signal-feed-author-favorites/);
assert.match(source, /toggleAuthorFavorite/);
assert.match(source, /authorFavorites\.has\(option\.value\)/);
assert.match(source, /aria-pressed=\{isFavorite\}/);
assert.match(source, /setAuthorFilter\(option\.value\)/);
assert.match(source, /data-signal-toolbar/);
assert.match(source, /data-signal-source-tabs/);
assert.match(source, /grid w-full min-w-0 grid-cols-4/);
assert.match(source, /data-signal-utility-strip/);
assert.match(source, /flex flex-wrap items-center gap-2/);
assert.doesNotMatch(
  source,
  /flex w-full min-w-0 gap-1 overflow-x-auto rounded-lg/,
);
assert.match(source, /data-signal-feed-pane/);
assert.match(source, /shouldRefreshSignalSnapshotsOnEffect/);
assert.match(source, /signalRefreshRangeRef/);
assert.match(source, /contentVisibility:\s*"auto"/);
assert.match(source, /containIntrinsicSize:\s*"0 420px"/);
assert.match(source, /rounded-\[6px\]/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);
assert.match(
  source,
  /rounded-lg border border-workspace-line-strong bg-workspace-surface/,
);
assert.match(source, /bg-workspace-canvas/);
assert.match(source, /active:scale-\[0\.995\]/);
assert.match(source, /border-l-2 border-l-accent\/50/);
assert.doesNotMatch(source, /border-l-success|focus:ring-success/);
assert.match(source, /data-telegram-fault-alert/);
assert.match(source, /requestTelegramSnapshot\(\{ range: feedRange \}\),\s*requestXSnapshot\(\{ range: feedRange \}\),/s);
assert.doesNotMatch(source, /refreshSourceLabel\(telegramRefresh\?\.source\)/);
assert.doesNotMatch(source, /telegramRefresh\.cacheFetchedAt/);
assert.doesNotMatch(source, /telegramSnapshot\.channels\.length[^\n]*频道/);

console.log("ok - unified news mobile command surface");
