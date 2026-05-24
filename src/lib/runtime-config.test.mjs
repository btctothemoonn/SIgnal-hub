import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const originalCwd = process.cwd();
const dir = await mkdtemp(join(tmpdir(), "signal-hub-runtime-config-"));

try {
  process.chdir(dir);
  await mkdir(".signal-hub", { recursive: true });
  const configPath = join(".signal-hub", "runtime-config.json");

  await writeFile(
    configPath,
    JSON.stringify({
      telegramChannels: ["old_channel"],
      twitterAccounts: [],
    }),
    "utf8",
  );

  const runtimeConfig = await import(
    new URL(`./runtime-config.ts?reload-test=${Date.now()}`, import.meta.url)
  );

  const first = await runtimeConfig.loadRuntimeConfig();
  assert.deepEqual(
    first.telegramChannels.map((item) => item.ref),
    ["old_channel"],
  );
  assert.deepEqual(first.douyinCreators, []);

  const withDouyin = await runtimeConfig.addDouyinCreator(
    "https://www.douyin.com/user/MS4wLjABAAAAcreator",
  );
  assert.deepEqual(
    withDouyin.douyinCreators.map((item) => item.ref),
    ["https://www.douyin.com/user/MS4wLjABAAAAcreator"],
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(
    configPath,
    JSON.stringify({
      telegramChannels: ["new_channel"],
      twitterAccounts: [{ ref: "new_x", tags: ["watch"] }],
      douyinCreators: [{ ref: "douyin_author", tags: ["stocks"] }],
    }),
    "utf8",
  );

  const second = await runtimeConfig.loadRuntimeConfig();
  assert.deepEqual(
    second.telegramChannels.map((item) => item.ref),
    ["new_channel"],
  );
  assert.deepEqual(second.douyinCreators, [
    { ref: "douyin_author", tags: ["stocks"] },
  ]);
  assert.deepEqual(runtimeConfig.getCachedRuntimeConfig(), second);
} finally {
  process.chdir(originalCwd);
  await rm(dir, { recursive: true, force: true });
}

console.log("ok - runtime config reloads when the file changes");
