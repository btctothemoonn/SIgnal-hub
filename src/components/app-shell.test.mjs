import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");

assert.match(source, /<aside className="[^"]*lg:sticky[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:top-0[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:h-screen[^"]*"/);
assert.match(source, /href="\/api\/logout"/);

console.log("ok - app shell sidebar layout");
