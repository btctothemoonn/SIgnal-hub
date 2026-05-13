import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const routeSource = await readFile(resolve("src/app/api/logout/route.ts"), "utf8");
const shellSource = await readFile(resolve("src/components/app-shell.tsx"), "utf8");

assert.match(routeSource, /export async function GET\(\)/);
assert.match(routeSource, /export async function POST\(request: Request\)/);
assert.match(routeSource, /Use POST to sign out\./);
assert.match(shellSource, /<form action="\/api\/logout" method="post"/);
assert.doesNotMatch(shellSource, /href="\/api\/logout"/);

console.log("ok - logout uses POST form");
