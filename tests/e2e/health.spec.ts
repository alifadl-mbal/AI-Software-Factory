import { expect, test } from "@playwright/test";

// Sample mode, no sign-in configured: open as before, with a healthy health check.

test("/api/health answers 200 in sample mode", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", dataSource: "sample", orion: "not used" });
});

test("without sign-in there is no user menu and the sign-in page is skipped", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("sample-badge")).toBeVisible();
  await expect(page.getByTestId("user-menu")).toHaveCount(0);
  await expect(page.getByTestId("no-sign-in-banner")).toHaveCount(0);
});
