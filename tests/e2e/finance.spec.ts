import { expect, test, type Page } from "@playwright/test";

import { kpiFull, waitForData, watchConsole } from "./helpers";

/** The "This period" figure of one statement row, in full. */
function statementCell(page: Page, rowId: string) {
  return page.getByTestId(`pnl-row-${rowId}`).locator("td").nth(1);
}

test("Finance is in the nav and on the overview, and keeps the filters", async ({ page }) => {
  await page.goto("/?range=qtd");
  await waitForData(page);
  await expect(page.getByRole("link", { name: "Finance", exact: true })).toBeVisible();
  const card = page.getByTestId("dashboard-link-finance");
  await expect(card).toContainText("ZF_F_T_DETAIL_BI");
  await card.click();
  await expect(page).toHaveURL(/\/finance\?range=qtd/);
  await expect(page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible();
});

test("the P&L statement agrees with the KPI cards", async ({ page }) => {
  await page.goto("/finance");
  await waitForData(page);
  await expect(statementCell(page, "revenue")).toHaveText(await kpiFull(page, "Revenue"));
  await expect(statementCell(page, "cost-of-sales")).toHaveText(await kpiFull(page, "Cost of sales"));
  await expect(statementCell(page, "gross-profit")).toHaveText(await kpiFull(page, "Gross profit"));
  await expect(statementCell(page, "net-profit")).toHaveText(await kpiFull(page, "Net profit"));
  // Costs are shown as positive amounts.
  expect(await kpiFull(page, "Cost of sales")).toMatch(/^AED [1-9]/);
  expect(await kpiFull(page, "G&A expenses")).toMatch(/^AED [1-9]/);
});

test("unmapped accounts show a visible total, and only when non-zero", async ({ page }) => {
  // The sample data posts to an unmapped account in company 103 only, from February.
  const year = new Date().getFullYear();
  await page.goto(`/finance?range=custom&from=${year}-03-01&to=${year}-03-31&company=103`);
  await waitForData(page);
  await expect(page.getByTestId("unmapped-total")).toContainText("Unmapped accounts: -AED");
  const row = page.getByTestId("pnl-row-unmapped");
  await expect(row).toContainText("Unmapped");
  await row.getByRole("button").click();
  await expect(page.getByTestId("pnl-account").filter({ hasText: "49001" })).toBeVisible();

  await page.goto(`/finance?range=custom&from=${year}-03-01&to=${year}-03-31&company=101`);
  await waitForData(page);
  await expect(page.getByTestId("kpi-card")).toHaveCount(7);
  await expect(page.getByTestId("unmapped-total")).toHaveCount(0);
  await expect(page.getByTestId("pnl-row-unmapped")).toHaveCount(0);
});

test("a filter change updates the figures", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/finance");
  await waitForData(page);
  const ytdRevenue = await kpiFull(page, "Revenue");
  const ytdProfit = await kpiFull(page, "Net profit");

  await page.getByTestId("date-range-trigger").click();
  await page.getByRole("button", { name: "Month to date" }).click();
  await expect(page).toHaveURL(/\/finance\?range=mtd/);
  await waitForData(page);
  await expect.poll(() => kpiFull(page, "Revenue")).not.toBe(ytdRevenue);
  expect(await kpiFull(page, "Net profit")).not.toBe(ytdProfit);
  const mtdRevenue = await kpiFull(page, "Revenue");
  await expect(statementCell(page, "revenue")).toHaveText(mtdRevenue);

  await page.getByTestId("company-trigger").click();
  await page.getByPlaceholder("Search companies…").fill("Sample Trading");
  await page.getByRole("option", { name: /Sample Trading/ }).click();
  await expect(page).toHaveURL(/[?&]company=101/);
  await page.keyboard.press("Escape");
  await waitForData(page);
  await expect.poll(() => kpiFull(page, "Revenue")).not.toBe(mtdRevenue);
  await expect(statementCell(page, "revenue")).toHaveText(await kpiFull(page, "Revenue"));
  expect(errors).toEqual([]);
});

test("clicking an account opens its journal lines in a side panel", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/finance");
  await waitForData(page);
  const group = page.getByTestId("pnl-row-general-and-admin-expenses").getByRole("button");
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  const account = page.getByTestId("pnl-account").filter({ hasText: "40809" });
  await account.click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: /40809 · Salaries/ })).toBeVisible();
  const table = drawer.getByTestId("data-table");
  await expect(table).toBeVisible();
  await expect(table.locator("thead")).toContainText("Doc ref");
  expect(await table.locator("tbody tr").count()).toBeGreaterThan(1);
  // Unposted (CYU) lines never show.
  await expect(drawer).not.toContainText("unposted");

  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the drill-down caps at 500 lines with a note", async ({ page }) => {
  // 24 months of payroll across every company and department is well over 500 lines.
  const year = new Date().getFullYear();
  await page.goto(`/finance?range=custom&from=${year - 1}-01-01&to=${year}-12-31`);
  await waitForData(page);
  await page.getByTestId("pnl-row-general-and-admin-expenses").getByRole("button").click();
  await page.getByTestId("pnl-account").filter({ hasText: "40809" }).click();
  const note = page.getByRole("dialog").getByTestId("journal-cap-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("newest 500 of");
});

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the statement scrolls inside its card and the drill-down fits the screen", async ({ page }) => {
    await page.goto("/finance");
    await waitForData(page);
    await page.getByTestId("pnl-row-revenue").getByRole("button").click();
    await page.getByTestId("pnl-account").first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByTestId("data-table")).toBeVisible();
    const box = (await drawer.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await drawer.getByRole("button", { name: "Close" }).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
