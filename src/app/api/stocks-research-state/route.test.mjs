import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const routePath = fileURLToPath(new URL("./route.ts", import.meta.url));
const source = await readFile(routePath, "utf8");

assert.match(source, /export async function GET/);
assert.match(source, /export async function PUT/);
assert.match(source, /getStocksResearchStates/);
assert.match(source, /saveStocksResearchState/);
assert.match(source, /VALIDATION_ERROR/);
assert.match(source, /INTERNAL_ERROR/);

console.log("ok - stocks research state route contract is present");
