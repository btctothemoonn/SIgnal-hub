import { resolve } from "node:path";

export const X_OWNED_READER_DEFAULT_USERNAMES = [
  "hzzzz666", "photoncap", "woody168888", "fi56622380", "chaoxiangooo", "1kbxx", "fffffiyes_yu",
] as const;

export type XOwnedReaderConfig = {
  enabled: boolean;
  allowlist: string[];
  pythonPath: string;
  bridgePath: string;
  sessionDbPath: string;
  cooldownFilePath: string;
  intervalMs: number;
  maxRequests: number;
  deadlineMs: number;
  minIntervalMs: number;
  maxPages: number;
  staleAfterMs: number;
};
export type XOwnedReaderEnv = Record<string, string | undefined>;

export function normalizeXOwnedUsername(value: unknown): string {
  if (typeof value !== "string") return "";
  const username = value.trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username.toLowerCase() : "";
}

function positive(raw: string | undefined, fallback: number) {
  const value = Number(raw?.trim());
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getXOwnedReaderConfig(env: XOwnedReaderEnv = process.env): XOwnedReaderConfig {
  const rawAllowlist = env.X_OWNED_READER_USERNAMES;
  const allowlist = rawAllowlist === undefined
    ? [...X_OWNED_READER_DEFAULT_USERNAMES]
    : [...new Set(rawAllowlist.split(/[\s,，]+/).map(normalizeXOwnedUsername).filter(Boolean))];
  return {
    enabled: ["1", "true", "yes", "on"].includes(env.X_OWNED_READER_ENABLED?.trim().toLowerCase() || ""),
    allowlist,
    pythonPath: env.X_OWNED_READER_PYTHON?.trim() || "python3",
    bridgePath: env.X_OWNED_READER_BRIDGE_PATH?.trim() || resolve(process.cwd(), "scripts", "x-owned-reader-bridge.py"),
    sessionDbPath: env.X_OWNED_READER_SESSION_DB?.trim() || "",
    cooldownFilePath: env.X_OWNED_READER_COOLDOWN_FILE?.trim() || "",
    intervalMs: Math.max(300_000, positive(env.X_OWNED_READER_INTERVAL_MS, 300_000)),
    maxRequests: Math.min(80, positive(env.X_OWNED_READER_MAX_REQUESTS, 80)),
    deadlineMs: Math.min(180_000, positive(env.X_OWNED_READER_DEADLINE_MS, 180_000)),
    minIntervalMs: Math.max(2_000, positive(env.X_OWNED_READER_MIN_INTERVAL_MS, 2_000)),
    maxPages: Math.min(5, positive(env.X_OWNED_READER_MAX_PAGES, 5)),
    staleAfterMs: 600_000,
  };
}

export function selectXOwnedReaderAccounts(usernames: readonly string[], config: XOwnedReaderConfig): string[] {
  const allowed = new Set(config.allowlist);
  const seen = new Set<string>();
  return usernames.filter((username) => {
    const key = normalizeXOwnedUsername(username);
    if (!key || !allowed.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
