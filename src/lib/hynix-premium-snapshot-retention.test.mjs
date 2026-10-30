import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearHynixPremiumLastGoodMemoryForTests,
  recallHynixPremiumLastGood,
  rememberHynixPremiumLastGood,
  retainHynixPremiumSnapshot,
} from "./hynix-premium-snapshot-retention.ts";

function point(openTime, premiumPct) {
  return {
    openTime,
    closeTime: openTime + 299_999,
    capturedAt: new Date(openTime).toISOString(),
    baseSymbol: "SKHYUSDT",
    benchmarkSymbol: "SKHYNIXUSDT",
    basePrice: 1,
    baseOpenPrice: 1,
    baseHighPrice: 1,
    baseLowPrice: 1,
    baseClosePrice: 1,
    benchmarkPrice: 1,
    benchmarkOpenPrice: 1,
    benchmarkHighPrice: 1,
    benchmarkLowPrice: 1,
    benchmarkClosePrice: 1,
    premiumPct,
    premiumOpenPct: premiumPct,
    premiumHighPct: premiumPct,
    premiumLowPct: premiumPct,
    premiumClosePct: premiumPct,
    volume: 1,
  };
}

function snapshot(points, errors = []) {
  return {
    generatedAt: "2026-10-30T00:00:00.000Z",
    source: points.length ? "live" : "empty",
    provider: "binance-futures",
    interval: "5m",
    symbols: { base: "SKHYUSDT", benchmark: "SKHYNIXUSDT" },
    websocket: { url: "wss://example.test/ws", streams: [] },
    points,
    latest: points.at(-1) ?? null,
    errors,
  };
}

const good = snapshot([point(1, 10), point(2, 12)]);
const retained = retainHynixPremiumSnapshot(good, null);
assert.equal(retained.stale, false);
assert.equal(retained.dataAsOf, good.latest.capturedAt);

const failed = snapshot([point(9, 1)], ["SKHYUSDT Binance futures kline HTTP 429"]);
const served = retainHynixPremiumSnapshot(failed, good);
assert.equal(served.stale, true);
assert.equal(served.points.length, 2);
assert.equal(served.points[1].premiumPct, 12);
assert.equal(served.dataAsOf, good.latest.capturedAt);
assert.match(served.errors[0], /429/);

const directory = mkdtempSync(join(tmpdir(), "hynix-last-good-"));
const env = { SIGNAL_HUB_RUNTIME_DIR: directory };
try {
  rememberHynixPremiumLastGood(good, env);
  clearHynixPremiumLastGoodMemoryForTests();
  const loaded = recallHynixPremiumLastGood("5m", env);
  assert.equal(loaded?.points.length, 2);
  const afterRestart = retainHynixPremiumSnapshot(failed, loaded);
  assert.equal(afterRestart.stale, true);
  assert.equal(afterRestart.points.length, 2);
  rememberHynixPremiumLastGood(failed, env);
  clearHynixPremiumLastGoodMemoryForTests();
  assert.equal(recallHynixPremiumLastGood("5m", env)?.points[1].premiumPct, 12);
} finally {
  clearHynixPremiumLastGoodMemoryForTests();
  rmSync(directory, { recursive: true, force: true });
}

console.log("ok - hynix premium snapshot retention");
