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
assert.match(source, /role="tablist"/);
assert.match(source, /AI 科技/);
assert.match(source, /币圈/);
assert.match(source, /宏观市场/);
assert.match(source, /aria-selected/);
assert.match(source, /data-daily-brief-card/);
assert.match(source, /marketContextExpanded/);
assert.match(source, /data-mobile-market-context/);
assert.match(source, /aria-expanded=\{marketContextExpanded\}/);
assert.match(source, /line-clamp-3 lg:line-clamp-none/);
assert.match(source, /展开背景/);
assert.match(source, /收起背景/);
assert.match(source, /lg:grid-cols-2/);
assert.match(source, /getDailyBriefGroup|groupDailyBriefItems/);
assert.doesNotMatch(source, /className="truncate">\{group\.label\}/);
assert.match(source, /initialHistory/);
assert.match(source, /历史简报/);
assert.match(source, /\/api\/daily-brief\?date=/);
assert.match(source, /overflow-x-auto/);
assert.match(source, /aria-pressed/);

console.log("ok - daily brief panel renders cached brief");
