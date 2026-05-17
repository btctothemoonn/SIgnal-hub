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
assert.match(source, /rounded-lg border border-line\/70 bg-panel\/95/);
assert.match(source, /bg-background\/70/);
assert.match(source, /active:scale-\[0\.995\]/);
assert.match(source, /border-l-2 border-l-accent\/45/);
assert.match(source, /data-telegram-fault-alert/);
assert.match(source, /requestTelegramSnapshot\(\{ range: feedRange \}\),\s*requestXSnapshot\(\{ range: feedRange \}\),/s);
assert.doesNotMatch(source, /refreshSourceLabel\(telegramRefresh\?\.source\)/);
assert.doesNotMatch(source, /telegramRefresh\.cacheFetchedAt/);
assert.doesNotMatch(source, /telegramSnapshot\.channels\.length[^\n]*频道/);

console.log("ok - unified news mobile command surface");
