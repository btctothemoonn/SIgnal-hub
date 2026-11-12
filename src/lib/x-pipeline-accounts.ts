import type { RuntimeConfig } from "@/lib/runtime-config";
import type { XPipelineAccountInput } from "./x-pipeline-store.ts";

function sanitizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,\s，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function makeAccount(username: string, tags: string[]): XPipelineAccountInput {
  return {
    username,
    name: username,
    profileUrl: `https://x.com/${username}`,
    avatar: `https://unavatar.io/twitter/${username}`,
    note: "local config",
    tags,
  };
}

export function getXPipelineConfiguredAccounts(
  config: RuntimeConfig,
  env: NodeJS.ProcessEnv = process.env,
): XPipelineAccountInput[] {
  const result: XPipelineAccountInput[] = [];
  const seen = new Set<string>();

  const add = (raw: string, tags: string[] = []) => {
    const username = sanitizeUsername(raw);
    if (!username) return;
    const key = username.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(makeAccount(username, tags));
  };

  for (const account of config.twitterAccounts) {
    add(account.ref, account.tags);
  }

  for (const account of splitList(env.TWITTER_WATCH_USERNAMES)) {
    add(account, []);
  }

  return result;
}
