import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const workspace = readFileSync(
  new URL("../pnpm-workspace.yaml", import.meta.url),
  "utf8",
);

assert.equal(pkg.pnpm?.overrides?.postcss, "8.5.16");
assert.equal(pkg.pnpm?.overrides?.["ip-address"], "10.2.0");
assert.match(workspace, /(?:^|\n)overrides:\r?\n  postcss: 8\.5\.16\r?\n  ip-address: 10\.2\.0(?:\r?\n|$)/);
console.log("ok - production dependency overrides are pinned");
