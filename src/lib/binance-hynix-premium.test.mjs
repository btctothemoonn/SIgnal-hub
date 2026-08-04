import assert from "node:assert/strict";
import {
  BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
  binanceHynixPremiumWebSocketUrl,
  buildBinanceHynixPremiumPoint,
  buildBinanceHynixPremiumSnapshot,
  fetchBinanceHynixPremiumSnapshot,
  fetchBinanceHynixFundingSnapshot,
  formatShanghaiChartTime,
  getBinanceHynixPremiumStartTimeMs,
  parseBinanceFuturesWebSocketMessage,
  parseBinanceKlinePayload,
} from "./binance-hynix-premium.ts";

const skhyKlines = parseBinanceKlinePayload(
  {
    code: "000000",
    data: [
      [1760000000000, "1", "1.11", "0.99", "1.05", "100", 1760000299999],
      [1760000300000, "1.05", "1.2", "1.02", "1.1", "120", 1760000599999],
    ],
  },
  "SKHYUSDT",
);

assert.equal(skhyKlines.length, 2);
assert.equal(skhyKlines[0].symbol, "SKHYUSDT");
assert.equal(skhyKlines[0].interval, "1m");
assert.equal(skhyKlines[0].closePrice, 1.05);
assert.equal(skhyKlines[0].openTime, 1760000000000);
assert.equal(
  BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
  Date.parse("2026-07-13T16:00:00.000Z"),
);
assert.equal(
  getBinanceHynixPremiumStartTimeMs(
    "1m",
    Date.parse("2026-07-31T00:00:00.000Z"),
  ),
  Date.parse("2026-07-28T00:00:00.000Z"),
);
assert.equal(
  getBinanceHynixPremiumStartTimeMs(
    "5m",
    Date.parse("2026-07-31T00:00:00.000Z"),
  ),
  BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
);
assert.equal(
  formatShanghaiChartTime(Date.parse("2026-07-14T01:05:00.000Z") / 1000, "5m"),
  "07-14 09:05",
);

const hourlyKlines = parseBinanceKlinePayload(
  [[1760000400000, "1", "1.4", "0.9", "1.2", "80", 1760003999999]],
  "SKHYUSDT",
  "1h",
);
assert.equal(hourlyKlines[0].interval, "1h");

const wrappedKlineInfos = parseBinanceKlinePayload(
  {
    data: {
      klineInfos: [
        [1760000600000, "1", "1.3", "1", "1.25", "60", 1760000899999],
      ],
    },
  },
  "SKHYUSDT",
);
assert.equal(wrappedKlineInfos[0].closePrice, 1.25);

const synchronizedPoint = buildBinanceHynixPremiumPoint({
  openTime: 1760000000000,
  closeTime: 1760000299999,
  capturedAt: "2026-07-28T00:05:00.000Z",
  baseSymbol: "SKHYUSDT",
  benchmarkSymbol: "SKHYNIXUSDT",
  basePrice: 1.04,
  baseOpenPrice: 1,
  baseHighPrice: 1.5,
  baseLowPrice: 0.5,
  baseClosePrice: 1.04,
  benchmarkPrice: 10,
  benchmarkOpenPrice: 10,
  benchmarkHighPrice: 15,
  benchmarkLowPrice: 5,
  benchmarkClosePrice: 10,
  volume: 1,
});
assert.equal(synchronizedPoint?.premiumOpenPct, 0);
assert.equal(synchronizedPoint?.premiumHighPct, 4);
assert.equal(synchronizedPoint?.premiumLowPct, 0);
assert.equal(synchronizedPoint?.premiumClosePct, 4);

const snapshot = buildBinanceHynixPremiumSnapshot({
  generatedAt: "2026-07-28T08:00:00.000Z",
  interval: "5m",
  baseSymbol: "SKHYUSDT",
  benchmarkSymbol: "SKHYNIXUSDT",
  baseKlines: skhyKlines,
  benchmarkKlines: parseBinanceKlinePayload(
    [
      [1760000000000, "10", "10.2", "9.8", "10", "90", 1760000299999],
      [1760000300000, "10", "11", "9.9", "10", "110", 1760000599999],
    ],
    "SKHYNIXUSDT",
  ),
  errors: [],
});

