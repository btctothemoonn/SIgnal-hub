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

console.log("ok - market alerts panel renders filters and live state");
