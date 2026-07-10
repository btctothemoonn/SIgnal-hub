import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /getLoginClientKey\(request\)/);
assert.match(source, /checkLoginRateLimit\(clientKey\)/);
assert.match(source, /recordLoginFailure\(clientKey\)/);
assert.match(source, /clearLoginFailures\(clientKey\)/);
assert.ok(
  source.indexOf("checkLoginRateLimit(clientKey)") <
    source.indexOf('verifyAdminPassword(formData.get("password"))'),
  "rate-limit check must happen before password verification",
);

console.log("ok - login route applies the failure limiter");