assert.equal(snapshot.source, "live");
assert.equal(snapshot.provider, "binance-futures");
assert.equal(snapshot.interval, "5m");
assert.equal(snapshot.points.length, 2);
assert.equal(snapshot.latest?.basePrice, 1.1);
assert.equal(snapshot.latest?.benchmarkPrice, 10);
assert.equal(snapshot.latest?.premiumPct, 10);
assert.equal(snapshot.points[0].premiumOpenPct, 0);
assert.equal(snapshot.points[0].premiumHighPct, 5);
assert.equal(snapshot.points[0].premiumLowPct, 0);
assert.equal(snapshot.points[0].premiumClosePct, 5);
assert.equal(snapshot.points[0].baseOpenPrice, 1);
assert.equal(snapshot.points[0].benchmarkClosePrice, 10);
assert.equal(snapshot.points[0].volume, 100);

const alignedMinuteStart = Date.parse("2026-07-28T00:00:00.000Z");
function minuteKline({
  symbol,
  minute,
  open,
  high,
  low,
  close,
}) {
  const openTime = alignedMinuteStart + minute * 60 * 1000;
  return {
    symbol,
    interval: "1m",
    openTime,
    closeTime: openTime + 60 * 1000 - 1,
    openPrice: open,
    highPrice: high,
    lowPrice: low,
    closePrice: close,
    volume: 1,
  };
}

const minuteAlignedSnapshot = buildBinanceHynixPremiumSnapshot({
  generatedAt: "2026-07-28T00:05:00.000Z",
  interval: "5m",
  baseSymbol: "SKHYUSDT",
  benchmarkSymbol: "SKHYNIXUSDT",
  baseKlines: [
    minuteKline({
      symbol: "SKHYUSDT",
      minute: 0,
      open: 1,
      high: 1.5,
      low: 0.9,
      close: 1,
    }),
    minuteKline({
      symbol: "SKHYUSDT",
      minute: 1,
      open: 1,
      high: 1.2,
      low: 0.5,
      close: 1.01,
    }),
    minuteKline({
      symbol: "SKHYUSDT",
      minute: 2,
      open: 1.01,
      high: 1.3,
      low: 0.8,
      close: 1.02,
    }),
    minuteKline({
      symbol: "SKHYUSDT",
      minute: 3,
      open: 1.02,
      high: 1.4,
      low: 0.7,
      close: 1.03,
    }),
    minuteKline({
      symbol: "SKHYUSDT",
      minute: 4,
      open: 1.03,
      high: 1.6,
      low: 0.6,
      close: 1.04,
    }),
  ],
  benchmarkKlines: [
    minuteKline({
      symbol: "SKHYNIXUSDT",
      minute: 0,
      open: 10,
      high: 15,
      low: 10,
      close: 10,
    }),
    minuteKline({
      symbol: "SKHYNIXUSDT",
      minute: 1,
      open: 10,
      high: 10,
      low: 5,
      close: 10,
    }),
    minuteKline({
      symbol: "SKHYNIXUSDT",
      minute: 2,
      open: 10,
      high: 14,
      low: 8,
      close: 10,
    }),
    minuteKline({
      symbol: "SKHYNIXUSDT",
      minute: 3,
      open: 10,
      high: 13,
      low: 7,
      close: 10,
    }),
    minuteKline({
      symbol: "SKHYNIXUSDT",
      minute: 4,
      open: 10,
      high: 12,
      low: 6,
      close: 10,
    }),
  ],
  errors: [],
});

assert.equal(
  minuteAlignedSnapshot.points.length,
  1,
  "five aligned minute observations should aggregate into one 5m candle",
);
assert.equal(minuteAlignedSnapshot.points[0].premiumOpenPct, 0);
assert.equal(minuteAlignedSnapshot.points[0].premiumHighPct, 4);
assert.equal(minuteAlignedSnapshot.points[0].premiumLowPct, 0);
assert.equal(minuteAlignedSnapshot.points[0].premiumClosePct, 4);
assert.equal(minuteAlignedSnapshot.points[0].volume, 5);

