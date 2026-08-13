import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /activeNav="douyin"/);
assert.match(source, /DouyinMonitorPanel/);
assert.match(source, /\/api\/douyin/);
assert.match(source, /DOUYIN_INITIAL_PAGE_SIZE = 10/);
assert.match(source, /getDouyinSnapshot\(\{ limit: DOUYIN_INITIAL_PAGE_SIZE \}\)/);

console.log("ok - douyin page is wired with a bounded initial snapshot");
