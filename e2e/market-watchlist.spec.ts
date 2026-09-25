import { expect, test } from "@playwright/test";
import { openMarketAlertsStore } from "../src/lib/market-alerts-store";
import type { MarketOpportunityMetrics } from "../src/lib/market-opportunity-core";

// Opt in with an isolated MARKET_ALERTS_DB and SIGNAL_HUB_RUNTIME_DIR so these
// deterministic fixtures never write to a developer's live alert database.
const enabled = process.env.SIGNAL_E2E_MARKET_WATCHLIST === "1";
test.skip(!enabled, "Run with SIGNAL_E2E_MARKET_WATCHLIST=1 and an isolated MARKET_ALERTS_DB.");

test("persisted watchlist renders three candidates, retains recap scope through SSE, and fits mobile", async ({ page }, testInfo) => {
  expect(process.env.MARKET_ALERTS_DB, "an explicit isolated database is required").toBeTruthy();
  expect(process.env.SIGNAL_HUB_RUNTIME_DIR, "an explicit isolated runtime is required").toBeTruthy();
  const store = openMarketAlertsStore(process.env.MARKET_ALERTS_DB);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // This page is entirely backed by fixtures. Prevent unrelated navigation
  // prefetching and all external browser requests during this focused check.
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" || request.headers()["next-router-prefetch"]) {
      await route.abort();
    } else {
      await route.continue();
    }
  });

  try {
    for (const [index, symbol] of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"].entries()) {
      const isTrendCandidate = symbol === "BTCUSDT";
      const observedAt = isTrendCandidate ? new Date(nowMs - 60_000).toISOString() : now;
      store.insertMarketAlertEvent({
        id: `watchlist-e2e-${symbol}`, symbol, type: "volatility", side: "LONG", level: 1,
        stage: "test", trigger: "test", source: "ws", price: 100, changePct: 5,
        volumeRatio: 3, score: null, metrics: {}, reasons: [],
        occurredAt: new Date(nowMs - (isTrendCandidate ? 80 : index + 1) * 60_000).toISOString(),
      });
      const metrics: MarketOpportunityMetrics = {
        symbol, observedAt, stale: false,
        pct1m: 1, pct5m: 2, pct15m: 4, pct1h: 6, pct24h: 8,
        volumeRatio1m: 2, volumeRatio5m: 2, oiGrowth15m: 3, oiNotional: 10_000_000,
        funding: 0, basis: 0, globalLongShortRatio: 1, topTraderLongShortRatio: 1,
        takerBuySellRatio: 1.2, spotAvailable: isTrendCandidate, spotChange15m: isTrendCandidate ? .2 : null,
        spotVolumeRatio5m: null, perpSpotDivergencePct: null,
        distanceFromHighPct: -1, distanceFromLowPct: 5, priorRunUpPct: 10,
        supportBreak: false, lowerStructure: false, breakout20: true,
        quoteVolume: 10_000_000, marketCapUsd: null, fdvUsd: null,
        alertCounts: { pump: 1, crash: 0, squeeze: 0, total: 1 },
      };
      if (isTrendCandidate) {
        metrics.watchlist = {
          candleClosedAt: observedAt, pct1h: 6.95, pct5m: -.2, pct15m: .3,
          volumeRatio5m: .6, distanceFromHighPct: -.7, distanceFromLowPct: 8,
          supportBreak: false, lowerStructure: false, breakout20: false,
          spotChange15m: .2,
        };
      }
      store.upsertOpportunityEnrichment({ symbol, metrics, fetchedAt: now, stale: false, error: null });
    }
    for (let index = 0; index < 10; index += 1) {
      store.insertMarketAlertEvent({
        id: `watchlist-e2e-old-${index}`, symbol: "HISTORYUSDT", type: "volatility",
        side: "LONG", level: 1, stage: "test", trigger: "test", source: "ws",
        price: 1, changePct: 5, volumeRatio: 3, score: null, metrics: {}, reasons: [],
        occurredAt: new Date(nowMs - 2 * 60 * 60_000 - index).toISOString(),
      });
    }
    const reports = store.getMarketBriefInput(nowMs);
    expect(reports["3h"].items[0]).toMatchObject({
      symbol: "BTCUSDT", tracking: { trend: "strong_up", confirmation: "consolidating" },
    });
    reports["3h"].status = "ready";
    reports["3h"].headline = "本轮保留小时趋势与短线异动，分别观察后续确认。";
    reports["24h"].status = "ready";
    reports["24h"].headline = "历史预警回顾，次数不代表当前跟踪优先级。";
    expect(store.claimMarketBriefCheck(nowMs)).toBe(true);
    expect(store.saveMarketBriefCache(reports, "watchlist-e2e", nowMs)).toBe(true);

    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto("/login?next=%2Falerts");
    await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/alerts$/);
    const brief = page.locator("[data-market-alert-brief]");
    const rows = brief.locator("[data-market-brief-symbol]");
    await expect(brief.getByRole("button", { name: "跟踪清单", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-market-brief-symbol")))).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    const trendRow = brief.locator('[data-market-brief-symbol="BTCUSDT"]');
    await expect(trendRow.getByText("小时强势", { exact: true })).toBeVisible();
    await expect(trendRow.getByText("短线整理", { exact: true })).toBeVisible();
    await expect(brief.getByText("入选理由", { exact: true })).toHaveCount(3);
    await expect(brief.getByText("下一步观察", { exact: true })).toHaveCount(3);
    await expect(brief.getByText("移出条件", { exact: true })).toHaveCount(3);
    await expect(brief).not.toContainText("数据可能已过期");
    expect(await brief.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("watchlist-desktop.png"), fullPage: false });

    await brief.getByRole("button", { name: "24h 回顾", exact: true }).click();
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toHaveAttribute("data-market-brief-symbol", "HISTORYUSDT");
    await expect(brief).toContainText(reports["24h"].headline);
    const updatedHeadline = "历史回顾已通过现有实时通道更新。";
    reports["24h"].headline = updatedHeadline;
    expect(store.saveMarketBriefCache(reports, "watchlist-e2e-updated", nowMs)).toBe(true);
    await expect(brief).toContainText(updatedHeadline, { timeout: 15_000 });
    await expect(brief.getByRole("button", { name: "24h 回顾", exact: true })).toHaveAttribute("aria-pressed", "true");

    await brief.getByRole("button", { name: "跟踪清单", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(rows).toHaveCount(3);
    await expect(trendRow.getByText("小时强势", { exact: true })).toBeVisible();
    await expect(trendRow.getByText("短线整理", { exact: true })).toBeVisible();
    await expect(brief).not.toContainText("数据可能已过期");
    expect(await brief.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await brief.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= window.innerWidth + 1;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("watchlist-mobile.png"), fullPage: false });
    await brief.screenshot({ path: testInfo.outputPath("watchlist-mobile-full.png") });
    expect(errors).toEqual([]);
    await expect(page.locator("[data-nextjs-dialog], .vite-error-overlay")).toHaveCount(0);
  } finally {
    store.close();
  }
});
