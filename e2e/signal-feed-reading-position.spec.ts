import { expect, test, type Page } from "@playwright/test";

const readingAnchorKey = "signal-hub:signal-feed-reading-anchor";
const desktopViewport = { width: 1440, height: 1000 };
const mobileViewport = { width: 390, height: 844 };
const historicalAnchor = {
  itemId: "telegram:reading:8",
  viewportTop: 180,
  savedAt: "2026-10-02T00:00:00.000Z",
};

function message(index: number) {
  return {
    id: `reading:${index}`, channelRef: "reading", channelTitle: "Reading fixtures", channelUsername: "reading", channelId: "10",
    channelLink: "https://t.me/reading", channelAvatar: null, messageUrl: `https://t.me/reading/${index}`,
    text: `Independent reading fixture ${index}. ${"This message has enough detail to exercise the real reading viewport. ".repeat(5)} https://news.example/reading/${index}`,
    createdAt: new Date(Date.UTC(2026, 9, 2, 0, index)).toISOString(),
    views: 0, forwards: 0, origin: "history", media: null, translation: null, quotedMessage: null,
  };
}

const initialFeed = Array.from({ length: 18 }, (_, index) => message(index + 1));
const telegramSnapshot = {
  provider: "telegram", mode: "mtproto", isConfigured: true, isConnected: true, status: "live", channels: [],
  feed: initialFeed, note: "", errors: [],
};
const xSnapshot = {
  provider: "6551", baseUrl: "", isConfigured: false, isConnected: false, status: "paused", watchAccounts: [], trackedKeywords: [],
  feed: [], note: "", errors: [],
};
const emptySummary = {
  success: true, status: "empty", configured: false, summary: null, generatedAt: null, itemCount: 0,
  period: { scope: "12h", audience: "signals", label: "最近 12 小时", timeZone: "Asia/Shanghai" },
  sourceCounts: { telegram: 0, x: 0, stocks: 0 }, error: null,
};
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => expect(browserErrors.get(page)).toEqual([]));

async function installFixtures(page: Page, seedHistoricalAnchor = false) {
  // Replace only transport. The component's snapshot handlers, browser layout,
  // native scrolling, saved anchors, and compensation remain untouched.
  await page.addInitScript(({ snapshot, anchorKey, anchor }) => {
    if (anchor && !sessionStorage.getItem("reading-fixture-anchor-seeded")) {
      localStorage.setItem(anchorKey, JSON.stringify(anchor));
      sessionStorage.setItem("reading-fixture-anchor-seeded", "1");
    }
    const streams: FixtureEventSource[] = [];
    class FixtureEventSource {
      static CLOSED = 2;
      readyState = 1;
      listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
      constructor(public url: string) { streams.push(this); }
      addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
        if (this.url === "/api/telegram/events" && type === "telegram-snapshot") {
          queueMicrotask(() => {
            if (this.readyState !== FixtureEventSource.CLOSED) listener(new MessageEvent(type, { data: JSON.stringify(snapshot) }));
          });
        }
      }
      close() { this.readyState = FixtureEventSource.CLOSED; }
    }
    window.EventSource = FixtureEventSource as unknown as typeof EventSource;
    Object.defineProperty(window, "__emitReadingSnapshot", { value: (data: string) => {
      for (const stream of streams.filter((candidate) => candidate.url === "/api/telegram/events" && candidate.readyState !== FixtureEventSource.CLOSED)) {
        for (const listener of stream.listeners.get("telegram-snapshot") || []) listener(new MessageEvent("telegram-snapshot", { data }));
      }
    } });
  }, { snapshot: telegramSnapshot, anchorKey: readingAnchorKey, anchor: seedHistoricalAnchor ? historicalAnchor : null });

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    // Login uses only the isolated server's generated test password and cookie.
    if (path === "/api/login") return route.continue();
    if (path === "/api/telegram") return route.fulfill({ json: telegramSnapshot });
    if (path === "/api/x") return route.fulfill({ json: xSnapshot });
    if (path === "/api/signal-summary" || path === "/api/alpha-summary") return route.fulfill({ json: emptySummary });
    if (path === "/api/stocks-hynix-premium") return route.fulfill({ json: {
      generatedAt: "2026-10-02T00:00:00.000Z", source: "empty", provider: "binance-futures", interval: "5m",
      symbols: { base: "HYNIXUSDT", benchmark: "BTCUSDT" }, websocket: { url: "", streams: [] }, points: [], latest: null, errors: [],
    } });
    if (path === "/api/stocks-hynix-funding") return route.fulfill({ json: {
      generatedAt: "2026-10-02T00:00:00.000Z", source: "empty", provider: "binance-futures", symbols: { base: "HYNIXUSDT", benchmark: "BTCUSDT" },
      strategy: "short-base-long-benchmark", records: [], daily: [], latest: null, errors: [],
    } });
    if (path === "/api/deployment-version") return route.fulfill({ json: { version: null } });
    return route.fulfill({ json: { success: true, status: "empty", errors: [] } });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/)/, (route) => route.abort());
}

