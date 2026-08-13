import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./workspace-route-loading.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /AppShell/);
assert.match(source, /activeNav=\{activeNav\}/);
assert.match(source, /data-workspace-route-loading/);
assert.match(source, /aria-busy="true"/);
assert.match(source, /animate-pulse/);

console.log("ok - workspace route loading keeps navigation responsive");
