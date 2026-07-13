import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("./opportunity-radar.tsx", import.meta.url),
  "utf8",
);

assert.match(component, /useBrowserJsonCache<OpportunitySnapshot>\(cacheKey\)/);
assert.match(
  component,
  /signal-hub:opportunities:v1:\$\{market\}:\$\{sort\}:\$\{status\}/,
);
assert.match(component, /live\?\.key === cacheKey/);
assert.match(component, /requestState\?\.key === cacheKey/);
assert.match(component, /\/api\/opportunities\?\$\{query\.toString\(\)\}/);
assert.match(component, /5 \* 60 \* 1000/);
assert.match(component, /method: "POST"/);
assert.match(component, /follow/);
assert.match(component, /dismiss/);
assert.match(component, /replaceSnapshot/);
assert.match(component, /current\.items\.map/);
assert.match(component, /current\.items\.filter/);
assert.doesNotMatch(component, /router\.refresh|location\.reload/);
assert.doesNotMatch(component, /signal-summary|alpha-summary/);
assert.doesNotMatch(component, /\/api\/opportunities\/refresh/);

for (const label of [
  "评分",
  "信心",
  "市场",
  "资产",
  "事件",
  "状态",
  "时间窗",
  "来源",
  "价格反应",
  "理由",
  "风险",
  "失效条件",
  "打开原文",
  "关注",
  "忽略",
  "展开",
]) {
  assert.match(component, new RegExp(label));
}

assert.match(component, /item\.firstSeenAt/);
assert.match(component, /item\.lastSeenAt/);
assert.match(component, /已保留上次缓存/);
assert.match(
  component,
  /aria-label=\{`资产 \$\{item\.assetKeys\.join\(" · "\)\}`\}/,
);
assert.doesNotMatch(component, /className="sr-only"/);

assert.match(component, /aria-label=\{followLabel\}/);
assert.match(component, /title=\{followLabel\}/);
assert.match(component, /aria-label="忽略"/);
assert.match(component, /title="忽略"/);
assert.match(component, /aria-label=\{expanded \? "收起" : "展开"\}/);
assert.match(component, /target="_blank"/);
assert.match(component, /rel="noreferrer"/);
assert.match(component, /rounded-lg/);
assert.doesNotMatch(component, /rounded-xl|rounded-2xl|rounded-3xl/);

console.log("ok - opportunity radar cached cards and actions");
