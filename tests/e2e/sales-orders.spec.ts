import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { aedNumber, kpiFull, waitForData, watchConsole } from "./helpers";

// The order-book fixture is anchored so its newest order is today; the open book doesn't follow the
// period, so any two periods must show the same open figures.

test("sales orders is in the nav and on the overview", async ({ page }) => {
  await page.goto("/");
  await waitForData(page);
  await page.getByTestId("dashboard-link-sales-orders").click();
  await expect(page).toHaveURL(/\/sales-orders/);
  await expect(page.getByRole("heading", { level: 1, name: "Sales orders" })).toBeVisible();
});

test("the open book is as of today and ignores the period; booked follows it", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/sales-orders?range=12m");
  await waitForData(page);
  await expect(page.getByTestId("period-note")).toContainText("The open book is as of today");
  const open = await kpiFull(page, "Open order value");
  const booked = await kpiFull(page, "Orders booked");
  expect(open).toMatch(/^AED [1-9]/);

  await page.goto("/sales-orders?range=mtd");
  await waitForData(page);
  await expect(page).toHaveURL(/range=mtd/);
  expect(await kpiFull(page, "Open order value")).toBe(open);
  expect(await kpiFull(page, "Orders booked")).not.toBe(booked);

  await page.goto("/sales-orders?range=mtd&company=102");
  await waitForData(page);
  expect(await kpiFull(page, "Open order value")).not.toBe(open);
  await page.reload();
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText("1 company");
  // Company 102 has USD orders: they are listed apart from the AED figures.
  await expect(page.getByTestId("so-currency-note")).toContainText("USD");
  expect(errors).toEqual([]);
});

test("the open value adds up across the aging and salesperson charts", async ({ page }) => {
  await page.goto("/sales-orders");
  await waitForData(page);
  const open = aedNumber(await kpiFull(page, "Open order value"));
  for (const title of ["Open value by order age", "Open value by salesperson"]) {
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("heading", { name: title }) });
    const total = aedNumber((await card.locator('[data-slot="card-action"]').textContent()) ?? "");
    expect(Math.abs(total - open)).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole("group", { name: /^Open value by order age/ })).toHaveAttribute(
    "aria-label",
    /: <30 D AED .*, 1-2 M AED .*, 2-3 M AED .*, 3-6 M AED .*, 6-12 M AED .*, 1-2 Y AED .*, 2\+ Y AED /,
  );
});

test("the open lines table exports CSV", async ({ page }) => {
  await page.goto("/sales-orders");
  await waitForData(page);
  const table = page.getByTestId("open-lines-table");
  await expect(table.locator("thead th")).toHaveText([
    "Company",
    "Order no",
    "Order date",
    "Customer",
    "Salesperson",
    "Item",
    "Ordered",
    "Delivered",
    "Invoiced",
    "Pending value",
    "Expected delivery",
    "Days overdue",
  ]);
  await expect(table.getByRole("columnheader", { name: "Pending value" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );

  const downloadEvent = page.waitForEvent("download");
  await table.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("open-order-lines.csv");
  const csv = (await readFile(await download.path())).toString("utf8").replace(/^﻿/, "");
  const lines = csv.trim().split(/\r\n/);
  expect(lines[0]).toBe(
    "Company,Order no,Order date,Customer,Salesperson,Item,Ordered,Delivered,Invoiced,Pending value,Expected delivery,Days overdue",
  );
  expect(lines.length).toBeGreaterThan(10);
});
