import { expect, test } from "@playwright/test";

import { kpiFull, waitForData, watchConsole } from "./helpers";

test("the treemap adds up to Sales net revenue", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  const revenue = await kpiFull(page, "Net revenue");
  await page.goto("/products");
  await waitForData(page);
  await expect(page.getByTestId("treemap-total")).toHaveText(revenue);
  const table = page.getByTestId("product-treemap").getByTestId("data-table");
  await expect(table.locator("tfoot td").nth(1)).toHaveText(revenue);
  await expect(table.getByRole("button", { name: "Unassigned" })).toBeVisible();
});

test("zooms into a brand and follows an item link", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/products?range=12m");
  await waitForData(page);
  await expect(page.getByTestId("yoy-legend")).toContainText("New: no sales last year");
  const breadcrumb = page.getByTestId("treemap-breadcrumb");
  await expect(breadcrumb).toHaveText("All brands");

  const brand = page.getByTestId("treemap-brand").first();
  const brandName = ((await brand.getAttribute("aria-label")) ?? "").split(":")[0];
  // Keyboard: the tiles are focusable and Enter zooms.
  await brand.focus();
  await page.keyboard.press("Enter");
  await expect(breadcrumb).toContainText(brandName);
  await expect(page.getByTestId("treemap-brand")).toHaveCount(0);

  const item = page.getByTestId("treemap-item").first();
  const itemName = ((await item.getAttribute("aria-label")) ?? "").split(":")[0];
  await item.click();
  await expect(page).toHaveURL(/\/items\/[^/?]+\?range=12m$/);
  await expect(page.getByRole("heading", { level: 1, name: itemName })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the breadcrumb and the table zoom too", async ({ page }) => {
  await page.goto("/products");
  await waitForData(page);
  const table = page.getByTestId("product-treemap").getByTestId("data-table");
  const first = table.locator("tbody tr").first().getByRole("button");
  const brandName = (await first.textContent()) ?? "";
  await first.click();
  await expect(page.getByTestId("treemap-breadcrumb")).toContainText(brandName);
  await expect(table.getByRole("columnheader", { name: "Item" })).toBeVisible();
  await page.getByTestId("treemap-breadcrumb").getByRole("button", { name: "All brands" }).click();
  await expect(page.getByTestId("treemap-breadcrumb")).toHaveText("All brands");
});

test("each watchlist states its rule and links to item pages", async ({ page }) => {
  await page.goto("/products");
  await waitForData(page);
  for (const [title, rule] of [
    ["Growers", /Largest rise .* at least AED 10K last year/],
    ["Decliners", /Largest fall .* at least AED 10K last year/],
    ["Highest discount %", /Discount as a share of gross/],
    ["Highest returns %", /Returns \(credit notes\) as a share of invoiced sales/],
  ] as const) {
    const card = page.locator(
      `#${title
        .toLowerCase()
        .replace(/[^a-z]+/g, "-")
        .replace(/-$/, "")}`,
    );
    await expect(card.getByRole("heading", { name: title })).toBeVisible();
    await expect(card).toContainText(rule);
  }
  const growers = page.getByTestId("watchlist-growers");
  await expect(growers.locator("li")).toHaveCount(10);
  await growers.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/items\//);
});

test("an empty period shows empty states", async ({ page }) => {
  await page.goto("/products?range=custom&from=2001-01-01&to=2001-01-31");
  await waitForData(page);
  await expect(page.locator("#revenue-by-brand-and-item").getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("empty-state")).toHaveCount(5);
});

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a ranked list replaces the treemap", async ({ page }) => {
    await page.goto("/products");
    await waitForData(page);
    await expect(page.getByTestId("treemap-chart")).toHaveCount(0);
    const list = page.getByTestId("mix-ranked-list");
    await list.getByRole("button").first().click();
    await expect(list.getByRole("link").first()).toBeVisible();
    await list.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/items\//);
  });
});
