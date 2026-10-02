import { expect, test } from "@playwright/test";

const original = { id: "tg:original", source: "Telegram", author: "研究频道", createdAt: "2026-10-01T03:00:00Z", link: "https://t.me/research/123" };
const update = { id: "x:update", source: "X", author: "@maintainer", createdAt: "2026-10-02T03:00:00Z", link: "https://x.com/maintainer/status/456" };
const event = (id: string, title: string, state: "new" | "updated" | "continuing" | "invalidated") => ({
  title, change: "来源提供了协议测试的观察记录。", whyTrack: "测试进展将影响后续日程。", evidenceType: "reported",
  watch: ["观察公开测试结果与团队公告。"], invalidate: ["团队撤回当前日程。"],
  sourceIds: [original.id, update.id], sources: [original, update],
  tracking: { id, state, firstSeenAt: "2026-10-01T04:00:00Z", lastSeenAt: "2026-10-02T04:00:00Z",
    lastChangedAt: "2026-10-02T04:00:00Z", previousGeneratedAt: "2026-10-01T05:00:00Z",
    newSourceIds: state === "updated" ? [update.id] : [], note: state === "updated" ? "团队已发布首轮测试结果。" : "沿用已有依据继续观察。" },
});
const snapshot = {
  success: true, status: "generated", configured: true,
  period: { key: "fixture", scope: "12h", audience: "signals", inputBudgetVersion: 4, signalContentVersion: 2,
    label: "最近 12 小时", startAt: "2026-10-01T16:00:00Z", endAt: "2026-10-02T04:00:00Z", timeZone: "Asia/Shanghai" },
  generatedAt: "2026-10-02T04:00:00Z", lastAttemptAt: "2026-10-02T04:00:00Z", model: "fixture",
  itemCount: 48, sourceCounts: { telegram: 20, x: 28, stocks: 0 },
  coverage: { candidateCount: 100, selectedCount: 48, startAt: "2026-10-01T17:00:00Z", endAt: "2026-10-02T03:00:00Z" },
  error: null,
  summary: { headline: "股票与加密资产的来源观点保持分歧。", authors: [], consensus: [], risks: [], watchlist: [],
    stocks: [{ target: "NVDA", opinions: [{ author: "@alice", view: "看好算力需求。" }, { author: "@bob", view: "估值仍需观察。" }] }],
    crypto: [{ target: "BTC", opinions: [{ author: "@carol", view: "关注资金流入。" }] }],
    events: [event("continuing", "延续观察的事件", "continuing"), event("new", "首次纳入的事件", "new"), event("updated", "出现新进展的事件", "updated")],
    eventHistory: [event("continuing", "延续观察的事件", "continuing"), event("history", "此前的观察记录", "continuing")],
  },
};

