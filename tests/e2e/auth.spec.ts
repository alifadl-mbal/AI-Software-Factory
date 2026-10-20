import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { E2E_AUTH } from "./auth-env";
import { PAGES, signIn } from "./helpers";

// Runs against the oracle server with Microsoft sign-in configured (dummy tenant, see
// playwright.config) and AUTH_ALLOWED_GROUP set. Orion is unreachable there.

test.describe("signed out", () => {
  for (const { path } of PAGES) {
    test(`${path} sends you to sign-in`, async ({ page }) => {
      await page.goto(`${path}?range=ytd`);
      await expect(page).toHaveURL(/\/sign-in(\?|$)/);
      expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(
        path === "/" ? "/?range=ytd" : `${path}?range=ytd`,
      );
      await expect(page.getByTestId("sign-in")).toBeVisible();
      await expect(page.getByTestId("sign-in-microsoft")).toBeVisible();
      // No shell, no data.
      await expect(page.getByTestId("kpi-card")).toHaveCount(0);
      await expect(page.getByTestId("refresh")).toHaveCount(0);
    });
  }

  test("the sign-in page is accessible", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByTestId("sign-in")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("protected API routes answer 401", async ({ request }) => {
    for (const url of ["/api/finance/journal-lines?account=40809", "/api/anything-else"]) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).toBe(401);
      expect(await response.json()).toMatchObject({ ok: false });
    }
  });

  test("a server action is refused without a session", async ({ request }) => {
    const response = await request.post("/sales", { maxRedirects: 0, headers: { "Next-Action": "x" } });
    expect([303, 307, 308]).toContain(response.status());
    expect(response.headers().location).toContain("/sign-in");
  });
});

test("/api/health stays open and leaks nothing", async ({ request }) => {
  const response = await request.get("/api/health", { timeout: 20_000 });
  // Orion doesn't answer on this server.
  expect(response.status()).toBe(503);
  const body = await response.json();
  expect(body).toMatchObject({ status: "unavailable", dataSource: "oracle", orion: "down" });
  expect(body.version).toBeTruthy();
  expect(body.commit).toBeTruthy();
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/127\.0\.0\.1|nosuchservice|e2e|secret|password/i);
});

test("/api/cron/* rejects a missing or wrong token and accepts the right one", async ({ request }) => {
  expect((await request.get("/api/cron/ping")).status()).toBe(401);
  const wrong = await request.get("/api/cron/ping", { headers: { Authorization: "Bearer nope" } });
  expect(wrong.status()).toBe(401);
  const other = await request.get("/api/cron/anything", { headers: { Authorization: "Bearer nope" } });
  expect(other.status()).toBe(401);
  const right = await request.get("/api/cron/ping", {
    headers: { Authorization: `Bearer ${E2E_AUTH.CRON_SECRET}` },
  });
  expect(right.status()).toBe(200);
  expect(await right.json()).toMatchObject({ ok: true });
});

test.describe("signed in", () => {
  test("a group member gets the dashboards, the user menu and can sign out", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL!, { name: "Test User" });
    const response = await page.goto("/sales");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Sales" })).toBeVisible();

    const menu = page.getByTestId("user-menu");
    await expect(menu).toHaveText("TU");
    await expect(menu).toHaveAccessibleName("Account: Test User");
    await menu.click();
    await expect(page.getByRole("menu")).toContainText("test.user@mbal.example");
    await page.getByTestId("sign-out").click();
    // Slow under load: the page's own queries are still queueing for the dead Orion.
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 30_000 });
    await page.goto("/sales");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("a member's API calls get through the gate", async ({ context, baseURL, page }) => {
    await signIn(context, baseURL!);
    const response = await page.request.get("/api/finance/journal-lines?account=40809", { timeout: 40_000 });
    // Past the gate: the route itself answers (502, because Orion is unreachable here).
    expect(response.status()).toBe(502);
  });

  test("a non-member sees the no-access page, and APIs answer 403", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, { member: false });
    await page.goto("/finance");
    await expect(page).toHaveURL(/\/no-access$/);
    await expect(page.getByTestId("no-access")).toContainText("test.user@mbal.example");
    await expect(page.getByTestId("kpi-card")).toHaveCount(0);
    const api = await page.request.get("/api/finance/journal-lines?account=40809", { maxRedirects: 0 });
    expect(api.status()).toBe(403);
  });
});

test.describe("user menu on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("fits at 390px in light and dark", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/sales");
      const menu = page.getByTestId("user-menu");
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      await menu.click();
      const item = page.getByTestId("sign-out");
      await expect(item).toBeVisible();
      // Measure once the open animation (zoom-in-95) is over.
      await page
        .getByRole("menu")
        .evaluate((menu) => Promise.all(menu.getAnimations({ subtree: true }).map((a) => a.finished)));
      const itemBox = await item.boundingBox();
      expect(itemBox!.x).toBeGreaterThanOrEqual(0);
      expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(390);
      expect(itemBox!.height).toBeGreaterThanOrEqual(36);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(390);
      await page.keyboard.press("Escape");
    }
  });
});
