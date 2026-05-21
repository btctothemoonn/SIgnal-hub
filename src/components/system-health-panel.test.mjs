import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./system-health-panel.tsx", import.meta.url), "utf8");

assert.match(source, /\/api\/system-health/);
assert.match(source, /window\.setInterval/);
assert.match(source, /信息健康中心/);
assert.match(source, /statusLabel/);
assert.match(source, /formatTime\(item\.updatedAt\)/);

console.log("ok - system health panel contract");
