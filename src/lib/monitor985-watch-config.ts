import type { XPipelineAccountInput } from "./x-pipeline-store";

export type Monitor985WatchAccount = {
  handle: string;
  displayName: string;
  remark: string;
  tags: string[];
  favorite: boolean;
  alertSound: string;
  source: string;
};

export type Monitor985ParsedWatchConfig = {
  configuredTwitter: Monitor985WatchAccount[];
  extraTwitter: Monitor985WatchAccount[];
  unfollowedTwitter: string[];
  effectiveTwitter: Monitor985WatchAccount[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanHandle(value: string): string {
  return value.trim().replace(/^@+/, "");
}

function accountKey(value: string): string {
  return cleanHandle(value).toLowerCase();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const valueText = text(item);
    const key = valueText.toLowerCase();
    if (!valueText || seen.has(key)) continue;
    seen.add(key);
    out.push(valueText);
  }
  return out;
}

function pickHandle(item: unknown): string {
  if (typeof item === "string") return cleanHandle(item);
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  return cleanHandle(
    text(record.handle) ||
      text(record.username) ||
      text(record.screenName) ||
      text(record.uid) ||
      text(record.ref),
  );
}

function normalizeAccount(item: unknown): Monitor985WatchAccount | null {
  const handle = pickHandle(item);
  if (!handle) return null;

  const record =
    item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  return {
    handle,
    displayName:
      text(record.displayName) || text(record.name) || text(record.userName) || handle,
    remark: text(record.remark) || text(record.note),
    tags: stringArray(record.tags),
    favorite: Boolean(record.favorite),
    alertSound: text(record.alertSound),
    source: text(record.source) || "985monitor",
  };
}

function normalizeAccountList(value: unknown): Monitor985WatchAccount[] {
  if (!Array.isArray(value)) return [];
  const out: Monitor985WatchAccount[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const account = normalizeAccount(item);
    if (!account) continue;
    const key = accountKey(account.handle);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(account);
  }
  return out;
}

function normalizeHandleList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const handle = pickHandle(item);
    const key = accountKey(handle);
    if (!handle || seen.has(key)) continue;
    seen.add(key);
    out.push(handle);
  }
  return out;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeEffective(
  configured: Monitor985WatchAccount[],
  extra: Monitor985WatchAccount[],
  unfollowed: string[],
): Monitor985WatchAccount[] {
  const blocked = new Set(unfollowed.map(accountKey));
  const merged = new Map<string, Monitor985WatchAccount>();
  for (const account of [...configured, ...extra]) {
    const key = accountKey(account.handle);
    if (!key || blocked.has(key)) continue;
    merged.set(key, account);
  }
  return Array.from(merged.values());
}

export function parseMonitor985WatchConfig(raw: unknown): Monitor985ParsedWatchConfig {
  const root = objectValue(raw);
  const config = objectValue(root.config);
  const overlay = objectValue(root.overlay);
  const overlayTwitter = objectValue(overlay.twitter);

  const configuredTwitter = normalizeAccountList(config.twitter);
  const extraTwitter = normalizeAccountList(overlayTwitter.extraFollows);
  const unfollowedTwitter = normalizeHandleList(overlayTwitter.unfollowed);

  return {
    configuredTwitter,
    extraTwitter,
    unfollowedTwitter,
    effectiveTwitter: mergeEffective(configuredTwitter, extraTwitter, unfollowedTwitter),
  };
}

export function toMonitor985XPipelineAccounts(
  config: Monitor985ParsedWatchConfig,
): XPipelineAccountInput[] {
  return config.effectiveTwitter.map((account) => {
    const note = ["985monitor", account.source, account.remark]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" / ");
    return {
      username: account.handle,
      name: account.displayName || account.handle,
      profileUrl: `https://x.com/${account.handle}`,
      avatar: `https://unavatar.io/twitter/${account.handle}`,
      note,
      tags: account.tags,
    };
  });
}

export function buildMonitor985FollowExtraBody(username: string) {
  const handle = cleanHandle(username);
  return {
    alertSound: "",
    displayName: handle,
    favorite: false,
    handle,
    remark: "Signal Hub",
    source: "twitter",
  };
}

export function buildMonitor985UnfollowBody(username: string) {
  return {
    handle: cleanHandle(username),
    source: "twitter",
  };
}
