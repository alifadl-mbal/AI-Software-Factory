import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { aedNumber, kpiFull, waitForData, watchConsole } from "./helpers";

/**
 * Sales-style charts on Purchasing, Sales orders and the item page (issue #52): partial months,
 * growth, the hover card, the drill-down and the brand filter on Purchasing. Every card and drill
 * total must equal the bar it came from.
 */

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

async function sliceTotal(section: Locator): Promise<number> {
  const values = await section
    .locator("[data-value]")
    .evaluateAll((cells) => cells.map((cell) => Number(cell.getAttribute("data-value"))));
  expect(values.length).toBeGreaterThan(0);
  expect(values.length).toBeLessThanOrEqual(6);
  return values.reduce((sum, value) => sum + value, 0);
}

/** "Feb 2026: AED 1,234,567. List its receipts" → 1234567. */
async function barValue(bar: Locator): Promise<number> {
  const label = (await bar.getAttribute("aria-label")) ?? "";
  return aedNumber(label.split(": ")[1].split(". ")[0]);
}

/** Wait until the card's breakdown has loaded and check each section adds up to its total. */
async function expectCardAddsUp(card: Locator, sections: string[], expected: number) {
  for (const section of sections) await expect(card.getByTestId(`breakdown-${section}`)).toBeVisible();
  const total = aedNumber((await card.getByTestId("breakdown-total").textContent()) ?? "");
  expect(Math.abs(total - expected)).toBeLessThanOrEqual(1);
  for (const section of sections) {
    expect(
      Math.abs((await sliceTotal(card.getByTestId(`breakdown-${section}`))) - total),
      section,
    ).toBeLessThan(1);
  }
}

