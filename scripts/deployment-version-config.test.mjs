import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "signal-version-config-"));
const previous = process.cwd();
const configUrl = new URL("../next.config.ts", import.meta.url);
let query = 0;
const config = async () => (await import(`${configUrl.href}?fixture=${++query}`)).default;
try {
  process.chdir(directory);
  const local = (await config()).env.NEXT_PUBLIC_SIGNAL_HUB_VERSION;
  assert.match(local, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  for (const expected of ["d".repeat(40), "e".repeat(64)]) {
    writeFileSync(join(directory, ".release-commit"), `${expected}\n`);
    assert.equal((await config()).env.NEXT_PUBLIC_SIGNAL_HUB_VERSION, expected);
  }
  writeFileSync(join(directory, ".release-commit"), "not-a-commit\nprivate configuration");
  const invalid = (await config()).env.NEXT_PUBLIC_SIGNAL_HUB_VERSION;
  assert.match(invalid, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.notEqual(local, invalid, "independent local builds receive distinct identifiers");
  console.log("ok - builds expose validated release markers and unique local fallback versions");
} finally {
  process.chdir(previous);
  rmSync(directory, { recursive: true, force: true });
}
