import { test, expect } from "@playwright/test";

test.use({ channel: "chrome" });

test("login language choice remains after reload", async ({ page }, testInfo) => {
  await page.route("**/api/setup/status", (route) => route.fulfill({ json: { needsSetup: false } }));
  await page.route("**/api/auth/login-methods", (route) => route.fulfill({ json: { entraEnabled: false, entraOnly: false } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "USIM CMS Admin" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("login-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByRole("button", { name: "EN", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("unknown route and mobile navigation stay usable", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("usim_cms_session", JSON.stringify({
      token: "ux-smoke-csrf", role: "webmaster", tenantHost: "example.test", tenantHosts: ["example.test"],
    }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/unknown-route");
  await expect(page.getByRole("heading", { name: "Halaman tidak ditemui" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-not-found.png"), fullPage: true });
  const open = page.getByRole("button", { name: "Buka menu navigasi" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Buka menu navigasi" });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await dialog.boundingBox())?.x).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("mobile-menu.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await page.getByRole("button", { name: "Kembali ke papan pemuka" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
