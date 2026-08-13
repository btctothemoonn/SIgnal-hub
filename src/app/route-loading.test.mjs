import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = [
  ["./loading.tsx", "signals"],
  ["./holding/loading.tsx", "holding"],
  ["./stocks/loading.tsx", "stocks"],
  ["./douyin/loading.tsx", "douyin"],
];

for (const [path, activeNav] of routes) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source, /WorkspaceRouteLoading/);
  assert.match(source, new RegExp(`activeNav="${activeNav}"`));
}

console.log("ok - primary workspace routes provide loading fallbacks");
