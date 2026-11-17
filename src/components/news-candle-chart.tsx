"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries, ColorType, HistogramSeries, createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { chartNewsMarkers, formatNewsPrice, newsExecutionSymbol, newsPriceMinMove } from "@/lib/news-terminal-client";
import type { NewsItem, NewsMarket, TradeFill } from "@/lib/news-terminal-types";

function chartTime(time: Time) {
  return new Date(Number(time) * 1000).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function NewsCandleChart({ market, news, selected, fills = [] }: {
  market: NewsMarket;
  news: NewsItem[];
  selected: NewsItem | null;
  fills?: TradeFill[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markerRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    const colors = getComputedStyle(document.documentElement);
    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: colors.getPropertyValue("--workspace-surface").trim() || "#17191f" },
        textColor: colors.getPropertyValue("--muted").trim() || "#a1a7b3", fontFamily: "Arial, sans-serif", fontSize: 11,
      },
      grid: { vertLines: { color: "rgba(128,128,128,0.07)" }, horzLines: { color: "rgba(128,128,128,0.1)" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: .12, bottom: .24 } },
      timeScale: {
        timeVisible: true, secondsVisible: false, borderVisible: false, rightOffset: 4,
        tickMarkFormatter: (time: Time) => chartTime(time).split(" ").at(-1) || "",
      },
      localization: { locale: "zh-CN", priceFormatter: formatNewsPrice, timeFormatter: chartTime },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#49c68d", downColor: "#ef6b73", borderVisible: false, wickUpColor: "#49c68d", wickDownColor: "#ef6b73",
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "", priceLineVisible: false, lastValueVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: .84, bottom: 0 } });
    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;
    markerRef.current = createSeriesMarkers(candles, []);
    fitted.current = false;
    const observer = new MutationObserver(() => {
      const next = getComputedStyle(document.documentElement);
      chart.applyOptions({ layout: {
        background: { type: ColorType.Solid, color: next.getPropertyValue("--workspace-surface").trim() },
        textColor: next.getPropertyValue("--muted").trim(),
      } });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect(); chart.remove(); chartRef.current = null;
      candleRef.current = null; volumeRef.current = null; markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!market.candles.length) return;
    candleRef.current?.applyOptions({ priceFormat: { type: "custom", minMove: newsPriceMinMove(market.price), formatter: formatNewsPrice } });
    candleRef.current?.setData(market.candles.map(candle => ({ ...candle, time: candle.time as UTCTimestamp })));
    volumeRef.current?.setData(market.candles.map(candle => ({
      time: candle.time as UTCTimestamp, value: candle.volume,
      color: candle.close >= candle.open ? "rgba(73,198,141,.25)" : "rgba(239,107,115,.25)",
    })));
    if (!fitted.current) { chartRef.current?.timeScale().fitContent(); fitted.current = true; }
  }, [market]);

  useEffect(() => {
    const bars = market.candles;
    const step = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 60;
    const candleAt = (timestamp: number) => {
      const seconds = timestamp / 1000;
      if (!bars.length || seconds < bars[0].time || seconds >= bars[bars.length - 1].time + step) return null;
      const next = bars.findIndex(candle => candle.time > seconds);
      return bars[(next < 0 ? bars.length : next) - 1] || null;
    };
    const markers: SeriesMarker<UTCTimestamp>[] = chartNewsMarkers(news, market.symbol, bars).map(marker => ({ ...marker, time: marker.time as UTCTimestamp }));
    if (selected?.coins.some(coin => coin.symbol === market.symbol)) {
      const bar = candleAt(selected.publishedAt);
      if (bar) markers.push({ time: bar.time as UTCTimestamp, position: "aboveBar", shape: "circle", color: "#7aa2ff", text: "选中新闻" });
    }
    const nativeSymbol = newsExecutionSymbol(market.pair || "", market.venue);
    for (const fill of fills) {
      if (fill.venue !== market.venue || fill.symbol !== nativeSymbol) continue;
      const bar = candleAt(fill.createdAt);
      if (bar) markers.push({ time: bar.time as UTCTimestamp, position: fill.side === "buy" ? "belowBar" : "aboveBar", shape: fill.side === "buy" ? "arrowUp" : "arrowDown", color: fill.side === "buy" ? "#49c68d" : "#ef6b73", text: `${fill.side === "buy" ? "B" : "S"} ${formatNewsPrice(fill.price)}` });
    }
    markerRef.current?.setMarkers(markers.sort((a, b) => Number(a.time) - Number(b.time)));
  }, [market, news, selected, fills]);

  return <div ref={container} data-news-chart style={{ width: "100%", height: "100%", minHeight: 260 }} aria-label={`${market.symbol} ${market.venue} K线`} />;
}
