import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const route = new URL("./route.ts", import.meta.url);
assert.ok(existsSync(route), "The deployed website needs a version API");
const previous = process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION;
try {
  process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION = "c".repeat(40);
  const { GET } = await import(route.href);
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: "c".repeat(40) });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("cache-control"), /private/);
  console.log("ok - deployment version returns the build version without caching");
} finally {
  if (previous === undefined) delete process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION;
  else process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION = previous;
}
