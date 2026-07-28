"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  PriceScaleMode,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useBrowserJsonCache } from "@/components/use-browser-json-cache";
import {
  buildBinanceHynixPremiumPoint,
  parseBinanceFuturesWebSocketMessage,
  upsertBinanceHynixPremiumPoint,
  type BinanceFuturesWebSocketMessage,
  type BinanceHynixPremiumPoint,
  type BinanceHynixPremiumSnapshot,
  type BinanceKlinePoint,
} from "@/lib/binance-hynix-premium";

const STOCKS_HYNIX_PREMIUM_CACHE_KEY =
  "signal-hub:stocks:hynix-premium:5m:v2";
const PREMIUM_CHART_HEIGHT = 360;
const PREMIUM_CHART_LIMIT = 288;
const PREMIUM_UP_COLOR = "#62d6aa";
const PREMIUM_DOWN_COLOR = "#ff7b8a";

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function premiumTone(value: number | null | undefined) {
  if (typeof value !== "number") return "text-muted";
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

function chartTime(point: BinanceHynixPremiumPoint) {
  return Math.floor(point.openTime / 1000) as UTCTimestamp;
}

function pointToCandle(point: BinanceHynixPremiumPoint): CandlestickData {
  const open = point.premiumOpenPct ?? point.premiumPct;
  const high = point.premiumHighPct ?? point.premiumPct;
  const low = point.premiumLowPct ?? point.premiumPct;
  const close = point.premiumClosePct ?? point.premiumPct;
  return {
    time: chartTime(point),
    open,
    high: Math.max(open, high, close),
    low: Math.min(open, low, close),
    close,
  };
}

function pointToVolume(point: BinanceHynixPremiumPoint): HistogramData {
  const open = point.premiumOpenPct ?? point.premiumPct;
  const close = point.premiumClosePct ?? point.premiumPct;
  return {
    time: chartTime(point),
    value: Math.max(0, point.volume ?? 0),
    color:
      close >= open
        ? "rgba(98, 214, 170, 0.32)"
        : "rgba(255, 123, 138, 0.3)",
  };
}

export function StocksHynixPremiumCurve() {
  const [liveSnapshot, setLiveSnapshot] =
    useState<BinanceHynixPremiumSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef<BinanceHynixPremiumSnapshot | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fittedRangeRef = useRef<string | null>(null);
  const websocketKlinesRef = useRef<Record<string, BinanceKlinePoint>>({});
  const websocketMarkPricesRef = useRef<
    Record<string, { markPrice: number; eventTime: number }>
  >({});
  const [cachedSnapshot, writeCachedSnapshot] =
    useBrowserJsonCache<BinanceHynixPremiumSnapshot>(
      STOCKS_HYNIX_PREMIUM_CACHE_KEY,
    );
  const snapshot = liveSnapshot ?? cachedSnapshot;
  const points = snapshot?.points ?? [];
  const latest = snapshot?.latest ?? points.at(-1) ?? null;
  const shownPoints = points.slice(-PREMIUM_CHART_LIMIT);
  const candleData = useMemo(
    () => shownPoints.map(pointToCandle),
    [shownPoints],
  );
  const volumeData = useMemo(
    () => shownPoints.map(pointToVolume),
    [shownPoints],
  );
  const firstPoint = shownPoints[0] ?? null;

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: PREMIUM_CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: "#0b1211" },
        textColor: "#c8d6d0",
      },
      localization: {
        locale: "zh-CN",
        priceFormatter: (price: number) => `${price.toFixed(2)}%`,
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.12)" },
        horzLines: { color: "rgba(148, 163, 184, 0.12)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(226, 232, 240, 0.35)",
          labelBackgroundColor: "#2a342f",
        },
        horzLine: {
          color: "rgba(226, 232, 240, 0.35)",
          labelBackgroundColor: "#2a342f",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.22)",
        mode: PriceScaleMode.Normal,
        scaleMargins: {
          top: 0.12,
          bottom: 0.28,
        },
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.22)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        minBarSpacing: 3,
        lockVisibleTimeRangeOnResize: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        horzTouchDrag: true,
        mouseWheel: true,
        pressedMouseMove: true,
        vertTouchDrag: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: PREMIUM_UP_COLOR,
      downColor: PREMIUM_DOWN_COLOR,
      borderUpColor: PREMIUM_UP_COLOR,
      borderDownColor: PREMIUM_DOWN_COLOR,
      wickUpColor: PREMIUM_UP_COLOR,
      wickDownColor: PREMIUM_DOWN_COLOR,
      priceFormat: {
        type: "custom",
        minMove: 0.01,
        formatter: (price: number) => `${price.toFixed(2)}%`,
      },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "rgba(148, 163, 184, 0.25)",
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(([entry]) => {
            if (!entry) return;
            chart.applyOptions({
              width: Math.max(320, Math.floor(entry.contentRect.width)),
              height: PREMIUM_CHART_HEIGHT,
            });
          });
    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      fittedRangeRef.current = null;
    };
  }, []);

  useEffect(() => {
    candleSeriesRef.current?.setData(candleData);
    volumeSeriesRef.current?.setData(volumeData);
    const first = candleData[0]?.time;
    const last = candleData.at(-1)?.time;
    const rangeKey =
      first === undefined || last === undefined
        ? null
        : `${first}:${last}:${candleData.length}`;
    if (rangeKey && rangeKey !== fittedRangeRef.current) {
      chartRef.current?.timeScale().fitContent();
      fittedRangeRef.current = rangeKey;
    }
  }, [candleData, volumeData]);

  useEffect(() => {
    let cancelled = false;
    async function loadPremiumData() {
      try {
        setError(null);
        const response = await fetch(
          `/api/stocks-hynix-premium?limit=${PREMIUM_CHART_LIMIT}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) {
          throw new Error(`hynix premium HTTP ${response.status}`);
        }
        const snapshot = (await response.json()) as BinanceHynixPremiumSnapshot;
        if (!cancelled) {
          setLiveSnapshot(snapshot);
          if (snapshot.points.length > 0) writeCachedSnapshot(snapshot);
          setError(snapshot.errors[0] ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void loadPremiumData();
    const timer = window.setInterval(loadPremiumData, 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [writeCachedSnapshot]);

  useEffect(() => {
    const websocketUrl = snapshot?.websocket?.url;
    const baseSymbol = snapshot?.symbols.base;
    const benchmarkSymbol = snapshot?.symbols.benchmark;
    if (!websocketUrl || !baseSymbol || !benchmarkSymbol) return;
    if (typeof WebSocket === "undefined") return;

    let closedByEffect = false;
    const applyPremiumPoint = (point: BinanceHynixPremiumPoint | null) => {
      if (!point) return;
      setLiveSnapshot((current) => {
        const baseSnapshot = current ?? snapshotRef.current;
        if (!baseSnapshot) return current;
        const nextSnapshot = upsertBinanceHynixPremiumPoint(
          baseSnapshot,
          point,
          PREMIUM_CHART_LIMIT,
        );
        writeCachedSnapshot(nextSnapshot);
        return nextSnapshot;
      });
    };
    const applyMarkPrice = (
      message: Extract<BinanceFuturesWebSocketMessage, { type: "markPrice" }>,
    ) => {
      websocketMarkPricesRef.current[message.symbol] = {
        markPrice: message.markPrice,
        eventTime: message.eventTime,
      };
      const baseMark = websocketMarkPricesRef.current[baseSymbol];
      const benchmarkMark = websocketMarkPricesRef.current[benchmarkSymbol];
      if (!baseMark || !benchmarkMark) return;
      const capturedTime = Math.min(baseMark.eventTime, benchmarkMark.eventTime);
      const openTime = Math.floor(capturedTime / (5 * 60 * 1000)) * 5 * 60 * 1000;
      applyPremiumPoint(
        buildBinanceHynixPremiumPoint({
          openTime,
          closeTime: openTime + 5 * 60 * 1000 - 1,
          capturedAt: new Date(capturedTime).toISOString(),
          baseSymbol,
          benchmarkSymbol,
          basePrice: baseMark.markPrice,
          benchmarkPrice: benchmarkMark.markPrice,
        }),
      );
    };
    const applyKline = (
      message: Extract<BinanceFuturesWebSocketMessage, { type: "kline" }>,
    ) => {
      websocketKlinesRef.current[message.point.symbol] = message.point;
      const baseKline = websocketKlinesRef.current[baseSymbol];
      const benchmarkKline = websocketKlinesRef.current[benchmarkSymbol];
      if (!baseKline || !benchmarkKline) return;
      if (baseKline.openTime !== benchmarkKline.openTime) return;
      applyPremiumPoint(
        buildBinanceHynixPremiumPoint({
          openTime: baseKline.openTime,
          closeTime: Math.min(baseKline.closeTime, benchmarkKline.closeTime),
          capturedAt: new Date(
            Math.min(message.eventTime, baseKline.closeTime, benchmarkKline.closeTime),
          ).toISOString(),
          baseSymbol,
          benchmarkSymbol,
          basePrice: baseKline.closePrice,
          baseOpenPrice: baseKline.openPrice,
          baseHighPrice: baseKline.highPrice,
          baseLowPrice: baseKline.lowPrice,
          baseClosePrice: baseKline.closePrice,
          benchmarkPrice: benchmarkKline.closePrice,
          benchmarkOpenPrice: benchmarkKline.openPrice,
          benchmarkHighPrice: benchmarkKline.highPrice,
          benchmarkLowPrice: benchmarkKline.lowPrice,
          benchmarkClosePrice: benchmarkKline.closePrice,
          volume: baseKline.volume,
        }),
      );
    };

    const socket = new WebSocket(websocketUrl);
    socket.onopen = () => {
      if (!closedByEffect) setError(null);
    };
    socket.onmessage = (event) => {
      const message = parseBinanceFuturesWebSocketMessage(event.data);
      if (!message) return;
      if (message.type === "markPrice") {
        applyMarkPrice(message);
      } else {
        applyKline(message);
      }
    };
    socket.onerror = () => {
      if (!closedByEffect) setError("Binance Futures WebSocket error");
    };
    socket.onclose = () => {
      if (!closedByEffect) setError("Binance Futures WebSocket disconnected");
    };

    return () => {
      closedByEffect = true;
      socket.close();
    };
  }, [
    snapshot?.symbols.base,
    snapshot?.symbols.benchmark,
    snapshot?.websocket?.url,
    writeCachedSnapshot,
  ]);

  return (
    <section
      data-testid="stocks-hynix-premium-curve"
      className="min-w-0 border-y border-line/60 bg-panel-strong/80 px-3 py-3 sm:px-4"
    >
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            币安海力士溢价曲线
          </h2>
          <p className="mt-0.5 text-[11px] text-muted">
            SKHYUSDT * 10 / SKHYNIXUSDT · 5m K 线 · Binance Futures
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:min-w-[30rem]">
          <div className="rounded-md border border-line/60 bg-background/35 px-3 py-2">
            <p className="text-[10px] font-semibold text-muted">当前溢价</p>
            <p
              className={`mt-1 font-mono text-lg font-semibold ${premiumTone(
                latest?.premiumPct,
              )}`}
            >
              {latest ? formatSignedPercent(latest.premiumPct) : "--"}
            </p>
          </div>
          <div className="rounded-md border border-line/60 bg-background/35 px-3 py-2">
            <p className="text-[10px] font-semibold text-muted">SKHYUSDT</p>
            <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
              {latest ? formatPrice(latest.basePrice) : "--"}
            </p>
          </div>
          <div className="rounded-md border border-line/60 bg-background/35 px-3 py-2">
            <p className="text-[10px] font-semibold text-muted">SKHYNIXUSDT</p>
            <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
              {latest ? formatPrice(latest.benchmarkPrice) : "--"}
            </p>
          </div>
        </div>
      </div>

      <div className="relative min-w-0 overflow-hidden rounded-lg border border-line/60 bg-background/35">
        <div
          ref={chartContainerRef}
          role="img"
          aria-label="SKHYUSDT times 10 against SKHYNIXUSDT 5 minute premium candlestick chart"
          className="h-[360px] w-full"
        />
        {shownPoints.length <= 1 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/55 px-4 text-sm text-muted">
            {error ?? "等待 Binance 5m K 线数据。"}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>{snapshot ? `${shownPoints.length} 根 5m K 线` : "加载中"}</span>
        {firstPoint ? <span>起点 {formatTime(firstPoint.capturedAt)}</span> : null}
        {latest ? <span>更新 {formatTime(latest.capturedAt)}</span> : null}
        {error ? <span className="text-warning">{error}</span> : null}
      </div>
    </section>
  );
}
