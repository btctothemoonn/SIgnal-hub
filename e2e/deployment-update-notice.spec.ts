import { expect, test, type Page } from "@playwright/test";

const versionPath = "/api/deployment-version";
const destination = "/settings?notice-test=keep#settings-category";
const validVersion = /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;

async function loginToSettings(page: Page) {
  // Settings GET is read-only, but a fixture keeps this check independent of
  // configured providers and avoids loading the information feed.
  await page.route("**/api/settings", (route) => route.fulfill({
    json: {
      success: true,
      config: { telegramChannels: [], twitterAccounts: [], douyinCreators: [] },
      configuration: { summaryConfigured: false, translationConfigured: false, adminAccessConfigured: true },
    },
  }));
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
  const initialCheck = page.waitForResponse((response) => new URL(response.url()).pathname === versionPath);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp("/settings\\?notice-test=keep#settings-category$"));
  await expect(page.getByRole("heading", { name: "监控设置", exact: true })).toBeVisible();
  const response = await initialCheck;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(Object.keys(payload)).toEqual(["version"]);
  expect(payload.version).toMatch(validVersion);
  return payload.version as string;
}

async function resumeAndWait(page: Page, event: "focus" | "online" | "visibilitychange") {
  // The component coalesces duplicate resume events for two seconds. Advancing
  // the browser clock tests the actual event handler without sleeping in CI.
  await page.clock.fastForward(2_100);
  const check = page.waitForResponse((response) => new URL(response.url()).pathname === versionPath);
  await page.evaluate((eventName) => {
    (eventName === "visibilitychange" ? document : window).dispatchEvent(new Event(eventName));
  }, event);
  await check;
}

test("deployment version API requires login and never caches the private release", async ({ request, page }) => {
  const anonymous = await request.get(versionPath);
  expect(anonymous.status()).toBe(401);
  const initialVersion = await loginToSettings(page);
  const response = await page.request.get(versionPath);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers().vary).toContain("Cookie");
  expect(await response.json()).toEqual({ version: initialVersion });
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`release notice preserves the page until manual refresh at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Install before mounting so the production interval belongs to this clock.
    await page.clock.install();
    const initialVersion = await loginToSettings(page);
    const notice = page.getByRole("status").filter({ hasText: "有更新，请刷新" });
    await expect(notice).toHaveCount(0);
    const initialUrl = page.url();
    const sessionCookies = await page.context().cookies();
    expect(sessionCookies.length).toBeGreaterThan(0);
    await page.evaluate(() => { Object.assign(window, { deploymentNoticeDocument: "original document" }); });

    let liveVersion = initialVersion;
    let fail = true;
    await page.route("**/api/deployment-version", (route) => fail
      ? route.fulfill({ status: 503, json: { error: "synthetic_restart" } })
      : route.fulfill({ json: { version: liveVersion } }));

    await resumeAndWait(page, "online");
    await expect(notice).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "监控设置", exact: true })).toBeVisible();

    fail = false;
    liveVersion = initialVersion === "a".repeat(40) ? "b".repeat(40) : "a".repeat(40);
    await resumeAndWait(page, "focus");
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("button", { name: "立即刷新", exact: true })).toBeVisible();
    expect(page.url()).toBe(initialUrl);
    expect(await page.evaluate(() => Reflect.get(window, "deploymentNoticeDocument"))).toBe("original document");

    // A short outage cannot manufacture a release or clear a known update.
    fail = true;
    await resumeAndWait(page, "online");
    await expect(notice).toBeVisible();
    fail = false;
    liveVersion = initialVersion;
    await resumeAndWait(page, "visibilitychange");
    await expect(notice).toHaveCount(0);

    // A normal minute timer also detects a release while the tab stays open.
    liveVersion = initialVersion === "c".repeat(40) ? "d".repeat(40) : "c".repeat(40);
    const timedCheck = page.waitForResponse((response) => new URL(response.url()).pathname === versionPath);
    await page.clock.fastForward(60_000);
    await timedCheck;
    await expect(notice).toBeVisible();
    expect(page.url()).toBe(initialUrl);
    expect(await page.evaluate(() => Reflect.get(window, "deploymentNoticeDocument"))).toBe("original document");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`deployment-update-${viewport.width}.png`), fullPage: false });

    // The production browser bundle remains the initial build in this fixture;
    // returning to that release lets us verify refresh clears the notice too.
    liveVersion = initialVersion;
    await Promise.all([
      page.waitForEvent("load"),
      notice.getByRole("button", { name: "立即刷新", exact: true }).click(),
    ]);
    await expect(page).toHaveURL(initialUrl);
    await expect(page.getByRole("heading", { name: "监控设置", exact: true })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "deploymentNoticeDocument"))).toBeUndefined();
    expect(await page.context().cookies()).toEqual(sessionCookies);
    await expect(notice).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
