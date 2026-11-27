import { expect, test } from "@playwright/test";

const telegramMessage = {
  id: "alpha:11", channelRef: "alpha", channelTitle: "Alpha channel", channelUsername: "alpha", channelId: "11",
  channelLink: "https://t.me/alpha", channelAvatar: null, messageUrl: "https://t.me/alpha/11",
  text: "Protocol release https://news.example/articles/protocol", createdAt: "2026-10-02T00:00:00.000Z",
  views: 0, forwards: 0, origin: "history", media: null, translation: null, quotedMessage: null,
};
const telegramSnapshot = {
  provider: "telegram", mode: "mtproto", isConfigured: true, isConnected: true, status: "live", channels: [],
  feed: [telegramMessage], note: "", errors: [],
};
const xSnapshot = {
  provider: "6551", baseUrl: "", isConfigured: true, isConnected: true, status: "live", watchAccounts: [], trackedKeywords: [],
  feed: [{
    id: "9001", username: "research", displayName: "Research", profileUrl: "https://x.com/research", userAvatar: "",
    tweetUrl: "https://x.com/research/status/9001", text: "My independent assessment https://news.example/articles/protocol?utm_source=x",
    createdAt: "2026-10-02T01:00:00.000Z", hashtags: [], likes: 0, retweets: 0, replies: 0, quotes: 0, views: 0,
    media: [], quotedTweet: null, origin: "watch", queryLabel: "985monitor fixture",
    translation: { sourceLanguage: "en", targetLanguage: "zh-CN", text: "独立评论：公开测试出现限制 https://news.example/articles/protocol" },
  }], note: "", errors: [],
};

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`Signal groups retain comments, filters, read state and old anchors at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Replace only the source stream transport, retaining the feed's real SSE
    // consumers, state transitions, DOM anchors, scrolling and read actions.
    await page.addInitScript(() => {
      const streams: { url: string; listeners: Map<string, ((event: MessageEvent<string>) => void)[]> }[] = [];
      class FixtureEventSource {
        static CLOSED = 2;
        readyState = 1;
        listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
        constructor(public url: string) { streams.push(this); }
        addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
          this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
        }
        close() { this.readyState = 2; }
      }
      window.EventSource = FixtureEventSource as unknown as typeof EventSource;
      Object.defineProperty(window, "__emitFeedSnapshot", { value: (url: string, type: string, data: string) => {
        for (const stream of streams.filter((stream) => stream.url === url)) {
          for (const listener of stream.listeners.get(type) || []) listener(new MessageEvent(type, { data }));
        }
      } });
    });
    await page.route("**/api/telegram?**", (route) => route.fulfill({ json: telegramSnapshot }));
    await page.route("**/api/x?**", (route) => route.fulfill({ json: xSnapshot }));
    const emptySummary = { success: true, status: "empty", configured: false, summary: null, generatedAt: null, itemCount: 0,
      period: { scope: "12h", audience: "signals", label: "最近 12 小时", timeZone: "Asia/Shanghai" }, sourceCounts: { telegram: 0, x: 0, stocks: 0 }, error: null };
    await page.route("**/api/signal-summary**", (route) => route.fulfill({ json: emptySummary }));
    await page.route("**/api/alpha-summary**", (route) => route.fulfill({ json: emptySummary }));
    await page.route("**/api/stocks-hynix-premium**", (route) => route.fulfill({ json: { success: false, status: "empty", points: [], error: null } }));
    await page.goto("/login?next=%2F");
    await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/$/);
    const warning = page.getByRole("alertdialog");
    if (await warning.isVisible()) await warning.getByRole("button", { name: "知道了", exact: true }).click();
    const pane = page.locator("section[data-signal-feed-pane][data-mobile-command-feed]");
    await pane.getByRole("button", { name: "12h", exact: true }).click();
    const rows = pane.locator("article[data-signal-feed-item-id]");
    await expect(rows).toHaveCount(1);
    const row = rows.first();
    await expect(row).toContainText("Protocol release");
    const id = await row.getAttribute("data-signal-feed-item-id");
    const details = row.locator("details");
    await details.locator("summary").click();
    await expect(details.locator("[data-signal-feed-group-member]")).toHaveCount(2);
    await expect(details).toContainText("My independent assessment");
    await expect(details).toContainText("独立评论：公开测试出现限制");
    const tgMember = details.locator('[data-signal-feed-group-member="telegram:alpha:11"]');
    await expect(tgMember.getByRole("link", { name: "查看原文", exact: true })).toHaveAttribute("href", "https://t.me/alpha/11");
    await expect(tgMember.getByRole("link", { name: "Alpha channel", exact: true })).toHaveAttribute("href", "https://t.me/alpha");

    await pane.getByPlaceholder("搜索关键词...").fill("公开测试出现限制");
    await expect(rows).toHaveCount(1);
    await expect(row).toContainText("My independent assessment");
    await expect(row).not.toContainText("Alpha channel");
    await pane.getByPlaceholder("搜索关键词...").fill("");
    await pane.getByRole("button", { name: "按博主或频道筛选", exact: true }).click();
    await pane.getByRole("button", { name: /^@research 1$/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(row).not.toContainText("Alpha channel");
    await pane.getByRole("button", { name: "按博主或频道筛选", exact: true }).click();
    await pane.getByRole("button", { name: /^全部博主 \/ 频道/ }).click();
    const representativeText = await row.locator(":scope > div > p").textContent();
    await row.focus();
    await row.press("Enter");
    await expect(row).toHaveAttribute("data-signal-feed-unread-count", "0");
    await row.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");

    await page.evaluate((snapshot) => {
      Reflect.get(window, "__emitFeedSnapshot")("/api/telegram/events", "telegram-snapshot", JSON.stringify(snapshot));
    }, { ...telegramSnapshot, feed: [...telegramSnapshot.feed, {
      ...telegramMessage, id: "beta:12", channelRef: "beta", channelTitle: "Beta channel", channelUsername: "beta", channelId: "12",
      channelLink: "https://t.me/beta", messageUrl: "https://t.me/beta/12", createdAt: "2026-10-02T02:00:00.000Z",
      text: "A later, independent comment https://news.example/articles/protocol",
    }] });
    await expect(rows).toHaveCount(1);
    await expect(row).toHaveAttribute("data-signal-feed-item-id", id!);
    await expect(row.locator(":scope > div > p")).toHaveText(representativeText!);
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator("[data-signal-feed-group-member]")).toHaveCount(3);
    await expect(row).toHaveAttribute("data-signal-feed-unread-count", "1");
    await expect(row).toContainText("新增 1 条未读");
    await expect(details).toContainText("A later, independent comment");

    await page.evaluate(() => localStorage.setItem("signal-hub:signal-feed-reading-anchor", JSON.stringify({ itemId: "telegram:alpha:11", viewportTop: 180, savedAt: "2026-10-02T00:00:00.000Z" })));
    await pane.locator("[data-signal-utility-strip]").getByRole("button", { name: "返回上次阅读", exact: true }).click();
    await expect(pane).toContainText("已返回上次阅读位置");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/signal-feed-aggregation-${viewport.width}.png`, fullPage: false });
  });
}
