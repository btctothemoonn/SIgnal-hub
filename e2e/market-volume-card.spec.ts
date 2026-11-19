import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { openMarketAlertsStore } from "../src/lib/market-alerts-store";
import { marketSignalsDbPath, openMarketSignalsStore } from "../src/lib/market-signals";

test("a burst-only card gains a price confirmation and keeps its first burst on desktop and mobile", async ({ page }, testInfo) => {
  const runtime = process.env.SIGNAL_E2E_RUNTIME_DIR!;
  const store = openMarketAlertsStore(join(runtime, "market.sqlite"));
  const signals = openMarketSignalsStore(marketSignalsDbPath({ SIGNAL_HUB_RUNTIME_DIR: runtime }));
  const min = 60_000;
  const now = Math.floor(Date.now() / min) * min;
  const symbol = "PIEVERSEUSDT";
  try {
    signals.replaceSymbolClasses([{ symbol, underlyingType: "COIN" }], now);
    const bars = Array.from({ length: 60 }, (_, i) => {
      const open = 1 + i / 1000;
      return {
        symbol, at: now - (60 - i) * min, open, high: open + .015,
        low: open - .005, close: open + .01, quoteVolume: i === 30 || i === 53 ? 60_000 : 10_000,
        observeVolume: true,
      };
    });
    const hour = 60 * min;
    const boundary = Math.floor(now / hour) * hour;
    signals.upsertPositioning([1000, 1030].map((quantity, i) => ({
      symbol, hourMs: boundary - (2 - i) * hour, close: 1, oiValue: quantity, oiQuantity: quantity, funding: null,
    })));
    signals.upsertFundingRates([{ symbol, rate: .00005, observedAtMs: now }]);
    store.recordLiquidationCoverage(now - 16 * min, now);
    store.recordMarketLiquidation({ symbol, minuteAt: now - 6 * min, side: "BUY", notionalUsdt: 11500 });
    store.recordCardMinutes(bars, now);
    await page.goto("/login?next=%2Falerts");
    await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/alerts$/);
    const card = page.locator("#coin-PIEVERSEUSDT");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("爆量观察");
    const api = await (await page.request.get("/api/market-signals")).json();
    const episodes = api.volumeEpisodes.filter((e: { symbol: string }) => e.symbol === symbol);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ firstPrice: bars[30].close, count: 2, firstRatio: 6 });
    expect(api.cardCandles[symbol]).toHaveLength(60);
    expect(api.cardMetrics[symbol].oi1hPct).toBe(3);
    expect(api.cardMetrics[symbol].fundingRate).toBe(.00005);
    const confirmedAt = new Date(now - 2 * min).toISOString();
    store.insertMarketAlertEvent({
      id: "volume-card-e2e", symbol, type: "volatility", side: "LONG", level: 1, stage: "暴涨预警",
      trigger: "B加速", source: "ws", price: 1.067, changePct: 5, volumeRatio: 6, score: null,
      metrics: {}, reasons: [], occurredAt: confirmedAt, createdAt: confirmedAt,
    });
    await expect(card).toContainText(/暴涨/, { timeout: 40_000 });
    await expect(card.getByRole("link", { name: "查看 PIEVERSE 实时行情", exact: true })).toHaveAttribute("href", "/news?symbol=PIEVERSEUSDT");
    await expect(card.locator("svg[role=img]")).toBeVisible();
    await card.screenshot({ path: testInfo.outputPath("card-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(card.locator("svg[role=img]")).toBeVisible();
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await card.evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await card.screenshot({ path: testInfo.outputPath("card-mobile.png") });
    const details = card.getByRole("button", { name: /展开费率/ });
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await details.click();
    await expect(card.getByText("+0.005%", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "打开 PIEVERSE 实时 K 线" })).toHaveAttribute("href", "/news?symbol=PIEVERSEUSDT");
  } finally {
    signals.close();
    store.close();
  }
});
