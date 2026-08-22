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
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useBrowserJsonCache } from "@/components/use-browser-json-cache";
import {
  BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
  binanceHynixPremiumIntervalMs,
  buildBinanceHynixPremiumPoint,
  formatShanghaiChartTime,
  getBinanceHynixPremiumStartTimeMs,
  parseBinanceFuturesWebSocketMessage,
  upsertBinanceHynixPremiumPoint,
  type BinanceFuturesWebSocketMessage,
  type BinanceHynixFundingSnapshot,
  type BinanceHynixPremiumInterval,
  type BinanceHynixPremiumPoint,
  type BinanceHynixPremiumSnapshot,
  type BinanceKlinePoint,
} from "@/lib/binance-hynix-premium";
import {
  HYNIX_PREMIUM_ALERT_THRESHOLD_PCT,
  dismissHynixPremiumAlertCycle,
  nextHynixPremiumAlertCycle,
  shouldShowHynixPremiumAlert,
  type HynixPremiumAlertCycle,
} from "@/lib/hynix-premium-alert";

const STOCKS_HYNIX_PREMIUM_CACHE_KEY =
  "signal-hub:stocks:hynix-premium:v4";
const STOCKS_HYNIX_FUNDING_CACHE_KEY =
  "signal-hub:stocks:hynix-funding:v1";
const STOCKS_HYNIX_PREMIUM_ALERT_ENABLED_CACHE_KEY =
  "signal-hub:stocks:hynix-premium:alert-enabled:v1";
const PREMIUM_CHART_HEIGHT = 360;
const PREMIUM_KLINE_PAGE_LIMIT = 1500;
const PREMIUM_MAX_POINTS = 20000;
const CHART_SURFACE = "#17191f";
const CHART_TEXT = "#a1a7b3";
const CHART_GRID = "rgba(207, 213, 225, 0.08)";
const CHART_AXIS = "rgba(207, 213, 225, 0.16)";
const CHART_ACCENT = "#d6a85b";
const PREMIUM_UP_COLOR = "#49c68d";
const PREMIUM_DOWN_COLOR = "#ef6b73";
const PREMIUM_INTERVAL_OPTIONS = [
  { value: "1m", label: "1分钟" },
  { value: "5m", label: "5分钟" },
  { value: "1h", label: "1小时" },
  { value: "1d", label: "1天" },
] satisfies Array<{ value: BinanceHynixPremiumInterval; label: string }>;

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
  return formatShanghaiChartTime(Date.parse(value) / 1000, "5m");
}

