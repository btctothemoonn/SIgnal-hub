import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./deploy-vps.sh", import.meta.url), "utf8");
const serviceRegistry = readFileSync(
  new URL("../src/lib/signal-hub-services.ts", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

assert.match(source, /set -euo pipefail/);
assert.match(source, /require\("node:sqlite"\)/);
assert.match(source, /git pull --ff-only origin/);
assert.match(source, /SIGNAL_HUB_DEPLOY_REEXEC/);
assert.match(source, /exec env SIGNAL_HUB_DEPLOY_REEXEC=1 bash/);
assert.match(source, /node_modules\/next\/dist\/bin\/next build/);
const installCommand = '"$PNPM_BIN" install --frozen-lockfile --ignore-scripts';
const installIndex = source.indexOf(installCommand);
const testIndex = source.indexOf('"$NODE_BIN" scripts/run-tests.mjs');
const lintIndex = source.indexOf('"$NODE_BIN" node_modules/eslint/bin/eslint.js .');
const buildIndex = source.indexOf('"$NODE_BIN" node_modules/next/dist/bin/next build');
assert.ok(installIndex >= 0, "deployment must install the locked dependencies");
assert.ok(testIndex >= 0, "deployment must run the project test suite");
assert.ok(lintIndex >= 0, "deployment must run ESLint");
assert.ok(installIndex < testIndex, "dependencies must be installed before tests");
assert.ok(testIndex < lintIndex, "tests must run before lint");
assert.ok(lintIndex < buildIndex, "lint must run before build");
assert.match(source, /systemctl restart/);
assert.match(source, /signal-hub-web/);
assert.match(source, /signal-hub-stocks-cache/);
assert.match(source, /signal-hub-daily-brief/);
assert.match(source, /signal-hub-tiger-holdings/);
assert.match(source, /signal-hub-douyin/);
assert.match(source, /daily-brief-worker\.mjs/);
assert.match(source, /Environment=SIGNAL_HUB_RUNTIME_DIR=\$APP_DIR\/\.signal-hub/);
assert.match(packageJson.engines.node, />=22\.5\.0/);
assert.doesNotMatch(serviceRegistry, /signal-hub-opportunity|机会雷达/);
assert.doesNotMatch(source, /signal-hub-opportunity|opportunity-worker/);

console.log("ok - vps deploy script contract");
