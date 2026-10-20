import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { kpiFull, PAGES, waitForData, watchConsole } from "./helpers";

for (const { path, heading, kpis, headline } of PAGES) {
  test(`${path} loads with real figures and no console errors`, async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByTestId("sample-badge")).toBeVisible();
    await waitForData(page);
    await expect(page.getByTestId("kpi-card")).toHaveCount(kpis);
    await expect(page.getByTestId("error-card")).toHaveCount(0);
    expect(await kpiFull(page, headline)).toMatch(/^AED [1-9][\d,]*$/);
    expect(errors).toEqual([]);
  });
}

test("Sales KPI totals match the breakdown tables", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  const revenue = await kpiFull(page, "Net revenue");
  for (const table of await page.getByTestId("data-table").all()) {
    const footer = table.locator("tfoot td");
    await expect(footer.nth(0)).toHaveText("Total");
    await expect(footer.nth(1)).toHaveText(revenue);
    await expect(footer.nth(2)).toHaveText(await kpiFull(page, "Gross margin"));
  }
});

test("filters update every figure and the URL, and the back button restores them", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/sales");
  await waitForData(page);
  const ytdRevenue = await kpiFull(page, "Net revenue");
  const ytdTrend = await page
    .getByRole("heading", { name: "Monthly net revenue" })
    .locator("..")
    .locator("..")
    .textContent();

  await page.getByTestId("date-range-trigger").click();
  await page.getByRole("button", { name: "Month to date" }).click();
  await expect(page).toHaveURL(/[?&]range=mtd/);
  await waitForData(page);
  await expect.poll(() => kpiFull(page, "Net revenue")).not.toBe(ytdRevenue);
  const mtdRevenue = await kpiFull(page, "Net revenue");
  expect(
    await page
      .getByRole("heading", { name: "Monthly net revenue" })
      .locator("..")
      .locator("..")
      .textContent(),
  ).not.toBe(ytdTrend);
  await expect(page.locator("tfoot td").nth(1)).toHaveText(mtdRevenue);

  await page.getByTestId("company-trigger").click();
  await page.getByPlaceholder("Search companies…").fill("Sample Trading");
  await page.getByRole("option", { name: /Sample Trading/ }).click();
  await expect(page).toHaveURL(/[?&]company=101/);
  await expect(page).toHaveURL(/[?&]range=mtd/);
  await page.keyboard.press("Escape");
  await waitForData(page);
  await expect.poll(() => kpiFull(page, "Net revenue")).not.toBe(mtdRevenue);
  await expect(page.locator("tfoot td").nth(1)).toHaveText(await kpiFull(page, "Net revenue"));
  await expect(page.getByTestId("period")).toContainText("1 company");

  // Shareable: opening the URL fresh gives the same figures.
  const filteredRevenue = await kpiFull(page, "Net revenue");
  const url = page.url();
  await page.goto(url);
  await waitForData(page);
  expect(await kpiFull(page, "Net revenue")).toBe(filteredRevenue);

  await page.goBack();
  await expect(page).not.toHaveURL(/company=/);
  await page.goBack();
  await expect(page).not.toHaveURL(/range=/);
  await waitForData(page);
  await expect.poll(() => kpiFull(page, "Net revenue")).toBe(ytdRevenue);
  expect(errors).toEqual([]);
});

test("custom date range from the calendar", async ({ page }) => {
  await page.goto("/sales?range=custom&from=2026-01-01&to=2026-01-31");
  await waitForData(page);
  await expect(page.getByTestId("date-range-trigger")).toContainText("Custom");
  await expect(page.getByTestId("period")).toContainText("1 Jan 2026 – 31 Jan 2026");
});

test("Refresh reloads the data and shows when it is from", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  await page.getByTestId("refresh").click();
  await expect(page.getByTestId("refresh")).toBeEnabled();
  await waitForData(page);
  await expect(page.getByText(/^Data as of \d\d:\d\d$/)).toBeVisible();
});

test("the data table sorts, searches and exports CSV", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  const table = page.getByTestId("data-table").first();
  const firstCell = table.locator("tbody tr").first().locator("td").first();
  const topCustomer = await firstCell.textContent();
  await table.getByRole("button", { name: "Customer" }).click();
  await expect(firstCell).not.toHaveText(topCustomer ?? "");
  await table.getByRole("searchbox").or(table.getByRole("textbox")).fill("All other");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await table.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("top-customers.csv");
});

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const { path } of PAGES) {
    test(`${path}: sidebar is a drawer and nothing scrolls sideways`, async ({ page }) => {
      await page.goto(path);
      await waitForData(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const nav = page.getByRole("dialog");
      await expect(nav).toHaveCount(0);
      await page.getByRole("button", { name: "Toggle navigation" }).click();
      await expect(nav).toBeVisible();
      await nav.getByRole("link", { name: "Sales", exact: true }).click();
      await expect(page).toHaveURL(/\/sales(\?|$)/);
      await expect(nav).toHaveCount(0);
    });
  }
});

test("dark mode renders", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/sales");
  await waitForData(page);
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await waitForData(page);
  await expect(page.getByTestId("kpi-card").first()).toBeVisible();
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Switch to light mode");
  expect(errors).toEqual([]);
});

test("dark mode from the OS on a first visit hydrates cleanly", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const errors = watchConsole(page);
  await page.goto("/sales");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await waitForData(page);
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Switch to light mode");
  expect(errors).toEqual([]);
});

test("negative bar values don't overlap their category labels", async ({ page }) => {
  // Sample data is rebased to the current year; Equipment nets out negative for these companies over
  // 1–20 October. A fixed range keeps that true whatever today's date is.
  const year = new Date().getFullYear();
  await page.goto(`/sales?range=custom&from=${year}-10-01&to=${year}-10-20&company=101,102`);
  await waitForData(page);
  const charts = page.locator(".recharts-wrapper");
  // Any LabelList text, so the check holds for whatever renders the labels.
  const labels = charts.locator(".recharts-label-list text");
  await expect(labels.filter({ hasText: "-AED 86.5K" })).toBeVisible();
  expect(await labels.count()).toBeGreaterThan(1);
  for (const label of await labels.all()) {
    const text = (await label.textContent()) ?? "";
    const box = (await label.boundingBox())!;
    const chart = label.locator("xpath=ancestor::*[contains(@class,'recharts-wrapper')][1]");
    const ticks = chart.locator(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value");
    expect(await ticks.count()).toBeGreaterThan(0);
    for (const tick of await ticks.all()) {
      const tickBox = (await tick.boundingBox())!;
      const overlaps =
        box.x < tickBox.x + tickBox.width &&
        tickBox.x < box.x + box.width &&
        box.y < tickBox.y + tickBox.height &&
        tickBox.y < box.y + box.height;
      expect(overlaps, `"${text}" overlaps "${await tick.textContent()}"`).toBe(false);
    }
  }
});

for (const theme of ["light", "dark"] as const) {
  for (const { path } of PAGES) {
    test(`axe: no serious or critical violations on ${path} (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(path);
      await waitForData(page);
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /light/);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );
      expect(
        serious.map(
          (violation) =>
            `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
        ),
      ).toEqual([]);
    });
  }
}
