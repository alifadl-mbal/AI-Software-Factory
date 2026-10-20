import { expect, test } from "@playwright/test";

import { PAGES } from "./helpers";

// Runs against `next start` in oracle mode with no sign-in configured (see playwright.config):
// it must serve no data at all, only the "sign-in not configured" page.

for (const { path } of PAGES) {
  test(`${path} shows "sign-in not configured" and no data`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/not-configured$/);
    await expect(page.getByTestId("not-configured")).toBeVisible();
    await expect(page.getByTestId("kpi-card")).toHaveCount(0);
    await expect(page.getByTestId("error-card")).toHaveCount(0);
    await expect(page.getByTestId("refresh")).toHaveCount(0);
  });
}

test("data API routes answer 503 with no data", async ({ request }) => {
  const response = await request.get("/api/finance/journal-lines?account=40809", { maxRedirects: 0 });
  expect(response.status()).toBe(503);
  const body = await response.json();
  expect(body).toEqual({ ok: false, message: expect.stringContaining("not configured") });
});

test("the health check stays open", async ({ request }) => {
  const response = await request.get("/api/health", { timeout: 20_000 });
  expect(response.status()).toBe(503);
  expect(await response.json()).toMatchObject({ dataSource: "oracle", orion: "down" });
});
