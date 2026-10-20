import { expect, test, type Page } from "@playwright/test";

import { kpiFull, waitForData, watchConsole } from "./helpers";

// The shared checks in app.spec.ts (console errors, 390px, axe in both themes) cover / too through
// PAGES. These are the Overview-specific ones.

const FILTERS = "?range=qtd&company=101,102";

/** The full figure behind one Needs-attention row. */
async function attentionFull(page: Page, testId: string): Promise<string> {
  const value = page.getByTestId(testId).getByTestId("attention-value");
  return (await value.getAttribute("title")) ?? (await value.textContent()) ?? "";
}

test("every area shows real figures, with as-of-today captions", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await waitForData(page);
  for (const area of ["sales", "finance", "inventory", "purchasing", "receivables", "payables"]) {
    await expect(page.getByTestId(`overview-${area}`)).toBeVisible();
  }
  for (const value of await page.getByTestId("kpi-value").all()) {
    await expect(value).not.toHaveText(/NaN|^—?$/);
  }
  for (const area of ["inventory", "purchasing", "receivables", "payables"]) {
    await expect(page.getByTestId(`area-caption-${area}`)).toContainText("As of today");
  }
  await expect(page.getByTestId("area-caption-sales")).toContainText("same period last year");
  await expect(page.getByTestId("ap-currency-note")).toBeVisible();
  await expect(page.getByTestId("attention").getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Monthly net revenue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly P&L" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("headline figures equal the same figures on each dashboard", async ({ page }) => {
  await page.goto(`/${FILTERS}`);
  await waitForData(page);
  const overview = {
    netRevenue: await kpiFull(page, "Net revenue"),
    marginPct: await kpiFull(page, "Gross margin %"),
    netProfit: await kpiFull(page, "Net profit"),
    netMarginPct: await kpiFull(page, "Net margin %"),
    stockValue: await kpiFull(page, "Stock value"),
    stockChange: await kpiFull(page, "Change vs last month-end"),
    pendingValue: await kpiFull(page, "Pending PO value"),
    overduePct: await kpiFull(page, "Overdue %"),
    overdueValue: await attentionFull(page, "attention-overdue-po"),
    arOutstanding: await kpiFull(page, "AR outstanding"),
    arOver90: await attentionFull(page, "attention-ar-over-90"),
    apOutstanding: await kpiFull(page, "AP outstanding"),
    deadStock: await attentionFull(page, "attention-dead-stock"),
    reorder: await attentionFull(page, "attention-reorder"),
  };
  expect(overview.netRevenue).toMatch(/^AED [1-9]/);
  expect(overview.stockValue).toMatch(/^AED [1-9]/);
  expect(overview.arOutstanding).toMatch(/^AED [1-9]/);

  await page.goto(`/sales${FILTERS}`);
  await waitForData(page);
  expect(await kpiFull(page, "Net revenue")).toBe(overview.netRevenue);
  expect(await kpiFull(page, "Margin %")).toBe(overview.marginPct);

  await page.goto(`/finance${FILTERS}`);
  await waitForData(page);
  expect(await kpiFull(page, "Net profit")).toBe(overview.netProfit);
  expect(await kpiFull(page, "Net margin %")).toBe(overview.netMarginPct);

  await page.goto(`/inventory${FILTERS}`);
  await waitForData(page);
  expect(await kpiFull(page, "Stock value")).toBe(overview.stockValue);
  expect(await kpiFull(page, "Change vs last month-end")).toBe(overview.stockChange);
  await expect(page.getByTestId("dead-stock-total")).toContainText(overview.deadStock);
  await expect(page.getByTestId("reorder-count")).toContainText(`${overview.reorder} alert`);

  await page.goto(`/purchasing${FILTERS}`);
  await waitForData(page);
  expect(await kpiFull(page, "Pending PO value")).toBe(overview.pendingValue);
  expect(await kpiFull(page, "Overdue %")).toBe(overview.overduePct);
  expect(await kpiFull(page, "Overdue value")).toBe(overview.overdueValue);

  await page.goto(`/receivables-payables${FILTERS}`);
  await waitForData(page);
  expect(await kpiFull(page, "AR outstanding")).toBe(overview.arOutstanding);
  expect(await kpiFull(page, "AR over 90 days")).toBe(overview.arOver90);
  expect(await kpiFull(page, "AP outstanding")).toBe(overview.apOutstanding);
});

