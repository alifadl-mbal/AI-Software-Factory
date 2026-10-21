import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { aedNumber, waitForData, watchConsole } from "./helpers";

/** The Sales hover breakdown, partial-month marker and growth row (issue #40). */

function trendChart(page: Page): Locator {
  return page.locator("#monthly-net-revenue");
}

/** Hover `target` until the card shows: the chart's listeners attach once it has hydrated. */
async function hoverForCard(page: Page, target: Locator): Promise<Locator> {
  const card = page.getByTestId("breakdown-card");
  await expect(async () => {
    await page.mouse.move(0, 0);
    await target.hover();
    await expect(card).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return card;
}

/** The slices of one breakdown section, as numbers. */
async function sliceValues(section: Locator): Promise<number[]> {
  const values = await section
    .locator("[data-value]")
    .evaluateAll((cells) => cells.map((cell) => Number(cell.getAttribute("data-value"))));
  return values;
}

test("hovering a month bar opens its breakdown; slices add up to the bar", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/sales");
  await waitForData(page);
  const url = page.url();
  const chart = trendChart(page);

  // Year to date always ends today, so the last month is partial and marked as such.
  await expect(chart.getByTestId("partial-marker")).toContainText(/Partial month: 1–\d{1,2} \w{3}/);
  await expect(chart.locator("[data-partial]")).toHaveCount(1);
  await expect(chart.getByTestId("yoy").first()).toHaveText(/^(▲|▼)?[+-]?\d+\.\d%$|^—$/);

  const card = await hoverForCard(page, chart.locator(".recharts-bar-rectangle").first());
  await expect(card.getByTestId("breakdown-company")).toBeVisible();
  await expect(card.getByTestId("breakdown-salesperson")).toBeVisible();
  await expect(card.getByTestId("breakdown-itemGroup")).toBeVisible();
  const total = aedNumber((await card.getByTestId("breakdown-total").textContent()) ?? "");
  expect(total).toBeGreaterThan(0);
  for (const dimension of ["company", "salesperson", "itemGroup"]) {
    const values = await sliceValues(card.getByTestId(`breakdown-${dimension}`));
    expect(values.length).toBeGreaterThan(0);
    expect(values.length).toBeLessThanOrEqual(6);
    expect(Math.abs(values.reduce((sum, value) => sum + value, 0) - total), dimension).toBeLessThan(1);
  }
  await expect(card.getByTestId("breakdown-last-year")).toHaveText(/AED/);

  // Hovering never changes the URL.
  expect(page.url()).toBe(url);
  expect(errors).toEqual([]);
});

test("a company bar shows its salespeople and item groups", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  const companies = page.locator("#revenue-by-company");
  const card = await hoverForCard(page, companies.locator(".recharts-bar-rectangle").first());
  await expect(card.getByTestId("breakdown-salesperson")).toBeVisible();
  await expect(card.getByTestId("breakdown-company")).toHaveCount(0);
  const total = aedNumber((await card.getByTestId("breakdown-total").textContent()) ?? "");
  const values = await sliceValues(card.getByTestId("breakdown-itemGroup"));
  expect(Math.abs(values.reduce((sum, value) => sum + value, 0) - total)).toBeLessThan(1);
});

test("the chart's keyboard focus opens the card", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  await trendChart(page).locator("svg.recharts-surface[tabindex='0']").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("breakdown-card")).toBeVisible();
});

test("a custom range over 24 months shows yearly bars, the cut years marked partial", async ({ page }) => {
  const year = new Date().getFullYear();
  await page.goto(`/sales?range=custom&from=${year - 3}-03-05&to=${year}-06-15`);
  await waitForData(page);
  const chart = trendChart(page);
  await expect(chart.getByTestId("period-tick")).toHaveCount(4);
  await expect(chart.getByTestId("partial-marker")).toContainText("Partial years");
  // A year without sales draws no bar, so check the labels: both cut years show their days.
  await expect(chart.getByTestId("period-tick").first()).toContainText(`${year - 3} from 5 Mar`);
  await expect(chart.getByTestId("period-tick").last()).toContainText(`${year} to 15 Jun`);
  await expect(chart.locator("[data-partial]").last()).toBeAttached();
});

test("the Finance P&L chart marks the partial month and shows growth", async ({ page }) => {
  await page.goto("/finance");
  await waitForData(page);
  const chart = page.locator("#monthly-p-and-l");
  await expect(chart.getByTestId("partial-marker")).toBeVisible();
  await expect(chart.getByTestId("yoy").first()).toBeVisible();
});

test("the three new KPIs", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  const kpis = page.getByTestId("sales-kpis");
  for (const label of ["Active customers", "Average invoice", "Discount"]) {
    await expect(kpis.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(kpis.getByText(/% of gross sales \(last year [\d.]+%\)/)).toBeVisible();
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tapping a bar opens the breakdown as a bottom sheet", async ({ page }) => {
    await page.goto("/sales");
    await waitForData(page);
    const url = page.url();
    const bar = trendChart(page).locator(".recharts-bar-rectangle").first();
    const sheet = page.getByTestId("breakdown-sheet");
    // The tap listener is attached once the chart has hydrated; tap again until the sheet shows.
    await expect(async () => {
      if (!(await sheet.isVisible())) await bar.click();
      await expect(sheet).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(sheet.getByTestId("breakdown-company")).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(840);
    expect(page.url()).toBe(url);

    const results = await new AxeBuilder({ page }).include("[data-testid=breakdown-sheet]").analyze();
    expect(
      results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // The sheet's button opens that month's drill-down.
    await bar.click();
    await sheet.getByRole("button", { name: "List its documents" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("dialog").getByTestId("drill-documents")).toBeVisible();
    await expect(page).toHaveURL(/drill=/);
  });
});
