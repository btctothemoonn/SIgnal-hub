import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /text\/event-stream/);
assert.match(source, /market-alerts-snapshot/);
assert.match(source, /heartbeat/);
assert.match(source, /getMarketAlertsLatestUpdatedAt/);

console.log("ok - market alerts SSE route contract");
