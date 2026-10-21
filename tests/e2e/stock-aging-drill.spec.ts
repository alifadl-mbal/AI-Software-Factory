import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { aedNumber, kpiFull, waitForData, watchConsole } from "./helpers";

/**
 * Sales-style charts on Inventory, Receivables & payables and the customer page (issue #53): the
 * hover cards, the drill-downs, and the brand (Inventory) and salesperson (AR) filters.
 */

/** Hover `target` until the card shows: the chart's listeners attach once it has hydrated. */
async function hoverForCard(page: Page, target: Locator): Promise<Locator> {
  const card = page.getByTestId("breakdown-card");
  await expect(async () => {
    await page.mouse.move(0, 0);
    await target.hover();
    await expect(card).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(card.getByRole("status")).toHaveCount(0);
  return card;
}

/** The card's total, after checking each of `sections` adds up to it. */
async function cardTotal(card: Locator, sections: string[]): Promise<number> {
  const total = aedNumber((await card.getByTestId("breakdown-total").textContent()) ?? "");
  for (const id of sections) {
    const values = await card
      .getByTestId(`breakdown-${id}`)
      .locator("[data-value]")
      .evaluateAll((cells) => cells.map((cell) => Number(cell.getAttribute("data-value"))));
    expect(values.length, id).toBeGreaterThan(0);
    expect(values.length, id).toBeLessThanOrEqual(6);
    expect(Math.abs(values.reduce((sum, value) => sum + value, 0) - total), id).toBeLessThan(1);
  }
  return total;
}

async function expectNoSeriousAxe(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).analyze();
  expect(
    results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
  ).toEqual([]);
}

function stockChart(page: Page): Locator {
  return page.locator("#month-end-stock-value");
}

test("Inventory: a month-end bar's card adds up, and its drill-down lists its items", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/inventory");
  await waitForData(page);
  const bars = stockChart(page).locator("g[data-drill]");
  const bar = bars.nth((await bars.count()) - 2);
  const month = (await bar.getAttribute("data-drill"))!;

  const url = page.url();
  const card = await hoverForCard(page, bar);
  const total = await cardTotal(card, ["company", "brand", "itemGroup"]);
  await expect(card.getByTestId("breakdown-last-year")).toHaveText(/AED/);
  expect(page.url()).toBe(url);
  // The bar's own figure is in its name.
  expect(Math.abs(aedNumber((await bar.getAttribute("aria-label"))!.split(":")[1]) - total)).toBeLessThan(1);

  // Keyboard: focus the bar, Enter opens the drill-down.
  await bar.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(page).toHaveURL(new RegExp(`stockMonth=${month}`));
  const items = dialog.getByTestId("drill-stock-items");
  await expect(items).toBeVisible();
  expect(
    Math.abs(aedNumber((await items.getByTestId("drill-total-closing-value").textContent())!) - total),
  ).toBeLessThan(1);
  await expect(items.getByTestId("data-table-totals")).toContainText(
    (await items.getByTestId("drill-total-closing-value").textContent())!,
  );
  await expectNoSeriousAxe(page, "[data-testid=stock-drill]");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/stockMonth=/);
  await expect(bar).toBeFocused();

  // A reload keeps the drill-down; an item opens its page.
  await page.goto(`/inventory?stockMonth=${month}`);
  const link = page.getByRole("dialog").getByTestId("drill-stock-items").locator("tbody a").first();
  await link.click();
  await expect(page).toHaveURL(/\/items\//);
  expect(errors).toEqual([]);
});

test("Inventory: the brand filter applies, and the salesperson filter is disabled", async ({ page }) => {
  await page.goto("/inventory");
  await waitForData(page);
  const all = aedNumber(await kpiFull(page, "Stock value"));

  await page.goto("/inventory?brand=CT");
  await waitForData(page);
  await expect(page.getByTestId("brand-trigger")).toBeEnabled();
  await expect(page.getByTestId("salesperson-trigger")).toBeDisabled();
  await expect(page.getByTestId("sales-filter-hint")).toHaveText("No salesperson here");
  await expect(page.getByTestId("period")).toContainText("brand: Contoso");
  const contoso = aedNumber(await kpiFull(page, "Stock value"));
  expect(contoso).toBeGreaterThan(0);
  expect(contoso).toBeLessThan(all);

  // The card's brand section is that one brand.
  const card = await hoverForCard(page, stockChart(page).locator("g[data-drill]").last());
  await expect(card.getByTestId("breakdown-brand").getByTestId("slice")).toHaveText([/Contoso/]);

  await page.goto("/inventory?salesperson=SM01");
  await waitForData(page);
  await expect(page.getByTestId("sales-filter-hint")).toHaveText("Salesperson doesn't apply here");
  await expect(page.getByTestId("period")).toContainText("the salesperson filter doesn't apply here");
  expect(aedNumber(await kpiFull(page, "Stock value"))).toBe(all);
});

test("Inventory: stock value is compared with the same month-end last year", async ({ page }) => {
  await page.goto("/inventory");
  await waitForData(page);
  const card = page.getByTestId("kpi-card").filter({ hasText: "Stock value" }).first();
  await expect(card).toContainText("last year");
  await expect(card).toContainText("month-end");
});

