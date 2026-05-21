import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export const dynamic = "force-dynamic"/);
assert.match(source, /export const runtime = "nodejs"/);
assert.match(source, /getSystemHealthSnapshot/);
assert.match(source, /systemctl/);
assert.match(source, /signal-hub-telegram/);
assert.match(source, /signal-hub-x-hybrid/);
assert.match(source, /signal-hub-stocks-cache/);

console.log("ok - system health api route contract");
