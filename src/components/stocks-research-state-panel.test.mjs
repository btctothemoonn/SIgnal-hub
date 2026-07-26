import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stocks-research-state-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /观察/);
assert.match(source, /等待/);
assert.match(source, /持有/);
assert.match(source, /回避/);
assert.match(source, /买入区/);
assert.match(source, /失效条件/);
assert.match(source, /下个催化/);
assert.match(source, /研究逻辑/);
assert.match(source, /保存研究状态/);
assert.match(source, /onSave/);
assert.match(source, /保存失败/);
assert.match(source, /updatedAt/);
assert.match(source, /disabled=\{loading \|\| saving\}/);
assert.match(source, /await onSave/);

console.log("ok - stocks research state editor contract");
