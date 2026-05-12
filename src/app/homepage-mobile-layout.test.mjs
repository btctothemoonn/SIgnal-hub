import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /mainClassName="[^"]*gap-3[^"]*lg:gap-4[^"]*"/);
assert.match(source, /<section id="signals" className="[^"]*order-2[^"]*lg:order-1[^"]*"/);
assert.match(source, /<aside\s+id="alpha"\s+className="[^"]*order-1[^"]*lg:order-2[^"]*"/);
assert.match(source, /className="[^"]*mobile-command-summary[^"]*"/);

console.log("ok - homepage mobile command ordering");
