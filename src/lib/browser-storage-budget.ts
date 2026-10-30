export const REBUILDABLE_STORAGE_BUDGET_CHARS = 1_500_000;

const exactRebuildableKeys = new Set([
  "signal-hub:stocks:hynix-premium:5m:v1",
  "signal-hub:stocks:hynix-premium:5m:v2",
  "signal-hub:stocks:hynix-premium:v3:5m",
  "signal-hub:stocks:hynix-premium:v3:1h",
  "signal-hub:stocks:hynix-premium:v3:1d",
  "signal-hub:stocks:hynix-funding:v1",
  "signal-hub:stocks:market-snapshot:v1",
  "signal-hub:stocks:financial-snapshot:v1",
  "signal-hub.binance-holding-snapshot.v1",
  "signal-hub.tiger-holding-snapshot.v1",
  "signal-hub.tiger-equity-history.v1",
]);

export type BudgetStorage = {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
};

export function isRebuildableBrowserStorageKey(key: string): boolean {
  if (exactRebuildableKeys.has(key) || /^signal-hub:stocks:hynix-premium:v4:(1m|5m|1h|1d)$/.test(key)) return true;
  const prefix = "signal-hub:stocks:performance-snapshot:v1:";
  if (!key.startsWith(prefix)) return false;
  const tickers = key.slice(prefix.length);
  try { return tickers.length > 0 && encodeURIComponent(decodeURIComponent(tickers)) === tickers; } catch { return false; }
}

function evictionRank(key: string) {
  if (/hynix-premium:(?:5m:v1|5m:v2|v3:)/.test(key) || key.endsWith(":v4:1m")) return 0;
  if (key.startsWith("signal-hub:stocks:performance-snapshot:")) return 1;
  if (key.endsWith(":v4:1h") || key.endsWith(":v4:1d")) return 2;
  if (key.includes("funding") || key.includes("market-snapshot") || key.includes("financial-snapshot")) return 3;
  if (key.endsWith(":v4:5m")) return 4;
  return 5;
}

export function enforceRebuildableStorageBudget(
  storage: BudgetStorage,
  key: string,
  value: string,
  budget = REBUILDABLE_STORAGE_BUDGET_CHARS,
): string[] {
  if (!isRebuildableBrowserStorageKey(key)) return [];
  const entries: Array<{ key: string; length: number }> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index);
    if (!name || name === key || !isRebuildableBrowserStorageKey(name)) continue;
    entries.push({ key: name, length: storage.getItem(name)?.length ?? 0 });
  }
  let used = entries.reduce((sum, entry) => sum + entry.length, 0);
  const removed: string[] = [];
  while (used + value.length > budget && entries.length > 0) {
    entries.sort((left, right) => evictionRank(left.key) - evictionRank(right.key) || right.length - left.length);
    const next = entries.shift();
    if (!next) break;
    storage.removeItem(next.key);
    removed.push(next.key);
    used -= next.length;
  }
  return removed;
}
