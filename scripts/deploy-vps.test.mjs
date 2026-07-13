import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./deploy-vps.sh", import.meta.url), "utf8");
const serviceRegistry = readFileSync(
  new URL("../src/lib/signal-hub-services.ts", import.meta.url),
  "utf8",
);

assert.match(source, /set -euo pipefail/);
assert.match(source, /git pull --ff-only origin/);
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
assert.match(source, /signal-hub-tiger-holdings/);
assert.match(source, /signal-hub-douyin/);
assert.match(serviceRegistry, /signal-hub-opportunity/);
assert.match(source, /signal-hub-opportunity\.service/);
assert.match(
  source,
  /ExecStart=\$NODE_BIN --experimental-strip-types --experimental-transform-types \$APP_DIR\/scripts\/opportunity-worker\.mjs/,
);
assert.match(source, /Environment=SIGNAL_HUB_RUNTIME_DIR=\$APP_DIR\/\.signal-hub/);
const opportunityEnableIndex = source.indexOf("sudo systemctl enable signal-hub-opportunity");
const opportunityRestartIndex = source.indexOf("  signal-hub-opportunity\n", opportunityEnableIndex);
assert.ok(opportunityEnableIndex >= 0, "deployment must enable the opportunity worker");
assert.ok(opportunityRestartIndex > opportunityEnableIndex, "enabled opportunity worker must be restarted");
assert.doesNotMatch(source, /OPPORTUNITY_RADAR_UI_ENABLED/);

console.log("ok - vps deploy script contract");
