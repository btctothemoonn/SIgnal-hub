import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  pruneMarketAlertKlineCharts,
  readMarketAlertKlineChart,
  renderMarketAlertKlineSvg,
  writeMarketAlertKlineChart,
} = await import("./market-alerts-chart.ts");

function kline(index, open, high, low, close, volume) {
  const openTime = Date.parse("2026-08-31T00:00:00.000Z") + index * 300_000;
  return [
    openTime,
    String(open),
    String(high),
    String(low),
    String(close),
    String(volume),
    openTime + 299_999,
    String(volume * close),
  ];
}

const klines = [
  kline(0, 100, 104, 99, 103, 20),
  kline(1, 103, 105, 100, 101, 18),
  kline(2, 101, 108, 100, 107, 34),
  kline(3, 107, 109, 105, 106, 25),
];

const svg = renderMarketAlertKlineSvg({
  symbol: "BTCUSDT",
  interval: "5m",
  klines,
  generatedAt: "2026-08-31T00:20:00.000Z",
});

assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
assert.match(svg, /BTCUSDT · 5m/);
assert.match(svg, /最新 106/);
assert.match(svg, /2026-08-31 08:20/);
assert.equal((svg.match(/data-candle=/g) ?? []).length, 4);
assert.equal((svg.match(/data-volume=/g) ?? []).length, 4);
assert.match(svg, /#22c77a/);
assert.match(svg, /#ef5a5a/);

const directory = mkdtempSync(join(tmpdir(), "market-alert-chart-"));
try {
  const first = await writeMarketAlertKlineChart({
    symbol: "btcusdt",
    interval: "5m",
    klines,
    generatedAt: "2026-08-31T00:20:00.000Z",
    sourceKey: "1788134400000_1788134400000_aaaaaaaaaaaa",
    runtimeRoot: directory,
  });
  assert.equal(first.symbol, "BTCUSDT");
  assert.equal(first.interval, "5m");
  assert.equal(first.updatedAt, "2026-08-31T00:20:00.000Z");
  assert.equal(first.sourceKey, "1788134400000_1788134400000_aaaaaaaaaaaa");
  assert.equal(typeof first.removeSource, "function");
  assert.equal(typeof first.pruneOlder, "function");

  const firstFile = await readMarketAlertKlineChart("BTCUSDT", {
    runtimeRoot: directory,
    sourceKey: first.sourceKey,
  });
  assert.ok(firstFile);
  assert.match(firstFile.toString("utf8"), /最新 106/);

  const replacement = klines.slice(0, -1).concat([
    kline(3, 107, 112, 106, 111, 42),
  ]);
  const second = await writeMarketAlertKlineChart({
    symbol: "BTCUSDT",
    interval: "5m",
    klines: replacement,
    generatedAt: "2026-08-31T00:25:00.000Z",
    sourceKey: "1788134700000_1788134700000_bbbbbbbbbbbb",
    runtimeRoot: directory,
  });
  const replacedFile = await readMarketAlertKlineChart("BTCUSDT", {
    runtimeRoot: directory,
    sourceKey: second.sourceKey,
  });
  assert.ok(replacedFile);
  assert.match(replacedFile.toString("utf8"), /最新 111/);
  assert.doesNotMatch(replacedFile.toString("utf8"), /最新 106/);
  await pruneMarketAlertKlineCharts("BTCUSDT", second.sourceKey, {
    runtimeRoot: directory,
  });
  assert.deepEqual(
    readdirSync(join(directory, "market-alerts", "charts")),
    [`BTCUSDT.${second.sourceKey}.svg`],
  );

  assert.equal(
    await readMarketAlertKlineChart("../BTCUSDT", { runtimeRoot: directory }),
    null,
  );
  await assert.rejects(
    writeMarketAlertKlineChart({
      symbol: "../BTCUSDT",
      interval: "5m",
      klines,
      generatedAt: "2026-08-31T00:30:00.000Z",
      sourceKey: "1788135000000_1788135000000_cccccccccccc",
      runtimeRoot: directory,
    }),
    /invalid market alert chart symbol/i,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("ok - market alert K-line charts are rendered and atomically replaced");