function feedPane(page: Page) {
  return page.locator("section[data-signal-feed-pane][data-mobile-command-feed]");
}

function timeline(page: Page) {
  return feedPane(page).locator("[data-signal-feed-timeline]");
}

function row(page: Page, index: number) {
  return timeline(page).locator("article[data-signal-feed-item-id]").filter({ hasText: `Independent reading fixture ${index}.` });
}

async function settleFrames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

function readingScrollTop(page: Page) {
  return page.viewportSize()!.width >= 1024
    ? timeline(page).evaluate((element) => element.scrollTop)
    : page.evaluate(() => window.scrollY);
}

async function loginAndOpenFeed(page: Page, options: {
  seedHistoricalAnchor?: boolean;
  viewport?: { width: number; height: number };
  beforeLogin?: () => Promise<void>;
} = {}) {
  await page.setViewportSize(options.viewport ?? desktopViewport);
  await installFixtures(page, options.seedHistoricalAnchor);
  await options.beforeLogin?.();
  await page.goto("/login?next=%2F");
  await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(timeline(page).locator("article[data-signal-feed-item-id]")).toHaveCount(18);
  await settleFrames(page);
  await expect.poll(() => readingScrollTop(page)).toBe(0);
}

async function emitLaterMessage(page: Page, index: number) {
  await page.evaluate((snapshot) => {
    Reflect.get(window, "__emitReadingSnapshot")(JSON.stringify(snapshot));
  }, { ...telegramSnapshot, feed: [...initialFeed, message(index)] });
  await expect(row(page, index)).toHaveCount(1);
  await settleFrames(page);
}

async function scrollToReadingRow(page: Page, index = 8) {
  await row(page, index).evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await settleFrames(page);
  await expect.poll(() => readingScrollTop(page)).toBeGreaterThan(500);
}

async function expectLatestVisible(page: Page, latest = 18) {
  await expect.poll(() => readingScrollTop(page)).toBe(0);
  const offset = await row(page, latest).evaluate((element) => {
    const parent = element.closest("[data-signal-feed-timeline]")!;
    return element.getBoundingClientRect().top - parent.getBoundingClientRect().top;
  });
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(offset).toBeLessThan(20);
  if (page.viewportSize()!.width < 1024) {
    const top = await row(page, latest).evaluate((element) => element.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(mobileViewport.height);
  }
}

async function expectSavedRowVisible(page: Page) {
  await expect.poll(() => row(page, 8).evaluate((element) => {
    const parent = element.closest("[data-signal-feed-timeline]")!;
    const rect = element.getBoundingClientRect();
    const bounds = parent.getBoundingClientRect();
    return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
  })).toBe(true);
  await expect.poll(() => timeline(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
}

for (const viewport of [desktopViewport, mobileViewport]) {
  test(`new SSE messages keep the latest view at the top at ${viewport.width}px`, async ({ page }) => {
    await loginAndOpenFeed(page, { viewport });
    await emitLaterMessage(page, 19);
    await expectLatestVisible(page, 19);
  });

  test(`new SSE messages preserve the visible row while reading older messages at ${viewport.width}px`, async ({ page }) => {
    await loginAndOpenFeed(page, { viewport });
    await scrollToReadingRow(page);
    const previousTop = await row(page, 8).evaluate((element) => element.getBoundingClientRect().top);
    await emitLaterMessage(page, 19);
    await expect.poll(async () => Math.abs(await row(page, 8).evaluate((element) => element.getBoundingClientRect().top) - previousTop)).toBeLessThan(2);
  });
}

test("initial latest view and its SSE update retain the saved reading position", async ({ page }) => {
  await loginAndOpenFeed(page, { seedHistoricalAnchor: true });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.itemId, readingAnchorKey)).toBe(historicalAnchor.itemId);
  await emitLaterMessage(page, 19);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.itemId, readingAnchorKey)).toBe(historicalAnchor.itemId);
  await feedPane(page).locator("[data-signal-utility-strip]").getByRole("button", { name: "返回上次阅读", exact: true }).click();
  await expectSavedRowVisible(page);
});

