import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");

assert.match(source, /<aside className="[^"]*lg:sticky[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:top-0[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:h-screen[^"]*"/);
assert.match(source, /<form action="\/api\/logout" method="post"/);
assert.match(source, /type="submit"/);

assert.match(source, /data-mobile-command-shell/);
assert.match(source, /overflow-x-auto/);
assert.match(source, /fixed bottom-0/);
assert.match(source, /lg:hidden/);
assert.match(source, /pb-20 lg:pb-0/);
assert.match(source, /\{subtitle \? \(/);
assert.match(source, /router\.prefetch\("\/settings"\)/);

console.log("ok - app shell mobile command layout");
