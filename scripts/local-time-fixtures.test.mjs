import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [
  "src/lib/display-time.test.mjs",
  "src/components/market-alerts-panel.behavior.test.mjs",
];

for (const timeZone of ["UTC", "Asia/Shanghai", "America/Los_Angeles"]) {
  for (const file of files) {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--experimental-transform-types", file],
      { cwd: root, env: { ...process.env, TZ: timeZone }, encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `${file} must pass in ${timeZone}\n${result.stdout}\n${result.stderr}`,
    );
  }
  console.log(`ok - local-time fixtures pass in ${timeZone}`);
}
