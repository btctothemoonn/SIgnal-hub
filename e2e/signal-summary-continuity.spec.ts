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
  summary: { headline: "本轮新增和有进展的事件优先展示", authors: [], consensus: [], risks: [], watchlist: [],
    events: [event("continuing", "延续观察的事件", "continuing"), event("new", "首次纳入的事件", "new"), event("updated", "出现新进展的事件", "updated")],
    eventHistory: [event("continuing", "延续观察的事件", "continuing"), event("history", "此前的观察记录", "continuing")],
  },
};

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`Signal event continuity, historical originals and mobile layout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/signal-summary**", (route) => route.fulfill({ json: snapshot }));
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
    const cards = pane.locator("article[data-signal-event-id]");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAttribute("data-signal-event-id", "new");
    await expect(cards.nth(1)).toHaveAttribute("data-signal-event-id", "updated");
    await expect(cards.nth(2)).toHaveAttribute("data-signal-event-id", "continuing");
    const changed = pane.locator('[data-signal-event-id="updated"]');
    await expect(changed.getByText("有新进展", { exact: true })).toBeVisible();
    await expect(changed.getByText("本轮变化：团队已发布首轮测试结果。", { exact: true })).toBeVisible();
    await expect(changed.getByRole("link", { name: /研究频道/ })).toHaveAttribute("href", original.link);
    await expect(changed.getByRole("link", { name: /@maintainer/ })).toHaveAttribute("href", update.link);
    await expect(changed.locator("[data-signal-new-evidence]")).toHaveCount(1);
    const history = pane.locator("[data-signal-event-history]");
    await expect(history).not.toHaveAttribute("open");
    await history.locator("summary").click();
    await expect(history.getByText("此前的观察记录", { exact: true })).toBeVisible();
    await expect(history.getByRole("link", { name: /研究频道/ })).toHaveAttribute("href", original.link);
    await expect(history.getByText("延续观察的事件", { exact: true })).toHaveCount(0);
    await changed.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/signal-continuity-${viewport.width}.png`, fullPage: false });
  });
}
