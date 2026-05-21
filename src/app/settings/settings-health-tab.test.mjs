import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /SystemHealthPanel/);
assert.match(source, /type Kind = "telegram" \| "twitter" \| "health"/);
assert.match(source, /kind: "health"/);
assert.match(source, /activeKind === "health"/);

console.log("ok - settings includes health tab");
