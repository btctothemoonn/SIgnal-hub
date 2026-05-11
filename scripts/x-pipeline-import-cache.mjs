import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { importXPipelineSnapshot, setXPipelineHealth } from "../src/lib/x-pipeline-store.ts";

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {}
}

async function main() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));

  const cachePath =
    process.env.TWITTER_SNAPSHOT_CACHE_FILE?.trim() ||
    join(process.cwd(), ".signal-hub", "twitter-snapshot-cache.json");

  let payload;
  try {
    payload = JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    console.log(JSON.stringify({ event: "x_cache_import_skipped", reason: "missing_cache" }));
    return;
  }

  if (!payload?.snapshot || payload.snapshot.provider !== "6551") {
    console.log(JSON.stringify({ event: "x_cache_import_skipped", reason: "invalid_cache" }));
    return;
  }

  importXPipelineSnapshot(payload.snapshot);
  setXPipelineHealth({
    scope: "collector",
    status: "stale",
    detail: "Imported old twitter snapshot cache; waiting for websocket",
  });
  console.log(
    JSON.stringify({
      event: "x_cache_imported",
      feed: payload.snapshot.feed?.length || 0,
      accounts: payload.snapshot.watchAccounts?.length || 0,
    }),
  );
}

main().catch((error) => {
  setXPipelineHealth({
    scope: "collector",
    status: "error",
    detail: String(error),
  });
  console.error(JSON.stringify({ event: "x_cache_import_failed", error: String(error) }));
  process.exit(1);
});
