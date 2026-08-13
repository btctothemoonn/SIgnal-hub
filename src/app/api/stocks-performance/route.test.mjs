import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /searchParams\.get\("format"\)/);
assert.match(source, /compactStocksPerformanceSnapshot\(snapshot\)/);
assert.match(source, /NextResponse\.json\(responseSnapshot\)/);

console.log("ok - stocks performance route compact response is opt in");