const legacySnapshot = {
  ...snapshot, status: "cached",
  period: { ...snapshot.period, scope: "today", label: "最近 24 小时" },
  summary: { ...snapshot.summary, headline: "旧版总结仍可读取，分类正在更新。", stocks: undefined, crypto: undefined },
};
const emptyCategoriesSnapshot = {
  ...snapshot,
  period: { ...snapshot.period, scope: "3d", label: "近 3 天" },
  summary: { ...snapshot.summary, headline: "当前样本没有明确标的观点。", stocks: [], crypto: [] },
};
const retainedFailureSnapshot = {
  ...snapshot, success: false, status: "error", lastAttemptAt: "2026-10-02T04:30:00Z", error: "测试：更新超时",
};
const refreshedSnapshot = {
  ...snapshot, generatedAt: "2026-10-02T05:00:00Z", lastAttemptAt: "2026-10-02T05:00:00Z",
  summary: { ...snapshot.summary, headline: "重新生成后，算力需求观点有所更新。",
    stocks: [{ target: "NVDA", opinions: [{ author: "@alice", view: "提高算力需求预期。" }] }],
  },
};

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`Signal category compatibility, refresh fallback and mobile layout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests: { method: string; scope: string | null }[] = [];
    let refreshAttempts = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await page.route("**/api/signal-summary**", async (route) => {
      const request = route.request();
      const scope = new URL(request.url()).searchParams.get("scope");
      requests.push({ method: request.method(), scope });
      if (request.method() === "POST") {
        refreshAttempts += 1;
        if (refreshAttempts === 1) await refreshGate;
        await route.fulfill({ json: refreshAttempts === 1 ? retainedFailureSnapshot : refreshedSnapshot });
        return;
      }
      await route.fulfill({ json: scope === "today" ? legacySnapshot : scope === "3d" ? emptyCategoriesSnapshot : snapshot });
    });
    await page.route("**/api/alpha-summary**", (route) => route.fulfill({ json: snapshot }));
    await page.route("**/api/stocks-hynix-premium**", (route) => route.fulfill({ json: { success: false, status: "empty", points: [], error: null } }));
    await page.goto("/login?next=%2F");
    await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/$/);
    const warning = page.getByRole("alertdialog");
    if (await warning.isVisible()) await warning.getByRole("button", { name: "知道了", exact: true }).click();
    if (viewport.width < 1024) await page.getByRole("tab", { name: "AI 总结", exact: true }).click();
    const pane = page.locator("[data-signal-summary-pane]");
    const stocks = pane.getByRole("region", { name: "股票", exact: true });
    const crypto = pane.getByRole("region", { name: "币圈", exact: true });
    await expect(pane.getByRole("heading", { name: snapshot.summary.headline, exact: true })).toBeVisible();
    await expect(stocks.getByRole("heading", { name: "NVDA", exact: true })).toBeVisible();
    await expect(stocks.getByText("@alice：看好算力需求。", { exact: true })).toBeVisible();
    await expect(stocks.getByText("@bob：估值仍需观察。", { exact: true })).toBeVisible();
    await expect(crypto.getByText("@carol：关注资金流入。", { exact: true })).toBeVisible();
    await expect(pane.getByText("实际纳入：48 条 / 候选 100 条", { exact: true })).toBeVisible();
    await expect(pane.locator("[data-alpha-summary-period]")).toHaveText("周期最近 12 小时");
    await expect(pane.locator("[data-signal-event-id], [data-signal-event-history], [data-signal-new-evidence]")).toHaveCount(0);
    for (const title of ["延续观察的事件", "首次纳入的事件", "出现新进展的事件", "此前的观察记录"]) {
      await expect(pane.getByText(title, { exact: true })).toHaveCount(0);
    }
    await expect(pane.locator(`a[href="${original.link}"], a[href="${update.link}"]`)).toHaveCount(0);

    await pane.getByRole("button", { name: "24h", exact: true }).click();
    await expect(pane.getByRole("button", { name: "24h", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(pane.locator("[data-alpha-summary-period]")).toHaveText("周期最近 24 小时");
    await expect(pane.getByRole("heading", { name: legacySnapshot.summary.headline, exact: true })).toBeVisible();
    await expect(pane.getByText("旧版总结正在更新标的分类。", { exact: true })).toHaveCount(2);
    await expect(pane.getByText("本期暂无相关标的观点。", { exact: true })).toHaveCount(0);

    await pane.getByRole("button", { name: "3天", exact: true }).click();
    await expect(pane.locator("[data-alpha-summary-period]")).toHaveText("周期近 3 天");
    await expect(pane.getByRole("heading", { name: emptyCategoriesSnapshot.summary.headline, exact: true })).toBeVisible();
    await expect(pane.getByText("本期暂无相关标的观点。", { exact: true })).toHaveCount(2);
    await expect(pane.getByText("旧版总结正在更新标的分类。", { exact: true })).toHaveCount(0);
    await expect(stocks.getByRole("heading", { name: "NVDA", exact: true })).toHaveCount(0);

    await pane.getByRole("button", { name: "12h", exact: true }).click();
    await expect(pane.getByRole("heading", { name: snapshot.summary.headline, exact: true })).toBeVisible();
    const regenerate = pane.getByRole("button", { name: "重新生成", exact: true });
    await expect(regenerate).toBeEnabled();
    const firstRequest = page.waitForRequest((request) => request.url().includes("/api/signal-summary?") && request.method() === "POST");
    await regenerate.click();
    expect((await firstRequest).postDataJSON()).toEqual({ force: true, scope: "12h", audience: "signals" });
    await expect(pane.getByRole("button", { name: "生成中...", exact: true })).toBeDisabled();
    await expect(pane.getByText("正在重新生成12h总结...", { exact: true })).toBeVisible();
    await expect(pane.getByRole("heading", { name: snapshot.summary.headline, exact: true })).toBeVisible();
    await expect(stocks.getByText("@alice：看好算力需求。", { exact: true })).toBeVisible();
    releaseRefresh();
    await expect(pane.getByText("更新失败，正在显示上次总结", { exact: true })).toBeVisible();
    await expect(pane.getByText("上次成功生成：2026/10/02 12:00", { exact: true })).toBeVisible();
    await expect(pane.getByText("本次尝试：2026/10/02 12:30", { exact: true })).toBeVisible();
    await expect(pane.getByText("生成失败：测试：更新超时", { exact: true })).toBeVisible();
    await expect(stocks.getByText("@alice：看好算力需求。", { exact: true })).toBeVisible();

    await expect(regenerate).toBeEnabled();
    const secondRequest = page.waitForRequest((request) => request.url().includes("/api/signal-summary?") && request.method() === "POST");
    await regenerate.click();
    expect((await secondRequest).postDataJSON()).toEqual({ force: true, scope: "12h", audience: "signals" });
    await expect(pane.getByRole("heading", { name: refreshedSnapshot.summary.headline, exact: true })).toBeVisible();
    await expect(stocks.getByText("@alice：提高算力需求预期。", { exact: true })).toBeVisible();
    await expect(pane.getByText("上次成功生成：2026/10/02 13:00", { exact: true })).toBeVisible();
    await expect(pane.getByText("更新失败，正在显示上次总结", { exact: true })).toHaveCount(0);
    await expect(pane.getByText("本次尝试：2026/10/02 12:30", { exact: true })).toHaveCount(0);
    await expect(pane.getByText(/^已重新生成：/)).toBeVisible();
    expect(requests.filter((request) => request.method === "POST")).toEqual([
      { method: "POST", scope: "12h" }, { method: "POST", scope: "12h" },
    ]);
    for (const scope of ["12h", "today", "3d"]) expect(requests).toContainEqual({ method: "GET", scope });
    await crypto.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/signal-continuity-${viewport.width}.png`, fullPage: false });
  });
}