test("tiles link to their dashboards with the filters kept, and a reload keeps them", async ({ page }) => {
  await page.goto(`/${FILTERS}`);
  await waitForData(page);
  const revenue = await kpiFull(page, "Net revenue");
  await page.reload();
  await waitForData(page);
  expect(await kpiFull(page, "Net revenue")).toBe(revenue);
  await expect(page.getByTestId("period")).toContainText("2 companies");

  const links = {
    sales: "/sales",
    finance: "/finance",
    inventory: "/inventory",
    purchasing: "/purchasing",
    receivables: "/receivables-payables",
    payables: "/receivables-payables",
  };
  for (const [area, path] of Object.entries(links)) {
    await expect(page.getByTestId(`area-link-${area}`)).toHaveAttribute("href", `${path}${FILTERS}`);
  }
  await expect(page.getByTestId("attention-overdue-po")).toHaveAttribute(
    "href",
    `/purchasing${FILTERS}#overdue-po-lines`,
  );
  await expect(page.getByTestId("attention-ar-over-90")).toHaveAttribute(
    "href",
    `/receivables-payables${FILTERS}#ar-aging`,
  );
  await expect(page.getByTestId("attention-dead-stock")).toHaveAttribute(
    "href",
    `/inventory${FILTERS}&dead=6#dead-and-slow-stock`,
  );
  await expect(page.getByTestId("attention-reorder")).toHaveAttribute(
    "href",
    `/inventory${FILTERS}#reorder-alerts`,
  );

  await page.getByTestId("area-link-sales").click();
  await expect(page).toHaveURL(new RegExp(`/sales\\?range=qtd&company=101,102$`));
  await waitForData(page);
  expect(await kpiFull(page, "Net revenue")).toBe(revenue);
});

test("a Needs-attention link lands on its section once the page has loaded", async ({ page }) => {
  await page.goto("/");
  await waitForData(page);
  await page.getByTestId("attention-overdue-po").click();
  await expect(page).toHaveURL(/\/purchasing#overdue-po-lines$/);
  await waitForData(page);
  await expect(page.locator("#overdue-po-lines")).toBeInViewport();
});

test("the period moves the period tiles; as-of-today tiles follow only the company", async ({ page }) => {
  const asOfToday = ["Stock value", "Pending PO value", "AR outstanding", "AP outstanding"];
  const read = async () =>
    Object.fromEntries(
      await Promise.all(
        ["Net revenue", "Net profit", ...asOfToday].map(async (label) => [label, await kpiFull(page, label)]),
      ),
    );

  await page.goto("/");
  await waitForData(page);
  const ytd = await read();

  await page.goto("/?range=mtd");
  await waitForData(page);
  const mtd = await read();
  expect(mtd["Net revenue"]).not.toBe(ytd["Net revenue"]);
  expect(mtd["Net profit"]).not.toBe(ytd["Net profit"]);
  for (const label of asOfToday) expect(mtd[label], label).toBe(ytd[label]);

  await page.goto("/?range=mtd&company=101");
  await waitForData(page);
  const oneCompany = await read();
  for (const label of asOfToday) expect(oneCompany[label], label).not.toBe(mtd[label]);
});

test("keyboard focus on a tile link is visible", async ({ page }) => {
  await page.goto("/");
  await waitForData(page);
  const link = page.getByTestId("area-link-sales");
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  const ring = await link.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(ring).not.toBe("none");
});
