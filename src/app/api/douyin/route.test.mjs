import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export async function GET\(request: Request\)/);
assert.match(source, /searchParams\.get\("limit"\)/);
assert.match(source, /getDouyinSnapshot\(\{ limit \}\)/);

console.log("ok - douyin route accepts an optional snapshot limit");
