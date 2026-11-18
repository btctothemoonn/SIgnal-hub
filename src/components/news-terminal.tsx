"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  Circle,
  Copy,
  ExternalLink,
  Filter,
  LoaderCircle,
  Newspaper,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  formatNewsMoney,
  formatNewsPrice,
  mergeNewsItems,
  newsExecutionSymbol,
  NEWS_SYMBOL_INPUT,
  normalizeNewsOrder,
  readNewsJson,
  tradeConfirmationKey,
} from "@/lib/news-terminal-client";
import type {
  NewsDetail,
  NewsFeed,
  NewsItem,
  NewsSourceSummary,
  TradeRequest,
  TradeStatus,
  TradeVenue,
} from "@/lib/news-terminal-types";
import {
  NewsPositions,
  NewsTradePanel,
  type OrderDraft,
} from "./news-trade-panel";
import styles from "./news-terminal.module.css";
import { prefetchNewsMarket } from "@/lib/news-market-client";
import { useNewsMarket } from "./use-news-market";

const NewsCandleChart = dynamic(
  () => import("./news-candle-chart").then((module) => module.NewsCandleChart),
  {
    ssr: false,
    loading: () => (
      <div className={styles.chartEmpty}>
        <LoaderCircle className={styles.spinning} size={20} />
      </div>
    ),
  },
);
const CHANNELS = [
  ["all", "全部"],
  ["main", "主站"],
  ["binance", "币安"],
  ["korea", "韩国"],
  ["alpha", "Alpha"],
  ["tradfi", "TradFi"],
  ["pricechange", "异动"],
  ["oi", "OI"],
];
const PREFS_KEY = "signal-hub:news-terminal:v1";
const DEFAULT_DRAFT: OrderDraft = {
  notional: 200,
  leverage: 3,
  type: "market",
  limitPrice: "",
  stopLoss: "",
  takeProfit: "",
};
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

function newsTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function useDebouncedValue(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

export function NewsTerminal({ initialSymbol }: { initialSymbol?: string }) {
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [pendingFeed, setPendingFeed] = useState<NewsFeed | null>(null);
  const [channel, setChannel] = useState("all");
  const [query, setQuery] = useState("");
  const searchQuery = useDebouncedValue(query);
  const [source, setSource] = useState("");
  const [onlyCoins, setOnlyCoins] = useState(false);
  const [compact, setCompact] = useState(false);
  const [original, setOriginal] = useState(false);
  const [immediate, setImmediate] = useState(false);
  const [sound, setSound] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sourceList, setSourceList] = useState<NewsSourceSummary[]>([]);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [symbol, setSymbol] = useState(initialSymbol ?? "BTC");
  const [symbolDraft, setSymbolDraft] = useState(initialSymbol ?? "BTC");
  const [venue, setVenue] = useState<TradeVenue>("binance");
  const [interval, setIntervalValue] = useState("5m");
  const [selected, setSelected] = useState<NewsItem | null>(null);
  const [detail, setDetail] = useState<NewsDetail | null>(null);
  const [detailContext, setDetailContext] = useState("");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [trade, setTrade] = useState<TradeStatus | null>(null);
  const [draft, setDraft] = useState<OrderDraft>(DEFAULT_DRAFT);
  const [sideTab, setSideTab] = useState("trade");
  const [mobileOpen, setMobileOpen] = useState(Boolean(initialSymbol));
  const [busy, setBusy] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    key: string;
    side: string;
    expiresAt: number;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const olderRequest = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const orderLock = useRef(false);
  const orderIntent = useRef<{ key: string; id: string } | null>(null);
  const soundEnabled = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const previousLatest = useRef<string | null>(null);
  const assetId = selected?.coins.find(coin => coin.symbol === symbol)?.assetId || "";
  const { market: matchingMarket, loading: marketLoading, error: marketError, live: marketLive } = useNewsMarket({ symbol, venue, interval, assetId }, revision);
  const currentAccount = trade?.accounts.find(
    (account) => account.venue === venue,
  );

  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
        if (
          !initialSymbol && typeof prefs.symbol === "string" &&
          NEWS_SYMBOL_INPUT.test(prefs.symbol.toUpperCase())
        ) {
          setSymbol(prefs.symbol.toUpperCase());
          setSymbolDraft(prefs.symbol.toUpperCase());
        }
        if (!initialSymbol && (prefs.venue === "binance" || prefs.venue === "hyperliquid"))
          setVenue(prefs.venue);
        if (typeof prefs.compact === "boolean") setCompact(prefs.compact);
        if (typeof prefs.original === "boolean") setOriginal(prefs.original);
        if (typeof prefs.onlyCoins === "boolean") setOnlyCoins(prefs.onlyCoins);
        if (typeof prefs.immediate === "boolean") setImmediate(prefs.immediate);
      } catch {
        /* Defaults remain usable when browser storage is unavailable. */
      }
    });
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setMobileOpen(false);
        setShowSettings(false);
        setConfirmation(null);
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("keydown", focusSearch);
      void audioRef.current?.close();
    };
  }, [initialSymbol]);

  function savePrefs(patch: Record<string, unknown>) {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          symbol,
          venue,
          compact,
          original,
          onlyCoins,
          immediate,
          ...patch,
        }),
      );
    } catch {
      /* Storage is optional. */
    }
  }
  function selectSymbol(next: string) {
    setSymbol(next);
    setSymbolDraft(next);
    setConfirmation(null);
    savePrefs({ symbol: next });
  }
  function selectStory(item: NewsItem, coin?: string) {
    setSelected(item);
    setMobileOpen(true);
    const next = coin || item.coins[0]?.symbol;
    if (next) selectSymbol(next);
  }
  function notify(message: string, error = false) {
    setNotice({ message, error });
  }
  function tone() {
    if (!soundEnabled.current || !audioRef.current) return;
    const audio = audioRef.current;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 700;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.12);
  }

  useEffect(() => {
    olderRequest.current?.abort();
    const controller = new AbortController();
    let inFlight = false;
    const params = new URLSearchParams({ channel, limit: "100" });
    if (searchQuery) params.set("q", searchQuery);
    if (source) params.set("source", source);
    async function load(initial = false) {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await readNewsJson<NewsFeed>(`/api/eqn-news?${params}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setFeedError(null);
        if (!initial && listRef.current && listRef.current.scrollTop > 60)
          setPendingFeed(data);
        else {
          setFeed(data);
          setPendingFeed(null);
        }
        if (
          !initial &&
          previousLatest.current &&
          data.items[0]?.id !== previousLatest.current &&
          data.items[0]?.score >= 80
        )
          tone();
        previousLatest.current = data.items[0]?.id || null;
      } catch (error) {
        if (!controller.signal.aborted)
          setFeedError(error instanceof Error ? error.message : "新闻加载失败");
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setFeedLoading(false);
      }
    }
    void load(true);
    const events = new EventSource("/api/eqn-news/stream");
    events.onmessage = () => {
      void load();
    };
    const poll = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    return () => {
      controller.abort();
      olderRequest.current?.abort();
      events.close();
      window.clearInterval(poll);
    };
  }, [channel, searchQuery, source, revision]);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 760px)").matches || !listRef.current) return;
    const root = listRef.current;
    let count = 0;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || count >= 2) continue;
        const button = entry.target as HTMLElement;
        if (button.dataset.marketSymbol !== symbol) {
          prefetchNewsMarket({ symbol: button.dataset.marketSymbol!, assetId: button.dataset.marketAsset, venue, interval });
          count++;
        }
        observer.unobserve(button);
      }
      if (count >= 2) observer.disconnect();
    }, { root, threshold: 0.5 });
    root.querySelectorAll("[data-market-symbol]").forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [feed, venue, interval, symbol]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const context = `${selected.id}|${symbol}|${venue}`;
    let inFlight = false;
    async function load() {
      if (inFlight || !selected) return;
      inFlight = true;
      try {
        const data = await readNewsJson<NewsDetail>(`/api/eqn-news/${encodeURIComponent(selected.id)}?${new URLSearchParams({ coin: symbol, venue })}`, { signal: controller.signal });
        if (!controller.signal.aborted) { setDetail(data); setDetailContext(context); setDetailError(null); }
      } catch (error) {
        if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : "详情加载失败");
      } finally { inFlight = false; }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [selected, symbol, venue, revision]);

  useEffect(() => {
    const controller = new AbortController();
    readNewsJson<{ sources: NewsSourceSummary[] }>("/api/eqn-news/sources", { signal: controller.signal })
      .then((data) => setSourceList(data.sources))
      .catch(() => { /* The feed-derived source list remains available. */ });
    return () => controller.abort();
  }, [showSettings]);

  async function toggleSource(target: NewsSourceSummary) {
    if (sourceSaving) return;
    const previous = sourceList;
    const next = sourceList.map((item) => item.source === target.source ? { ...item, blocked: !item.blocked } : item);
    setSourceList(next);
    setSourceSaving(true);
    try {
      const data = await readNewsJson<{ sources: NewsSourceSummary[] }>("/api/eqn-news/sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked: next.filter((item) => item.blocked).map((item) => item.source) }),
      });
      setSourceList(data.sources);
      if (!target.blocked && source.toLowerCase() === target.source.toLowerCase()) setSource("");
      setRevision((value) => value + 1);
    } catch (error) {
      setSourceList(previous);
      notify(error instanceof Error ? error.message : "来源设置保存失败", true);
    } finally {
      setSourceSaving(false);
    }
  }

  const refreshTrade = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await readNewsJson<TradeStatus>("/api/trade/status", {
        signal,
      });
      if (!signal?.aborted) setTrade(data);
    } catch (error) {
      if (!signal?.aborted)
        setTrade((previous) =>
          previous
            ? {
                ...previous,
                error: error instanceof Error ? error.message : "账户同步失败",
                accounts: previous.accounts.map((account) => ({
                  ...account,
                  connected: false,
                })),
              }
            : null,
        );
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = false;
    async function load() {
      if (active) return;
      active = true;
      try {
        await refreshTrade(controller.signal);
      } finally {
        active = false;
      }
    }
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden && !orderLock.current) void load();
    }, 10_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refreshTrade]);
  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(
      () => setConfirmation(null),
      Math.max(0, confirmation.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  async function postTrade(path: string, payload: unknown) {
    if (!trade?.csrfToken) throw new Error("交易会话尚未建立，请刷新账户");
    const response = await fetch(`/api/trade/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": trade.csrfToken,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 409
      )
        orderIntent.current = null;
      throw new Error(data.error || "交易请求失败，请核对交易记录");
    }
    return data;
  }
  async function runTradeAction(
    path: string,
    payload: unknown,
    success: string,
  ) {
    if (orderLock.current) return;
    orderLock.current = true;
    setBusy(true);
    try {
      const data = await postTrade(path, payload);
      const warning =
        data.warning ||
        data.protectionError ||
        data.result?.warning ||
        data.result?.protectionError;
      notify(warning ? String(warning) : success, Boolean(warning));
      await refreshTrade();
      return data;
    } catch (error) {
      notify(error instanceof Error ? error.message : "交易请求失败", true);
      throw error;
    } finally {
      orderLock.current = false;
      setBusy(false);
    }
  }
  function draftOrder(
    side: "buy" | "sell",
    overrides?: Partial<TradeRequest>,
  ): TradeRequest {
    return normalizeNewsOrder({
      clientOrderId: "",
      venue,
      symbol: matchingMarket?.pair ? newsExecutionSymbol(matchingMarket.pair, venue) : symbol,
      side,
      type: draft.type,
      notional: draft.notional,
      leverage: draft.leverage,
      ...(draft.type === "limit"
        ? { limitPrice: Number(draft.limitPrice) }
        : {}),
      ...(draft.stopLoss ? { stopLossPct: Number(draft.stopLoss) } : {}),
      ...(draft.takeProfit ? { takeProfitPct: Number(draft.takeProfit) } : {}),
      ...(selected?.coins.some(coin => coin.symbol === symbol) ? { newsId: selected.id } : {}),
      ...overrides,
    });
  }
  async function submitOrder(order: TradeRequest, forceConfirm = false) {
    if (orderLock.current) return;
    if (
      !trade?.enabled ||
      trade.mode !== "live" ||
      !trade.unlocked ||
      !currentAccount?.connected
    ) {
      notify("请先连接账户并解锁交易", true);
      return;
    }
    if (
      !order.reduceOnly &&
      (!matchingMarket?.pair ||
        !matchingMarket.tradable ||
        matchingMarket.error ||
        marketError ||
        Date.now() - matchingMarket.fetchedAt > 60_000 ||
        newsExecutionSymbol(matchingMarket.pair, venue) !== order.symbol)
    ) {
      notify("等待当前账户的合约行情确认后再下单", true);
      return;
    }
    if (
      !Number.isFinite(order.notional) ||
      order.notional <= 0 ||
      (!order.reduceOnly && order.notional > trade.limits.maxOrderNotional)
    ) {
      notify(
        `单笔名义价值需在 0 到 ${trade.limits.maxOrderNotional} 之间`,
        true,
      );
      return;
    }
    if (
      order.type === "limit" &&
      (!order.limitPrice ||
        !Number.isFinite(order.limitPrice) ||
        order.limitPrice <= 0)
    ) {
      notify("请输入有效的限价", true);
      return;
    }
    const key = tradeConfirmationKey(order);
    const needsConfirmation =
      !immediate ||
      forceConfirm ||
      window.matchMedia("(max-width: 767px)").matches ||
      Boolean(selected && Date.now() - selected.publishedAt > 600000);
    if (
      needsConfirmation &&
      (!confirmation ||
        confirmation.key !== key ||
        Date.now() > confirmation.expiresAt)
    ) {
      setConfirmation({ key, side: order.side, expiresAt: Date.now() + 2000 });
      notify(
        `再次点击确认${order.reduceOnly ? "平仓" : order.side === "buy" ? "开多" : "开空"} ${order.symbol} · ${formatNewsMoney(order.notional)} ${venue === "binance" ? "USDT" : "USDC"}`,
      );
      return;
    }
    setConfirmation(null);
    if (orderIntent.current?.key !== key)
      orderIntent.current = {
        key,
        id: crypto.randomUUID().replaceAll("-", ""),
      };
    order.clientOrderId = orderIntent.current.id;
    try {
      const result = await runTradeAction("order", order, "订单已提交，请查看挂单和成交记录");
      if (result?.status !== "uncertain") orderIntent.current = null;
    } catch {
      /* Preserve uncertain order IDs for reconciliation. */
    }
  }
  async function loadOlder() {
    if (!feed?.nextCursor || loadingOlder) return;
    const controller = new AbortController();
    olderRequest.current?.abort();
    olderRequest.current = controller;
    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({
        channel,
        limit: "100",
        before: feed.nextCursor,
      });
      if (searchQuery) params.set("q", searchQuery);
      if (source) params.set("source", source);
      const data = await readNewsJson<NewsFeed>(`/api/eqn-news?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setFeed((previous) =>
        previous
          ? { ...data, items: mergeNewsItems(previous.items, data.items) }
          : data,
      );
    } catch (error) {
      if (!controller.signal.aborted) setFeedError(error instanceof Error ? error.message : "历史新闻加载失败");
    } finally {
      setLoadingOlder(false);
    }
  }
  async function quickOrder(
    item: NewsItem,
    coin: string,
    side: "buy" | "sell",
  ) {
    if (coin !== symbol) {
      selectStory(item, coin);
      notify(`已切换 ${coin}，行情确认后可下单`);
      return;
    }
    await submitOrder(
      draftOrder(side, {
        symbol: matchingMarket?.pair ? newsExecutionSymbol(matchingMarket.pair, venue) : coin,
        newsId: item.id,
        type: "market",
        limitPrice: undefined,
      }),
      Date.now() - item.publishedAt > 600000,
    );
  }

  const items = (feed?.items || []).filter(
    (item) => !onlyCoins || item.coins.length > 0,
  );
  const sources: [string, string][] = sourceList.length
    ? sourceList.filter((item) => !item.blocked).map((item) => [item.source, item.name])
    : [
        ...new Map(
          (feed?.items || []).map((item) => [item.source, item.sourceName]),
        ).entries(),
      ];
  const blockedCount = sourceList.filter((item) => item.blocked).length;
  const currentDetail = selected && detailContext === `${selected.id}|${symbol}|${venue}` ? detail : null;
  const newsForChart = currentDetail?.relatedNews || feed?.items || [];
  const newCount =
    pendingFeed?.items.filter(
      (item) => !feed?.items.some((previous) => previous.id === item.id),
    ).length || 0;
  const currentPrice = matchingMarket?.price;
  const confirmedSide =
    confirmation &&
    confirmation.key ===
      tradeConfirmationKey(draftOrder(confirmation.side as "buy" | "sell"))
      ? confirmation.side
      : null;
  const sharedSymbolLabel = `${symbol}${matchingMarket?.pair ? ` · ${matchingMarket.pair}` : ""}`;

  return (
    <div className={styles.terminal} data-news-terminal>
      <div className={styles.toolbar}>
        <div
          className={styles.channelTabs}
          role="tablist"
          aria-label="新闻频道"
        >
          {CHANNELS.map(([key, label]) => (
            <button
              role="tab"
              aria-selected={channel === key}
              key={key}
              onClick={() => {
                setChannel(key);
                setFeedLoading(true);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.searchTools}>
          <label className={styles.search}>
            <Search size={14} />
            <input
              ref={searchRef}
              aria-label="搜索新闻或币种"
              placeholder="搜索新闻或币种"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button aria-label="清除搜索" onClick={() => setQuery("")}>
                <X size={13} />
              </button>
            ) : (
              <kbd>/</kbd>
            )}
          </label>
          <label className={styles.sourceFilter} title="新闻来源">
            <Filter size={13} />
            <select
              aria-label="新闻来源"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">全部来源</option>
              {sources.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.iconButton}
            title={sound ? "关闭提示音" : "开启提示音"}
            aria-label={sound ? "关闭提示音" : "开启提示音"}
            onClick={() => {
              const next = !sound;
              setSound(next);
              soundEnabled.current = next;
              if (next) {
                audioRef.current ??= new AudioContext();
                void audioRef.current.resume();
              }
            }}
          >
            {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          <button
            className={styles.iconButton}
            title="显示与交易设置"
            aria-label="显示与交易设置"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((value) => !value)}
          >
            <Settings2 size={15} />
          </button>
          <button
            className={styles.iconButton}
            title="刷新"
            aria-label="刷新新闻与行情"
            onClick={() => {
              setRevision((value) => value + 1);
              void refreshTrade();
            }}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>
      {showSettings ? (
        <div className={styles.preferences}>
          {[
            ["compact", "紧凑显示", compact],
            ["original", "显示原文", original],
            ["onlyCoins", "仅带币种", onlyCoins],
            ["immediate", "点击即下单", immediate],
          ].map(([key, label, checked]) => (
            <label key={String(key)}>
              <input
                type="checkbox"
                checked={Boolean(checked)}
                onChange={(event) => {
                  const value = event.target.checked;
                  if (key === "compact") setCompact(value);
                  if (key === "original") setOriginal(value);
                  if (key === "onlyCoins") setOnlyCoins(value);
                  if (key === "immediate") setImmediate(value);
                  setConfirmation(null);
                  savePrefs({ [String(key)]: value });
                }}
              />
              {label}
            </label>
          ))}
          <select
            aria-label="更多新闻频道"
            value={CHANNELS.some(([key]) => key === channel) ? "" : channel}
            onChange={(event) => {
              if (event.target.value) setChannel(event.target.value);
            }}
          >
            <option value="">更多频道</option>
            {[
              ["major", "主流币"],
              ["tier2", "二线币"],
              ["tier3", "小币"],
              ["cz", "CZ"],
              ["earn", "理财"],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <section className={styles.sourceManager} aria-label="新闻来源接入">
            <header>
              <strong>新闻来源</strong>
              <span>
                {sourceList.length - blockedCount} 接入 · {blockedCount} 屏蔽
                {sourceSaving ? <LoaderCircle className={styles.spinning} size={12} /> : null}
              </span>
            </header>
            <div className={styles.sourceGrid}>
              {sourceList.map((item) => (
                <label
                  key={item.source}
                  className={item.blocked ? styles.sourceBlocked : undefined}
                  title={item.lastAt ? `最近 ${new Date(item.lastAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : "暂无近期消息"}
                >
                  <input
                    type="checkbox"
                    checked={!item.blocked}
                    disabled={sourceSaving}
                    aria-label={`${item.blocked ? "接入" : "屏蔽"} ${item.name}`}
                    onChange={() => void toggleSource(item)}
                  />
                  <span>{item.name}</span>
                  <small title="24 小时 / 30 天消息数">{item.count24h}/{item.count}</small>
                </label>
              ))}
              {!sourceList.length ? <span className={styles.sourceEmpty}>暂无来源</span> : null}
            </div>
          </section>
        </div>
      ) : null}
      {notice ? (
        <div
          className={notice.error ? styles.errorNotice : styles.notice}
          role={notice.error ? "alert" : "status"}
        >
          <span>{notice.message}</span>
          <button
            className={styles.iconButton}
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      <div className={styles.workspace}>
        <section className={styles.feedPane} aria-label="实时新闻">
          <div className={styles.feedHeading}>
            <span>
              <Newspaper size={14} />
              实时新闻
            </span>
            <span>
              {items.length} 条
              {feedLoading ? (
                <LoaderCircle className={styles.spinning} size={12} />
              ) : null}
            </span>
          </div>
          {newCount ? (
            <button
              className={styles.newMessages}
              onClick={() => {
                setFeed(pendingFeed);
                setPendingFeed(null);
                listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <ArrowUpRight size={13} />
              {newCount} 条新消息
            </button>
          ) : null}
          <div ref={listRef} className={styles.feedList}>
            {feedError ? (
              <p className={styles.errorText} role="alert">
                {feedError}
              </p>
            ) : null}
            {feedLoading && !feed
              ? Array.from({ length: 5 }, (_, index) => (
                  <div className={styles.skeleton} key={index}>
                    <i />
                    <i />
                    <i />
                  </div>
                ))
              : null}
            {!feedLoading && !items.length ? (
              <div className={styles.empty}>
                <Newspaper size={24} />
                <span>
                  {feed?.status.enabled
                    ? "当前筛选下暂无新闻"
                    : "新闻采集待启用"}
                </span>
                <button
                  onClick={() => {
                    setChannel("all");
                    setQuery("");
                    setSource("");
                    setOnlyCoins(false);
                  }}
                >
                  清除筛选
                </button>
              </div>
            ) : null}
            {items.map((item) => (
              <article
                key={item.id}
                data-news-id={item.id}
                className={[
                  styles.newsItem,
                  compact ? styles.compact : "",
                  selected?.id === item.id ? styles.selectedNews : "",
                  item.score >= 80 ? styles.importantNews : "",
                ].join(" ")}
              >
                <div className={styles.newsMeta}>
                  <span className={styles.sourceName}>{item.sourceName}</span>
                  {item.kind === "listing" ? (
                    <span className={styles.listingBadge}>上币</span>
                  ) : null}
                  <time dateTime={new Date(item.publishedAt).toISOString()}>
                    {newsTime(item.publishedAt)}
                  </time>
                  {item.score >= 70 ? (
                    <span className={styles.score} title="规则重要性评分">
                      {item.score}
                    </span>
                  ) : null}
                </div>
                <button
                  className={styles.headline}
                  onClick={() => selectStory(item)}
                >
                  {original && item.original ? item.original : item.title}
                </button>
                {item.digest.length ? (
                  <ul className={styles.digest}>
                    {item.digest
                      .slice(0, compact ? 1 : 3)
                      .map((point, index) => (
                        <li key={index}>{point}</li>
                      ))}
                  </ul>
                ) : null}
                <div className={styles.coinRows}>
                  {item.coins.map((coin) => (
                    <div className={styles.coinRow} key={coin.symbol}>
                      <button
                        className={styles.coinLabel}
                        title={`查看 ${coin.symbol} 行情`}
                        data-market-symbol={coin.symbol}
                        data-market-asset={coin.assetId || ""}
                        onPointerEnter={() => prefetchNewsMarket({ symbol: coin.symbol, assetId: coin.assetId, venue, interval })}
                        onFocus={() => prefetchNewsMarket({ symbol: coin.symbol, assetId: coin.assetId, venue, interval })}
                        onClick={() => selectStory(item, coin.symbol)}
                      >
                        <span className={styles.coinMonogram}>
                          {coin.symbol.slice(0, 1)}
                        </span>
                        <strong>{coin.symbol}</strong>
                        <small>
                          {coin.symbol === symbol && currentPrice != null
                            ? `$${formatNewsPrice(currentPrice)}`
                            : coin.marketCapAtPublish
                              ? `MC ${formatNewsMoney(coin.marketCapAtPublish)}`
                              : ""}
                        </small>
                      </button>
                      {currentAccount?.configured ? (
                        <div className={styles.quickActions}>
                          <button
                            title={`市价开多 ${draft.notional} · ${venue}`}
                            disabled={
                              busy ||
                              !trade?.enabled ||
                              !trade.unlocked ||
                              trade.mode !== "live" ||
                              !currentAccount.connected
                            }
                            onClick={() =>
                              void quickOrder(item, coin.symbol, "buy")
                            }
                          >
                            <ArrowUpRight size={11} />
                            {draft.notional}
                          </button>
                          <button
                            title={`市价开空 ${draft.notional} · ${venue}`}
                            disabled={
                              busy ||
                              !trade?.enabled ||
                              !trade.unlocked ||
                              trade.mode !== "live" ||
                              !currentAccount.connected
                            }
                            onClick={() =>
                              void quickOrder(item, coin.symbol, "sell")
                            }
                          >
                            <ArrowDownLeft size={11} />
                            {draft.notional}
                          </button>
                        </div>
                      ) : (
                        <ArrowUpRight size={13} className={styles.muted} />
                      )}
                    </div>
                  ))}
                </div>
                {!compact && item.images.length ? (
                  <div className={styles.imageStrip}>
                    {item.images.slice(0, 2).map((url, index) => {
                      const safe = safeHttpUrl(url);
                      return safe ? (
                        <a
                          key={`${safe}-${index}`}
                          href={safe}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Image
                            alt="新闻配图"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            src={safe}
                            width={150}
                            height={84}
                            unoptimized
                            onError={(event) => {
                              event.currentTarget.hidden = true;
                            }}
                          />
                        </a>
                      ) : null;
                    })}
                  </div>
                ) : null}
                <div className={styles.newsActions}>
                  {safeHttpUrl(item.url) ? (
                    <a
                      href={safeHttpUrl(item.url)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      原文
                      <ExternalLink size={11} />
                    </a>
                  ) : null}
                  <button
                    title="复制新闻链接"
                    aria-label={`复制新闻链接 ${item.id}`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          safeHttpUrl(item.url) ||
                            `https://eqn.news${item.no ? `/main/${item.no}` : ""}`,
                        );
                        setCopied(item.id);
                      } catch {
                        notify("浏览器未允许复制", true);
                      }
                    }}
                  >
                    {copied === item.id ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </article>
            ))}
            {feed?.nextCursor ? (
              <button
                className={styles.loadOlder}
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? (
                  <LoaderCircle size={13} className={styles.spinning} />
                ) : (
                  <ArrowDown size={13} />
                )}
                加载更早新闻
              </button>
            ) : null}
          </div>
        </section>
        <div
          className={[
            styles.workbench,
            mobileOpen ? styles.mobileOpen : "",
          ].join(" ")}
          role={mobileOpen ? "region" : undefined}
          aria-label="行情和交易"
        >
          <div className={styles.mobileDetailHeader}>
            <button
              className={styles.iconButton}
              aria-label="返回新闻列表"
              onClick={() => setMobileOpen(false)}
            >
              <ChevronLeft size={18} />
            </button>
            <strong>{symbol}</strong>
            <span>{venue === "binance" ? "币安合约" : "Hyperliquid"}</span>
          </div>
          <div className={styles.marketPane}>
            <div className={styles.marketHeading}>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = symbolDraft.trim().toUpperCase();
                  if (NEWS_SYMBOL_INPUT.test(next)) selectSymbol(next);
                }}
              >
                <input
                  aria-label="行情币种"
                  value={symbolDraft}
                  maxLength={25}
                  onChange={(event) => setSymbolDraft(event.target.value)}
                />
                <button
                  className={styles.iconButton}
                  type="submit"
                  title="切换币种"
                  aria-label="切换币种"
                >
                  <Search size={13} />
                </button>
              </form>
              <select
                aria-label="交易账户"
                value={venue}
                onChange={(event) => {
                  const next = event.target.value as TradeVenue;
                  setVenue(next);
                  setConfirmation(null);
                  savePrefs({ venue: next });
                }}
              >
                <option value="binance">币安 · USDT</option>
                <option value="hyperliquid">Hyperliquid · USDC</option>
              </select>
            </div>
            <div className={styles.priceHeading}>
              <strong>
                {currentPrice != null
                  ? `$${formatNewsPrice(currentPrice)}`
                  : "--"}
              </strong>
              <span
                className={
                  (matchingMarket?.change24h || 0) >= 0
                    ? styles.positive
                    : styles.negative
                }
              >
                {matchingMarket?.change24h != null
                  ? `${matchingMarket.change24h >= 0 ? "+" : ""}${matchingMarket.change24h.toFixed(2)}%`
                  : "--"}
                <small>24h</small>
              </span>
              <span className={styles.pairLabel}>
                {matchingMarket?.pair || symbol}
              </span>
            </div>
            <div className={styles.marketStats}>
              <span>
                流通市值 <b>{formatNewsMoney(matchingMarket?.marketCap)}</b>
              </span>
              <span>
                FDV <b>{formatNewsMoney(matchingMarket?.fdv)}</b>
              </span>
              <span>
                资金费率{" "}
                <b>
                  {matchingMarket?.fundingRate != null
                    ? `${(matchingMarket.fundingRate * 100).toFixed(4)}%`
                    : "--"}
                </b>
              </span>
            </div>
            <div className={styles.chartToolbar}>
              <div role="group" aria-label="K线周期">
                {INTERVALS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={interval === value}
                    onClick={() => setIntervalValue(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <span>
                <Circle size={7} fill="currentColor" />
                新闻标记
              </span>
              <span data-news-market-status>{marketLive ? "实时" : "轮询"}</span>
              {marketLoading ? (
                <LoaderCircle className={styles.spinning} size={12} />
              ) : null}
            </div>
            <div className={styles.chartArea}>
              {matchingMarket?.candles.length ? (
                <NewsCandleChart
                  key={`${venue}:${symbol}:${interval}`}
                  market={matchingMarket}
                  news={newsForChart}
                  selected={selected}
                  fills={trade?.fills}
                />
              ) : (
                <div className={styles.chartEmpty}>
                  {marketLoading ? (
                    <>
                      <LoaderCircle size={22} className={styles.spinning} />
                      <span>加载 {symbol} K 线</span>
                    </>
                  ) : (
                    <>
                      <Newspaper size={22} />
                      <span>{marketError || "暂无此合约行情"}</span>
                      <button onClick={() => setRevision((value) => value + 1)}>
                        重试
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {marketError && matchingMarket?.candles.length ? (
              <p className={styles.errorText}>{marketError}</p>
            ) : null}
            {selected ? (
              <div className={styles.selectedStory}>
                <span>
                  <Circle size={7} fill="currentColor" />
                  {newsTime(selected.publishedAt)}
                </span>
                <strong>{selected.title}</strong>
              </div>
            ) : null}
            <NewsPositions
              status={trade}
              venue={venue}
              busy={busy}
              onOrder={(order) =>
                void submitOrder(draftOrder(order.side || "sell", order), true)
              }
              onCancel={(coin, id) => {
                void runTradeAction(
                  "cancel",
                  { venue, symbol: coin, orderId: id },
                  "已提交撤单",
                ).catch(() => {});
              }}
              onCloseAll={() => {
                void runTradeAction(
                  "close-all",
                  { venue },
                  "平仓请求已处理，请核对持仓",
                ).catch(() => {});
              }}
            />
          </div>
          <aside className={styles.tradeAside}>
            <div
              className={styles.sideTabs}
              role="tablist"
              aria-label="交易与新闻详情"
            >
              <button
                role="tab"
                aria-selected={sideTab === "trade"}
                onClick={() => setSideTab("trade")}
              >
                交易
              </button>
              <button
                role="tab"
                aria-selected={sideTab === "detail"}
                onClick={() => setSideTab("detail")}
              >
                详情
              </button>
              <span
                className={
                  currentAccount?.connected ? styles.positive : styles.muted
                }
              >
                <Circle size={6} fill="currentColor" />
                {currentAccount?.connected ? "已连接" : "未连接"}
              </span>
            </div>
            <div className={styles.sideSymbol}>{sharedSymbolLabel}</div>
            {sideTab === "trade" ? (
              <NewsTradePanel
                symbol={symbol}
                venue={venue}
                market={matchingMarket}
                status={trade}
                draft={draft}
                setDraft={(value) => {
                  setDraft(value);
                  setConfirmation(null);
                }}
                busy={busy}
                confirmation={confirmedSide}
                onOrder={(side) => void submitOrder(draftOrder(side))}
                onUnlock={async (pin) => {
                  await runTradeAction("unlock", { pin }, "交易已解锁");
                }}
                onLock={() => {
                  void runTradeAction("lock", {}, "交易已锁定").catch(() => {});
                }}
              />
            ) : (
              <div className={styles.details}>
                <h3>新闻后价格反应</h3>
                <div className={styles.reactions}>
                  {[1, 5, 15, 60].map((minutes) => {
                    const value = currentDetail?.reactions.find(
                      (reaction) => reaction.minutes === minutes,
                    )?.change;
                    return (
                      <div key={minutes}>
                        <span>{minutes === 60 ? "1h" : `${minutes}m`}</span>
                        <strong
                          className={
                            value != null && value < 0
                              ? styles.negative
                              : value != null
                                ? styles.positive
                                : styles.muted
                          }
                        >
                          {value == null
                            ? "--"
                            : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`}
                        </strong>
                      </div>
                    );
                  })}
                </div>
                <p className={styles.reactionNote}>
                  {selected
                    ? "按发布后首个完整分钟 K 线近似，未到期或行情缺失时留空。"
                    : "选择一条新闻查看价格反应"}
                </p>
                <h3>行情</h3>
                <dl className={styles.detailMetrics}>
                  <div>
                    <dt>流通市值</dt>
                    <dd>{formatNewsMoney(matchingMarket?.marketCap)}</dd>
                  </div>
                  <div>
                    <dt>FDV</dt>
                    <dd>{formatNewsMoney(matchingMarket?.fdv)}</dd>
                  </div>
                  <div>
                    <dt>24h 成交额</dt>
                    <dd>{formatNewsMoney(matchingMarket?.volume24h)}</dd>
                  </div>
                  <div>
                    <dt>持仓量</dt>
                    <dd>{formatNewsMoney(matchingMarket?.openInterest)}</dd>
                  </div>
                </dl>
                <h3>Signal 关联</h3>
                <div className={styles.relatedSignals}>
                  {currentDetail?.signals.length ? (
                    currentDetail.signals.map((signal, index) => (
                      <a href={signal.url} key={`${signal.url}-${index}`}>
                        <span>{signal.title}</span>
                        <ExternalLink size={12} />
                      </a>
                    ))
                  ) : (
                    <p className={styles.muted}>暂无关联事件</p>
                  )}
                </div>
                <h3>同币新闻</h3>
                <div className={styles.relatedNews}>
                  {currentDetail?.relatedNews.slice(0, 10).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => selectStory(item, symbol)}
                    >
                      <time>{newsTime(item.publishedAt)}</time>
                      <span>{item.title}</span>
                    </button>
                  ))}
                </div>
                {detailError ? (
                  <p className={styles.errorText}>{detailError}</p>
                ) : null}
              </div>
            )}
            {trade?.error ? (
              <p className={styles.errorText}>{trade.error}</p>
            ) : null}
          </aside>
        </div>
      </div>
      <div className={styles.statusBar}>
        <span
          className={feed?.status.connected ? styles.positive : styles.muted}
        >
          <Radio size={12} />
          {feed?.status.connected
            ? "新闻实时连接"
            : feed?.status.enabled
              ? "新闻连接中"
              : "采集待启用"}
        </span>
        <span>
          {feed?.status.lastMessageAt
            ? `最近消息 ${newsTime(feed.status.lastMessageAt)}`
            : ""}
        </span>
        <span
          className={currentAccount?.connected ? styles.positive : styles.muted}
        >
          {venue === "binance" ? "币安" : "Hyperliquid"}{" "}
          {currentAccount?.connected ? "已连接" : "未连接"}
        </span>
        <span className={styles.sourceCredit}>
          <a href="https://eqn.news/" target="_blank" rel="noreferrer">
            方程式新闻
            <ExternalLink size={10} />
          </a>
        </span>
      </div>
      {feed?.status.error ? (
        <div className={styles.workerError}>{feed.status.error}</div>
      ) : null}
      <button
        className={styles.mobileMarketButton}
        onClick={() => setMobileOpen(true)}
      >
        {symbol}
        <span>${formatNewsPrice(currentPrice)}</span>
        <ArrowUpRight size={14} />
      </button>
    </div>
  );
}
