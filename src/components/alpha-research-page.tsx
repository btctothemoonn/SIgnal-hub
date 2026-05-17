"use client";

import { useEffect, useMemo, useState } from "react";
import { AlphaSummaryCard } from "@/components/alpha-summary-card";
import { StocksResearchLayout } from "@/components/stocks-research-layout";
import { StocksSubscriptionReports } from "@/components/stocks-subscription-reports";
import {
  ALPHA_RESEARCH_DEFAULT_TICKER,
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
import {
  mergeStocksCatalystSnapshot,
  type StocksCatalystSnapshot,
} from "@/lib/stocks-catalyst-data";
import type { StocksPerformanceSnapshot } from "@/lib/stocks-performance-data";
import { buildStocksSubscriptionReports } from "@/lib/stocks-subscription-reports";

type AlphaTab = "research" | "reports" | "messages";

const tabs: { id: AlphaTab; label: string; description: string }[] = [
  {
    id: "research",
    label: "美股投研池",
    description: "AI / 算力链股票池、催化事件和财报速览",
  },
  {
    id: "reports",
    label: "订阅研报",
    description: "Patreon 研报列表、主题和 ticker 归因",
  },
  {
    id: "messages",
    label: "STOCKS 投研总结",
    description: "行情/财报/新闻优先，TG/X 补充信号",
  },
];

const STOCKS_MARKET_SNAPSHOT_CACHE_KEY =
  "signal-hub:stocks:market-snapshot:v1";
const STOCKS_FINANCIAL_SNAPSHOT_CACHE_KEY =
  "signal-hub:stocks:financial-snapshot:v1";
const STOCKS_CATALYST_SNAPSHOT_CACHE_KEY =
  "signal-hub:stocks:catalyst-snapshot:v1";
function performanceSnapshotCacheKey(tickersKey: string) {
  return `signal-hub:stocks:performance-snapshot:v1:${encodeURIComponent(
    tickersKey,
  )}`;
}

function readCachedSnapshot<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCachedSnapshot<T>(key: string, snapshot: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota/private-mode failures; live state still updates.
  }
}

function hasPerformanceSeries(snapshot: StocksPerformanceSnapshot | null) {
  return (snapshot?.series ?? []).some((series) => series.points.length > 0);
}

function snapshotIssueLabel(
  label: string,
  snapshot: { source: "live" | "mock"; errors: string[] } | null,
) {
  if (!snapshot) return null;
  return snapshot.source === "mock" ? `${label}已回落本地` : null;
}

function snapshotStatusTitle(
  snapshot: { errors: string[] } | null,
  fallback: string,
) {
  const errors = snapshot?.errors.filter(Boolean) ?? [];
  return errors.length > 0 ? errors.join(" | ") : fallback;
}

function isPerformanceCacheNotice(message: string | null) {
  return Boolean(message?.startsWith("No performance cache "));
}

function performanceIssueLabel(message: string) {
  const match = message.match(
    /^No performance cache for ([^;]+); using latest cached market date ([^.]+)\.$/,
  );
  return match ? `使用最近缓存 ${match[2]}` : message;
}

