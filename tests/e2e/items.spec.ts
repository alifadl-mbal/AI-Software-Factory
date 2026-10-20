import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { aedNumber, kpiFull, waitForData, watchConsole } from "./helpers";

// In the sample data, item IT00065 has sales, stock, month-end history, pending POs and open orders
// under the same code, and is at or below its reorder level at one location.
const CODE = "IT00065";
const NAME = "Sample item 065";
// Stock but no sales, and a code with characters that need encoding in a URL.
const ODD_CODE = "BLT/100 #2";
const ODD_NAME = "M10 bolt & nut 100% steel";

/** The figure in a section card's header (its total), as a number. */
async function cardTotal(page: Page, title: string): Promise<number> {
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  return aedNumber((await card.locator('[data-slot="card-action"]').textContent()) ?? "");
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

test("search → item page → linked customer page, keeping the filters", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/inventory?range=12m");
  await waitForData(page);

  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search customers and items" });
  const input = dialog.getByRole("combobox", { name: "Customer or item name, or code" });
  await expect(input).toBeFocused();
  // Part of the description; items have their own group.
  await input.pressSequentially("item 065");
  const items = dialog.getByTestId("search-group-item");
  await expect(items.getByTestId("search-result").first()).toContainText(NAME);
  await expect(dialog.getByTestId("search-group-customer")).toHaveCount(0);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/items/${CODE}\\?range=12m$`));
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(page.getByTestId("reorder-badge")).toBeVisible();
  await waitForData(page);

  const customers = page.getByTestId("item-top-customers");
  const link = customers.locator("tbody a").first();
  const customer = (await link.textContent())!;
  await link.click();
  await expect(page).toHaveURL(/\/customers\/C\d{4}\?range=12m$/);
  await expect(page.getByRole("heading", { level: 1, name: customer })).toBeVisible();
  await waitForData(page);
  expect(errors).toEqual([]);
});

test("customers and items show in separate groups", async ({ page }) => {
  await page.goto("/");
  await waitForData(page);
  await page.getByTestId("search-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Search customers and items" });
  // "C00" is in customer codes; "Sample item 1…" descriptions don't match, so add an item query too.
  await dialog.getByRole("combobox").fill("00");
  await expect(
    dialog.getByTestId("search-group-customer").getByTestId("search-result").first(),
  ).toBeVisible();
  await expect(dialog.getByTestId("search-group-item").getByTestId("search-result").first()).toBeVisible();
  await expect(dialog.getByText("Customers", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Items", { exact: true })).toBeVisible();
});

test("every KPI adds up to its breakdowns", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/items/${CODE}?range=12m`);
  await waitForData(page);
  await expect(page.getByTestId("kpi-card")).toHaveCount(10);
  await expect(page.getByTestId("item-planning")).toContainText("reorder at");

  const units = aedNumber(await kpiFull(page, "Units sold"));
  expect(units).not.toBe(0);
  near(await cardTotal(page, "Monthly units sold"), units);
  near(await cardTotal(page, "Top customers"), aedNumber(await kpiFull(page, "Net revenue")));
  near(await cardTotal(page, "Monthly net revenue"), aedNumber(await kpiFull(page, "Net revenue")));

  const onHand = aedNumber(await kpiFull(page, "Stock on hand"));
  const available = aedNumber(await kpiFull(page, "Available"));
  const reserved = aedNumber(await kpiFull(page, "Reserved"));
  near(available + reserved, onHand);
  const stockTotals = page.getByTestId("item-stock").locator("tfoot td");
  near(aedNumber((await stockTotals.nth(2).textContent())!), onHand);

  near(await cardTotal(page, "Pending PO lines"), aedNumber(await kpiFull(page, "On order (POs)")));
  near(
    await cardTotal(page, "Open sales-order lines"),
    aedNumber(await kpiFull(page, "Customer orders to deliver")),
  );

  // Months of cover = available ÷ average monthly units, as the card's hint says.
  const average = aedNumber(await kpiFull(page, "Avg monthly units"));
  const cover = aedNumber(await kpiFull(page, "Months of cover"));
  expect(average).toBeGreaterThan(0);
  expect(Math.abs(cover - available / average)).toBeLessThanOrEqual(0.05);
  expect(errors).toEqual([]);
});

test("an item with stock but no sales has no months of cover; odd codes open", async ({ page }) => {
  await page.goto(`/items/${encodeURIComponent(ODD_CODE)}`);
  await expect(page.getByRole("heading", { level: 1, name: ODD_NAME })).toBeVisible();
  await waitForData(page);
  const cover = page.getByTestId("kpi-card").filter({ hasText: "Months of cover" });
  await expect(cover.getByTestId("kpi-value")).toHaveText("No recent sales");
  await expect(page.getByText("Nobody bought this item in this period.")).toBeVisible();
  await expect(
    page.getByText("This item sold nothing in this period or the same period last year.").first(),
  ).toBeVisible();
});

test("item names in the dashboard tables open the right page", async ({ page }) => {
  // Sales: grouped by name; each sample name has one code. Revenue equals the item's row.
  await page.goto("/sales?range=12m");
  await waitForData(page);
  const table = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: "Top items" }) });
  const row = table
    .locator("tbody tr")
    .filter({ has: page.locator("a") })
    .first();
  const link = row.locator("a");
  const name = (await link.textContent())!;
  const revenue = aedNumber((await row.locator("td").nth(1).textContent())!);
  await link.click();
  await expect(page).toHaveURL(/\/items\/IT\d{5}\?range=12m$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await waitForData(page);
  expect(aedNumber(await kpiFull(page, "Net revenue"))).toBe(revenue);

  // Inventory: the reorder alert's item shows the reorder badge; dead stock links too.
  await page.goto("/inventory");
  await waitForData(page);
  await expect(page.locator("#dead-and-slow-stock tbody a").first()).toHaveAttribute(
    "href",
    /^\/items\/[^?]+$/,
  );
  const alert = page.locator("#reorder-alerts tbody a").first();
  const alertName = (await alert.textContent())!;
  await alert.click();
  await expect(page.getByRole("heading", { level: 1, name: alertName })).toBeVisible();
  await expect(page.getByTestId("reorder-badge")).toBeVisible();

  // Purchasing and Sales orders: the line tables link by item code.
  await page.goto("/purchasing");
  await waitForData(page);
  await expect(page.getByTestId("overdue-table").locator("tbody a").first()).toHaveAttribute(
    "href",
    /^\/items\//,
  );
  await page.goto("/sales-orders");
  await waitForData(page);
  await expect(
    page.getByTestId("open-lines-table").locator('tbody a[href^="/items/"]').first(),
  ).toBeVisible();
});

test("an unknown code shows a friendly not-found state", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/items/NOPE123");
  await expect(page.getByTestId("item-not-found")).toBeVisible();
  await expect(page.getByTestId("empty-state")).toContainText("Item not found");
  await expect(page.getByTestId("error-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the item page fits without sideways scrolling", async ({ page }) => {
    await page.goto(`/items/${CODE}`);
    await waitForData(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: item page and search dialog (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/items/${CODE}`);
    await waitForData(page);
    await page.getByTestId("search-trigger").click();
    await page.getByRole("combobox", { name: "Customer or item name, or code" }).fill("item 06");
    await expect(page.getByTestId("search-result").first()).toBeVisible();
    for (const scope of ["page with dialog", "page"]) {
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );
      expect(
        serious.map(
          (violation) =>
            `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
        ),
        scope,
      ).toEqual([]);
      await page.keyboard.press("Escape");
    }
  });
}
