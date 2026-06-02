import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/components/unified-news-panel.tsx", "utf8");

assert.match(source, /const MAX_ALL_NEWS_ITEMS = 200;/);
assert.match(source, /const MAX_TELEGRAM_NEWS_ITEMS = 300;/);
assert.match(source, /limit = MAX_TELEGRAM_NEWS_ITEMS/);
assert.match(source, /mergeFeeds\(\s*current\.feed,\s*incoming\.feed,\s*limit,\s*\)/);
assert.match(source, /getSignalFeedRangeLimit\(range,\s*"telegram"\)/);
assert.match(source, /getSignalFeedRangeLimit\(range,\s*"x"\)/);
assert.match(source, /return limitNewsItems\(matching, feedLimitForTab\(activeTab,\s*feedRange\)\);/);
assert.match(source, /requestTelegramSnapshot\(\{ range: feedRange \}\)/);
assert.match(source, /requestXSnapshot\(\{ range: feedRange \}\)/);
assert.match(source, /title:\s*tweet\.displayName\s*\|\|\s*`@\${displayUsername}`/);
assert.match(source, /subtitle:\s*formatXAuthorSubtitle\(displayUsername,\s*tweet\.queryLabel\)/);
assert.match(source, /title:\s*tweet\.quotedTweet\.displayName\s*\|\|/);
assert.match(source, /subtitle:\s*formatXAuthorSubtitle\(\s*tweet\.quotedTweet\.username\.replace/);

const mainMediaIndex = source.indexOf("{/* Media */}");
const quotedTweetIndex = source.indexOf("{/* Quoted tweet */}");
assert.ok(mainMediaIndex >= 0, "main media block should exist");
assert.ok(quotedTweetIndex >= 0, "quoted tweet block should exist");
assert.ok(
  mainMediaIndex < quotedTweetIndex,
  "main tweet media should render before the quoted tweet card",
);

console.log("ok - unified news panel keeps 300 telegram items without expanding all feed");
