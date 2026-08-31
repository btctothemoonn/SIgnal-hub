import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export const dynamic = "force-dynamic"/);
assert.match(source, /export const runtime = "nodejs"/);
assert.match(source, /getMarketAlertsSnapshot/);
assert.match(source, /searchParams\.get\("type"\)/);
assert.match(source, /searchParams\.get\("limit"\)/);

console.log("ok - market alerts api route contract");
