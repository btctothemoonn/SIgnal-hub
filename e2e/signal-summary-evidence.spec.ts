import { expect, test } from "@playwright/test";

const snapshot = {
  success: false, status: "error", configured: true,
  period: { key: "fixture", scope: "7d", audience: "signals", inputBudgetVersion: 4, signalContentVersion: 1,
    label: "近 7 天", startAt: "2026-09-25T04:00:00.000Z", endAt: "2026-10-02T04:00:00.000Z", timeZone: "Asia/Shanghai" },
  generatedAt: "2026-10-02T03:00:00.000Z", lastAttemptAt: "2026-10-02T03:30:00.000Z",
  model: "fixture", itemCount: 110, sourceCounts: { telegram: 40, x: 70, stocks: 0 },
  coverage: { candidateCount: 2100, selectedCount: 110, startAt: "2026-09-25T05:00:00.000Z", endAt: "2026-10-02T03:00:00.000Z" },
  error: "测试：更新超时",
  summary: {
    headline: "算力需求与加密资产观点继续分化。",
    authors: [{ name: "旧版作者", coreView: "旧版作者核心观点", sourceCount: 1, alpha: [], watch: [] }],
    consensus: ["旧版核心共识"], risks: ["旧版风险提示"], watchlist: ["旧版观察列表"],
    stocks: [{ target: "NVDA", opinions: [{ author: "@alice", view: "看好算力需求。" }, { author: "@bob", view: "估值仍需观察。" }] }],
    crypto: [{ target: "ETH", opinions: [{ author: "@carol", view: "关注生态资金流入。" }] }],
    events: [{ title: "协议发布后的测试进度", change: "来源宣布协议发布", whyTrack: "测试结果可以用于检验发布进度",
      evidenceType: "reported", watch: ["观察下一次公开测试结果"], invalidate: ["发布被撤回或测试暂停"],
      sourceIds: ["x:fixture"], sources: [{ id: "x:fixture", source: "X", author: "@research", createdAt: "2026-10-02T02:00:00.000Z", link: "https://x.com/research/status/fixture" }] }],
  },
};

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`Signal target opinions and retained-result freshness at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Verify the UI flow without generating a billable summary or calling sources.
    await page.route("**/api/signal-summary**", (route) => {
      const scope = new URL(route.request().url()).searchParams.get("scope") ?? "12h";
      return route.fulfill({ json: { ...snapshot, period: { ...snapshot.period, scope, label: scope === "7d" ? "近 7 天" : "最近 12 小时" } } });
    });
    await page.route("**/api/alpha-summary**", (route) => route.fulfill({ json: snapshot }));
    await page.route("**/api/stocks-hynix-premium**", (route) => route.fulfill({ json: { success: false, status: "empty", points: [], error: null } }));
    await page.goto("/login?next=%2F");
    await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/$/);
    const warning = page.getByRole("alertdialog");
    if (await warning.isVisible()) await warning.getByRole("button", { name: "知道了", exact: true }).click();
    if (viewport.width < 1024) {
      await page.getByRole("tab", { name: "AI 总结", exact: true }).click();
    }
    const pane = page.locator("[data-signal-summary-pane]");
    await pane.getByRole("button", { name: "7天", exact: true }).click();
    await expect(pane.getByRole("button", { name: "7天", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(pane.locator("[data-alpha-summary-period]")).toHaveText("周期近 7 天");
    await expect(pane.getByRole("button", { name: "重新生成", exact: true })).toBeVisible();
    await expect(pane.getByText("更新失败，正在显示上次总结", { exact: true })).toBeVisible();
    await expect(pane.getByText("上次成功生成：2026/10/02 11:00", { exact: true })).toBeVisible();
    await expect(pane.getByText("本次尝试：2026/10/02 11:30", { exact: true })).toBeVisible();
    await expect(pane.getByText("样本时间：2026/09/25 13:00 至 2026/10/02 11:00", { exact: true })).toBeVisible();
    await expect(pane.getByText("实际纳入：110 条 / 候选 2100 条", { exact: true })).toBeVisible();
    await expect(pane.getByRole("heading", { name: snapshot.summary.headline, exact: true })).toHaveCount(1);
    const stocks = pane.getByRole("region", { name: "股票", exact: true });
    const crypto = pane.getByRole("region", { name: "币圈", exact: true });
    await expect(stocks.getByRole("heading", { name: "NVDA", exact: true })).toBeVisible();
    await expect(stocks.getByText("@alice：看好算力需求。", { exact: true })).toBeVisible();
    await expect(stocks.getByText("@bob：估值仍需观察。", { exact: true })).toBeVisible();
    await expect(crypto.getByRole("heading", { name: "ETH", exact: true })).toBeVisible();
    await expect(crypto.getByText("@carol：关注生态资金流入。", { exact: true })).toBeVisible();
    await expect(stocks.getByRole("heading", { name: "ETH", exact: true })).toHaveCount(0);
    await expect(crypto.getByRole("heading", { name: "NVDA", exact: true })).toHaveCount(0);
    await expect(pane.locator("[data-signal-event-id], [data-signal-event-history], [data-signal-new-evidence]")).toHaveCount(0);
    for (const hidden of ["协议发布后的测试进度", "观察下一次公开测试结果", "发布被撤回或测试暂停", "来源陈述", "旧版作者核心观点", "旧版核心共识", "旧版风险提示", "旧版观察列表"]) {
      await expect(pane.getByText(hidden, { exact: true })).toHaveCount(0);
    }
    await expect(pane.locator('a[href="https://x.com/research/status/fixture"]')).toHaveCount(0);
    await crypto.scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/signal-summary-${viewport.width}.png`, fullPage: false });
  });
}
