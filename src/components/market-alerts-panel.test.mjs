import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./market-alerts-panel.tsx", import.meta.url), "utf8");

assert.match(source, /"use client"/);
assert.match(source, /market-alerts-snapshot/);
assert.match(source, /全部/);
assert.match(source, /暴涨暴跌/);
assert.match(source, /轧空/);
assert.match(source, /活跃信号/);
assert.match(source, /worker/i);
assert.match(source, /EventSource/);
assert.match(source, /推送待确认/);
assert.match(source, /推送失败/);
assert.match(source, /<MarketOpportunityPanel/);
const workspaceIndex = source.indexOf("data-market-alert-workspace");
const opportunityIndex = source.indexOf("<MarketOpportunityPanel");
const feedIndex = source.indexOf("data-market-alert-feed");
assert.ok(
  workspaceIndex < opportunityIndex && opportunityIndex < feedIndex,
  "the opportunity panel should be the first mobile item inside the alerts workspace",
);
assert.match(source, /data-market-alert-right-rail/);
assert.match(source, /lg:grid-cols-\[minmax\(0,3fr\)_minmax\(19rem,2fr\)\]/);
assert.ok(
  source.indexOf("data-market-alert-feed") < source.indexOf("<Ranking"),
  "market ranking should render after the realtime feed in the workspace sidebar",
);
assert.match(source, /data-market-alert-workspace/);
assert.match(source, /data-market-alert-sidebar/);
assert.match(source, /expandedEventId/);
assert.match(source, /memo\(function EventCard/);
assert.match(source, /\[content-visibility:auto\]/);
assert.match(source, /lg:max-h-\[calc\(100vh-6\.5rem\)\]/);
assert.doesNotMatch(source, /最新 5 分钟 K 线图/);
assert.match(source, /chartInterval/);
assert.match(source, /data-market-alert-price/);

console.log("ok - market alerts panel renders filters and live state");
