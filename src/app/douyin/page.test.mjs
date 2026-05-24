import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /activeNav="douyin"/);
assert.match(source, /DouyinMonitorPanel/);
assert.match(source, /\/api\/douyin/);

console.log("ok - douyin page is wired into app shell");
