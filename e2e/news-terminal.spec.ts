import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { join } from "node:path";
import { openMarketAlertsStore } from "../src/lib/market-alerts-store";
import { marketSignalsDbPath, openMarketSignalsStore } from "../src/lib/market-signals";
import type { NewsFeed, NewsMarket, TradeStatus } from "../src/lib/news-terminal-types";

const now = Date.now();
const feed: NewsFeed = {
  items: [{
    id: "fixture-news-1", no: 1001, publishedAt: now - 60_000, receivedAt: now,
    channels: ["main", "binance"], kind: "listing", source: "binance_listing", sourceName: "币安公告",
    title: "币安新增 SOL 永续合约交易支持", original: "Binance announces new SOL perpetual trading support",
    url: "https://www.binance.com/en/support/announcement", images: [],
    coins: [{ symbol: "SOL", assetId: "solana", marketCapAtPublish: 70_000_000_000 }],
    digest: ["永续合约交易开放", "请关注资金费率变化"], score: 85,
  }], nextCursor: null,
  status: { enabled: true, connected: true, updatedAt: now, lastMessageAt: now, error: null },
};
const status: TradeStatus = {
  enabled: true, mode: "live", unlocked: false, csrfToken: "fixture-csrf",
  accounts: ["binance", "hyperliquid"].map(venue => ({
    venue: venue as "binance" | "hyperliquid", configured: true, connected: true,
    availableBalance: 500, equity: 550,
    positions: [{ symbol: "SOL", side: "long", size: 1, notional: 150, entryPrice: 145, markPrice: 150, unrealizedPnl: 5, liquidationPrice: 110, leverage: 3 }],
    orders: [], error: null, updatedAt: now,
  })),
  limits: { maxOrderNotional: 500, maxSymbolNotional: 1000, maxTotalNotional: 3000, maxLeverage: 5, maxDailyLoss: 200, slippagePct: 1 },
  logs: [], error: null,
};

async function setup(page: Page, options: { statsGate?: Promise<void>; onSocket?: (socket: WebSocketRoute) => void } = {}) {
  let unlocked = false;
  const orders: Record<string, unknown>[] = [];
  let blocked: string[] = [];
  await page.routeWebSocket(/wss:\/\//, (socket) => { options.onSocket?.(socket); });
  await page.route("**/api/eqn-news**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/stream")) {
      await route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      return;
    }
    if (url.pathname.endsWith("/sources")) {
      if (route.request().method() === "PUT") blocked = route.request().postDataJSON().blocked.map((value: string) => value.toLowerCase());
      const sources = [["binance_listing", "币安公告", 12], ["Price Monitor", "Price Monitor", 2166]].map(([source, name, count]) => ({ source, name, count, count24h: 3, lastAt: now, blocked: blocked.includes(String(source).toLowerCase()) }));
      await route.fulfill({ json: { sources, blocked } });
      return;
    }
    if (url.pathname.endsWith("/market")) {
      if (url.searchParams.get("view") === "stats") await options.statsGate;
      const symbol = url.searchParams.get("symbol") || "BTC";
      const venue = url.searchParams.get("venue") || "binance";
      if (symbol === "SOL") expect(url.searchParams.get("assetId")).toBe("solana");
      const candles = Array.from({ length: 100 }, (_, index) => {
        const open = 145 + Math.sin(index / 5) * 4 + index / 20;
        return { time: Math.floor(now / 300_000) * 300 - (99 - index) * 300, open, high: open + 1.5, low: open - 1.4, close: open + Math.sin(index) * .7, volume: 100 + index };
      });
      const view = url.searchParams.get("view");
      const market: NewsMarket = { symbol, pair: venue === "binance" ? `${symbol}USDT` : symbol, venue: venue as "binance" | "hyperliquid", tradable: true, price: 150, change24h: view === "chart" ? null : 4.2, marketCap: view === "chart" ? null : 70e9, fdv: view === "chart" ? null : 80e9, volume24h: view === "chart" ? null : 4e9, fundingRate: view === "chart" ? null : .0001, openInterest: view === "chart" ? null : 5e8, candles: view === "stats" ? [] : candles, fetchedAt: Date.now(), error: null };
      await route.fulfill({ json: market });
      return;
    }
    if (url.pathname.endsWith("fixture-news-1")) {
      await route.fulfill({ json: { item: feed.items[0], relatedNews: feed.items, reactions: [{ minutes: 1, change: 1.5 }, { minutes: 5, change: null }], signals: [{ title: "SOL 暴涨预警", occurredAt: new Date(now).toISOString(), url: "/alerts" }] } });
      return;
    }
    await route.fulfill({ json: { ...feed, items: feed.items.filter(item => !blocked.includes(item.source.toLowerCase())) } });
  });
  await page.route("**/api/trade/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("status")) { await route.fulfill({ json: { ...status, unlocked } }); return; }
    expect(request.headers()["x-csrf-token"]).toBe("fixture-csrf");
    if (path.endsWith("unlock")) { unlocked = true; await route.fulfill({ json: { success: true } }); return; }
    if (path.endsWith("order")) orders.push(request.postDataJSON());
    await route.fulfill({ json: { success: true } });
  });
  await page.goto("/login?next=%2Fnews");
  await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/news$/);
  return orders;
}

