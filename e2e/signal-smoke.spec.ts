import { expect, test } from "@playwright/test";

test("private APIs reject anonymous requests", async ({ request }) => {
  for (const path of ["/api/x", "/api/telegram", "/api/system-health", "/api/stocks-hynix-premium"]) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
});

for (const path of ["/", "/holding", "/alerts", "/stocks", "/intel"]) {
  test(`login and render ${path} without browser exceptions`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/login?next=${encodeURIComponent(path)}`);
    await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}$`));
    await expect(page.locator("main").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
    expect(errors).toEqual([]);
    if (path === "/") {
      const curve = page.getByTestId("stocks-hynix-premium-curve");
      await expect(curve).toBeVisible();
      await curve.getByRole("button", { name: "展开图表", exact: true }).click();
      await expect(curve.getByRole("button", { name: "1分钟", exact: true })).toHaveCount(0);
      const responsePromise = page.waitForResponse((response) => response.url().includes("/api/stocks-hynix-premium?") && response.url().includes("interval=1h"));
      await curve.getByRole("button", { name: "1小时", exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const snapshot = await response.json();
      expect(snapshot.v).toBe(1);
      expect(snapshot.interval).toBe("1h");
      await expect(curve.locator("canvas").first()).toBeVisible();
      const alert = page.getByRole("alertdialog");
      if (await alert.isVisible()) await alert.getByRole("button", { name: "知道了", exact: true }).click();
      await page.screenshot({ path: "test-results/signal-desktop.png", fullPage: false });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: "test-results/signal-mobile.png", fullPage: false });
      expect(errors).toEqual([]);
    }
  });
}
