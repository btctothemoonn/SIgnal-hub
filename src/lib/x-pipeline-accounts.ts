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

function normalizeTruthHandle(raw: string): string {
  return raw.trim().replace(/^truth:/i, "").replace(/^@+/, "");
}

function makeTruthAccount(handle: string): XPipelineAccountInput {
  return {
    username: `truth:${handle}`,
    name: handle,
    profileUrl: `https://truthsocial.com/@${handle}`,
    avatar: "",
    note: "985monitor truth config",
    tags: ["truth"],
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

export function getXPipelineConfiguredTruthAccounts(
  env: NodeJS.ProcessEnv = process.env,
): XPipelineAccountInput[] {
  const raw = env.MONITOR985_TRUTH_ACCOUNTS?.trim() || "realDonaldTrump";
  const result: XPipelineAccountInput[] = [];
  const seen = new Set<string>();

  for (const item of splitList(raw)) {
    const handle = normalizeTruthHandle(item);
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(makeTruthAccount(handle));
  }

  return result;
}