/** Bar → list → first row's lines → Back → Esc, with the totals equal to the bar at each level. */
async function drill(page: Page, bar: Locator, totalTestId: string, lineTotalTestId: string) {
  const expected = await barValue(bar);
  const value = (await bar.getAttribute("data-drill"))!;
  await bar.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const documents = dialog.getByTestId("drill-documents");
  await expect(documents).toBeVisible();
  expect(
    Math.abs(aedNumber((await dialog.getByTestId(totalTestId).textContent()) ?? "") - expected),
  ).toBeLessThanOrEqual(1);
  const totals = aedNumber(
    (await documents.getByTestId("data-table-totals").locator("td").last().textContent()) ?? "",
  );
  expect(Math.abs(totals - expected)).toBeLessThanOrEqual(1);

  const firstRow = documents.locator("tbody tr").first();
  const rowValue = aedNumber((await firstRow.locator("td").last().textContent()) ?? "");
  const button = firstRow.getByRole("button");
  await button.click();
  await expect(page).toHaveURL(/doc=/);
  const lines = dialog.getByTestId("drill-lines");
  const lineTotal = aedNumber((await lines.getByTestId(lineTotalTestId).textContent()) ?? "");
  expect(Math.abs(lineTotal - rowValue)).toBeLessThanOrEqual(1);
  await expect(lines.getByRole("link").first()).toHaveAttribute("href", /^\/items\//);

  await lines.getByRole("button", { name: /^Back to / }).click();
  await expect(lines).toHaveCount(0);
  await expect(page).not.toHaveURL(/doc=/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(`g[data-drill="${value}"]`).first()).toBeFocused();
}

test.describe("Purchasing", () => {
  test("the receipts trend: partial month, growth, hover by company, supplier and brand", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/purchasing");
    await waitForData(page);
    const chart = page.locator("#monthly-receipts-spend");
    await expect(chart.getByTestId("partial-marker")).toContainText(/Partial month: 1–\d{1,2} \w{3}/);
    await expect(chart.getByTestId("yoy").first()).toBeVisible();
    const bar = chart.locator("g[data-drill]").first();
    const url = page.url();
    const card = await hoverForCard(page, bar);
    await expectCardAddsUp(card, ["company", "supplier", "brand"], await barValue(bar));
    await expect(card.getByTestId("breakdown-last-year")).toHaveText(/AED/);
    expect(page.url()).toBe(url);
    expect(errors).toEqual([]);
  });

  test("a month → its receipts → one receipt's lines, with exact totals", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/purchasing");
    await waitForData(page);
    const bar = page.locator("#monthly-receipts-spend g[data-drill]").last();
    await drill(page, bar, "drill-total-receipts-spend", "drill-total-spend");
    expect(errors).toEqual([]);
  });

  test("the brand filter applies to every figure; salesperson stays disabled", async ({ page }) => {
    await page.goto("/purchasing");
    await waitForData(page);
    await expect(page.getByTestId("brand-trigger")).toBeEnabled();
    await expect(page.getByTestId("salesperson-trigger")).toBeDisabled();
    await expect(page.getByTestId("sales-filter-hint")).toHaveCount(0);
    const pending = aedNumber(await kpiFull(page, "Pending PO value"));
    const spend = aedNumber(await kpiFull(page, "Receipts spend"));

    await page.goto("/purchasing?brand=FB");
    await waitForData(page);
    await expect(page.getByTestId("period")).toContainText("brand: Fabrikam");
    await expect(page.getByTestId("brand-trigger")).toContainText("Fabrikam");
    const brandPending = aedNumber(await kpiFull(page, "Pending PO value"));
    const brandSpend = aedNumber(await kpiFull(page, "Receipts spend"));
    expect(brandPending).toBeGreaterThan(0);
    expect(brandPending).toBeLessThan(pending);
    expect(brandSpend).toBeGreaterThan(0);
    expect(brandSpend).toBeLessThan(spend);

    // The chart, its hover card and the drill follow the brand too.
    const chart = page.locator("#monthly-receipts-spend");
    const chartTotal = aedNumber((await chart.locator('[data-slot="card-action"]').textContent()) ?? "");
    expect(Math.abs(chartTotal - brandSpend)).toBeLessThanOrEqual(1);
    const bar = chart.locator("g[data-drill]").first();
    const card = await hoverForCard(page, bar);
    const brands = card.getByTestId("breakdown-brand");
    await expect(brands).toBeVisible();
    await expect(brands.getByTestId("slice")).toHaveText([/^Fabrikam/]);

    // A salesperson set elsewhere doesn't apply here, and the scope line says so.
    await page.goto("/purchasing?brand=FB&salesperson=S06");
    await waitForData(page);
    await expect(page.getByTestId("period")).toContainText("the salesperson filter doesn't apply here");
    expect(aedNumber(await kpiFull(page, "Pending PO value"))).toBe(brandPending);
  });
});