function premiumTone(value: number | null | undefined) {
  if (typeof value !== "number") return "text-muted";
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

function formatSignedFundingFee(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)} USDT / 1万USDT名义`;
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
        ? "rgba(73, 198, 141, 0.22)"
        : "rgba(239, 107, 115, 0.2)",
  };
}

export function StocksHynixPremiumCurve() {
  const [selectedInterval, setSelectedInterval] =
    useState<BinanceHynixPremiumInterval>("1m");
  const [liveSnapshot, setLiveSnapshot] =
    useState<BinanceHynixPremiumSnapshot | null>(null);
  const [liveFundingSnapshot, setLiveFundingSnapshot] =
    useState<BinanceHynixFundingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [premiumAlertCycle, setPremiumAlertCycle] =
    useState<HynixPremiumAlertCycle>({
      isOverThreshold: false,
      dismissed: false,
    });
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
      `${STOCKS_HYNIX_PREMIUM_CACHE_KEY}:${selectedInterval}`,
    );
  const [cachedFundingSnapshot, writeCachedFundingSnapshot] =
    useBrowserJsonCache<BinanceHynixFundingSnapshot>(
      STOCKS_HYNIX_FUNDING_CACHE_KEY,
    );
  const [cachedPremiumAlertEnabled, writeCachedAlertEnabled] =
    useBrowserJsonCache<boolean>(
      STOCKS_HYNIX_PREMIUM_ALERT_ENABLED_CACHE_KEY,
    );
  const premiumAlertEnabled = cachedPremiumAlertEnabled ?? true;
  const snapshot =
    liveSnapshot?.interval === selectedInterval
      ? liveSnapshot
      : cachedSnapshot?.interval === selectedInterval
        ? cachedSnapshot
        : null;
  const fundingSnapshot = liveFundingSnapshot ?? cachedFundingSnapshot;
  const points = snapshot?.points ?? [];
  const latest = snapshot?.latest ?? points.at(-1) ?? null;
  const latestFunding = fundingSnapshot?.latest ?? null;
  const latestFundingDaily = fundingSnapshot?.daily.at(-1) ?? null;
  const premiumAlertVisible =
    latest !== null &&
    shouldShowHynixPremiumAlert(
      premiumAlertCycle,
      latest.premiumPct,
      premiumAlertEnabled,
    );
  const shownPoints = points.slice(-PREMIUM_MAX_POINTS);
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
        background: { type: ColorType.Solid, color: CHART_SURFACE },
        textColor: CHART_TEXT,
      },
      localization: {
        locale: "zh-CN",
        priceFormatter: (price: number) => `${price.toFixed(2)}%`,
        timeFormatter: (time: Time) =>
          `${formatShanghaiChartTime(time, selectedInterval)} UTC+8`,
      },
      grid: {
        vertLines: { color: CHART_GRID },
        horzLines: { color: CHART_GRID },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(214, 168, 91, 0.45)",
          labelBackgroundColor: CHART_ACCENT,
        },
        horzLine: {
          color: "rgba(214, 168, 91, 0.45)",
          labelBackgroundColor: CHART_ACCENT,
        },
      },
      rightPriceScale: {
        borderColor: CHART_AXIS,
        mode: PriceScaleMode.Normal,
        scaleMargins: {
          top: 0.12,
          bottom: 0.28,
        },
      },
      timeScale: {
        borderColor: CHART_AXIS,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) =>
          formatShanghaiChartTime(time, selectedInterval),
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
      color: "rgba(100, 115, 112, 0.18)",
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
  }, [selectedInterval]);

  useEffect(() => {
    candleSeriesRef.current?.setData(candleData);
    volumeSeriesRef.current?.setData(volumeData);
    const first = candleData[0]?.time;
    const last = candleData.at(-1)?.time;
    const rangeKey =
      first === undefined || last === undefined
        ? null
        : `${selectedInterval}:${first}:${last}:${candleData.length}`;
    if (rangeKey && rangeKey !== fittedRangeRef.current) {
      chartRef.current?.timeScale().fitContent();
      fittedRangeRef.current = rangeKey;
    }
  }, [candleData, selectedInterval, volumeData]);

  useEffect(() => {
    let cancelled = false;
    async function loadPremiumData() {
      try {
        setError(null);
        const startTime = getBinanceHynixPremiumStartTimeMs(selectedInterval);
        const response = await fetch(
          `/api/stocks-hynix-premium?interval=${selectedInterval}&startTime=${startTime}&limit=${PREMIUM_KLINE_PAGE_LIMIT}`,
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
          setPremiumAlertCycle((current) =>
            nextHynixPremiumAlertCycle(current, snapshot.latest?.premiumPct),
          );
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
  }, [selectedInterval, writeCachedSnapshot]);

  useEffect(() => {
    let cancelled = false;
    async function loadFundingData() {
      try {
        setFundingError(null);
        const response = await fetch(
          `/api/stocks-hynix-funding?startTime=${BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS}&limit=1000`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) {
          throw new Error(`hynix funding HTTP ${response.status}`);
        }
        const snapshot = (await response.json()) as BinanceHynixFundingSnapshot;
        if (!cancelled) {
          setLiveFundingSnapshot(snapshot);
          if (snapshot.records.length > 0) writeCachedFundingSnapshot(snapshot);
          setFundingError(snapshot.errors[0] ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setFundingError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void loadFundingData();
    const timer = window.setInterval(loadFundingData, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [writeCachedFundingSnapshot]);

  useEffect(() => {
    const websocketUrl = snapshot?.websocket?.url;
    const baseSymbol = snapshot?.symbols.base;
    const benchmarkSymbol = snapshot?.symbols.benchmark;
    if (!websocketUrl || !baseSymbol || !benchmarkSymbol) return;
    if (typeof WebSocket === "undefined") return;

    let closedByEffect = false;
    websocketKlinesRef.current = {};
    websocketMarkPricesRef.current = {};
    const applyPremiumPoint = (point: BinanceHynixPremiumPoint | null) => {
      if (!point) return;
      setPremiumAlertCycle((current) =>
        nextHynixPremiumAlertCycle(current, point.premiumPct),
      );
      setLiveSnapshot((current) => {
        const baseSnapshot = current ?? snapshotRef.current;
        if (!baseSnapshot) return current;
        const nextSnapshot = upsertBinanceHynixPremiumPoint(
          baseSnapshot,
          point,
          PREMIUM_MAX_POINTS,
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
      const intervalMs = binanceHynixPremiumIntervalMs(selectedInterval);
      const openTime = Math.floor(capturedTime / intervalMs) * intervalMs;
      applyPremiumPoint(
        buildBinanceHynixPremiumPoint({
          openTime,
          closeTime: openTime + intervalMs - 1,
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
      if (message.point.interval !== selectedInterval) return;
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
            Math.min(
              message.eventTime,
              baseKline.closeTime,
              benchmarkKline.closeTime,
            ),
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
    selectedInterval,
    writeCachedSnapshot,
  ]);

  return (
    <section
      data-testid="stocks-hynix-premium-curve"
      className="min-h-[32rem] min-w-0 rounded-lg border border-line/60 bg-panel-strong px-3 py-3 shadow-sm"
    >
      {premiumAlertVisible ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="hynix-premium-alert-title"
          className="fixed inset-0 z-50 flex items-start justify-center bg-background/55 px-4 pt-24 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-lg border border-danger/50 bg-panel-strong p-4">
            <p
              id="hynix-premium-alert-title"
              className="text-sm font-semibold text-danger"
            >
              海力士溢价超过 {HYNIX_PREMIUM_ALERT_THRESHOLD_PCT}%
            </p>
            <p className="mt-2 text-xs leading-5 text-foreground">
              当前溢价 {formatSignedPercent(latest.premiumPct)}，组合为
              SKHYUSDT * 10 / SKHYNIXUSDT。
            </p>
            <p className="mt-1 text-[11px] text-muted">
              本轮溢价回落到 {HYNIX_PREMIUM_ALERT_THRESHOLD_PCT}% 以下后，再次上穿会重新提醒。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => writeCachedAlertEnabled(false)}
                className="rounded-md border border-line/70 px-3 py-1.5 text-xs font-semibold text-muted transition hover:text-foreground"
              >
                关闭提醒
              </button>
              <button
                type="button"
                onClick={() =>
                  setPremiumAlertCycle((current) =>
                    dismissHynixPremiumAlertCycle(current),
                  )
                }
                className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-danger/85"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            币安海力士溢价曲线
          </h2>
          <p className="mt-0.5 text-[11px] text-muted">
            SKHYUSDT * 10 / SKHYNIXUSDT · {selectedInterval} K 线 · UTC+8 ·
            {selectedInterval === "1m" ? "最近3天" : "2026-07-14 起"}
          </p>
          <div className="mt-2 inline-flex rounded-lg border border-line/70 bg-workspace-canvas p-1">
            {PREMIUM_INTERVAL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedInterval(option.value)}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                  selectedInterval === option.value
                    ? "border-accent/40 bg-accent-soft text-foreground shadow-sm"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={premiumAlertEnabled}
            onClick={() => writeCachedAlertEnabled(!premiumAlertEnabled)}
            className={`mt-2 inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
              premiumAlertEnabled
                ? "border-success/45 bg-success/10 text-success"
                : "border-line/70 bg-background/45 text-muted hover:text-foreground"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                premiumAlertEnabled ? "bg-success" : "bg-muted"
              }`}
            />
            30% 溢价提醒 {premiumAlertEnabled ? "开" : "关"}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:min-w-[30rem]">
          <div className="rounded-lg border border-line/60 bg-workspace-canvas px-3 py-2">
            <p className="text-[10px] font-semibold text-muted">当前溢价</p>
            <p
              className={`mt-1 font-mono text-lg font-semibold ${premiumTone(
                latest?.premiumPct,
              )}`}
            >
              {latest ? formatSignedPercent(latest.premiumPct) : "--"}
            </p>
          </div>
          <div className="rounded-lg border border-line/60 bg-workspace-canvas px-3 py-2">
            <p className="text-[10px] font-semibold text-muted">SKHYUSDT</p>
            <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
              {latest ? formatPrice(latest.basePrice) : "--"}
            </p>
          </div>
          <div className="rounded-lg border border-line/60 bg-workspace-canvas px-3 py-2">
            <p className="text-[10px] font-semibold text-muted">SKHYNIXUSDT</p>
            <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
              {latest ? formatPrice(latest.benchmarkPrice) : "--"}
            </p>
          </div>
        </div>
      </div>

      <div className="relative min-w-0 overflow-hidden rounded-lg border border-line/60 bg-workspace-canvas">
        <div
          ref={chartContainerRef}
          role="img"
          aria-label="SKHYUSDT times 10 against SKHYNIXUSDT premium candlestick chart"
          className="h-[360px] w-full"
        />
        {shownPoints.length <= 1 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/55 px-4 text-sm text-muted">
            {error ?? "等待 Binance K 线数据。"}
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        <div className="rounded-lg border border-line/60 bg-workspace-canvas px-3 py-3">
          <p className="text-xs font-semibold text-foreground">
            溢价回归套利资金费
          </p>
          <p className="mt-1 text-[11px] text-muted">
            做空 SKHY + 做多 SKHYNIX，正数代表资金费收钱
          </p>
        </div>
        <div className="rounded-lg border border-line/60 bg-workspace-canvas px-3 py-3">
          <p className="text-[10px] font-semibold text-muted">最近一期合计</p>
          <p
            className={`mt-1 font-mono text-base font-semibold ${premiumTone(
              latestFunding?.combinedFundingRatePct,
            )}`}
          >
            {latestFunding
              ? formatSignedPercent(latestFunding.combinedFundingRatePct)
              : "--"}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            {latestFunding
              ? formatShanghaiChartTime(latestFunding.fundingTime / 1000, "5m")
              : "等待资金费率"}
          </p>
        </div>
        <div className="rounded-lg border border-line/60 bg-workspace-canvas px-3 py-3">
          <p className="text-[10px] font-semibold text-muted">
            当日累计 / 1万USDT
          </p>
          <p
            className={`mt-1 font-mono text-base font-semibold ${premiumTone(
              latestFundingDaily?.combinedFundingFeePer10kUsdt,
            )}`}
          >
            {latestFundingDaily
              ? formatSignedFundingFee(
                  latestFundingDaily.combinedFundingFeePer10kUsdt,
                )
              : "--"}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            {fundingSnapshot
              ? `${fundingSnapshot.records.length} 条资金费记录`
              : "加载中"}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>
          {snapshot
            ? `${shownPoints.length} 根 ${selectedInterval} K 线`
            : "加载中"}
        </span>
        {firstPoint ? <span>起点 {formatTime(firstPoint.capturedAt)}</span> : null}
        {latest ? <span>更新 {formatTime(latest.capturedAt)}</span> : null}
        {error ? <span className="text-warning">{error}</span> : null}
        {fundingError ? (
          <span className="text-warning">{fundingError}</span>
        ) : null}
      </div>
    </section>
  );
}
