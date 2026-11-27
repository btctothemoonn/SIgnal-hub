"use client";

import { useEffect, useMemo, useState } from "react";
import { AlphaSummaryCard } from "@/components/alpha-summary-card";
import { StocksResearchLayout } from "@/components/stocks-research-layout";
import { StocksTodayChanges } from "@/components/stocks-today-changes";
import { useBrowserJsonCache } from "@/components/use-browser-json-cache";
import {
  ALPHA_RESEARCH_DEFAULT_TICKER,
  ALPHA_RESEARCH_POOL_TRACKING_START_DATE,
  ALPHA_RESEARCH_SECTORS,
  ALPHA_RESEARCH_STOCKS,
} from "@/lib/alpha-research-pool";
import {
  mergeStocksMarketSnapshot,
  type StocksMarketSnapshot,
} from "@/lib/stocks-market-client";
import {
  mergeStocksFinancialSnapshot,
  type StocksFinancialSnapshot,
} from "@/lib/stocks-financial-data";
import type { StocksPerformanceSnapshot } from "@/lib/stocks-performance-data";
import {
  expandCompactStocksPerformanceSnapshot,
  type CompactStocksPerformanceSnapshot,
} from "@/lib/stocks-performance-transport";
import { scheduleDeferredBrowserTask } from "@/lib/deferred-browser-task";
import { buildStocksTodayChanges } from "@/lib/stocks-changes";

type AlphaTab = "research" | "messages";

const tabs: { id: AlphaTab; label: string; description: string }[] = [
  {
    id: "research",
    label: "美股投研池",
    description: "AI / 算力链股票池和财报速览",
  },
  {
    id: "messages",
    label: "STOCKS 投研总结",
    description: "行情和财报优先，整理投研结论",
  },
];

const STOCKS_MARKET_SNAPSHOT_CACHE_KEY =
  "signal-hub:stocks:market-snapshot:v1";
const STOCKS_FINANCIAL_SNAPSHOT_CACHE_KEY =
  "signal-hub:stocks:financial-snapshot:v1";

function performanceSnapshotCacheKey(tickersKey: string) {
  return `signal-hub:stocks:performance-snapshot:v1:${encodeURIComponent(
    tickersKey,
  )}`;
}

type KeyedPerformanceSnapshot = {
  cacheKey: string;
  snapshot: StocksPerformanceSnapshot;
};

function hasPerformanceSeries(snapshot: StocksPerformanceSnapshot | null) {
  return (snapshot?.series ?? []).some((series) => series.points.length > 0);
}

function snapshotIssueLabel(
  label: string,
  snapshot: { source: "live" | "mock"; errors: string[] } | null,
) {
  if (!snapshot) return null;
  if (snapshot.source === "mock") return `${label}已回落本地`;
  return snapshot.errors.some((error) =>
    error.includes("refresh failed; using cached snapshot"),
  )
    ? `${label}刷新失败，使用缓存`
    : snapshot.errors.length > 0
      ? `${label}部分数据不可用`
      : null;
}

function isPerformanceCacheNotice(message: string | null) {
  return Boolean(message?.startsWith("No performance cache "));
}

