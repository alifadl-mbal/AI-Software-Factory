import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { aedNumber, kpiFull, waitForData, watchConsole } from "./helpers";

// In the sample data, customer C0034 (Summit Hotel 34) has sales, open AR and open AED orders under
// the same code, as every customer does on Orion.
const CODE = "C0034";
const NAME = "Summit Hotel 34";

/** The full figure in a section card's header (its total). */
async function cardTotal(page: Page, title: string): Promise<number> {
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: title }) });
  return aedNumber((await card.locator('[data-slot="card-action"]').textContent()) ?? "");
}

test("search → customer page → back, by keyboard, keeping the filters", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/sales?range=12m&company=101,104");
  await waitForData(page);

  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search customers" });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("combobox", { name: "Customer or item name, or code" });
  await expect(input).toBeFocused();
  await input.pressSequentially("summit hotel 3");
  await expect(dialog.getByTestId("search-result").first()).toContainText(NAME);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/customers/${CODE}\\?range=12m&company=101,104$`));
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(page.getByTestId("period")).toContainText("2 companies");
  await waitForData(page);

  await page.goBack();
  await expect(page).toHaveURL(/\/sales\?range=12m&company=101,104$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sales" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("short or unmatched searches say so; Escape closes", async ({ page }) => {
  await page.goto("/");
  await waitForData(page);
  await page.getByTestId("search-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Search customers" });
  const input = dialog.getByRole("combobox");
  await input.fill("s");
  await expect(dialog).toContainText("Type at least 2 characters");
  await input.fill("zzzz nobody");
  await expect(dialog).toContainText("No customer or item matches “zzzz nobody”");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("every KPI adds up to its breakdowns", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/customers/${CODE}?range=12m`);
  await waitForData(page);
  await expect(page.getByTestId("kpi-card")).toHaveCount(5);
  await expect(page.getByTestId("customer-profile")).toContainText("Credit limit");

  const revenue = aedNumber(await kpiFull(page, "Net revenue"));
  expect(revenue).not.toBe(0);
  expect(Math.abs((await cardTotal(page, "Monthly net revenue")) - revenue)).toBeLessThanOrEqual(1);
  expect(Math.abs((await cardTotal(page, "Top items bought")) - revenue)).toBeLessThanOrEqual(1);

  const ar = aedNumber(await kpiFull(page, "AR outstanding"));
  expect(ar).not.toBe(0);
  expect(Math.abs((await cardTotal(page, "AR aging")) - ar)).toBeLessThanOrEqual(1);

  const open = aedNumber(await kpiFull(page, "Open order value"));
  expect(open).toBeGreaterThan(0);
  expect(Math.abs((await cardTotal(page, "Open sales-order lines")) - open)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("customer names in the dashboard tables open the right page", async ({ page }) => {
  // Receivables: grouped by customer code, so every named row links.
  await page.goto("/receivables-payables?company=101");
  await waitForData(page);
  const arTable = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Top customers by balance" }),
  });
  const arRow = arTable
    .locator("tbody tr")
    .filter({ has: page.locator("a") })
    .first();
  const arLink = arRow.locator("a");
  const arName = (await arLink.textContent())!;
  const arBalance = aedNumber((await arRow.locator("td").nth(1).textContent())!);
  await arLink.click();
  await expect(page).toHaveURL(/\/customers\/C\d{4}\?company=101$/);
  await expect(page.getByRole("heading", { level: 1, name: arName })).toBeVisible();
  await waitForData(page);
  // The customer's AR equals their row on the Receivables page.
  expect(aedNumber(await kpiFull(page, "AR outstanding"))).toBe(arBalance);

  // Sales: grouped by name; each sample name has one code.
  await page.goto("/sales?range=12m");
  await waitForData(page);
  const salesTable = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Top customers" }),
  });
  const salesRow = salesTable
    .locator("tbody tr")
    .filter({ has: page.locator("a") })
    .first();
  const salesLink = salesRow.locator("a");
  const salesName = (await salesLink.textContent())!;
  const salesRevenue = aedNumber((await salesRow.locator("td").nth(1).textContent())!);
  await salesLink.click();
  await expect(page).toHaveURL(/\/customers\/C\d{4}\?range=12m$/);
  await expect(page.getByRole("heading", { level: 1, name: salesName })).toBeVisible();
  await waitForData(page);
  expect(aedNumber(await kpiFull(page, "Net revenue"))).toBe(salesRevenue);

  // Sales orders: the top-customers table and the open lines both link.
  await page.goto("/sales-orders");
  await waitForData(page);
  await expect(page.getByTestId("open-lines-table").locator("tbody a").first()).toHaveAttribute(
    "href",
    /^\/customers\/C\d{4}$/,
  );
  const soTable = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Top customers by open value" }),
  });
  await expect(soTable.locator("tbody a").first()).toHaveAttribute("href", /^\/customers\/C\d{4}$/);
  // "All other" is never a link.
  await expect(soTable.locator("tbody a", { hasText: "All other" })).toHaveCount(0);
});

test("an unknown code shows a friendly not-found state", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/customers/NOPE123");
  await expect(page.getByTestId("customer-not-found")).toBeVisible();
  await expect(page.getByTestId("empty-state")).toContainText("Customer not found");
  await expect(page.getByTestId("error-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a customer with nothing in the period shows empty states", async ({ page }) => {
  await page.goto(`/customers/${CODE}?range=custom&from=2001-01-01&to=2001-01-31`);
  await waitForData(page);
  await expect(page.getByText("This customer bought nothing in this period.")).toBeVisible();
  await expect(page.getByText("This customer returned nothing in this period.")).toBeVisible();
});

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the customer page and search fit without sideways scrolling", async ({ page }) => {
    await page.goto(`/customers/${CODE}`);
    await waitForData(page);
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Search customers" }).click();
    await page.getByRole("combobox", { name: "Customer or item name, or code" }).fill("summit");
    await expect(page.getByTestId("search-result").first()).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: customer page and search dialog (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/customers/${CODE}`);
    await waitForData(page);
    await page.getByTestId("search-trigger").click();
    await page.getByRole("combobox", { name: "Customer or item name, or code" }).fill("summit");
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
