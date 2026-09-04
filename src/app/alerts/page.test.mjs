import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /activeNav="alerts"/);
assert.match(source, /MarketAlertsPanel/);
assert.match(source, /getMarketAlertsSnapshot/);
assert.match(source, /异动监控/);
assert.match(source, /4 在线/);
assert.match(source, /liveWorkers === 4/);

console.log("ok - alerts page is wired into app shell");
