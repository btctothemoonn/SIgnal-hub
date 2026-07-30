import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
const dir = await mkdtemp(join(tmpdir(), "signal-hub-douyin-toggle-"));

try {
  process.chdir(dir);
  await mkdir(".signal-hub", { recursive: true });
  await writeFile(
    join(".signal-hub", "runtime-config.json"),
    JSON.stringify({
      telegramChannels: [],
      twitterAccounts: [],
      douyinCreators: [{ ref: "https://www.douyin.com/user/test", tags: [] }],
      douyinEnabled: false,
    }),
    "utf8",
  );

  let externalRequests = 0;
  globalThis.fetch = async () => {
    externalRequests += 1;
    throw new Error("disabled douyin monitor must not fetch");
  };

  const { refreshDouyinMonitor } = await import(
    new URL(`./douyin-monitor.ts?toggle-test=${Date.now()}`, import.meta.url)
  );
  const snapshot = await refreshDouyinMonitor();

  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.configured, true);
  assert.equal(externalRequests, 0);
} finally {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  await rm(dir, { recursive: true, force: true });
}

console.log("ok - disabled douyin monitor skips all external requests");
