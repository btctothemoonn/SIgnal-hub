"use client";

import { useEffect, useState } from "react";
import { cacheNewsMarket, fetchNewsMarket, newsMarketKey, persistNewsMarkets, readCachedNewsMarket, type NewsMarketSelection } from "@/lib/news-market-client";
import { connectNewsCandles, mergeNewsCandles, NEWS_CANDLE_STEPS } from "@/lib/news-market-stream";
import type { NewsMarket } from "@/lib/news-terminal-types";

type MarketState = { key: string; market: NewsMarket | null; loading: boolean; live: boolean; error: string | null };

export function useNewsMarket(selection: NewsMarketSelection, revision: number) {
  const { symbol, venue, interval, assetId } = selection;
  const key = newsMarketKey(selection);
  const [state, setState] = useState<MarketState>({ key: "", market: null, loading: true, live: false, error: null });

  useEffect(() => {
    const request = { symbol, venue, interval, assetId };
    const context = newsMarketKey(request);
    let active = true;
    let current = readCachedNewsMarket(request);
    if (current) current = { ...current, error: "缓存行情，正在刷新" };
    let loading = true;
    let live = false;
    let chartVerified = false;
    let chartInFlight = false;
    let statsInFlight = false;
    let lastStreamAt = 0;
    let disconnect: (() => void) | undefined;
    let subscribedPair: string | null = null;
    let latestStats: NewsMarket | null = null;

    function publish() {
      if (!active) return;
      setState({ key: context, market: current, loading, live, error: current?.error ?? null });
      if (current) cacheNewsMarket(request, current);
    }

    function subscribe() {
      if (!active || document.hidden || !chartVerified || !current?.pair || subscribedPair === current.pair) return;
      disconnect?.();
      subscribedPair = current.pair;
      disconnect = connectNewsCandles({
        venue, pair: current.pair, interval,
        onState: (connected) => { live = connected; publish(); },
        onReconnect: () => { void loadChart(true); },
        onCandle: (candle) => {
          if (!current || !active) return;
          const last = current.candles.at(-1);
          if (last && candle.time < last.time) return;
          if (last && candle.time > last.time + NEWS_CANDLE_STEPS[interval]) {
            live = false;
            void loadChart(true);
            return;
          }
          lastStreamAt = Date.now();
          current = { ...current, candles: mergeNewsCandles(current.candles, [candle]), price: candle.close,
            fetchedAt: current.error ? current.fetchedAt : lastStreamAt };
          publish();
        },
      });
    }

    async function loadStats() {
      if (statsInFlight || !active || document.hidden) return;
      statsInFlight = true;
      try {
        const data = await fetchNewsMarket(request, "stats");
        if (!active) return;
        latestStats = data;
        if (current?.pair && current.pair === data.pair) {
          current = applyStats(current, data);
          publish();
        }
      } catch { /* Chart updates remain independent of display-only statistics. */ }
      finally { statsInFlight = false; }
    }

    async function loadChart(refresh = false) {
      if (chartInFlight || !active || document.hidden) return;
      chartInFlight = true;
      const startedAt = Date.now();
      loading = true;
      publish();
      try {
        const data = await fetchNewsMarket(request, "chart", refresh);
        if (!active) return;
        const previous = current;
        if (data.error && previous?.pair === data.pair && previous?.candles.length) {
          current = { ...previous, error: data.error };
        } else {
          current = data;
          if (previous?.pair === data.pair && lastStreamAt > startedAt) {
            current = { ...data, candles: mergeNewsCandles(data.candles, previous.candles.filter((candle) => candle.time >= (data.candles.at(-1)?.time ?? 0))), price: previous.price, fetchedAt: lastStreamAt };
          }
          if (latestStats?.pair === current.pair) current = applyStats(current, latestStats);
        }
        chartVerified = !data.error && !!data.candles.length;
        if (!chartVerified) { live = false; disconnect?.(); disconnect = undefined; subscribedPair = null; }
        subscribe();
        // Starting statistics after the candle response gives the interactive request the first queue slot.
        void loadStats();
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : "行情加载失败";
        current = current ? { ...current, error: message } : { symbol, venue, pair: null, tradable: false, price: null, change24h: null, marketCap: null, fdv: null, volume24h: null, fundingRate: null, openInterest: null, candles: [], fetchedAt: 0, error: message };
        chartVerified = false;
        live = false;
        disconnect?.();
        disconnect = undefined;
        subscribedPair = null;
      } finally {
        chartInFlight = false;
        loading = false;
        publish();
      }
    }

    function visibilityChanged() {
      if (document.hidden) {
        disconnect?.(); disconnect = undefined; subscribedPair = null;
        live = false;
        persistNewsMarkets();
        publish();
      } else {
        void loadChart(true);
      }
    }

    void loadChart(revision > 0);
    const fallback = window.setInterval(() => { if (!live && !document.hidden) void loadChart(true); }, 30_000);
    const statistics = window.setInterval(() => { if (!document.hidden) void loadStats(); }, 60_000);
    const persist = window.setInterval(persistNewsMarkets, 30_000);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", persistNewsMarkets);
    return () => {
      active = false;
      disconnect?.();
      window.clearInterval(fallback);
      window.clearInterval(statistics);
      window.clearInterval(persist);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", persistNewsMarkets);
      persistNewsMarkets();
    };
  }, [symbol, venue, interval, assetId, revision]);

  return state.key === key ? state : { key, market: null, loading: true, live: false, error: null };
}

function applyStats(market: NewsMarket, stats: NewsMarket): NewsMarket {
  return { ...market, change24h: stats.change24h, marketCap: stats.marketCap, fdv: stats.fdv,
    volume24h: stats.volume24h, fundingRate: stats.fundingRate, openInterest: stats.openInterest };
}