export function AlphaResearchPage() {
  const [activeTab, setActiveTab] = useState<AlphaTab>("research");
  const [selectedTicker, setSelectedTicker] = useState(
    ALPHA_RESEARCH_DEFAULT_TICKER,
  );
  const [marketSnapshot, setMarketSnapshot] =
    useState<StocksMarketSnapshot | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [financialSnapshot, setFinancialSnapshot] =
    useState<StocksFinancialSnapshot | null>(null);
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [catalystSnapshot, setCatalystSnapshot] =
    useState<StocksCatalystSnapshot | null>(null);
  const [catalystError, setCatalystError] = useState<string | null>(null);
  const [performanceSnapshot, setPerformanceSnapshot] =
    useState<StocksPerformanceSnapshot | null>(null);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const stocks = useMemo(() => {
    const withMarket = mergeStocksMarketSnapshot(
      ALPHA_RESEARCH_STOCKS,
      marketSnapshot,
    );
    const withFinancials = mergeStocksFinancialSnapshot(
      withMarket,
      financialSnapshot,
    );
    return mergeStocksCatalystSnapshot(
      withFinancials,
      catalystSnapshot,
    );
  }, [catalystSnapshot, financialSnapshot, marketSnapshot]);
  const selectedStock = useMemo(
    () => stocks.find((stock) => stock.ticker === selectedTicker) ?? null,
    [selectedTicker, stocks],
  );
  const subscriptionReports = useMemo(
    () => buildStocksSubscriptionReports(stocks),
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
  const marketStatus =
    marketSnapshot?.source === "live"
      ? "Live 行情"
      : marketSnapshot?.source === "mock"
        ? "Mock 回落"
        : "行情加载中";

  const marketDataIsLive = marketSnapshot?.source === "live";
  const marketDataLoading = marketSnapshot === null && marketError === null;
  const marketDataLabel = marketDataIsLive
    ? `${marketSnapshot.provider.toUpperCase()} / ${
        marketSnapshot.freshness === "delayed" ? "延迟" : "实时"
      }${marketSnapshot.fallbackUsed ? " / fallback" : ""}`
    : marketSnapshot?.source === "mock"
      ? "基线价 / 非实时"
      : "行情加载中";

  const financialStatus =
    financialSnapshot?.source === "live"
      ? "Live 财报"
      : financialSnapshot?.source === "mock"
        ? "Mock 财报"
        : "财报加载中";
  const catalystStatus =
    catalystSnapshot?.source === "live"
      ? catalystSnapshot.provider === "all-sources"
        ? "订阅+外部新闻+信号"
        : catalystSnapshot.provider === "external-plus-supplemental"
        ? "外部新闻+信号"
        : catalystSnapshot.provider === "external-plus-subscription"
          ? "订阅+外部新闻"
          : catalystSnapshot.provider === "subscription-plus-supplemental"
            ? "订阅+信号"
            : catalystSnapshot.provider === "subscription-research"
              ? "订阅研报"
        : catalystSnapshot.provider === "external-news"
          ? "外部新闻"
          : "补充信号"
      : catalystSnapshot?.source === "mock"
        ? "Mock 新闻"
        : "新闻加载中";

  const marketIssue = snapshotIssueLabel("行情", marketSnapshot);
  const financialIssue = snapshotIssueLabel("财报", financialSnapshot);
  const catalystIssue = snapshotIssueLabel("新闻", catalystSnapshot);
  const stocksDataHealthItems = [
    {
      label: "行情",
      value: marketStatus,
      detail: marketError ?? marketIssue ?? snapshotStatusTitle(marketSnapshot, marketStatus),
      tone:
        marketError || marketIssue
          ? "warning"
          : marketSnapshot?.source === "live"
            ? "success"
            : "info",
    },
    {
      label: "财报",
      value: financialStatus,
      detail:
        financialError ??
        financialIssue ??
        snapshotStatusTitle(financialSnapshot, financialStatus),
      tone:
        financialError || financialIssue
          ? "warning"
          : financialSnapshot?.source === "live"
            ? "success"
            : "info",
    },
    {
      label: "新闻",
      value: catalystStatus,
      detail:
        catalystError ??
        catalystIssue ??
        snapshotStatusTitle(catalystSnapshot, catalystStatus),
      tone:
        catalystError || catalystIssue
          ? "warning"
          : catalystSnapshot?.source === "live"
            ? "success"
            : "info",
    },
  ];

  useEffect(() => {
    let cancelled = false;
    setMarketSnapshot(
      (current) =>
        current ??
        readCachedSnapshot<StocksMarketSnapshot>(
          STOCKS_MARKET_SNAPSHOT_CACHE_KEY,
        ),
    );
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
          setMarketSnapshot(snapshot);
          writeCachedSnapshot(STOCKS_MARKET_SNAPSHOT_CACHE_KEY, snapshot);
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = performanceCacheKey;
    const cached = readCachedSnapshot<StocksPerformanceSnapshot>(cacheKey);
    setPerformanceSnapshot(hasPerformanceSeries(cached) ? cached : null);
    async function loadPerformanceData() {
      try {
        setPerformanceError(null);
        const response = await fetch(
          `/api/stocks-performance?tickers=${encodeURIComponent(
            performanceTickersKey,
          )}&lookbackDays=7`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(`performance data HTTP ${response.status}`);
        }
        const snapshot = (await response.json()) as StocksPerformanceSnapshot;
        if (!cancelled) {
          if (hasPerformanceSeries(snapshot)) {
            setPerformanceSnapshot(snapshot);
            writeCachedSnapshot(cacheKey, snapshot);
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
  }, [marketSnapshot?.generatedAt, performanceCacheKey, performanceTickersKey]);

  useEffect(() => {
    let cancelled = false;
    setFinancialSnapshot(
      (current) =>
        current ??
        readCachedSnapshot<StocksFinancialSnapshot>(
          STOCKS_FINANCIAL_SNAPSHOT_CACHE_KEY,
        ),
    );
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
          setFinancialSnapshot(snapshot);
          writeCachedSnapshot(STOCKS_FINANCIAL_SNAPSHOT_CACHE_KEY, snapshot);
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
    void loadFinancialData();
    const timer = window.setInterval(loadFinancialData, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCatalystSnapshot(
      (current) =>
        current ??
        readCachedSnapshot<StocksCatalystSnapshot>(
          STOCKS_CATALYST_SNAPSHOT_CACHE_KEY,
        ),
    );
    async function loadCatalystData() {
      try {
        setCatalystError(null);
        const response = await fetch("/api/stocks-catalysts", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`catalyst data HTTP ${response.status}`);
        }
        const snapshot = (await response.json()) as StocksCatalystSnapshot;
        if (!cancelled) {
          setCatalystSnapshot(snapshot);
          writeCachedSnapshot(STOCKS_CATALYST_SNAPSHOT_CACHE_KEY, snapshot);
          setCatalystError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setCatalystError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
    void loadCatalystData();
    const timer = window.setInterval(loadCatalystData, 2 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="grid min-h-0 gap-4">
      <section className="rounded-lg border border-line/70 bg-panel-strong shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)] lg:sticky lg:top-[5.25rem] lg:z-30 lg:backdrop-blur-xl">
        <div className="flex flex-col gap-3 border-b border-line/60 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-medium text-foreground">
              STOCKS 美股投研池
            </h1>
            <p className="mt-1 text-xs text-muted">
              行情和财报尝试接入 Yahoo 数据源，失败时自动回落本地 mock。
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={[
                "rounded-md px-2 py-1 text-[11px] font-semibold",
                marketSnapshot?.source === "live"
                  ? "bg-success-soft text-success"
                  : marketSnapshot?.source === "mock"
                    ? "bg-warning-soft text-warning"
                    : "bg-info-soft text-info",
              ].join(" ")}
              title={snapshotStatusTitle(marketSnapshot, marketStatus)}
            >
              {marketStatus}
            </span>
            <span
              className={[
                "rounded-md px-2 py-1 text-[11px] font-semibold",
                financialSnapshot?.source === "live"
                  ? "bg-success-soft text-success"
                  : financialSnapshot?.source === "mock"
                    ? "bg-warning-soft text-warning"
                    : "bg-info-soft text-info",
              ].join(" ")}
              title={snapshotStatusTitle(financialSnapshot, financialStatus)}
            >
              {financialStatus}
            </span>
            <span
              className={[
                "rounded-md px-2 py-1 text-[11px] font-semibold",
                catalystSnapshot?.source === "live"
                  ? "bg-success-soft text-success"
                  : catalystSnapshot?.source === "mock"
                    ? "bg-warning-soft text-warning"
                    : "bg-info-soft text-info",
              ].join(" ")}
              title={snapshotStatusTitle(catalystSnapshot, catalystStatus)}
            >
              {catalystStatus}
            </span>
            {marketSnapshot ? (
              <span className="rounded-md border border-line/60 bg-background/45 px-2 py-1 text-[11px] text-muted">
                {new Date(marketSnapshot.generatedAt).toLocaleTimeString(
                  "zh-CN",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )}
              </span>
            ) : null}
            {marketError ? (
              <span className="max-w-[18rem] truncate rounded-md border border-danger/30 bg-danger-soft px-2 py-1 text-[11px] text-danger">
                {marketError}
              </span>
            ) : null}
            {marketIssue ? (
              <span
                className="max-w-[12rem] truncate rounded-md border border-warning/30 bg-warning-soft px-2 py-1 text-[11px] text-warning"
                title={snapshotStatusTitle(marketSnapshot, marketIssue)}
              >
                {marketIssue}
              </span>
            ) : null}
            {financialError ? (
              <span className="max-w-[18rem] truncate rounded-md border border-danger/30 bg-danger-soft px-2 py-1 text-[11px] text-danger">
                {financialError}
              </span>
            ) : null}
            {financialIssue ? (
              <span
                className="max-w-[12rem] truncate rounded-md border border-warning/30 bg-warning-soft px-2 py-1 text-[11px] text-warning"
                title={snapshotStatusTitle(financialSnapshot, financialIssue)}
              >
                {financialIssue}
              </span>
            ) : null}
            {catalystError ? (
              <span className="max-w-[18rem] truncate rounded-md border border-danger/30 bg-danger-soft px-2 py-1 text-[11px] text-danger">
                {catalystError}
              </span>
            ) : null}
            {catalystIssue ? (
              <span
                className="max-w-[12rem] truncate rounded-md border border-warning/30 bg-warning-soft px-2 py-1 text-[11px] text-warning"
                title={snapshotStatusTitle(catalystSnapshot, catalystIssue)}
              >
                {catalystIssue}
              </span>
            ) : null}
            {performanceError ? (
              <span
                className={[
                  "max-w-[18rem] truncate rounded-md border px-2 py-1 text-[11px]",
                  isPerformanceCacheNotice(performanceError)
                    ? "border-warning/30 bg-warning-soft text-warning"
                    : "border-danger/30 bg-danger-soft text-danger",
                ].join(" ")}
                title={performanceError}
              >
                {performanceIssueLabel(performanceError)}
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line/70 bg-background/45 p-1 sm:w-[32rem]">
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "min-h-10 rounded-md px-2 py-1.5 text-left transition-colors",
                    selected
                      ? "bg-foreground text-background shadow-[0_12px_28px_-24px_rgba(38,31,27,0.65)]"
                      : "text-muted hover:bg-panel hover:text-foreground",
                  ].join(" ")}
                >
                  <span className="block text-xs font-semibold">{tab.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] opacity-75">
                    {tab.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-3 py-2 sm:px-4 lg:flex-row lg:items-center">
          <span className="text-[11px] font-semibold uppercase tracking-normal text-muted">
            数据健康中心
          </span>
          <div className="flex min-w-0 flex-wrap gap-2">
            {stocksDataHealthItems.map((item) => (
              <span
                key={item.label}
                title={item.detail}
                className={[
                  "max-w-[16rem] truncate rounded-md border px-2 py-1 text-[11px] font-semibold",
                  item.tone === "success"
                    ? "border-success/30 bg-success-soft text-success"
                    : item.tone === "warning"
                      ? "border-warning/30 bg-warning-soft text-warning"
                      : "border-info/30 bg-info-soft text-info",
                ].join(" ")}
              >
                {item.label}：{item.value}
              </span>
            ))}
          </div>
        </div>
      </section>

      {activeTab === "research" ? (
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
            if (!sector) {
              return;
            }
            setSelectedTicker(sector.tickers[0]);
          }}
          onSelectTicker={setSelectedTicker}
          marketDataLabel={marketDataLabel}
          marketDataLoading={marketDataLoading}
          performanceLoading={performanceSnapshot === null && performanceError === null}
        />
      ) : activeTab === "reports" ? (
        <StocksSubscriptionReports
          reports={subscriptionReports}
          generatedAt={catalystSnapshot?.generatedAt ?? null}
          onSelectTicker={(ticker) => {
            setSelectedTicker(ticker);
            setActiveTab("research");
          }}
        />
      ) : (
        <AlphaSummaryCard
          audience="stocks"
          deskLabel="STOCKS Research AI"
          endpoint="/api/stocks-summary"
        />
      )}
    </div>
  );
}
