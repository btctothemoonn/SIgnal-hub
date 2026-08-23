import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./daily-brief-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /DailyBriefPanel/);
assert.match(source, /\/api\/daily-brief/);
assert.match(source, /手动生成/);
assert.match(source, /最近一次简报/);
assert.match(source, /后续关注/);
assert.match(source, /投资影响/);
assert.match(source, /Reuters|AP News/);
assert.match(source, /sourceUrls/);
assert.match(source, /生成请求失败/);
assert.doesNotMatch(source, /Signal 流/);
assert.match(source, /独立新闻源/);
assert.doesNotMatch(source, /entries\.length === 0\) return "Reuters \/ AP News"/);

console.log("ok - daily brief panel renders cached brief");