test("news desktop links story to chart, verifies nonblank canvas, and submits one confirmed order", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  const orders = await setup(page);
  await page.getByRole("button", { name: feed.items[0].title, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "行情币种" })).toHaveValue("SOL");
  const chart = page.locator("[data-news-chart]");
  await expect(chart.locator("canvas").first()).toBeVisible();
  await expect.poll(async () => {
    expect(errors).toEqual([]);
    return chart.locator("canvas").evaluateAll(canvases => canvases.some(canvas => {
    const context = (canvas as HTMLCanvasElement).getContext("2d");
    if (!context) return false;
    const pixels = context.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data;
    let up = 0, down = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 240) continue;
      if (pixels[index] === 73 && pixels[index + 1] === 198 && pixels[index + 2] === 141) up++;
      if (pixels[index] === 239 && pixels[index + 1] === 107 && pixels[index + 2] === 115) down++;
    }
    return up > 100 && down > 100;
  }));
  }).toBe(true);
  await page.getByLabel("交易 PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  const openLong = page.getByRole("button", { name: "开多", exact: true });
  await expect(openLong).toBeEnabled();
  await openLong.click();
  expect(orders).toHaveLength(0);
  await page.getByRole("button", { name: "确认开多", exact: true }).click();
  await expect.poll(() => orders.length).toBe(1);
  expect(orders[0]).toMatchObject({ venue: "binance", symbol: "SOL", notional: 200, leverage: 3, type: "market", side: "buy" });
  expect(orders[0].clientOrderId).toMatch(/^[a-f0-9]{32}$/);
  await page.getByRole("combobox", { name: "交易账户" }).selectOption("hyperliquid");
  await expect(page.getByRole("combobox", { name: "交易账户" })).toHaveValue("hyperliquid");
  await expect(page.locator("[data-news-terminal]")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("news-desktop.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("news mobile fits viewport and opens and closes the trading detail sheet", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("news-mobile-feed.png"), fullPage: true });
  await page.getByRole("button", { name: feed.items[0].title, exact: true }).click();
  await expect(page.getByRole("button", { name: "返回新闻列表" })).toBeVisible();
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("news-mobile-trade.png"), fullPage: true });
  await page.getByRole("button", { name: "返回新闻列表" }).click();
  await expect(page.getByRole("button", { name: feed.items[0].title, exact: true })).toBeVisible();
});