const oneMinuteSnapshot = buildBinanceHynixPremiumSnapshot({
  generatedAt: "2026-07-28T00:02:00.000Z",
  baseSymbol: "SKHYUSDT",
  benchmarkSymbol: "SKHYNIXUSDT",
  baseKlines: [
    minuteKline({
      symbol: "SKHYUSDT",
      minute: 0,
      open: 1,
      high: 1.1,
      low: 0.9,
      close: 1,
    }),
    minuteKline({
      symbol: "SKHYUSDT",
      minute: 1,
      open: 1,
      high: 1.2,
      low: 1,
      close: 1.1,
    }),
  ],
  benchmarkKlines: [
    minuteKline({
      symbol: "SKHYNIXUSDT",
      minute: 0,
      open: 10,
      high: 10,
      low: 10,
      close: 10,
    }),
    minuteKline({
      symbol: "SKHYNIXUSDT",
      minute: 1,
      open: 10,
      high: 10,
      low: 10,
      close: 10,
    }),
  ],
  errors: [],
});
assert.equal(oneMinuteSnapshot.interval, "1m");
assert.equal(oneMinuteSnapshot.points.length, 2);
assert.equal(oneMinuteSnapshot.points[1].premiumClosePct, 10);
assert.equal(
  binanceHynixPremiumWebSocketUrl({
    baseSymbol: "SKHYUSDT",
    benchmarkSymbol: "SKHYNIXUSDT",
    interval: "1h",
  }),
  "wss://fstream.binance.com/public/stream?streams=skhyusdt@markPrice/skhynixusdt@markPrice/skhyusdt@kline_1h/skhynixusdt@kline_1h",
);
assert.equal(
  binanceHynixPremiumWebSocketUrl(),
  "wss://fstream.binance.com/public/stream?streams=skhyusdt@markPrice/skhynixusdt@markPrice/skhyusdt@kline_1m/skhynixusdt@kline_1m",
);

const requestedUrls = [];
const fetched = await fetchBinanceHynixPremiumSnapshot({
  fetchImpl: async (url) => {
    requestedUrls.push(String(url));
    const parsedUrl = new URL(String(url));
    const symbol = parsedUrl.searchParams.get("symbol");
    if (parsedUrl.pathname.endsWith("/premiumIndex")) {
      return Response.json({
        symbol,
        markPrice: symbol === "SKHYUSDT" ? "1.3" : "10",
        indexPrice: symbol === "SKHYUSDT" ? "1.29" : "10.01",
        time: 1760000300000,
      });
    }
    const close = symbol === "SKHYUSDT" ? "1.2" : "10";
    return Response.json([
      [1760000000000, "1", close, "1", close, "10", 1760000299999],
    ]);
  },
  env: {
    BINANCE_HYNIX_PREMIUM_REST_BASE_URL: "https://fapi.binance.com",
  },
  interval: "1h",
  startTime: BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
  endTime: BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS + 60 * 60 * 1000,
  limit: 24,
});

assert.equal(fetched.source, "live");
assert.equal(fetched.provider, "binance-futures");
assert.equal(fetched.interval, "1h");
assert.equal(fetched.latest?.premiumPct, 30);
assert.equal(requestedUrls.length, 4);
assert.ok(
  requestedUrls.every((url) =>
    url.includes("https://fapi.binance.com/fapi/v1/"),
  ),
);
assert.equal(
  requestedUrls.filter((url) => url.includes("/fapi/v1/klines")).length,
  2,
);
assert.equal(
  requestedUrls.filter((url) => url.includes("/fapi/v1/premiumIndex")).length,
  2,
);
assert.ok(
  requestedUrls
    .filter((url) => url.includes("/fapi/v1/klines"))
    .every((url) => url.includes("interval=1m")),
);
assert.ok(
  requestedUrls
    .filter((url) => url.includes("/fapi/v1/klines"))
    .every((url) =>
      url.includes(`startTime=${BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS}`),
    ),
);
assert.ok(requestedUrls.some((url) => url.includes("symbol=SKHYUSDT")));
assert.ok(requestedUrls.some((url) => url.includes("symbol=SKHYNIXUSDT")));

