import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function transpileToTemp() {
  const dir = await mkdtemp(join(tmpdir(), "x-manual-catchup-test-"));
  const source = await readFile(new URL("./x-manual-catchup.ts", import.meta.url), "utf8");
  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  };
  await writeFile(
    join(dir, "x-manual-catchup.mjs"),
    ts.transpileModule(source, { compilerOptions }).outputText,
    "utf8",
  );
  return import(`file:///${join(dir, "x-manual-catchup.mjs").replace(/\\/g, "/")}`);
}

const {
  X_MANUAL_CATCHUP_HEALTH_SCOPE,
  buildXManualCatchupSpawnConfig,
  resolveXManualCatchupRuntimeOptions,
} = await transpileToTemp();

assert.equal(X_MANUAL_CATCHUP_HEALTH_SCOPE, "manual-catchup");

assert.deepEqual(
  resolveXManualCatchupRuntimeOptions({
    env: {},
  }),
  {
    lookbackMs: 36 * 60 * 60 * 1000,
    batchLimit: 120,
    scanLimit: 6000,
    rowDelayMs: 5000,
    healthScope: "manual-catchup",
  },
);

assert.deepEqual(
  resolveXManualCatchupRuntimeOptions({
    env: {
      X_MANUAL_CATCHUP_LOOKBACK_HOURS: "12",
      X_MANUAL_CATCHUP_BATCH_LIMIT: "20",
      X_MANUAL_CATCHUP_SCAN_LIMIT: "800",
      X_MANUAL_CATCHUP_ROW_DELAY_MS: "1500",
    },
    input: {
      lookbackHours: 72,
      batchLimit: 50,
      rowDelayMs: 2500,
    },
  }),
  {
    lookbackMs: 72 * 60 * 60 * 1000,
    batchLimit: 50,
    scanLimit: 800,
    rowDelayMs: 2500,
    healthScope: "manual-catchup",
  },
);

const spawnConfig = buildXManualCatchupSpawnConfig({
  cwd: "D:/app",
  nodePath: "node",
  env: {},
  input: {
    lookbackHours: 2,
    batchLimit: 7,
    rowDelayMs: 333,
  },
});

assert.equal(spawnConfig.cwd, "D:/app");
assert.equal(spawnConfig.nodePath, "node");
assert.deepEqual(spawnConfig.args, [
  "--experimental-strip-types",
  "--experimental-transform-types",
  "scripts/x-hybrid-worker.mjs",
  "--once",
]);
assert.equal(spawnConfig.env.X_HYBRID_CATCHUP_LOOKBACK_MS, String(2 * 60 * 60 * 1000));
assert.equal(spawnConfig.env.X_HYBRID_BATCH_LIMIT, "7");
assert.equal(spawnConfig.env.X_HYBRID_SCAN_LIMIT, "1000");
assert.equal(spawnConfig.env.X_HYBRID_ROW_DELAY_MS, "333");
assert.equal(spawnConfig.env.X_HYBRID_RETRY_ERRORS, "true");
assert.equal(spawnConfig.env.X_HYBRID_HEALTH_SCOPE, "manual-catchup");

console.log("ok - manual X catchup uses a bounded one-off worker");
