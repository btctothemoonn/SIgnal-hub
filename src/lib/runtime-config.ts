import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CONFIG_PATH = resolve(process.cwd(), ".signal-hub", "runtime-config.json");

export type RuntimeWatchItem = { ref: string; tags: string[] };

export type RuntimeConfig = {
  telegramChannels: RuntimeWatchItem[];
  twitterAccounts: RuntimeWatchItem[];
};

type RawItem = string | { ref?: unknown; tags?: unknown } | null | undefined;
type RawRuntimeConfig = {
  telegramChannels?: unknown;
  twitterAccounts?: unknown;
};

const emptyConfig: RuntimeConfig = {
  telegramChannels: [],
  twitterAccounts: [],
};

let cache: RuntimeConfig | null = null;
let loadPromise: Promise<RuntimeConfig> | null = null;
let cacheMtimeMs: number | null = null;
let loadPromiseMtimeMs: number | null = null;

function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function sanitizeWatchList(values: unknown): RuntimeWatchItem[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: RuntimeWatchItem[] = [];
  for (const raw of values as RawItem[]) {
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ref: trimmed, tags: [] });
      continue;
    }
    if (raw && typeof raw === "object" && typeof raw.ref === "string") {
      const trimmed = raw.ref.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ref: trimmed, tags: sanitizeTags(raw.tags) });
    }
  }
  return result;
}

function normalize(raw: RawRuntimeConfig | null | undefined): RuntimeConfig {
  if (!raw || typeof raw !== "object") return { ...emptyConfig };
  return {
    telegramChannels: sanitizeWatchList(raw.telegramChannels),
    twitterAccounts: sanitizeWatchList(raw.twitterAccounts),
  };
}

async function getConfigMtimeMs(): Promise<number | null> {
  try {
    return (await stat(CONFIG_PATH)).mtimeMs;
  } catch {
    return null;
  }
}

async function readConfigFile(): Promise<{
  config: RuntimeConfig;
  mtimeMs: number | null;
}> {
  try {
    const content = await readFile(CONFIG_PATH, "utf-8");
    return {
      config: normalize(JSON.parse(content) as RawRuntimeConfig),
      mtimeMs: await getConfigMtimeMs(),
    };
  } catch {
    return { config: { ...emptyConfig }, mtimeMs: null };
  }
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const mtimeMs = await getConfigMtimeMs();
  if (cache && cacheMtimeMs === mtimeMs) return cache;
  if (!loadPromise || loadPromiseMtimeMs !== mtimeMs) {
    loadPromiseMtimeMs = mtimeMs;
    const promise = readConfigFile().then((record) => {
      cache = record.config;
      cacheMtimeMs = record.mtimeMs;
      return record.config;
    });
    loadPromise = promise.finally(() => {
      if (loadPromise === promise) {
        loadPromise = null;
        loadPromiseMtimeMs = null;
      }
    });
  }
  return loadPromise;
}

export function getCachedRuntimeConfig(): RuntimeConfig {
  return cache ?? { ...emptyConfig };
}

async function saveRuntimeConfig(config: RuntimeConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  const tmpPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmpPath, JSON.stringify(config, null, 2), "utf-8");
  await rename(tmpPath, CONFIG_PATH);
  cacheMtimeMs = await getConfigMtimeMs();
  cache = config;
}

type Listener = () => void | Promise<void>;
const changeListeners = new Set<Listener>();

export function onRuntimeConfigChange(listener: Listener): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

async function notifyListeners() {
  for (const listener of changeListeners) {
    try {
      await listener();
    } catch {
      // ignore listener errors
    }
  }
}

let mutationQueue: Promise<unknown> = Promise.resolve();

async function mutate(
  updater: (current: RuntimeConfig) => RuntimeConfig,
): Promise<RuntimeConfig> {
  const run = mutationQueue.then(async () => {
    const current = await loadRuntimeConfig();
    const next = normalize(updater(current));
    await saveRuntimeConfig(next);
    await notifyListeners();
    return next;
  });
  mutationQueue = run.catch(() => {});
  return run;
}

function findIndex(list: RuntimeWatchItem[], ref: string): number {
  const lower = ref.trim().toLowerCase();
  return list.findIndex((item) => item.ref.toLowerCase() === lower);
}

function addItem(list: RuntimeWatchItem[], ref: string): RuntimeWatchItem[] {
  const trimmed = ref.trim();
  if (!trimmed) return list;
  if (findIndex(list, trimmed) >= 0) return list;
  return [...list, { ref: trimmed, tags: [] }];
}

function addItems(
  list: RuntimeWatchItem[],
  refs: string[],
): RuntimeWatchItem[] {
  let next = list;
  for (const ref of refs) {
    next = addItem(next, ref);
  }
  return next;
}

function removeItem(list: RuntimeWatchItem[], ref: string): RuntimeWatchItem[] {
  const lower = ref.trim().toLowerCase();
  return list.filter((item) => item.ref.toLowerCase() !== lower);
}

function setItemTags(
  list: RuntimeWatchItem[],
  ref: string,
  tags: string[],
): RuntimeWatchItem[] {
  const idx = findIndex(list, ref);
  if (idx < 0) return list;
  const cleaned = sanitizeTags(tags);
  const next = list.slice();
  next[idx] = { ref: next[idx].ref, tags: cleaned };
  return next;
}

export async function addTelegramChannel(ref: string): Promise<RuntimeConfig> {
  return mutate((current) => ({
    ...current,
    telegramChannels: addItem(current.telegramChannels, ref),
  }));
}

export async function addTelegramChannels(
  refs: string[],
): Promise<RuntimeConfig> {
  return mutate((current) => ({
    ...current,
    telegramChannels: addItems(current.telegramChannels, refs),
  }));
}

export async function removeTelegramChannel(
  ref: string,
): Promise<RuntimeConfig> {
  return mutate((current) => ({
    ...current,
    telegramChannels: removeItem(current.telegramChannels, ref),
  }));
}

export async function setTelegramChannelTags(
  ref: string,
  tags: string[],
): Promise<RuntimeConfig> {
  return mutate((current) => ({
    ...current,
    telegramChannels: setItemTags(current.telegramChannels, ref, tags),
  }));
}

export async function addTwitterAccount(
  username: string,
): Promise<RuntimeConfig> {
  return mutate((current) => ({
    ...current,
    twitterAccounts: addItem(current.twitterAccounts, username),
  }));
}

export async function addTwitterAccounts(
  usernames: string[],
): Promise<RuntimeConfig> {
  return mutate((current) => ({
    ...current,
    twitterAccounts: addItems(current.twitterAccounts, usernames),
  }));
}

export async function removeTwitterAccount(
  username: string,
): Promise<RuntimeConfig> {
  return mutate((current) => ({
    ...current,
    twitterAccounts: removeItem(current.twitterAccounts, username),
  }));
}

export async function setTwitterAccountTags(
  username: string,
  tags: string[],
): Promise<RuntimeConfig> {
  return mutate((current) => ({
    ...current,
    twitterAccounts: setItemTags(current.twitterAccounts, username, tags),
  }));
}
