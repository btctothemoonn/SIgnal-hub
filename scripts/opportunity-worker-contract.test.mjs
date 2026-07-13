import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const scriptPath = join(root, "scripts", "opportunity-worker.mjs");
const script = readFileSync(scriptPath, "utf8");

assert.equal(
  packageJson.scripts["opportunity:worker"],
  "node --experimental-strip-types --experimental-transform-types scripts/opportunity-worker.mjs",
);
assert.equal(
  packageJson.scripts["opportunity:worker:once"],
  "node --experimental-strip-types --experimental-transform-types scripts/opportunity-worker.mjs --once",
);
assert.match(script, /\.env\.local/);
assert.match(script, /\.env/);
assert.match(script, /--once/);
assert.match(script, /SIGINT/);
assert.match(script, /SIGTERM/);
assert.match(script, /getOpportunityWorkerIntervalMs/);
assert.match(script, /already_running/);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "opportunity-worker-"));
const dbPath = join(temporaryDirectory, "opportunities.sqlite");
try {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--experimental-transform-types",
      scriptPath,
      "--once",
    ],
    {
      cwd: temporaryDirectory,
      env: {
        ...process.env,
        OPPORTUNITY_DB: dbPath,
        SIGNAL_HUB_RUNTIME_DIR: temporaryDirectory,
        MINIMAX_API_KEY: "",
        DEEPSEEK_API_KEY: "",
        AI_SUMMARY_API_KEY: "",
        AI_SUMMARY_FALLBACK_API_KEY: "",
      },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.signal, null);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /API_KEY|request body/i);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare(`
    select state_value from opportunity_worker_state where state_key = 'last_cycle'
  `).get();
  assert.ok(row);
  assert.equal(JSON.parse(row.state_value).candidateCount, 0);
  db.close();
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("ok - opportunity worker script contract");
