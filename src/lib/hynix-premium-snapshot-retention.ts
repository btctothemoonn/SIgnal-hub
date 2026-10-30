import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BinanceHynixPremiumInterval, BinanceHynixPremiumSnapshot } from "./binance-hynix-premium.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

const lastGoodByInterval = new Map<BinanceHynixPremiumInterval, BinanceHynixPremiumSnapshot>();

export function hynixPremiumDataAsOf(snapshot: BinanceHynixPremiumSnapshot) {
  return snapshot.latest?.capturedAt ?? snapshot.points.at(-1)?.capturedAt ?? null;
}

export function isHealthyHynixPremiumSnapshot(snapshot: BinanceHynixPremiumSnapshot) {
  return snapshot.points.length > 1 && snapshot.errors.length === 0;
}

export function retainHynixPremiumSnapshot(
  snapshot: BinanceHynixPremiumSnapshot,
  lastGood: BinanceHynixPremiumSnapshot | null,
): BinanceHynixPremiumSnapshot {
  if (isHealthyHynixPremiumSnapshot(snapshot)) {
    return {
      ...snapshot,
      stale: false,
      dataAsOf: hynixPremiumDataAsOf(snapshot),
    };
  }
  if (lastGood && lastGood.interval === snapshot.interval && lastGood.points.length > 1) {
    return {
      ...lastGood,
      errors: snapshot.errors.length > 0 ? snapshot.errors : lastGood.errors,
      stale: true,
      dataAsOf: hynixPremiumDataAsOf(lastGood),
    };
  }
  return {
    ...snapshot,
    stale: true,
    dataAsOf: hynixPremiumDataAsOf(snapshot),
  };
}

function lastGoodPath(interval: BinanceHynixPremiumInterval, env: Record<string, string | undefined> = process.env) {
  return getRuntimeDataPath(env, "hynix-premium-last-good", `${interval}.json`);
}

export function rememberHynixPremiumLastGood(
  snapshot: BinanceHynixPremiumSnapshot,
  env: Record<string, string | undefined> = process.env,
) {
  if (!isHealthyHynixPremiumSnapshot(snapshot)) return;
  const stored = { ...snapshot, stale: false, dataAsOf: hynixPremiumDataAsOf(snapshot) };
  lastGoodByInterval.set(snapshot.interval, stored);
  const path = lastGoodPath(snapshot.interval, env);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(stored));
  renameSync(temporary, path);
}

export function recallHynixPremiumLastGood(
  interval: BinanceHynixPremiumInterval,
  env: Record<string, string | undefined> = process.env,
): BinanceHynixPremiumSnapshot | null {
  const cached = lastGoodByInterval.get(interval);
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(lastGoodPath(interval, env), "utf8")) as BinanceHynixPremiumSnapshot;
    if (parsed?.interval !== interval || !Array.isArray(parsed.points) || parsed.points.length <= 1) return null;
    lastGoodByInterval.set(interval, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function clearHynixPremiumLastGoodMemoryForTests() {
  lastGoodByInterval.clear();
}
