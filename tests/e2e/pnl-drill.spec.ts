import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { aedNumber, waitForData, watchConsole } from "./helpers";

/** The Monthly P&L hover card and drill-down on Finance and the Overview (issue #51). */

function pnlChart(page: Page): Locator {
  return page.locator("#monthly-p-and-l");
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

async function checkCard(card: Locator) {
  await expect(card.getByTestId("breakdown-figure-revenue")).toBeVisible();
  await expect(card.getByTestId("breakdown-figure-cost-of-sales")).toBeVisible();
  await expect(card.getByTestId("breakdown-figure-general-and-admin")).toBeVisible();
  await expect(card.getByTestId("breakdown-last-year")).toHaveText(/AED/);
  const total = aedNumber((await card.getByTestId("breakdown-total").textContent()) ?? "");
  const companies = await card
    .getByTestId("breakdown-company")
    .locator("[data-value]")
    .evaluateAll((cells) => cells.map((cell) => Number(cell.getAttribute("data-value"))));
  expect(companies.length).toBeGreaterThan(0);
  expect(companies.length).toBeLessThanOrEqual(6);
  expect(Math.abs(companies.reduce((sum, value) => sum + value, 0) - total)).toBeLessThan(1);

  // Net profit = revenue − cost of sales − G&A, to the dirham.
  const figure = async (id: string) =>
    Number(
      await card.getByTestId(`breakdown-figure-${id}`).locator("[data-value]").getAttribute("data-value"),
    );
  const revenue = await figure("revenue");
  const cost = await figure("cost-of-sales");
  const admin = await figure("general-and-admin");
  expect(Math.abs(revenue - cost - admin - total)).toBeLessThan(1);
  return { total, revenue };
}

test("Finance: hovering a month bar shows its P&L against last year and its companies", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/finance");
  await waitForData(page);
  const url = page.url();
  const card = await hoverForCard(page, pnlChart(page).locator(".recharts-bar-rectangle").first());
  await checkCard(card);
  expect(page.url()).toBe(url);
  expect(errors).toEqual([]);
});

test("Finance: a month bar → P&L lines → GL accounts → journal lines, Back and Esc", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/finance");
  await waitForData(page);
  const bar = page.locator("#monthly-p-and-l g[data-drill]").first();
  const month = (await bar.getAttribute("data-drill"))!;

  // The card's figures, to reconcile with the drill-down.
  const card = await hoverForCard(page, bar);
  const { total, revenue } = await checkCard(card);

  // Keyboard: focus the bar, Enter opens the drill-down.
  await bar.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`pnl=${month}`));
  const lines = dialog.getByTestId("drill-pnl-lines");
  expect(
    Math.abs(aedNumber((await lines.getByTestId("drill-total-net-profit").textContent())!) - total),
  ).toBeLessThan(1);
  expect(
    Math.abs(aedNumber((await lines.getByTestId("drill-total-revenue").textContent())!) - revenue),
  ).toBeLessThan(1);

  // A line → its accounts, which add up to it.
  const costOfSales = (await lines.getByTestId("drill-total-cost-of-sales").textContent())!;
  await lines.getByRole("button", { name: "Cost of sales" }).click();
  await expect(page).toHaveURL(/pnlLine=cost-of-sales/);
  const accounts = dialog.getByTestId("drill-accounts");
  await expect(accounts.getByTestId("drill-total-this-period")).toHaveText(costOfSales);
  await expect(accounts.getByTestId("data-table-totals")).toContainText(costOfSales);

  // An account → its journal lines for that month.
  const account = accounts.locator("tbody button[data-row-id]").first();
  const code = (await account.getAttribute("data-row-id"))!;
  await account.click();
  await expect(page).toHaveURL(new RegExp(`pnlAccount=${code}`));
  const journal = dialog.getByTestId("drill-journal");
  await expect(journal.getByTestId("drill-account-title")).toContainText(code);
  const table = journal.getByTestId("data-table");
  await expect(table).toBeVisible();
  const dates = await table.locator("tbody tr td:first-child").allTextContents();
  expect(dates.length).toBeGreaterThan(0);
  for (const date of dates) expect(date.slice(0, 7)).toBe(month);

  // Back twice, focus on the row that was open each time.
  await journal.getByRole("button", { name: "Back to accounts" }).click();
  await expect(journal).toHaveCount(0);
  await expect(accounts.locator(`button[data-row-id="${code}"]`)).toBeFocused();
  await accounts.getByRole("button", { name: "Back to P&L lines" }).click();
  await expect(lines.locator('button[data-row-id="cost-of-sales"]')).toBeFocused();
  await expect(page).not.toHaveURL(/pnlLine=/);

  const results = await new AxeBuilder({ page }).include("[data-testid=pnl-drill]").analyze();
  expect(
    results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
  ).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/pnl=/);
  await expect(bar).toBeFocused();
  expect(errors).toEqual([]);
});

test("Finance: the drill-down follows the company filter and matches the statement", async ({ page }) => {
  const year = new Date().getFullYear();
  await page.goto(`/finance?range=custom&from=${year}-03-01&to=${year}-03-31&company=101`);
  await waitForData(page);
  const statementNet = (await page.getByTestId("pnl-row-net-profit").locator("td").nth(1).textContent())!;
  await page.goto(`/finance?range=custom&from=${year}-03-01&to=${year}-03-31&company=101&pnl=${year}-03`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("company 101");
  await expect(dialog.getByTestId("drill-total-net-profit")).toHaveText(statementNet);
});

test("Overview: the Monthly P&L shows partial months, growth and the hover card", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await waitForData(page);
  const chart = pnlChart(page);
  await expect(chart.getByTestId("partial-marker")).toBeVisible();
  await expect(chart.getByTestId("yoy").first()).toBeVisible();
  const card = await hoverForCard(page, chart.locator(".recharts-bar-rectangle").first());
  await checkCard(card);

  // Selecting a bar opens the same drill-down.
  await chart.locator("g[data-drill]").first().click();
  await expect(page.getByRole("dialog").getByTestId("drill-pnl-lines")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a tap opens the card as a bottom sheet and its button the drill-down", async ({ page }) => {
    await page.goto("/finance");
    await waitForData(page);
    const bar = pnlChart(page).locator(".recharts-bar-rectangle").first();
    const sheet = page.getByTestId("breakdown-sheet");
    await expect(async () => {
      if (!(await sheet.isVisible())) await bar.click();
      await expect(sheet).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(sheet.getByTestId("breakdown-company")).toBeVisible();
    await sheet.getByRole("button", { name: "Open its P&L" }).click();
    await expect(sheet).toHaveCount(0);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("drill-pnl-lines")).toBeVisible();
    await expect(page).toHaveURL(/pnl=/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
