import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAlphaSummaryDbPath } from "./alpha-summary.ts";
import { stocksPerformanceDbPath } from "./stocks-performance-data.ts";
import { getTelegramPipelineConfig } from "./telegram-pipeline-config.ts";
import { getXPipelineConfig } from "./x-pipeline-config.ts";

const vercelEnv = { VERCEL: "1" };
const runtimeRoot = join(tmpdir(), "signal-hub");

assert.equal(
  getTelegramPipelineConfig(vercelEnv).dbPath,
  join(runtimeRoot, "telegram-pipeline.sqlite"),
);
assert.equal(
  getTelegramPipelineConfig(vercelEnv).mediaDir,
  join(runtimeRoot, "telegram-media"),
);
assert.equal(
  getXPipelineConfig(vercelEnv).dbPath,
  join(runtimeRoot, "x-pipeline.sqlite"),
);
assert.equal(
  getAlphaSummaryDbPath(vercelEnv, "signals"),
  join(runtimeRoot, "signal-summary.sqlite"),
);
assert.equal(
  getAlphaSummaryDbPath(vercelEnv, "stocks"),
  join(runtimeRoot, "stocks-summary.sqlite"),
);
assert.equal(
  stocksPerformanceDbPath(vercelEnv),
  join(runtimeRoot, "stocks-data.sqlite"),
);

assert.match(
  getXPipelineConfig({}).dbPath,
  /[\\/]\.signal-hub[\\/]x-pipeline\.sqlite$/,
);

console.log("ok - vercel runtime storage uses writable tmp paths");