test("an older bootstrap REST reply retains newer SSE messages and edits", async ({ page }) => {
  let initialRestRequested = false;
  let releaseInitialRest!: () => void;
  const initialRestGate = new Promise<void>((resolve) => { releaseInitialRest = resolve; });
  await loginAndOpenFeed(page, { beforeLogin: async () => {
    // Hold only the slow transport response. The real bootstrap/merge code
    // receives SSE updates while its initial REST snapshot is still in flight.
    await page.route(/\/api\/telegram(?:\?|$)/, async (route) => {
      initialRestRequested = true;
      await initialRestGate;
      await route.fulfill({ json: telegramSnapshot });
    });
  } });
  try {
    await expect.poll(() => initialRestRequested).toBe(true);
    const newerSnapshot = { ...telegramSnapshot, feed: [
      ...initialFeed.map((item) => item.id === "reading:17" ? {
        ...item, text: `${item.text} SSE edited the original message after REST started.`,
      } : item),
      message(19),
    ] };
    await page.evaluate((snapshot) => Reflect.get(window, "__emitReadingSnapshot")(JSON.stringify(snapshot)), newerSnapshot);
    await expect(row(page, 19)).toHaveCount(1);
    await expect(row(page, 17)).toContainText("SSE edited the original message after REST started.");

    const oldReply = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/telegram");
    releaseInitialRest();
    await oldReply;
    await settleFrames(page);
    await expect(timeline(page).locator("article[data-signal-feed-item-id]")).toHaveCount(19);
    await expect(row(page, 17)).toContainText("SSE edited the original message after REST started.");
    await expectLatestVisible(page, 19);
  } finally {
    releaseInitialRest();
  }
});

test("manual refresh applies unrelated REST changes while retaining a concurrent SSE delta", async ({ page }) => {
  const bootstrapReply = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/telegram");
  await loginAndOpenFeed(page);
  await bootstrapReply;
  await settleFrames(page);

  let manualRestRequested = false;
  let releaseManualRest!: () => void;
  const manualRestGate = new Promise<void>((resolve) => { releaseManualRest = resolve; });
  const enrichedRestSnapshot = { ...telegramSnapshot, feed: initialFeed.map((item) => item.id === "reading:16" ? {
    ...item,
    text: `${item.text} REST enriched an unrelated message while the stream updated another row.`,
    translation: {
      provider: "minimax", sourceLanguage: "en", targetLanguage: "zh-CN",
      text: `独立阅读测试消息16。${"这条消息包含充足细节，用来验证真实阅读区域的位置。".repeat(5)} https://news.example/reading/16 REST 新增的独立消息翻译：消息流更新另一条记录时，REST 为这条消息补充了内容。`,
    },
  } : item) };
  await page.route(/\/api\/telegram(?:\?|$)/, async (route) => {
    manualRestRequested = true;
    await manualRestGate;
    await route.fulfill({ json: enrichedRestSnapshot });
  });
  try {
    await feedPane(page).getByRole("button", { name: "刷新 TG", exact: true }).click();
    await expect.poll(() => manualRestRequested).toBe(true);
    // This is an incremental stream event: row 16 is absent, so its REST
    // enrichment is independent of the newer stream changes to rows 17/19.
    await page.evaluate((snapshot) => Reflect.get(window, "__emitReadingSnapshot")(JSON.stringify(snapshot)), {
      ...telegramSnapshot,
      feed: [{ ...message(17), text: `${message(17).text} SSE edited this message during manual refresh.` }, message(19)],
    });
    await expect(row(page, 19)).toHaveCount(1);
    await expect(row(page, 17)).toContainText("SSE edited this message during manual refresh.");
    const manualReply = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/telegram");
    releaseManualRest();
    await manualReply;
    await expect(feedPane(page).getByRole("button", { name: "刷新 TG", exact: true })).toBeEnabled();
    await settleFrames(page);
    await expect(timeline(page).locator("article[data-signal-feed-item-id]")).toHaveCount(19);
    await expect(row(page, 17)).toContainText("SSE edited this message during manual refresh.");
    await expect(row(page, 16)).toContainText("REST enriched an unrelated message while the stream updated another row.");
    await expect(row(page, 16)).toContainText("REST 新增的独立消息翻译");
    await expectLatestVisible(page, 19);
  } finally {
    releaseManualRest();
  }
});

