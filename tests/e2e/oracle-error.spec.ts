import { expect, test } from "@playwright/test";

// Runs against a server in oracle mode whose ORACLE_DSN points at nothing (see playwright.config).
test("an unreachable Orion shows a friendly ErrorCard, not a stack trace", async ({ page }) => {
  await page.goto("/sales");
  const errors = page.getByTestId("error-card");
  await expect(errors.first()).toBeVisible({ timeout: 30_000 });
  await expect(errors.first()).toContainText("Couldn't connect to Orion");
  await expect(errors.first().getByRole("button", { name: "Retry" })).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/at \w+ \(|node_modules|127\.0\.0\.1|nosuchservice/);
  await expect(page.getByTestId("sample-badge")).toHaveCount(0);
});
