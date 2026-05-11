import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function transpileToTemp() {
  const dir = await mkdtemp(join(tmpdir(), "x-pipeline-hybrid-source-test-"));
  const configSource = await readFile(
    new URL("./x-pipeline-config.ts", import.meta.url),
    "utf8",
  );
  const usageSource = (
    await readFile(new URL("./x-api-usage.ts", import.meta.url), "utf8")
  ).replace('from "./x-pipeline-config.ts"', 'from "./x-pipeline-config.mjs"');
  const storeSource = (
    await readFile(new URL("./x-pipeline-store.ts", import.meta.url), "utf8")
  )
    .replace('from "./x-pipeline-config.ts"', 'from "./x-pipeline-config.mjs"')
    .replace('from "./x-api-usage.ts"', 'from "./x-api-usage.mjs"');

  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  };
  await writeFile(
    join(dir, "x-pipeline-config.mjs"),
    ts.transpileModule(configSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-api-usage.mjs"),
    ts.transpileModule(usageSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-pipeline-store.mjs"),
    ts.transpileModule(storeSource, { compilerOptions }).outputText,
    "utf8",
  );
  return import(`file:///${join(dir, "x-pipeline-store.mjs").replace(/\\/g, "/")}`);
}

const {
  getXPipelineHealth,
  getXHybridAccountFetchStatus,
  getXHybridSourceStatus,
  markXHybridAccountFetched,
  markXHybridSource,
  openXPipelineDb,
  setXPipelineHealth,
} = await transpileToTemp();

const db = openXPipelineDb(":memory:");
assert.equal(getXHybridSourceStatus("telegram:1", db), null);

markXHybridSource(
  {
    sourceId: "telegram:1",
    status: "enriched",
    detail: "matched tweet",
    tweetId: "2048993047942181129",
  },
  db,
);

assert.deepEqual(getXHybridSourceStatus("telegram:1", db), {
  sourceId: "telegram:1",
  status: "enriched",
  detail: "matched tweet",
  tweetId: "2048993047942181129",
});

const cooldownMs = 30 * 60 * 1000;
assert.deepEqual(
  getXHybridAccountFetchStatus("@WatcherGuru", {
    cooldownMs,
    now: new Date("2026-04-28T10:00:00.000Z"),
    db,
  }),
  {
    username: "WatcherGuru",
    lastFetchedAt: null,
    nextAllowedAt: null,
    isCoolingDown: false,
  },
);

markXHybridAccountFetched("WatcherGuru", "2026-04-28T10:00:00.000Z", db);
assert.deepEqual(
  getXHybridAccountFetchStatus("watcherguru", {
    cooldownMs,
    now: new Date("2026-04-28T10:29:59.000Z"),
    db,
  }),
  {
    username: "WatcherGuru",
    lastFetchedAt: "2026-04-28T10:00:00.000Z",
    nextAllowedAt: "2026-04-28T10:30:00.000Z",
    isCoolingDown: true,
  },
);
assert.equal(
  getXHybridAccountFetchStatus("WatcherGuru", {
    cooldownMs,
    now: new Date("2026-04-28T10:30:00.000Z"),
    db,
  }).isCoolingDown,
  false,
);

setXPipelineHealth(
  {
    scope: "manual-catchup",
    status: "live",
    detail: "checked 3 pending telegram trigger messages",
  },
  db,
);

assert.match(getXPipelineHealth("manual-catchup", db)?.updatedAt ?? "", /^\d{4}-/);
assert.deepEqual(
  {
    ...getXPipelineHealth("manual-catchup", db),
    updatedAt: "stable",
  },
  {
    scope: "manual-catchup",
    status: "live",
    detail: "checked 3 pending telegram trigger messages",
    updatedAt: "stable",
  },
);

console.log("ok - x pipeline tracks processed hybrid telegram sources");