export function AlphaResearchPage() {
  const [activeTab, setActiveTab] = useState<AlphaTab>("research");
  const [selectedTicker, setSelectedTicker] = useState(
    ALPHA_RESEARCH_DEFAULT_TICKER,
  );
  const [liveMarketSnapshot, setLiveMarketSnapshot] =
    useState<StocksMarketSnapshot | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [liveFinancialSnapshot, setLiveFinancialSnapshot] =
    useState<StocksFinancialSnapshot | null>(null);
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [livePerformanceSnapshot, setLivePerformanceSnapshot] =
    useState<KeyedPerformanceSnapshot | null>(null);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [cachedMarketSnapshot, writeMarketSnapshotCache] =
    useBrowserJsonCache<StocksMarketSnapshot>(STOCKS_MARKET_SNAPSHOT_CACHE_KEY);
  const [cachedFinancialSnapshot, writeFinancialSnapshotCache] =
    useBrowserJsonCache<StocksFinancialSnapshot>(
      STOCKS_FINANCIAL_SNAPSHOT_CACHE_KEY,
    );
  const marketSnapshot = liveMarketSnapshot ?? cachedMarketSnapshot;
  const financialSnapshot = liveFinancialSnapshot ?? cachedFinancialSnapshot;
  const stocks = useMemo(() => {
    const withMarket = mergeStocksMarketSnapshot(
      ALPHA_RESEARCH_STOCKS,
      marketSnapshot,
    );
    return mergeStocksFinancialSnapshot(withMarket, financialSnapshot);
  }, [financialSnapshot, marketSnapshot]);
  const selectedStock = useMemo(
    () => stocks.find((stock) => stock.ticker === selectedTicker) ?? null,
    [selectedTicker, stocks],
  );
  const todayChanges = useMemo(
    () => buildStocksTodayChanges(stocks),
    [stocks],
  );
  const selectedSector = useMemo(
    () =>
      ALPHA_RESEARCH_SECTORS.find(
        (sector) => sector.id === selectedStock?.sectorId,
      ) ?? ALPHA_RESEARCH_SECTORS[0],
    [selectedStock?.sectorId],
  );
  const performanceTickers = selectedSector?.tickers ?? [];
  const performanceTickersKey = performanceTickers.join(",");
  const performanceCacheKey = performanceSnapshotCacheKey(performanceTickersKey);
  const [cachedPerformanceSnapshot, writePerformanceSnapshotCache] =
    useBrowserJsonCache<StocksPerformanceSnapshot>(performanceCacheKey);
  const performanceSnapshot =
    livePerformanceSnapshot?.cacheKey === performanceCacheKey &&
    hasPerformanceSeries(livePerformanceSnapshot.snapshot)
      ? livePerformanceSnapshot.snapshot
      : hasPerformanceSeries(cachedPerformanceSnapshot)
        ? cachedPerformanceSnapshot
        : null;
  const marketDataIsLive = marketSnapshot?.source === "live";
  const marketDataLoading = marketSnapshot === null && marketError === null;
  const marketDataLabel = marketDataIsLive
    ? `${marketSnapshot.provider.toUpperCase()} / ${
        marketSnapshot.freshness === "delayed" ? "延迟" : "实时"
      }${marketSnapshot.fallbackUsed ? " / fallback" : ""}`
    : marketSnapshot?.source === "mock"
      ? "基线价 / 非实时"
      : "行情加载中";
  const marketIssue = snapshotIssueLabel("行情", marketSnapshot);
  const financialIssue = snapshotIssueLabel("财报", financialSnapshot);
  const activeErrors = [
    marketError ?? marketIssue,
    financialError ?? financialIssue,
    performanceError && !isPerformanceCacheNotice(performanceError)
      ? performanceError
      : null,
  ].filter((message): message is string => Boolean(message));

  useEffect(() => {
    let cancelled = false;
    async function loadMarketData() {
      try {
        setMarketError(null);
        const response = await fetch("/api/stocks-market-data", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`market data HTTP ${response.status}`);
        }
        const snapshot = (await response.json()) as StocksMarketSnapshot;
        if (!cancelled) {
          setLiveMarketSnapshot(snapshot);
          writeMarketSnapshotCache(snapshot);
          setMarketError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setMarketError(error instanceof Error ? error.message : String(error));
        }
      }
    }
    void loadMarketData();
    const timer = window.setInterval(loadMarketData, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [writeMarketSnapshotCache]);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = performanceCacheKey;
    async function loadPerformanceData() {
      try {
        setPerformanceError(null);
        const response = await fetch(
          `/api/stocks-performance?tickers=${encodeURIComponent(
            performanceTickersKey,
          )}&startDate=${ALPHA_RESEARCH_POOL_TRACKING_START_DATE}&maxPoints=240&format=compact`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(`performance data HTTP ${response.status}`);
        }
        const snapshot = expandCompactStocksPerformanceSnapshot(
          (await response.json()) as
            | StocksPerformanceSnapshot
            | CompactStocksPerformanceSnapshot,
        );
        if (!cancelled) {
          if (hasPerformanceSeries(snapshot)) {
            setLivePerformanceSnapshot({ cacheKey, snapshot });
            writePerformanceSnapshotCache(snapshot);
          }
          setPerformanceError(snapshot.errors[0] ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setPerformanceError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
    void loadPerformanceData();
    const timer = window.setInterval(loadPerformanceData, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    marketSnapshot?.generatedAt,
    performanceCacheKey,
    performanceTickersKey,
    writePerformanceSnapshotCache,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadFinancialData() {
      try {
        setFinancialError(null);
        const response = await fetch("/api/stocks-financial-data", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`financial data HTTP ${response.status}`);
        }
        const snapshot = (await response.json()) as StocksFinancialSnapshot;
        if (!cancelled) {
          setLiveFinancialSnapshot(snapshot);
          writeFinancialSnapshotCache(snapshot);
          setFinancialError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setFinancialError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
    const cancelInitialLoad = scheduleDeferredBrowserTask(loadFinancialData);
    const timer = window.setInterval(loadFinancialData, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      cancelInitialLoad();
      window.clearInterval(timer);
    };
  }, [writeFinancialSnapshotCache]);

  return (
    <div
      data-stocks-workspace
      className="grid min-h-0 min-w-0 gap-3 overflow-x-clip"
    >
      <section className="rounded-lg border border-line/70 bg-panel-strong shadow-[0_16px_40px_-32px_rgba(15,23,42,0.28)] lg:sticky lg:top-[5.25rem] lg:z-30 lg:backdrop-blur-xl" data-stocks-command-bar>
        <div className="grid gap-2 border-b border-line/60 px-3 py-2.5 sm:px-4 sm:py-3 xl:grid-cols-[minmax(14rem,0.34fr)_minmax(0,0.66fr)] xl:items-center">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground sm:text-2xl">
              STOCKS 美股投研池
            </h1>
            <p className="hidden text-xs text-muted sm:block">
              <span className="mt-1 block">
                行情尝试接入 Yahoo，财报采用 FMP 标准化数据；失败时保留最近缓存。
              </span>
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-1 rounded-lg border border-line/70 bg-workspace-canvas p-1">
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "min-h-9 rounded-md border px-2 py-1.5 text-left transition-colors sm:min-h-10 sm:rounded-lg",
                    selected
                      ? "border-accent/40 bg-accent-soft text-foreground shadow-sm"
                      : "border-transparent text-muted hover:bg-panel hover:text-foreground",
                  ].join(" ")}
                >
                  <span className="block text-xs font-semibold">{tab.label}</span>
                  <span className="hidden truncate text-[11px] opacity-75 md:block">
                    {tab.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {activeErrors.length > 0 ? (
          <div
            data-stocks-error-alert
            className="border-t border-warning/30 bg-warning-soft px-3 py-2 text-[11px] text-warning sm:px-4"
          >
            {[...new Set(activeErrors)].join(" | ")}
          </div>
        ) : null}
      </section>

      {activeTab === "research" ? (
        <section data-stocks-chart-band className="grid min-w-0 gap-3">
          <StocksTodayChanges
            changes={todayChanges}
            selectedTicker={selectedTicker}
            onSelectTicker={setSelectedTicker}
          />
          <div data-stocks-research-split className="min-w-0">
            <StocksResearchLayout
              performanceSnapshot={performanceSnapshot}
              stocks={stocks}
              selectedStock={selectedStock}
              selectedTicker={selectedTicker}
              performanceTickers={performanceTickers}
              sectors={ALPHA_RESEARCH_SECTORS}
              activeSectorId={selectedSector?.id ?? ALPHA_RESEARCH_SECTORS[0]?.id ?? ""}
              onSelectSector={(sectorId) => {
                const sector = ALPHA_RESEARCH_SECTORS.find(
                  (item) => item.id === sectorId,
                );
                if (!sector) return;
                setSelectedTicker(sector.tickers[0]);
                setActiveTab("research");
              }}
              onSelectTicker={setSelectedTicker}
              marketDataLabel={marketDataLabel}
              marketDataLoading={marketDataLoading}
              performanceLoading={performanceSnapshot === null && performanceError === null}
            />
          </div>
        </section>
      ) : null}
      {activeTab === "messages" ? (
        <AlphaSummaryCard
          audience="stocks"
          deskLabel="STOCKS Research AI"
          endpoint="/api/stocks-summary"
        />
      ) : null}
    </div>
  );
}
