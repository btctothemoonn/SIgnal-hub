import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getRuntimeStorageRoot } from "./runtime-storage.ts";

type KlineRow = readonly unknown[];

type ChartOptions = {
  runtimeRoot?: string;
};

type RenderInput = {
  symbol: string;
  interval?: string;
  klines: KlineRow[];
  generatedAt: string;
};

type WriteInput = RenderInput & ChartOptions & {
  sourceKey: string;
};

type ReadOptions = ChartOptions & {
  sourceKey: string;
};

type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function normalizeSymbol(value: string) {
  const symbol = value.trim().toUpperCase();
  if (!/^[\p{L}\p{N}]{2,30}$/u.test(symbol)) {
    throw new Error("Invalid market alert chart symbol");
  }
  return symbol;
}

function chartFileStem(symbol: string) {
  return /^[A-Z0-9]{2,30}$/.test(symbol)
    ? symbol
    : `symbol-${createHash("sha256").update(symbol).digest("hex").slice(0, 24)}`;
}

function normalizeSourceKey(value: string) {
  const sourceKey = value.trim();
  if (!/^\d{13}_\d{13}_[a-f0-9]{12}$/.test(sourceKey)) {
    throw new Error("Invalid market alert chart source key");
  }
  return sourceKey;
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCandles(rows: KlineRow[]) {
  const candles: Candle[] = [];
  for (const row of rows) {
    const openTime = finite(row[0]);
    const open = finite(row[1]);
    const high = finite(row[2]);
    const low = finite(row[3]);
    const close = finite(row[4]);
    const volume = finite(row[5]);
    if (
      openTime === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      volume < 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      continue;
    }
    candles.push({ openTime, open, high, low, close, volume });
  }
  candles.sort((left, right) => left.openTime - right.openTime);
  if (candles.length < 2) throw new Error("K-line data is not sufficient");
  return candles.slice(-120);
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value: number) {
  if (Math.abs(value) >= 1_000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (Math.abs(value) >= 1) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  return value.toPrecision(5);
}

function shanghaiTime(value: string | number, withDate = true) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: withDate ? "numeric" : undefined,
    month: withDate ? "2-digit" : undefined,
    day: withDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const time = `${byType.get("hour")}:${byType.get("minute")}`;
  return withDate
    ? `${byType.get("year")}-${byType.get("month")}-${byType.get("day")} ${time}`
    : time;
}

function chartDirectory(runtimeRoot?: string) {
  return join(
    runtimeRoot ?? getRuntimeStorageRoot(process.env),
    "market-alerts",
    "charts",
  );
}

export function renderMarketAlertKlineSvg(input: RenderInput) {
  const symbol = normalizeSymbol(input.symbol);
  const interval = input.interval?.trim() || "5m";
  const candles = normalizeCandles(input.klines);
  const width = 1200;
  const height = 630;
  const plot = { left: 74, right: 1152, top: 102, bottom: 455 };
  const volume = { top: 494, bottom: 578 };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const priceLow = Math.min(...candles.map((candle) => candle.low));
  const priceHigh = Math.max(...candles.map((candle) => candle.high));
  const padding = Math.max((priceHigh - priceLow) * 0.08, priceHigh * 0.001);
  const minPrice = priceLow - padding;
  const maxPrice = priceHigh + padding;
  const priceRange = Math.max(Number.EPSILON, maxPrice - minPrice);
  const maxVolume = Math.max(1, ...candles.map((candle) => candle.volume));
  const slot = plotWidth / candles.length;
  const bodyWidth = Math.max(2, Math.min(10, slot * 0.62));
  const x = (index: number) => plot.left + slot * index + slot / 2;
  const y = (price: number) =>
    plot.bottom - ((price - minPrice) / priceRange) * plotHeight;
  const latest = candles.at(-1)!;
  const pieces: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`,
    `<title id="title">${escapeXml(symbol)} · ${escapeXml(interval)} K-line</title>`,
    `<desc id="description">${escapeXml(symbol)} latest ${escapeXml(interval)} candlestick chart generated ${escapeXml(input.generatedAt)}</desc>`,
    '<rect width="1200" height="630" fill="#10161d"/>',
    '<text x="74" y="49" fill="#f1f5f9" font-family="Arial, sans-serif" font-size="24" font-weight="700">' +
      `${escapeXml(symbol)} · ${escapeXml(interval)}</text>`,
    '<text x="74" y="78" fill="#8e9aa8" font-family="Arial, sans-serif" font-size="15">' +
      `最新 ${escapeXml(formatNumber(latest.close))}</text>`,
    '<text x="1152" y="49" text-anchor="end" fill="#8e9aa8" font-family="Arial, sans-serif" font-size="14">' +
      `${escapeXml(shanghaiTime(input.generatedAt))} · Asia/Shanghai</text>`,
  ];

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const gridY = plot.top + plotHeight * ratio;
    const price = maxPrice - priceRange * ratio;
    pieces.push(
      `<line x1="${plot.left}" y1="${gridY.toFixed(2)}" x2="${plot.right}" y2="${gridY.toFixed(2)}" stroke="#26313c" stroke-width="1"/>`,
      `<text x="${plot.right - 4}" y="${(gridY - 6).toFixed(2)}" text-anchor="end" fill="#718091" font-family="Arial, sans-serif" font-size="12">${escapeXml(formatNumber(price))}</text>`,
    );
  }

  candles.forEach((candle, index) => {
    const candleX = x(index);
    const openY = y(candle.open);
    const closeY = y(candle.close);
    const color = candle.close >= candle.open ? "#22c77a" : "#ef5a5a";
    const bodyY = Math.min(openY, closeY);
    const bodyHeight = Math.max(2, Math.abs(closeY - openY));
    const volumeHeight = Math.max(1, (candle.volume / maxVolume) * (volume.bottom - volume.top));
    pieces.push(
      `<g data-candle="${index}">`,
      `<line x1="${candleX.toFixed(2)}" y1="${y(candle.high).toFixed(2)}" x2="${candleX.toFixed(2)}" y2="${y(candle.low).toFixed(2)}" stroke="${color}" stroke-width="1.5"/>`,
      `<rect x="${(candleX - bodyWidth / 2).toFixed(2)}" y="${bodyY.toFixed(2)}" width="${bodyWidth.toFixed(2)}" height="${bodyHeight.toFixed(2)}" rx="1" fill="${color}"/>`,
      "</g>",
      `<rect data-volume="${index}" x="${(candleX - bodyWidth / 2).toFixed(2)}" y="${(volume.bottom - volumeHeight).toFixed(2)}" width="${bodyWidth.toFixed(2)}" height="${volumeHeight.toFixed(2)}" fill="${color}" opacity="0.52"/>`,
    );
  });

  const labelIndexes = [...new Set([0, Math.floor((candles.length - 1) / 2), candles.length - 1])];
  labelIndexes.forEach((index) => {
    pieces.push(
      `<text x="${x(index).toFixed(2)}" y="610" text-anchor="middle" fill="#718091" font-family="Arial, sans-serif" font-size="12">${escapeXml(shanghaiTime(candles[index].openTime, false))}</text>`,
    );
  });
  pieces.push("</svg>");
  return pieces.join("");
}

export async function writeMarketAlertKlineChart(
  input: WriteInput,
) {
  const symbol = normalizeSymbol(input.symbol);
  const sourceKey = normalizeSourceKey(input.sourceKey);
  const interval = input.interval?.trim() || "5m";
  const directory = chartDirectory(input.runtimeRoot);
  const fileStem = chartFileStem(symbol);
  const target = join(directory, `${fileStem}.${sourceKey}.svg`);
  const temporary = join(
    directory,
    `${fileStem}.${sourceKey}.${process.pid}.${randomUUID()}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(
      temporary,
      renderMarketAlertKlineSvg({ ...input, symbol, interval }),
      "utf8",
    );
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    symbol,
    interval,
    updatedAt: input.generatedAt,
    sourceKey,
    removeSource: (key: string) =>
      removeMarketAlertKlineChart(symbol, key, { runtimeRoot: input.runtimeRoot }),
    pruneOlder: (key: string) =>
      pruneMarketAlertKlineCharts(symbol, key, { runtimeRoot: input.runtimeRoot }),
  };
}