test.describe("Sales orders", () => {
  test("the booked trend: partial month, growth, hover by company, salesperson and brand", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/sales-orders");
    await waitForData(page);
    const chart = page.locator("#monthly-orders-booked");
    await expect(chart.getByTestId("partial-marker")).toBeVisible();
    await expect(chart.getByTestId("yoy").first()).toBeVisible();
    const bar = chart.locator("g[data-drill]").first();
    const card = await hoverForCard(page, bar);
    await expectCardAddsUp(card, ["company", "salesperson", "brand"], await barValue(bar));
    expect(errors).toEqual([]);
  });

  test("a booked month → its orders → one order's lines", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/sales-orders");
    await waitForData(page);
    const bar = page.locator("#monthly-orders-booked g[data-drill]").nth(2);
    await drill(page, bar, "drill-total-booked", "drill-total-booked");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("an order-age column: hover by company and salesperson, no last year; click lists its orders", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/sales-orders?since=all");
    await waitForData(page);
    const chart = page.locator("#open-value-by-order-age");
    const column = chart.locator("g[data-drill]").first();
    const card = await hoverForCard(page, column);
    await expectCardAddsUp(card, ["company", "salesperson"], await barValue(column));
    await expect(card.getByTestId("breakdown-last-year")).toHaveCount(0);

    await drill(page, column, "drill-total-open-value", "drill-total-open-value");
    expect(errors).toEqual([]);
  });

  test("the order-age drill follows ?since and survives a reload", async ({ page }) => {
    await page.goto("/sales-orders?since=all");
    await waitForData(page);
    const column = page.locator("#open-value-by-order-age g[data-drill]").last();
    const value = (await column.getAttribute("data-drill"))!;
    const expected = await barValue(column);
    await page.goto(`/sales-orders?since=all&bucket=${value}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(
      Math.abs(
        aedNumber((await dialog.getByTestId("drill-total-open-value").textContent()) ?? "") - expected,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(dialog.getByTestId("drill-documents").getByRole("link").first()).toHaveAttribute(
      "href",
      /^\/customers\//,
    );
  });

  test("the booked KPIs compare with last year and have a sparkline", async ({ page }) => {
    await page.goto("/sales-orders");
    await waitForData(page);
    const kpis = page.getByTestId("sales-order-kpis");
    for (const label of ["Orders booked", "Booked value", "Average order"]) {
      const kpi = kpis.getByTestId("kpi-card").filter({ has: page.getByText(label, { exact: true }) });
      await expect(kpi.getByText(/^vs /)).toBeVisible();
      await expect(kpi.locator('linearGradient[id^="spark-"]')).toHaveCount(1);
    }
  });
});

test("the item page's trends: partial month, growth and hover by company", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/items/IT00065");
  await waitForData(page);
  for (const [id, sections] of [
    ["#monthly-units-sold", ["company"]],
    ["#monthly-net-revenue", ["company"]],
  ] as const) {
    const chart = page.locator(id);
    await expect(chart.getByTestId("partial-marker")).toBeVisible();
    await expect(chart.getByTestId("yoy").first()).toBeVisible();
    const card = await hoverForCard(page, chart.locator(".recharts-bar-rectangle").first());
    for (const section of sections) await expect(card.getByTestId(`breakdown-${section}`)).toBeVisible();
    const total = Number(
      ((await card.getByTestId("breakdown-total").textContent()) ?? "").replace(/[^\d.-]/g, ""),
    );
    expect(Math.abs((await sliceTotal(card.getByTestId("breakdown-company"))) - total)).toBeLessThan(1);
  }
  expect(errors).toEqual([]);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const [path, chartId, button] of [
    ["/purchasing", "#monthly-receipts-spend", "List its receipts"],
    ["/sales-orders", "#monthly-orders-booked", "List its orders"],
    ["/sales-orders", "#open-value-by-order-age", "List its orders"],
  ] as const) {
    test(`${path} ${chartId}: a tap opens the sheet, its button the drill; no sideways scroll`, async ({
      page,
    }) => {
      await page.goto(path);
      await waitForData(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const bar = page.locator(`${chartId} .recharts-bar-rectangle`).first();
      const sheet = page.getByTestId("breakdown-sheet");
      await expect(async () => {
        if (!(await sheet.isVisible())) await bar.click();
        await expect(sheet).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await expect(sheet.getByTestId("breakdown-company")).toBeVisible();
      const results = await new AxeBuilder({ page }).include("[data-testid=breakdown-sheet]").analyze();
      expect(
        results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
      ).toEqual([]);
      await sheet.getByRole("button", { name: button }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByRole("dialog").getByTestId("drill-documents")).toBeVisible();
    });
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: Purchasing and Sales orders with the drill open (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    for (const path of ["/purchasing", "/sales-orders?bucket=1"]) {
      await page.goto(path);
      await waitForData(page);
      if (path === "/purchasing") await page.locator("#monthly-receipts-spend g[data-drill]").first().click();
      await expect(page.getByRole("dialog").getByTestId("drill-documents")).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
        path,
      ).toEqual([]);
    }
  });
}
