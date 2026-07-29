import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("./login-form.tsx", import.meta.url), "utf8");

assert.match(page, /data-login-workspace/);
assert.match(page, /Signal Hub/);
assert.doesNotMatch(page, /landing|hero|marketing/i);
assert.match(form, /action="\/api\/login"/);
assert.match(form, /autoComplete="current-password"/);
assert.match(form, /rounded-\[6px\]/);
assert.match(form, /text-danger/);

console.log("ok - login command workspace layout");
