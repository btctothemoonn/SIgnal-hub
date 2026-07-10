import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../eslint.config.mjs", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /"\.worktrees\/\*\*"/,
  "ESLint must ignore generated files in local Git worktrees",
);

console.log("ok - eslint ignores local worktree build output");