const pagedUrls = [];
await fetchBinanceHynixPremiumSnapshot({
  fetchImpl: async (url) => {
    pagedUrls.push(String(url));
    const parsedUrl = new URL(String(url));
    if (parsedUrl.pathname.endsWith("/premiumIndex")) {
      return Response.json({
        symbol: parsedUrl.searchParams.get("symbol"),
        markPrice: "1",
        indexPrice: "1",
        time: 1760000300000,
      });
    }
    const startTime = Number(parsedUrl.searchParams.get("startTime"));
    const closeTime = startTime + 5 * 60 * 1000 - 1;
    return Response.json([
      [startTime, "1", "1", "1", "1", "10", closeTime],
    ]);
  },
  interval: "5m",
  startTime: 1760000000000,
  endTime: 1760000900000,
  limit: 2,
});
assert.ok(
  pagedUrls.filter((url) => url.includes("/fapi/v1/klines")).length > 2,
);

const parsedKlineMessage = parseBinanceFuturesWebSocketMessage({
  stream: "skhyusdt@kline_5m",
  data: {
    e: "kline",
    E: 1760000310000,
    s: "SKHYUSDT",
    k: {
      t: 1760000300000,
      T: 1760000599999,
      s: "SKHYUSDT",
      i: "5m",
      o: "1.2",
      h: "1.4",
      l: "1.1",
      c: "1.3",
      v: "20",
      x: false,
    },
  },
});
assert.equal(parsedKlineMessage?.type, "kline");
assert.equal(parsedKlineMessage?.point.closePrice, 1.3);
assert.equal(parsedKlineMessage?.closed, false);

const parsedMarkMessage = parseBinanceFuturesWebSocketMessage(
  JSON.stringify({
    stream: "skhynixusdt@markPrice",
    data: {
      e: "markPriceUpdate",
      E: 1760000310000,
      s: "SKHYNIXUSDT",
      p: "10.2",
      i: "10.1",
    },
  }),
);
assert.equal(parsedMarkMessage?.type, "markPrice");
assert.equal(parsedMarkMessage?.symbol, "SKHYNIXUSDT");
assert.equal(parsedMarkMessage?.markPrice, 10.2);

const fundingUrls = [];
const fundingSnapshot = await fetchBinanceHynixFundingSnapshot({
  fetchImpl: async (url) => {
    fundingUrls.push(String(url));
    const parsedUrl = new URL(String(url));
    const symbol = parsedUrl.searchParams.get("symbol");
    return Response.json([
      {
        symbol,
        fundingRate: symbol === "SKHYUSDT" ? "-0.00100000" : "0.00020000",
        fundingTime: Date.parse("2026-07-14T00:00:00.000Z"),
        markPrice: symbol === "SKHYUSDT" ? "130" : "1040",
        rateType: "Regular",
      },
      {
        symbol,
        fundingRate: symbol === "SKHYUSDT" ? "0.00050000" : "-0.00010000",
        fundingTime: Date.parse("2026-07-14T08:00:00.000Z"),
        markPrice: symbol === "SKHYUSDT" ? "132" : "1050",
        rateType: "Regular",
      },
    ]);
  },
  startTime: BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
});
assert.equal(fundingSnapshot.source, "live");
assert.equal(fundingSnapshot.records.length, 2);
assert.equal(fundingSnapshot.daily[0].date, "2026-07-14");
assert.equal(fundingSnapshot.daily[0].combinedFundingRatePct, -0.06);
assert.equal(fundingSnapshot.daily[0].combinedFundingFeePer10kUsdt, -6);
assert.equal(
  fundingUrls.filter((url) => url.includes("/fapi/v1/fundingRate")).length,
  2,
);
assert.ok(
  fundingUrls.every((url) =>
    url.includes(`startTime=${BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS}`),
  ),
);

console.log("ok - binance hynix premium");
