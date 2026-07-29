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
assert.match(source, /data-settings-workspace/);
assert.match(source, /data-settings-category-tabs/);
assert.match(source, /data-settings-editor/);
assert.match(source, /lg:grid-cols-\[15rem_minmax\(0,1fr\)\]/);
assert.match(source, /overflow-x-auto/);

console.log("ok - settings includes health and douyin tabs");