test("AR: a column's card adds up, and its drill-down → customers → open documents", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/receivables-payables");
  await waitForData(page);
  const column = page.locator("#ar-aging g[data-drill]").first();
  const drill = (await column.getAttribute("data-drill"))!;
  const card = await hoverForCard(page, column);
  const total = await cardTotal(card, ["company", "salesperson"]);
  // Balances are as of today: no last year on the card.
  await expect(card.getByTestId("breakdown-last-year")).toHaveCount(0);

  await column.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`aging=${drill}`));
  const dialog = page.getByRole("dialog");
  const accounts = dialog.getByTestId("drill-aging-accounts");
  await expect(accounts).toBeVisible();
  expect(
    Math.abs(aedNumber((await accounts.getByTestId("drill-total-outstanding").textContent())!) - total),
  ).toBeLessThan(1);
  // Every customer links to its page.
  await expect(accounts.locator("tbody a[href^='/customers/']").first()).toBeVisible();

  // A customer → its open documents in the column, adding up to its row.
  const first = accounts.locator("tbody tr").first();
  const rowTotal = (await first.locator("td").last().textContent())!;
  const button = first.locator("button[data-row-id]");
  const code = (await button.getAttribute("data-row-id"))!;
  await button.click();
  await expect(page).toHaveURL(new RegExp(`agingAccount=${code}`));
  const documents = dialog.getByTestId("drill-aging-documents");
  await expect(documents.getByTestId("drill-total-outstanding")).toHaveText(rowTotal);
  await expectNoSeriousAxe(page, "[data-testid=aging-drill]");

  await documents.getByRole("button", { name: "Back to customers" }).click();
  await expect(documents).toHaveCount(0);
  await expect(accounts.locator(`button[data-row-id="${code}"]`)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(column).toBeFocused();
  expect(errors).toEqual([]);
});

test("AP: a column's card shows companies and the top vendors, and lists its vendors", async ({ page }) => {
  await page.goto("/receivables-payables");
  await waitForData(page);
  await page.getByRole("tab", { name: "Payables (AP)" }).click();
  const column = page.locator("#ap-aging g[data-drill]").first();
  const card = await hoverForCard(page, column);
  const total = await cardTotal(card, ["company", "supplier"]);
  await column.click();
  const accounts = page.getByRole("dialog").getByTestId("drill-aging-accounts");
  expect(
    Math.abs(aedNumber((await accounts.getByTestId("drill-total-owed").textContent())!) - total),
  ).toBeLessThan(1);
  await accounts.locator("tbody button[data-row-id]").first().click();
  await expect(page.getByRole("dialog").getByTestId("drill-aging-documents")).toBeVisible();
});

test("AR: the salesperson filter applies to receivables only, with AR's own salespeople", async ({
  page,
}) => {
  await page.goto("/receivables-payables");
  await waitForData(page);
  const ar = aedNumber(await kpiFull(page, "AR outstanding"));
  const ap = await kpiFull(page, "AP outstanding");

  // The choices are the customers' salespeople on open AR.
  await expect(page.getByTestId("brand-trigger")).toBeDisabled();
  await expect(page.getByTestId("sales-filter-hint")).toHaveText("No brand here");
  await page.getByTestId("salesperson-trigger").click();
  await expect(page.getByTestId("salesperson-count")).toHaveText(/^\d+ of \d+$/);
  await page.getByRole("button", { name: "None", exact: true }).click();
  await page.getByRole("combobox", { name: "Search salespeople" }).fill("Aisha Rahman");
  await page.getByRole("option", { name: "Aisha Rahman" }).click();
  await page.getByTestId("salesperson-apply").click();
  await expect(page).toHaveURL(/[?&]salesperson=SM01(&|$)/);
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText("salesperson: Aisha Rahman (receivables only)");
  const filtered = aedNumber(await kpiFull(page, "AR outstanding"));
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(ar);
  expect(await kpiFull(page, "AP outstanding")).toBe(ap);

  // The card's salesperson section is that one salesperson.
  const card = await hoverForCard(page, page.locator("#ar-aging g[data-drill]").first());
  await expect(card.getByTestId("breakdown-salesperson").getByTestId("slice")).toHaveText([/Aisha Rahman/]);
});

test("customer page: the trend has partial months, growth and a hover; the aging has a hover", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/customers/C0026?range=12m");
  await waitForData(page);
  const trend = page.locator("#monthly-net-revenue");
  await expect(trend.getByTestId("yoy").first()).toBeVisible();
  const card = await hoverForCard(page, trend.locator(".recharts-bar-rectangle").last());
  await cardTotal(card, ["company", "itemGroup"]);

  const aging = page.locator("#ar-aging .recharts-bar-rectangle").first();
  const agingCard = await hoverForCard(page, aging);
  await cardTotal(agingCard, ["company", "salesperson"]);
  expect(errors).toEqual([]);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  // The newest month-end and the youngest AR column always hold a balance in the sample data.
  for (const { path, chart, last, button, testId } of [
    {
      path: "/inventory",
      chart: "#month-end-stock-value",
      last: true,
      button: "List its items",
      testId: "drill-stock-items",
    },
    {
      path: "/receivables-payables",
      chart: "#ar-aging",
      last: false,
      button: "List its customers",
      testId: "drill-aging-accounts",
    },
  ]) {
    test(`${path}: a tap opens the card as a bottom sheet and its button the drill-down`, async ({
      page,
    }) => {
      await page.goto(path);
      await waitForData(page);
      const bars = page.locator(`${chart} .recharts-bar-rectangle`);
      const bar = last ? bars.last() : bars.first();
      const sheet = page.getByTestId("breakdown-sheet");
      await expect(async () => {
        if (!(await sheet.isVisible())) await bar.click();
        await expect(sheet).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await expect(sheet.getByTestId("breakdown-company")).toBeVisible();
      await sheet.getByRole("button", { name: button }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByRole("dialog").getByTestId(testId)).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