test("switching to 24h while bootstrap REST is delayed starts and retains the new range request", async ({ page }) => {
  let bootstrapRequested = false;
  let rangeRequested = false;
  let releaseBootstrap!: () => void;
  const bootstrapGate = new Promise<void>((resolve) => { releaseBootstrap = resolve; });
  await loginAndOpenFeed(page, { beforeLogin: async () => {
    await page.route(/\/api\/telegram(?:\?|$)/, async (route) => {
      if (new URL(route.request().url()).searchParams.get("range") === "24h") {
        rangeRequested = true;
        await route.fulfill({ json: { ...telegramSnapshot, feed: [message(20)] } });
        return;
      }
      bootstrapRequested = true;
      await bootstrapGate;
      // An old-range fetch may already have been aborted by the real effect.
      await route.fulfill({ json: telegramSnapshot }).catch(() => {});
    });
  } });
  try {
    await expect.poll(() => bootstrapRequested).toBe(true);
    await feedPane(page).getByRole("button", { name: "24h", exact: true }).click();
    await expect.poll(() => rangeRequested).toBe(true);
    await expect(row(page, 20)).toHaveCount(1);
    await expect(timeline(page).locator("article[data-signal-feed-item-id]")).toHaveCount(1);
    releaseBootstrap();
    await settleFrames(page);
    await expect(row(page, 20)).toHaveCount(1);
    await expect(timeline(page).locator("article[data-signal-feed-item-id]")).toHaveCount(1);
  } finally {
    releaseBootstrap();
  }
});

test("returning to latest keeps the bookmark for manual return to older reading", async ({ page }) => {
  await loginAndOpenFeed(page);
  await scrollToReadingRow(page);
  const savedId = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.itemId, readingAnchorKey);
  expect(savedId).toBeTruthy();
  expect(savedId).not.toBe("original:https://news.example/reading/18");
  const navigation = feedPane(page).locator("[data-signal-feed-floating-navigation]");
  await navigation.getByRole("button", { name: "回到最新消息", exact: true }).click();
  await settleFrames(page);
  // Manual scrollIntoView may align the first row past the timeline's 8px
  // padding; the observable contract is that the latest row is visible.
  await expect.poll(() => readingScrollTop(page)).toBeLessThanOrEqual(24);
  await expect(row(page, 18)).toBeInViewport();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.itemId, readingAnchorKey)).toBe(savedId);
  await navigation.getByRole("button", { name: "返回上次阅读", exact: true }).click();
  const saved = timeline(page).locator(`[data-signal-feed-item-id="${savedId}"]`);
  await expect.poll(() => saved.evaluate((element) => {
    const parent = element.closest("[data-signal-feed-timeline]")!;
    const rect = element.getBoundingClientRect();
    const bounds = parent.getBoundingClientRect();
    return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
  })).toBe(true);
  await expect.poll(() => readingScrollTop(page)).toBeGreaterThan(500);
});

for (const entry of ["reload", "shell navigation", "browser back"] as const) {
  test(`${entry} enters the feed at latest and keeps manual return to saved reading`, async ({ page }) => {
    await loginAndOpenFeed(page);
    await scrollToReadingRow(page);
    const savedId = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null")?.itemId, readingAnchorKey);
    expect(savedId).not.toBe("original:https://news.example/reading/18");
    if (entry === "reload") {
      await page.reload();
    } else {
      await page.locator("[data-workspace-rail]").getByRole("link", { name: "设置", exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      if (entry === "shell navigation") {
        await page.locator("[data-workspace-rail]").getByRole("link", { name: "信号", exact: true }).click();
      } else {
        await page.goBack();
      }
    }
    await expect(page).toHaveURL(/\/$/);
    await expect(row(page, 18)).toHaveCount(1);
    await settleFrames(page);
    await expectLatestVisible(page);
    await feedPane(page).locator("[data-signal-utility-strip]").getByRole("button", { name: "返回上次阅读", exact: true }).click();
    const saved = timeline(page).locator(`[data-signal-feed-item-id="${savedId}"]`);
    await expect.poll(() => saved.evaluate((element) => {
      const parent = element.closest("[data-signal-feed-timeline]")!;
      const rect = element.getBoundingClientRect();
      const bounds = parent.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    })).toBe(true);
  });
}
