import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export const dynamic = "force-dynamic"/);
assert.match(source, /export const runtime = "nodejs"/);
assert.match(source, /getSystemHealthSnapshot/);
assert.match(source, /SIGNAL_HUB_SYSTEMD_SERVICES/);
assert.match(source, /systemctl/);
assert.doesNotMatch(source, /const SERVICES/);

console.log("ok - system health api route contract");
