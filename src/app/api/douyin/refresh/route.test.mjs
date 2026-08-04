import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /loadRuntimeConfig/);
assert.match(source, /!config\.douyinEnabled/);
assert.match(source, /status: 409/);
assert.match(source, /refreshDouyinMonitor/);

console.log("ok - douyin refresh is gated by the runtime switch");
