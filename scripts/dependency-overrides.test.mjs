import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const workspace = readFileSync(
  new URL("../pnpm-workspace.yaml", import.meta.url),
  "utf8",
);

assert.equal(pkg.pnpm, undefined);
assert.doesNotMatch(workspace, /^  brace-expansion:/m);

const pnpmModulesDir = fileURLToPath(
  new URL("../node_modules/.pnpm/", import.meta.url),
);
const minimatch10Dir = readdirSync(pnpmModulesDir).find((entry) =>
  entry.startsWith("minimatch@10.2.5"),
);
assert.ok(minimatch10Dir, "minimatch 10 should be installed");
const require = createRequire(import.meta.url);
const yamlDir = readdirSync(pnpmModulesDir).find((entry) => entry.startsWith("js-yaml@4.3.0"));
const { load } = require(join(pnpmModulesDir, yamlDir, "node_modules/js-yaml"));
assert.deepEqual(load(workspace).overrides, {
  postcss: "8.5.23", "ip-address": "10.3.1", "nanoid@3": "3.3.18",
  browserslist: "4.28.7", sharp: "0.35.0",
  "minimatch@3.1.5>brace-expansion": "1.1.13", "js-yaml": "4.3.0",
});
const { minimatch } = require(
  join(pnpmModulesDir, minimatch10Dir, "node_modules/minimatch"),
);
assert.equal(minimatch("signal.ts", "signal.{js,ts}"), true);
console.log("ok - production dependency overrides are pinned");
