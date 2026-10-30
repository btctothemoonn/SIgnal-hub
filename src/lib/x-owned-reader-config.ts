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
  softCooldownEnabled: boolean;
  structuralIsolateAfter: number;
  structuralRetryMs: number;
  auditEnabled: boolean;
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

export const X_OWNED_STALE_FLOOR_MS = 600_000;
export const X_OWNED_STALE_SLACK_MS = 720_000;
export const X_OWNED_SOFT_COOLDOWN_CAP_MS = 12 * 60_000;
export const X_OWNED_SOFT_COOLDOWN_INTERVAL_LIMIT_MS = 15 * 60_000;
export const X_OWNED_SOFT_COOLDOWN_REQUEST_RATIO = 0.7;
export const X_OWNED_STRUCTURAL_ISOLATE_AFTER = 5;
export const X_OWNED_STRUCTURAL_RETRY_MS = 6 * 60 * 60_000;

export function ownedReaderStaleAfterMs(intervalMs: number, override?: number | null) {
  if (typeof override === "number" && Number.isInteger(override) && override > 0) return override;
  return Math.max(X_OWNED_STALE_FLOOR_MS, intervalMs + X_OWNED_STALE_SLACK_MS);
}

export function xOwnedReaderSoftCooldownMs(config: Pick<XOwnedReaderConfig, "softCooldownEnabled" | "intervalMs" | "minIntervalMs">) {
  if (!config.softCooldownEnabled || config.intervalMs >= X_OWNED_SOFT_COOLDOWN_INTERVAL_LIMIT_MS) return null;
  return Math.max(config.minIntervalMs, Math.min(config.intervalMs, X_OWNED_SOFT_COOLDOWN_CAP_MS));
}

function enabledFlag(raw: string | undefined, fallback: boolean) {
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function getXOwnedReaderConfig(env: XOwnedReaderEnv = process.env): XOwnedReaderConfig {
  const rawAllowlist = env.X_OWNED_READER_USERNAMES;
  const allowlist = rawAllowlist === undefined
    ? [...X_OWNED_READER_DEFAULT_USERNAMES]
    : [...new Set(rawAllowlist.split(/[\s,，]+/).map(normalizeXOwnedUsername).filter(Boolean))];
  const intervalMs = Math.max(300_000, positive(env.X_OWNED_READER_INTERVAL_MS, 300_000));
  return {
    enabled: ["1", "true", "yes", "on"].includes(env.X_OWNED_READER_ENABLED?.trim().toLowerCase() || ""),
    allowlist,
    pythonPath: env.X_OWNED_READER_PYTHON?.trim() || "python3",
    bridgePath: env.X_OWNED_READER_BRIDGE_PATH?.trim() || resolve(process.cwd(), "scripts", "x-owned-reader-bridge.py"),
    sessionDbPath: env.X_OWNED_READER_SESSION_DB?.trim() || "",
    cooldownFilePath: env.X_OWNED_READER_COOLDOWN_FILE?.trim() || "",
    intervalMs,
    maxRequests: Math.min(80, positive(env.X_OWNED_READER_MAX_REQUESTS, 80)),
    deadlineMs: Math.min(180_000, positive(env.X_OWNED_READER_DEADLINE_MS, 180_000)),
    minIntervalMs: Math.max(2_000, positive(env.X_OWNED_READER_MIN_INTERVAL_MS, 2_000)),
    maxPages: Math.min(5, positive(env.X_OWNED_READER_MAX_PAGES, 5)),
    staleAfterMs: ownedReaderStaleAfterMs(intervalMs, positive(env.X_OWNED_READER_STALE_AFTER_MS, 0) || null),
    softCooldownEnabled: enabledFlag(env.X_OWNED_READER_SOFT_COOLDOWN, true),
    structuralIsolateAfter: positive(env.X_OWNED_READER_STRUCTURAL_ISOLATE_AFTER, X_OWNED_STRUCTURAL_ISOLATE_AFTER),
    structuralRetryMs: positive(env.X_OWNED_READER_STRUCTURAL_RETRY_MS, X_OWNED_STRUCTURAL_RETRY_MS),
    auditEnabled: ["1", "true", "yes", "on"].includes(env.X_985_AUDIT_ENABLED?.trim().toLowerCase() || ""),
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
