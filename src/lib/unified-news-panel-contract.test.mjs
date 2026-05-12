import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/components/unified-news-panel.tsx", "utf8");

assert.match(source, /const MAX_ALL_NEWS_ITEMS = 200;/);
assert.match(source, /const MAX_TELEGRAM_NEWS_ITEMS = 300;/);
assert.match(source, /mergeFeeds\(\s*current\.feed,\s*incoming\.feed,\s*MAX_TELEGRAM_NEWS_ITEMS,\s*\)/);
assert.match(source, /return limitNewsItems\(matching, feedLimitForTab\(activeTab\)\);/);

console.log("ok - unified news panel keeps 300 telegram items without expanding all feed");