export async function readMarketAlertKlineChart(
  symbolInput: string,
  options: ReadOptions,
) {
  let symbol: string;
  let sourceKey: string;
  try {
    symbol = normalizeSymbol(symbolInput);
    sourceKey = normalizeSourceKey(options.sourceKey);
  } catch {
    return null;
  }
  try {
    return await readFile(
      join(
        chartDirectory(options.runtimeRoot),
        `${chartFileStem(symbol)}.${sourceKey}.svg`,
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeMarketAlertKlineChart(
  symbolInput: string,
  sourceKeyInput: string,
  options: ChartOptions = {},
) {
  const symbol = normalizeSymbol(symbolInput);
  const sourceKey = normalizeSourceKey(sourceKeyInput);
  await rm(
    join(
      chartDirectory(options.runtimeRoot),
      `${chartFileStem(symbol)}.${sourceKey}.svg`,
    ),
    { force: true },
  );
}

export async function pruneMarketAlertKlineCharts(
  symbolInput: string,
  keepSourceKeyInput: string,
  options: ChartOptions = {},
) {
  const symbol = normalizeSymbol(symbolInput);
  const keepSourceKey = normalizeSourceKey(keepSourceKeyInput);
  const directory = chartDirectory(options.runtimeRoot);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const prefix = `${chartFileStem(symbol)}.`;
  await Promise.all(
    names
      .filter((name) => name.startsWith(prefix) && name.endsWith(".svg"))
      .map((name) => ({
        name,
        sourceKey: name.slice(prefix.length, -4),
      }))
      .filter(({ sourceKey }) => sourceKey < keepSourceKey)
      .map(({ name }) => rm(join(directory, name), { force: true })),
  );
}
