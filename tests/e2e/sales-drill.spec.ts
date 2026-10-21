import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { aedNumber, kpiFull, waitForData, watchConsole } from "./helpers";

/** The month bars that open the drill-down (months with sales). */
function bars(page: Page) {
  return page.locator("g[data-drill]");
}

/** "Oct 2026: AED 1,234,567. List its documents" → "AED 1,234,567". */
async function barValue(page: Page, month: string): Promise<string> {
  const label = (await page.locator(`g[data-drill="${month}"]`).getAttribute("aria-label")) ?? "";
  return label.split(": ")[1].split(". ")[0];
}

test("a month bar → its documents → one document's lines → Back, with exact totals", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/sales");
  await waitForData(page);
  const bar = bars(page).last();
  const month = (await bar.getAttribute("data-drill"))!;
  const expected = await barValue(page, month);
  await bar.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`drill=${month}`));
  await expect(dialog.getByTestId("drill-total-net-revenue")).toHaveText(expected);
  const documents = dialog.getByTestId("drill-documents");
  const totalsRow = documents.getByTestId("data-table-totals");
  await expect(totalsRow).toContainText(expected);

  // The first (largest) document: its lines add up to its net value.
  const firstRow = documents.locator("tbody tr").first();
  const docValue = (await firstRow.locator("td").nth(5).textContent())!;
  const docButton = firstRow.getByRole("button");
  const docLabel = (await docButton.textContent())!;
  await docButton.click();
  const lines = dialog.getByTestId("drill-lines");
  await expect(lines.getByTestId("drill-document-title")).toContainText(docLabel);
  await expect(page).toHaveURL(/doc=/);
  await expect(lines.getByTestId("drill-total-net-value")).toHaveText(docValue);
  await expect(lines.getByTestId("data-table-totals")).toContainText(docValue);
  expect(await lines.locator("tbody tr").count()).toBeGreaterThan(0);
  await expect(lines.getByRole("link").first()).toHaveAttribute("href", /^\/items\//);

  await lines.getByRole("button", { name: "Back to documents" }).click();
  await expect(lines).toHaveCount(0);
  await expect(documents).toBeVisible();
  await expect(documents.getByRole("button", { name: docLabel }).first()).toBeFocused();
  await expect(page).not.toHaveURL(/doc=/);

  // Esc closes it and focus returns to the bar.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/drill=/);
  await expect(bar).toBeFocused();
  expect(errors).toEqual([]);
});

test("the open drill-down survives a reload", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  const month = (await bars(page).first().getAttribute("data-drill"))!;
  const expected = await barValue(page, month);
  await page.goto(`/sales?drill=${month}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("drill-total-net-revenue")).toHaveText(expected);
  // The sidebar doesn't carry the drill to other pages.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Inventory" })).toHaveAttribute("href", "/inventory");
});

test("the month → week → day table reconciles to the KPIs and drills from a day", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/sales");
  await waitForData(page);
  const table = page.getByTestId("sales-calendar");
  const total = table.getByTestId("calendar-total");
  const netRevenue = aedNumber((await total.locator("td").nth(3).textContent())!);
  expect(Math.abs(netRevenue - aedNumber(await kpiFull(page, "Net revenue")))).toBeLessThan(1);
  const invoices = Number((await total.locator("td").nth(2).textContent())!.replace(/\D/g, ""));
  expect(invoices).toBe(Number((await kpiFull(page, "Invoices")).replace(/\D/g, "")));

  // Expand the first month, then its first week: a row for every day, sales or not.
  const firstMonth = table.getByTestId("calendar-month").first();
  await firstMonth.getByRole("button", { name: /^Expand/ }).click();
  await expect(firstMonth.getByRole("button", { name: /^Collapse/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const firstWeek = table.getByTestId("calendar-week").first();
  await firstWeek.getByRole("button", { name: /^Expand/ }).click();
  const days = table.getByTestId("calendar-day");
  const dayCount = await days.count();
  expect(dayCount).toBeGreaterThan(0);
  expect(dayCount).toBeLessThanOrEqual(7);

  // A day with sales opens its documents, and the dialog totals match the row.
  const weekButtons = table.getByTestId("calendar-week").getByRole("button", { name: /^Expand/ });
  for (let index = 0; index < 5 && (await weekButtons.count()) > 0; index++) {
    await weekButtons.first().click();
  }
  const sellingDay = days.filter({ hasNot: page.locator("td:nth-child(3)", { hasText: /^0$/ }) }).first();
  const dayValue = (await sellingDay.locator("td").nth(3).textContent())!;
  await sellingDay.locator("button[data-drill]").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("drill-total-net-revenue")).toHaveText(dayValue);
  await page.keyboard.press("Escape");
  await expect(sellingDay.locator("button[data-drill]")).toBeFocused();
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: the open drill-down has no serious or critical violations (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/sales");
    await waitForData(page);
    await bars(page).last().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("drill-documents")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious.map((violation) => violation.id)).toEqual([]);
  });
}

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the dialog is a full-screen sheet and the table scrolls inside its card", async ({ page }) => {
    await page.goto("/sales");
    await waitForData(page);
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    const table = page.getByTestId("sales-calendar");
    const scroller = table.locator('[data-slot="table-container"]');
    expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

    await table.locator("button[data-drill]").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("drill-documents")).toBeVisible();
    await expect
      .poll(async () => {
        const box = (await dialog.boundingBox())!;
        return [Math.round(box.x), Math.round(box.width), Math.round(box.y), Math.round(box.height)];
      })
      .toEqual([0, 390, 0, 844]);
    // Focus stays inside the dialog.
    for (let index = 0; index < 15; index++) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
