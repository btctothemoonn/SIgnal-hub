import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /SystemHealthPanel/);
assert.match(source, /type Kind = "telegram" \| "twitter" \| "douyin" \| "health"/);
assert.match(source, /kind: "douyin"/);
assert.match(source, /douyinCreators/);
assert.match(source, /action: "douyin\.add"/);
assert.match(source, /action: "douyin\.remove"/);
assert.match(source, /action: "douyin\.setTags"/);
assert.match(source, /kind: "health"/);
assert.match(source, /activeKind === "health"/);

console.log("ok - settings includes health and douyin tabs");
