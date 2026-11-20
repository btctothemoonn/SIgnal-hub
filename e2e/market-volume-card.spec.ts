import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openMarketAlertsStore } from "../src/lib/market-alerts-store";
import { marketSignalsDbPath, openMarketSignalsStore } from "../src/lib/market-signals";

test("focus cards promote sharp crashes and merge updates with lifecycle stages on desktop and mobile", async ({ page }, testInfo) => {
  const runtime = process.env.SIGNAL_E2E_RUNTIME_DIR!;
  const alertsPath = join(runtime, "market.sqlite");
  const store = openMarketAlertsStore(alertsPath);
  const db = new DatabaseSync(alertsPath);
  const signals = openMarketSignalsStore(marketSignalsDbPath({ SIGNAL_HUB_RUNTIME_DIR: runtime }));
  const min = 60_000;
  const now = Math.floor(Date.now() / min) * min;
  const quarter = Math.floor(now / (15 * min)) * 15 * min;
  const symbol = "PIEVERSEUSDT";
  const startupOnly = "STARTUSDT";
  const tracked = "PUMPUSDT";
  const ordinary = "DROPUSDT";
  const burstOnly = "VOLUMEUSDT";
  const crash = "MEGAUSDT";
  const rally = "RALLYUSDT";
  const olderCrash = "OLDERUSDT";
  try {
    signals.replaceSymbolClasses([symbol, startupOnly, tracked, ordinary, burstOnly, crash, rally, olderCrash].map(s => ({
      symbol: s, underlyingType: "COIN", activeUsdtPerpetual: true,
    })), now);
    const bars = Array.from({ length: 60 }, (_, i) => {
      const open = 1 + i / 1000;
      return {
        symbol, at: now - (60 - i) * min, open, high: open + .015,
        low: open - .005, close: open + .01, quoteVolume: i === 30 || i === 53 ? 60_000 : 10_000,
        observeVolume: true,
      };
    });
    store.recordCardMinutes(bars, now);
    store.recordCardMinutes(bars.map(b => ({ ...b, symbol: burstOnly })), now);
    expect(store.listVolumeEpisodes(now - 60 * min, now).some(e => e.symbol === burstOnly)).toBe(true);
    const hour = 60 * min;
    const boundary = Math.floor(now / hour) * hour;
    signals.upsertPositioning([1000, 1030].map((quantity, i) => ({
      symbol, hourMs: boundary - (2 - i) * hour, close: 1, oiValue: quantity, oiQuantity: quantity, funding: null,
    })));
    signals.upsertFundingRates([{ symbol, rate: .00005, observedAtMs: now }]);
    store.recordLiquidationCoverage(now - 16 * min, now);
    store.recordMarketLiquidation({ symbol, minuteAt: now - 6 * min, side: "BUY", notionalUsdt: 11500 });

    const insertPhase = db.prepare("INSERT INTO market_lifecycle_events(symbol, kind, at, event_json) VALUES (?, ?, ?, ?)");
    for (const s of [symbol, startupOnly, tracked]) {
      const at = quarter - 30 * min;
      const event = { id: `startup-${s}-${at}`, symbol: s, kind: "startup", at, price: 1.02,
        hourPct: 3.5, relativePct: 2.5, gainFromLowPct: 5 };
      insertPhase.run(s, event.kind, at, JSON.stringify(event));
    }
    const pump = { id: "market-card-pump-e2e", symbol: tracked, kind: "pumped", at: quarter - 15 * min, price: 1.2, gainFromLowPct: 24 };
    insertPhase.run(tracked, pump.kind, pump.at, JSON.stringify(pump));
    const confirmedAt = new Date(now - 2 * min).toISOString();
    const alert = {
      id: "market-card-long-e2e", symbol, type: "volatility" as const, side: "LONG" as const, level: 1 as const,
      stage: "暴涨预警", trigger: "B加速", source: "ws" as const, price: 1.067, changePct: 5,
      volumeRatio: 6, score: null, metrics: {}, reasons: [], occurredAt: confirmedAt, createdAt: confirmedAt,
    };
    store.insertMarketAlertEvent(alert);
    store.insertMarketAlertEvent({
      ...alert, id: "market-card-short-e2e", symbol: ordinary, side: "SHORT", stage: "暴跌预警", changePct: -8,
    });
    const firstCrashAt = new Date(now - 6 * min).toISOString();
    store.insertMarketAlertEvent({
      ...alert, id: "mega-crash-l1", symbol: crash, side: "SHORT", stage: "暴跌预警", trigger: "B加速·实时",
      price: .05484, changePct: -3.72, volumeRatio: 136.77, metrics: { strengthPct: 5.13, statusText: "1m实时" },
      occurredAt: firstCrashAt, createdAt: firstCrashAt,
    });
    store.insertMarketAlertEvent({ ...alert, id: "rally-l2", symbol: rally, level: 2, stage: "暴涨升级", trigger: "A趋势·实时", changePct: 12 });
    const olderAt = new Date(now - 2 * hour).toISOString();
    store.insertMarketAlertEvent({ ...alert, id: "older-crash-l2", symbol: olderCrash, side: "SHORT", level: 2,
      stage: "暴跌升级", changePct: -12, occurredAt: olderAt, createdAt: olderAt });
    const sameTime = new Date(quarter - 30 * min).toISOString();
    store.insertMarketAlertEvent({
      ...alert, id: "startup-rally-l2", symbol: startupOnly, level: 2, stage: "暴涨升级", trigger: "A趋势·实时",
      changePct: 12, occurredAt: sameTime, createdAt: sameTime,
    });

    await page.goto("/login?next=%2Falerts");
    await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/alerts$/);
    const startups = page.getByRole("region", { name: "启动候选", exact: true });
    const weakening = page.getByRole("region", { name: "大涨后转弱", exact: true });
    const sudden = page.getByRole("region", { name: "突发异动", exact: true });
    const card = page.locator(`#coin-${symbol}`);
    const crashCard = sudden.locator(`#coin-${crash}`);
    await expect(crashCard).toContainText("突发暴跌 L1");
    await expect(crashCard.getByText("5.13%", { exact: true })).toBeVisible();
    await expect(crashCard.getByText("136.77 倍", { exact: true })).toBeVisible();
    await expect(crashCard.getByText("-3.72%", { exact: true })).toBeVisible();
    await expect(sudden.locator(`#coin-${rally}`)).toContainText("突发暴涨 L2");
    await expect(sudden.locator(`#coin-${startupOnly}`)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "全部异动", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /旧版异动页/ })).toHaveCount(0);
    await expect(startups.locator(`#coin-${symbol}`)).toBeVisible();
    await expect(startups.locator(`#coin-${startupOnly}`)).toBeVisible();
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("暴涨");
    await expect(card.locator('[data-marker="startup"]')).toHaveCount(1);
    await expect(page.locator(`#coin-${burstOnly}, #coin-${ordinary}, #coin-${tracked}`)).toHaveCount(0);
    const search = page.getByRole("searchbox", { name: "搜索币种" });
    await expect(sudden.locator(`#coin-${olderCrash}`)).toHaveCount(0);
    await search.fill("older/usdt");
    await expect(sudden.locator(`#coin-${olderCrash}`)).toBeVisible();
    await expect(crashCard).toHaveCount(0);
    await page.getByRole("button", { name: "1h", exact: true }).click();
    await expect(sudden.locator(`#coin-${olderCrash}`)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "其他匹配标的" }).getByRole("link", { name: "查看 OLDER 实时行情" })).toHaveAttribute("href", "/news?symbol=OLDERUSDT");
    await search.fill("missing-fixture");
    await expect(page.getByText("当前市场没有匹配的标的")).toBeVisible();
    await page.getByRole("button", { name: "清空搜索" }).click();
    await expect(search).toHaveValue("");
    await page.getByRole("button", { name: "24h", exact: true }).click();
    await expect(crashCard).toBeVisible();
    await crashCard.getByRole("button", { name: "加入自选 MEGA" }).click();
    const favorites = page.getByRole("button", { name: "仅自选" });
    await favorites.click();
    await search.fill("older");
    await expect(page.getByText("自选中没有匹配的标的")).toBeVisible();
    await search.fill("mega");
    await expect(crashCard).toBeVisible();
    await search.press("Escape");
    await favorites.click();
    await crashCard.getByRole("button", { name: "取消自选 MEGA" }).click();
    const api = await (await page.request.get("/api/market-signals")).json();
    const episodes = api.volumeEpisodes.filter((e: { symbol: string }) => e.symbol === symbol);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ firstPrice: bars[30].close, count: 2, firstRatio: 6 });
    expect(api.cardCandles[symbol]).toContainEqual(expect.objectContaining({ at: bars[59].at, close: bars[59].close }));
    expect(api.cardMetrics[symbol].oi1hPct).toBe(3);
    expect(api.cardMetrics[symbol].fundingRate).toBe(.00005);

    // Both changes must appear from the live feed without reopening the page.
    const event = { id: `weakening-${symbol}-${quarter}`, symbol, kind: "weakening", at: quarter, price: 1.06,
      pumpAt: quarter - 15 * min, peakPrice: 1.2, peakGainPct: 24, drawdownPct: 11.67, supportPrice: 1.09 };
    insertPhase.run(symbol, event.kind, event.at, JSON.stringify(event));
    store.insertMarketAlertEvent({
      ...alert, id: "mega-crash-l2", symbol: crash, side: "SHORT", level: 2, stage: "暴跌升级", trigger: "A趋势·实时",
      price: .05039, changePct: -12.04, volumeRatio: 5.23, metrics: { strengthPct: 12.04, statusText: "5m实时" },
    });
    await expect(weakening.locator(`#coin-${symbol}`)).toBeVisible({ timeout: 40_000 });
    await expect(crashCard).toContainText("突发暴跌 L2", { timeout: 40_000 });
    await expect(page.locator(`#coin-${crash}`)).toHaveCount(1);
    await expect(weakening.locator(`#coin-${crash}`)).toHaveCount(0);
    await expect(card).toHaveCount(1);
    await expect(startups.locator(`#coin-${symbol}`)).toHaveCount(0);
    await expect(card.locator('[data-marker="weakening"]')).toHaveCount(1);
    await expect(card.getByRole("link", { name: "查看 PIEVERSE 实时行情", exact: true })).toHaveAttribute("href", "/news?symbol=PIEVERSEUSDT");
    await expect(card.locator("svg[role=img]")).toBeVisible();
    await card.screenshot({ path: testInfo.outputPath("card-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(card.locator("svg[role=img]")).toBeVisible();
    await card.evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await card.screenshot({ path: testInfo.outputPath("card-mobile.png") });
    const details = card.getByRole("button", { name: /查看触发记录/ });
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await details.click();
    await expect(card.getByText("+0.005%", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "打开 PIEVERSE 实时 K 线" })).toHaveAttribute("href", "/news?symbol=PIEVERSEUSDT");

    await page.goto(`/alerts?symbol=${crash}`);
    await expect(crashCard.getByRole("button", { name: "收起详情" })).toHaveAttribute("aria-expanded", "true");
    await expect(crashCard.getByRole("link", { name: "打开 MEGA 实时 K 线" })).toHaveAttribute("href", "/news?symbol=MEGAUSDT");
    await page.goto(`/alerts?symbol=${ordinary}`);
    await expect(page.locator(`#coin-${ordinary}, #coin-${burstOnly}, #coin-${tracked}`)).toHaveCount(0);
  } finally {
    db.close();
    signals.close();
    store.close();
  }
});
