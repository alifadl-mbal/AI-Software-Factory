import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { kpiFull, waitForData, watchConsole } from "./helpers";

// The shared checks in app.spec.ts (console errors, 390px, axe in both themes) cover /inventory too
// through PAGES. These are the Inventory-specific ones.

function deadStock(page: Page) {
  return page
    .getByRole("heading", { name: "Dead and slow stock" })
    .locator("xpath=ancestor::*[@data-slot='card'][1]");
}

/** The value-at-risk figure, in AED. */
async function valueAtRisk(page: Page): Promise<number> {
  const text = (await page.getByTestId("dead-stock-total").textContent()) ?? "";
  return Number(/AED ([\d,]+)/.exec(text)?.[1].replaceAll(",", "") ?? NaN);
}

test("shows live stock as of today, with only the company filter", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText("As of today");
  await expect(page.getByTestId("date-range-trigger")).toHaveCount(0);
  await expect(page.getByTestId("company-trigger")).toBeVisible();
  await expect(page.getByTestId("kpi-card")).toHaveCount(5);
  await expect(page.getByTestId("error-card")).toHaveCount(0);
  await expect(page.getByText(/is provisional/)).toBeVisible();
  expect(await kpiFull(page, "Change vs last month-end")).toMatch(/^-?AED [\d,]+$/);
  expect(errors).toEqual([]);
});

test("is in the nav and on the overview", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dashboard-link-inventory").click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("link", { name: "Inventory", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the dead-stock toggle switches between 3, 6 and 12 months", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/inventory");
  await waitForData(page);
  const toggle = page.getByTestId("dead-stock-toggle");
  await expect(toggle.getByRole("button", { name: /^6m/ })).toHaveAttribute("aria-pressed", "true");
  const six = await valueAtRisk(page);

  await toggle.getByRole("button", { name: /^12m/ }).click();
  await expect(page).toHaveURL(/[?&]dead=12/);
  await waitForData(page);
  await expect(page.getByTestId("dead-stock-toggle").getByRole("button", { name: /^12m/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(deadStock(page)).toContainText("12 months or more");
  const twelve = await valueAtRisk(page);

  await page.getByTestId("dead-stock-toggle").getByRole("button", { name: /^3m/ }).click();
  await expect(page).toHaveURL(/[?&]dead=3/);
  await waitForData(page);
  await expect(deadStock(page)).toContainText("3 months or more");
  const three = await valueAtRisk(page);

  // A longer still period can only find less dead stock.
  expect(three).toBeGreaterThan(six);
  expect(six).toBeGreaterThan(twelve);
  expect(twelve).toBeGreaterThan(0);

  await page.getByTestId("dead-stock-toggle").getByRole("button", { name: /^6m/ }).click();
  await expect(page).not.toHaveURL(/dead=/);
  await waitForData(page);
  expect(await valueAtRisk(page)).toBe(six);
  expect(errors).toEqual([]);
});

test("the company filter changes every figure", async ({ page }) => {
  await page.goto("/inventory");
  await waitForData(page);
  const allValue = await kpiFull(page, "Stock value");
  const allRisk = await valueAtRisk(page);
  await page.getByTestId("company-trigger").click();
  await page.getByPlaceholder("Search companies…").fill("Sample Trading");
  await page.getByRole("option", { name: /Sample Trading/ }).click();
  await expect(page).toHaveURL(/[?&]company=101/);
  await page.keyboard.press("Escape");
  await waitForData(page);
  await expect.poll(() => kpiFull(page, "Stock value")).not.toBe(allValue);
  expect(await valueAtRisk(page)).toBeLessThan(allRisk);
  await expect(page.getByTestId("period")).toContainText("1 company");
  const companies = page
    .getByRole("heading", { name: "Stock value by company" })
    .locator("xpath=ancestor::*[@data-slot='card'][1]");
  await expect(
    companies.locator(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value"),
  ).toHaveCount(1);
});

test("reorder alerts sort and export CSV", async ({ page }) => {
  await page.goto("/inventory");
  await waitForData(page);
  const card = page
    .getByRole("heading", { name: "Reorder alerts" })
    .locator("xpath=ancestor::*[@data-slot='card'][1]");
  const table = card.getByTestId("data-table");
  await expect(card.getByTestId("reorder-count")).toContainText(/\d+ alerts?/);
  const firstItem = table.locator("tbody tr").first().locator("td").first();
  const before = await firstItem.textContent();
  await table.getByRole("button", { name: "Item" }).click();
  await expect(firstItem).not.toHaveText(before ?? "");

  const download = page.waitForEvent("download");
  await table.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("reorder-alerts.csv");
  const text = await readFile((await file.path())!, "utf8");
  expect(text.replace(/^﻿/, "").split("\r\n")[0]).toBe(
    "Item,Code,Company,Location,Available,Reorder level,Reorder qty",
  );
});