test("a sharp crypto crash and a separate equity board open the chosen Binance market on mobile", async ({ page }, testInfo) => {
  const runtimeDir = process.env.SIGNAL_E2E_RUNTIME_DIR!;
  const market = openMarketAlertsStore(join(runtimeDir, "market.sqlite"));
  const signals = openMarketSignalsStore(marketSignalsDbPath({ SIGNAL_HUB_RUNTIME_DIR: runtimeDir }));
  try {
    const observed = Date.now();
    signals.replaceSymbolClasses([
      { symbol: "DOGEUSDT", underlyingType: "COIN", activeUsdtPerpetual: true },
      { symbol: "AAOIUSDT", underlyingType: "EQUITY", activeUsdtPerpetual: true },
      { symbol: "NVDAUSDT", underlyingType: "EQUITY", activeUsdtPerpetual: true },
      { symbol: "XAUUSDT", underlyingType: "COMMODITY", activeUsdtPerpetual: true },
    ], observed);
    const minute = Math.floor(observed / 60_000) * 60_000;
    const boundary = Math.floor(minute / 300_000) * 300_000;
    const minuteCount = 240 + (minute - boundary) / 60_000;
    market.recordCardMinutes(Array.from({ length: minuteCount }, (_, i) => ({
      symbol: "AAOIUSDT", at: minute - (minuteCount - i) * 60_000,
      open: 43, high: 44, low: 42, close: 43.5, quoteVolume: 50_000, observeVolume: false,
    })), observed);
    for (const symbol of ["DOGEUSDT", "AAOIUSDT", "XAUUSDT"]) {
      market.insertMarketAlertEvent({
        id: "deep-link-" + symbol, symbol, type: "volatility", side: "SHORT", level: 2,
        stage: "暴跌升级", trigger: "A趋势·实时", source: "ws", price: 1, changePct: -12,
        volumeRatio: 5, score: null, metrics: { strengthPct: 12 }, reasons: [], occurredAt: new Date(observed).toISOString(),
      });
    }
  } finally {
    signals.close();
    market.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const orders = await setup(page);
  await page.evaluate(() => localStorage.setItem("signal-hub:news-terminal:v1", JSON.stringify({ symbol: "ETH", venue: "hyperliquid" })));
  await page.goto("/alerts");
  const crashes = page.getByRole("region", { name: "突发异动", exact: true });
  await expect(page.locator("#coin-AAOIUSDT, #coin-XAUUSDT")).toHaveCount(0);
  const symbolLink = crashes.locator("#coin-DOGEUSDT").getByRole("link", { name: "查看 DOGE 实时行情" });
  await expect(symbolLink).toHaveAttribute("href", "/news?symbol=DOGEUSDT");
  await symbolLink.click();
  await expect(page).toHaveURL(/\/news\?symbol=DOGEUSDT$/);
  await expect(page.getByRole("button", { name: "返回新闻列表" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "行情币种" })).toHaveValue("DOGE");
  await expect(page.getByRole("combobox", { name: "交易账户" })).toHaveValue("binance");
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible();
  await page.goto("/alerts");
  await page.getByRole("link", { name: "美股与 ETF", exact: true }).click();
  await expect(page).toHaveURL(/\/alerts\/equities$/);
  const rates = page.getByRole("region", { name: "信号胜率", exact: true });
  await expect(rates.getByRole("rowheader")).toHaveCount(2);
  await expect(rates.getByRole("rowheader", { name: /强暴涨.*看涨/ })).toBeVisible();
  await expect(rates.getByRole("rowheader", { name: /强暴跌.*看跌/ })).toBeVisible();
  const equities = page.getByRole("region", { name: "强暴跌", exact: true });
  await expect(equities.locator("#coin-AAOIUSDT")).toBeVisible();
  const equityCard = equities.locator("#coin-AAOIUSDT");
  const details = equityCard.locator("button[aria-expanded]");
  const timeline = equityCard.getByRole("list", { name: "AAOI 触发时间线" });
  const chart = equityCard.getByRole("img", { name: /AAOIUSDT.*K 线/ });
  const priceAxis = equityCard.locator("[data-price-axis]");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await expect(equityCard.getByRole("link", { name: "查看 AAOI 实时行情" })).toBeVisible();
    await expect(equityCard).toContainText("暴跌");
    await expect(equityCard.getByText(/43\.5/).first()).toBeVisible();
    await expect(chart).toBeVisible();
    await expect(timeline).toBeHidden();
    await expect(equityCard.getByText("24h 合约成交额", { exact: true })).toBeHidden();
    const compactHeight = await equityCard.evaluate(el => el.getBoundingClientRect().height);
    const compactChartHeight = viewport.width < 640 ? 192 : 224;
    expect(compactHeight - compactChartHeight).toBeLessThanOrEqual(140);
    await expect(chart).toHaveAccessibleName(/4h/);
    await expect(priceAxis).toBeVisible();
    const labels = await priceAxis.locator("[data-price-tick]").allTextContents();
    expect(new Set(labels).size).toBeGreaterThanOrEqual(2);
    const plot = (await chart.boundingBox())!;
    expect((await priceAxis.boundingBox())!.x).toBeGreaterThanOrEqual(plot.x + plot.width - 1);
    await expect(chart).toHaveAccessibleName(/5m/);
    expect(await chart.evaluate(el => el.getBoundingClientRect().height)).toBe(compactChartHeight);
    expect(await equityCard.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    testInfo.annotations.push({ type: "compact-card-height", description: `AAOI ${viewport.width}px · ${compactHeight}px` });
    await details.click();
    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(timeline).toBeVisible();
    await expect(equityCard.getByText("24h 合约成交额", { exact: true })).toBeVisible();
    await expect(priceAxis).toBeVisible();
    expect(await priceAxis.locator("[data-price-tick]").count()).toBeGreaterThanOrEqual(2);
    expect(await chart.evaluate(el => el.getBoundingClientRect().height)).toBe(viewport.width < 640 ? 288 : 320);
    await details.click();
    await expect(timeline).toBeHidden();
    await expect(details).toHaveAttribute("aria-expanded", "false");
    expect(await equityCard.evaluate(el => el.getBoundingClientRect().height)).toBe(compactHeight);
  }
  await expect(page.locator("#coin-DOGEUSDT, #coin-XAUUSDT")).toHaveCount(0);
  await expect(page.getByText("FDV", { exact: false })).toHaveCount(0);
  const equitySearch = page.getByRole("searchbox", { name: "搜索股票代码" });
  await equitySearch.fill("doge");
  await expect(page.getByText("当前市场没有匹配的标的")).toBeVisible();
  await equitySearch.fill("nvda");
  await expect(page.getByRole("region", { name: "其他匹配标的" }).getByRole("link", { name: "查看 NVDA 实时行情" })).toHaveAttribute("href", "/news?symbol=NVDAUSDT");
  await equitySearch.fill("aaoi/usdt");
  await expect(equities.locator("#coin-AAOIUSDT")).toBeVisible();
  await expect(page.getByRole("link", { name: "美股与 ETF" })).toHaveAttribute("aria-current", "page");
  const equityApi = await (await page.request.get("/api/market-signals?market=equities")).json();
  expect(equityApi.market).toBe("equities");
  expect(equityApi.searchSymbols).toEqual(["AAOIUSDT", "NVDAUSDT"]);
  expect((await page.request.get("/api/market-signals?market=unknown")).status()).toBe(400);
  await equities.getByRole("link", { name: "查看 AAOI 实时行情" }).click();
  await expect(page.getByRole("textbox", { name: "行情币种" })).toHaveValue("AAOI");
  await expect(page.getByRole("combobox", { name: "交易账户" })).toHaveValue("binance");
  expect(orders).toHaveLength(0);
});

test("news and trading data require website login", async ({ request }) => {
  const news = await request.get("/api/eqn-news");
  const sources = await request.get("/api/eqn-news/sources");
  const trade = await request.get("/api/trade/status");
  expect(news.status()).toBe(401);
  expect(sources.status()).toBe(401);
  expect(trade.status()).toBe(401);
});

test("news sources can be blocked and restored from settings", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.getByRole("button", { name: "显示与交易设置" }).click();
  const manager = page.getByRole("region", { name: "新闻来源接入" });
  await expect(manager.getByText("2 接入 · 0 屏蔽")).toBeVisible();
  const binance = manager.getByLabel("屏蔽 币安公告");
  await binance.uncheck();
  await expect(manager.getByText("1 接入 · 1 屏蔽")).toBeVisible();
  await expect(page.getByRole("button", { name: feed.items[0].title, exact: true })).toHaveCount(0);
  await expect(page.getByLabel("新闻来源", { exact: true }).locator("option", { hasText: "币安公告" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("news-source-manager.png") });
  await manager.getByLabel("接入 币安公告").check();
  await expect(page.getByRole("button", { name: feed.items[0].title, exact: true })).toBeVisible();
});

test("reopened chart renders the last cached candles while a slow refresh is pending", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.getByRole("button", { name: feed.items[0].title, exact: true }).click();
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible();
  await page.route("**/api/eqn-news/market?*", async route => {
    await new Promise(resolve => setTimeout(resolve, 6_000));
    await route.fallback();
  });
  await page.reload();
  await page.getByRole("button", { name: feed.items[0].title, exact: true }).click();
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible({ timeout: 2_000 });
  await page.getByLabel("交易 PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(page.getByRole("button", { name: "开多", exact: true })).toBeDisabled();
});

test("failed market refresh disables opening with retained chart data", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const orders = await setup(page);
  await page.getByRole("button", { name: feed.items[0].title, exact: true }).click();
  await page.getByLabel("交易 PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  const openLong = page.getByRole("button", { name: "开多", exact: true });
  await expect(openLong).toBeEnabled();
  await page.route("**/api/eqn-news/market?*", route => route.fulfill({
    status: 503, json: { error: "测试行情暂不可用" },
  }));
  await page.getByRole("button", { name: "刷新新闻与行情" }).click();
  await expect(page.getByText("测试行情暂不可用")).toBeVisible();
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible();
  await expect(openLong).toBeDisabled();
  expect(orders).toHaveLength(0);
});

test("chart renders before slow display statistics and keeps its candles when they arrive", async ({ page }) => {
  let release!: () => void;
  const statsGate = new Promise<void>(resolve => { release = resolve; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { statsGate });
  await page.getByRole("button", { name: feed.items[0].title, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "行情币种" })).toHaveValue("SOL");
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible({ timeout: 2_000 });
  await expect(page.locator("[data-news-market-status]")).toHaveText("轮询");
  release();
  await expect(page.getByText("FDV", { exact: false }).first()).toContainText("80B");
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible();
});

test("hover preloads one chart and selecting it reuses the same request", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/eqn-news/market") && url.searchParams.get("symbol") === "SOL" && url.searchParams.get("view") === "chart") requests.push(url.href);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  const coin = page.getByTitle("查看 SOL 行情", { exact: true });
  await coin.hover();
  await expect.poll(() => requests.length).toBe(1);
  await coin.click();
  await expect(page.getByRole("textbox", { name: "行情币种" })).toHaveValue("SOL");
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("live candles update price, reconnect fills history, and switching coin closes the old socket", async ({ page }) => {
  await page.clock.install();
  const sockets: WebSocketRoute[] = [];
  let solCharts = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/eqn-news/market") && url.searchParams.get("symbol") === "SOL" && url.searchParams.get("view") === "chart") solCharts++;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { onSocket: socket => sockets.push(socket) });
  await page.getByRole("button", { name: feed.items[0].title, exact: true }).click();
  await expect.poll(() => sockets.filter(socket => socket.url().includes("solusdt")).length).toBe(1);
  const send = (socket: WebSocketRoute, price: string) => socket.send(JSON.stringify({ e: "kline", E: Date.now(), s: "SOLUSDT", k: { s: "SOLUSDT", i: "5m", t: Math.floor(Date.now() / 300_000) * 300_000, o: "150", h: "170", l: "149", c: price, v: "200" } }));
  const first = sockets.find(socket => socket.url().includes("solusdt"))!;
  send(first, "160");
  await expect(page.locator("[data-news-market-status]")).toHaveText("实时");
  await expect(page.getByTitle("查看 SOL 行情", { exact: true })).toContainText("160");
  const before = solCharts;
  await page.clock.fastForward(31_000);
  expect(solCharts).toBe(before);
  first.close({ code: 1001, reason: "test reconnect" });
  await page.clock.runFor(1_100);
  await expect.poll(() => sockets.filter(socket => socket.url().includes("solusdt")).length).toBe(2);
  await expect.poll(() => solCharts).toBeGreaterThan(before);
  const second = sockets.filter(socket => socket.url().includes("solusdt"))[1];
  send(second, "165");
  await expect(page.getByTitle("查看 SOL 行情", { exact: true })).toContainText("165");
  let closed = false;
  second.onClose(() => { closed = true; });
  await page.getByRole("textbox", { name: "行情币种" }).fill("BTC");
  await page.getByRole("textbox", { name: "行情币种" }).press("Enter");
  await expect.poll(() => closed).toBe(true);
  await expect(page.getByRole("textbox", { name: "行情币种" })).toHaveValue("BTC");
});

test("unavailable live candles fall back to REST without losing the chart", async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/eqn-news/market") && url.searchParams.get("symbol") === "SOL" && url.searchParams.get("view") === "chart") requests++;
  });
  await setup(page);
  await page.getByRole("button", { name: feed.items[0].title, exact: true }).click();
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible();
  expect(requests).toBe(1);
  await page.clock.fastForward(31_000);
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator("[data-news-market-status]")).toHaveText("轮询");
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible();
});

test("mobile preloads the visible coin chart without fetching its display statistics", async ({ page }) => {
  const views: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/eqn-news/market") && url.searchParams.get("symbol") === "SOL") views.push(url.searchParams.get("view") || "full");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect.poll(() => views).toEqual(["chart"]);
  await page.getByRole("button", { name: feed.items[0].title, exact: true }).click();
  await expect(page.locator("[data-news-chart] canvas").first()).toBeVisible();
  expect(views.filter(view => view === "chart")).toHaveLength(1);
});
