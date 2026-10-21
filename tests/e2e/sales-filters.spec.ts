import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { kpiFull, waitForData, watchConsole } from "./helpers";

// The salesperson and brand filters, the scope line under the title and the company identity in the
// sidebar, against the sample data (data/sample: salesperson codes S01–S07, brands from
// ZF_STK_SO_PO_SL_BI.csv). The shared checks in app.spec.ts cover the pages themselves.

async function pick(page: Page, testId: "salesperson" | "brand", name: string) {
  await page.getByTestId(`${testId}-trigger`).click();
  await expect(page.getByTestId(`${testId}-count`)).toHaveText(/^\d+ of \d+$/);
  await page.getByRole("button", { name: "None", exact: true }).click();
  await page
    .getByRole("combobox", { name: `Search ${testId === "brand" ? "brands" : "salespeople"}` })
    .fill(name);
  await page.getByRole("option", { name }).click();
  await expect(page.getByTestId(`${testId}-count`)).toHaveText(/^1 of \d+$/);
  await page.getByTestId(`${testId}-apply`).click();
}

test("picking a salesperson changes the URL, the scope line and every figure", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/sales");
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText("all salespeople · all brands");
  const allRevenue = await kpiFull(page, "Net revenue");

  await pick(page, "salesperson", "Priya Nair");
  await expect(page).toHaveURL(/[?&]salesperson=S06(&|$)/);
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText("salesperson: Priya Nair · all brands");
  await expect.poll(() => kpiFull(page, "Net revenue")).not.toBe(allRevenue);
  const revenue = await kpiFull(page, "Net revenue");
  // KPIs still equal their breakdowns.
  for (const table of await page.getByTestId("data-table").all()) {
    await expect(table.locator("tfoot td").nth(1)).toHaveText(revenue);
  }
  await expect(page.getByTestId("salesperson-trigger")).toContainText("Priya Nair");

  // Reload keeps it, back removes it.
  await page.reload();
  await waitForData(page);
  expect(await kpiFull(page, "Net revenue")).toBe(revenue);
  await page.goBack();
  await expect(page).not.toHaveURL(/salesperson=/);
  await waitForData(page);
  await expect.poll(() => kpiFull(page, "Net revenue")).toBe(allRevenue);
  expect(errors).toEqual([]);
});

test("a brand narrows the sales and can be cleared with All", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  await expect(page.getByRole("heading", { name: "Revenue by brand" })).toBeVisible();
  const allRevenue = await kpiFull(page, "Net revenue");

  await pick(page, "brand", "Northwind");
  await expect(page).toHaveURL(/[?&]brand=NW(&|$)/);
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText("brand: Northwind");
  await expect.poll(() => kpiFull(page, "Net revenue")).not.toBe(allRevenue);

  await page.getByTestId("brand-trigger").click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByTestId("brand-apply").click();
  await expect(page).not.toHaveURL(/brand=/);
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText("all brands");
  await expect.poll(() => kpiFull(page, "Net revenue")).toBe(allRevenue);
});

test("sales orders follow the salesperson filter", async ({ page }) => {
  await page.goto("/sales-orders");
  await waitForData(page);
  const all = await kpiFull(page, "Open order value");
  await page.goto("/sales-orders?salesperson=S06");
  await waitForData(page);
  expect(await kpiFull(page, "Open order value")).not.toBe(all);
  await expect(page.getByTestId("salesperson-trigger")).toBeEnabled();
  await expect(page.locator("main")).not.toContainText("follows only the company filter");
  await expect(page.locator("main")).toContainText("follows the company, salesperson and brand filters");
});

test("customer and item pages say open orders follow the salesperson filter", async ({ page }) => {
  for (const path of ["/customers/C0034?salesperson=S06", "/items/IT00065?salesperson=S06"]) {
    await page.goto(path);
    await waitForData(page);
    await expect(page.getByTestId("period")).toContainText("(sales and open orders only)");
    await expect(page.locator("main")).toContainText(
      "open orders follow the company, salesperson and brand filters",
    );
  }
});

test("pages without salesperson or brand show the filters disabled and say an active one doesn't apply", async ({
  page,
}) => {
  await page.goto("/finance");
  await waitForData(page);
  await expect(page.getByTestId("salesperson-trigger")).toBeDisabled();
  await expect(page.getByTestId("brand-trigger")).toBeDisabled();
  await expect(page.getByTestId("sales-filter-hint")).toHaveText("No salesperson or brand here");
  await expect(page.getByTestId("period")).not.toContainText("salespeople");

  await page.goto("/inventory?salesperson=S06");
  await waitForData(page);
  await expect(page.getByTestId("sales-filter-hint")).toHaveText("Salesperson and brand don't apply here");
  await expect(page.getByTestId("period")).toContainText(
    "the salesperson and brand filters don't apply here",
  );
});

test("the Overview applies them to its sales figures only, and says so", async ({ page }) => {
  await page.goto("/?salesperson=S06");
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText("(sales figures only)");
  // The margin and the leader come from the ledger: never attached to the filtered revenue.
  const summary = page.getByTestId("overview-summary");
  await expect(summary).toHaveText(/^Year to date, net revenue was AED /);
  await expect(summary).toContainText(". Across all salespeople and brands, the business made ");
  await expect(summary).not.toContainText("at a ");
});

test("one company shows its name and a monogram; several show MBAL BI", async ({ page }) => {
  await page.goto("/sales?company=101");
  await expect(page.getByTestId("company-identity-name")).toHaveText("Sample Trading LLC");
  // No logo ships with the app, so it is the monogram badge.
  await expect(page.getByTestId("company-monogram")).toHaveText("ST");
  await page.goto("/sales?company=101,104");
  await expect(page.getByTestId("app-identity")).toContainText("MBAL BI");
  await expect(page.getByTestId("company-monogram")).toHaveCount(0);
});

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the filters live in a drawer and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/sales?salesperson=S06&brand=NW");
    await waitForData(page);
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("salesperson-trigger")).toBeHidden();
    await page.getByTestId("filters-trigger").click();
    const drawer = page.getByTestId("filters-drawer");
    await expect(drawer.getByTestId("salesperson-trigger")).toContainText("Priya Nair");
    await expect(drawer.getByTestId("brand-trigger")).toContainText("Northwind");
    await drawer.getByTestId("brand-trigger").click();
    await expect(page.getByTestId("brand-count")).toHaveText(/^1 of \d+$/);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  for (const url of ["/sales", "/?salesperson=S06", "/finance?salesperson=S06"]) {
    test(`the title and the sample badge keep their row clear of the Filters button: ${url}`, async ({
      page,
    }) => {
      await page.goto(url);
      await waitForData(page);
      const title = await page.getByTestId("page-title").boundingBox();
      expect(title!.width).toBeGreaterThan(0);
      const trigger = (await page.getByTestId("filters-trigger").boundingBox())!;
      const boxes = [title!];
      const badge = page.getByTestId("sample-badge");
      if (await badge.isVisible()) boxes.push((await badge.boundingBox())!);
      for (const box of boxes) {
        const apart =
          box.x + box.width <= trigger.x ||
          trigger.x + trigger.width <= box.x ||
          box.y + box.height <= trigger.y ||
          trigger.y + trigger.height <= box.y;
        expect(apart).toBe(true);
      }
    });
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: sales with the salesperson checklist open (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/sales?salesperson=S06");
    await waitForData(page);
    await page.getByTestId("salesperson-trigger").click();
    await expect(page.getByTestId("salesperson-count")).toHaveText(/^\d+ of \d+$/);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
}
