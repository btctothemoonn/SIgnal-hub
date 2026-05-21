import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(
  new URL("./check-system-health.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

assert.match(script, /getSystemHealthSnapshot/);
assert.match(script, /SIGNAL_HUB_SYSTEMD_SERVICES/);
assert.match(script, /--strict/);
assert.match(script, /process\.exitCode = 1/);
assert.match(packageJson.scripts["health:check"], /check-system-health\.mjs/);

console.log("ok - system health check script contract");
