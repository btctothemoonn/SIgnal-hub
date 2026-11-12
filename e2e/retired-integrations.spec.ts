import { expect, test } from "@playwright/test";

test("retired integrations have no settings, navigation, or active endpoints", async ({ page, request }) => {
  for (const path of ["/api/douyin", "/api/douyin/refresh", "/api/wecom/reports", "/api/wecom/ingest"]) {
    const response = await request.post(path, { data: {} });
    expect(response.status()).toBe(410);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }

  await page.goto("/login?next=%2Fsettings");
  await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "监控设置" })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('a[href="/douyin"], a[href="/wecom"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "抖音博主" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Telegram 频道/ })).toBeVisible();
  }
  await expect(page.getByRole("navigation", { name: "Mobile primary navigation" }).getByRole("link")).toHaveCount(5);

  const settings = await page.request.get("/api/settings");
  expect(settings.ok()).toBe(true);
  expect(Object.keys((await settings.json()).config).sort()).toEqual(["hynixPremiumAlert", "telegramChannels", "twitterAccounts"]);
  const retiredAction = await page.request.post("/api/settings", { data: { action: "douyin.setEnabled", enabled: true } });
  expect(retiredAction.status()).toBe(400);
  for (const path of ["/douyin", "/wecom"]) {
    expect((await page.request.get(path)).status()).toBe(404);
  }
});
