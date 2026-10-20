import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { kpiFull, waitForData, watchConsole } from "./helpers";

// Sample data is rebased so its newest year is the current one; fixed ranges in that year keep these
// checks true whatever today's date is.
const year = new Date().getFullYear();

test("purchasing is in the nav and on the overview", async ({ page }) => {
  await page.goto("/");
  await waitForData(page);
  await page.getByTestId("dashboard-link-purchasing").click();
  await expect(page).toHaveURL(/\/purchasing/);
  await expect(page.getByRole("heading", { level: 1, name: "Purchasing" })).toBeVisible();
  await expect(page.getByRole("navigation").or(page.locator("[data-sidebar=sidebar]")).first()).toContainText(
    "Purchasing",
  );
});

test("pending POs are as of today; receipts follow the period; company applies to both", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/purchasing?range=custom&from=${year}-01-01&to=${year}-03-31`);
  await waitForData(page);
  await expect(page.getByTestId("period-note")).toContainText("Pending POs are as of today");
  const pending = await kpiFull(page, "Pending PO value");
  const spend = await kpiFull(page, "Receipts spend");
  expect(pending).toMatch(/^AED [1-9]/);

  await page.goto(`/purchasing?range=custom&from=${year}-04-01&to=${year}-06-30`);
  await waitForData(page);
  expect(await kpiFull(page, "Pending PO value")).toBe(pending);
  expect(await kpiFull(page, "Receipts spend")).not.toBe(spend);

  await page.goto(`/purchasing?range=custom&from=${year}-04-01&to=${year}-06-30&company=102`);
  await waitForData(page);
  expect(await kpiFull(page, "Pending PO value")).not.toBe(pending);
  await expect(page.getByTestId("period")).toContainText("1 company");

  // Every aging bucket is listed, in order (the chart's label names them in bar order).
  await expect(page.getByRole("img", { name: /^Pending value by aging/ })).toHaveAttribute(
    "aria-label",
    /: On Time AED .*, 0-90 Days Overdue AED .*, 90-180 Days Overdue AED .*, 180-365 Days Overdue AED .*, 365\+ Days Overdue AED /,
  );
  expect(errors).toEqual([]);
});

test("the overdue table sorts and exports CSV", async ({ page }) => {
  await page.goto("/purchasing");
  await waitForData(page);
  const table = page.getByTestId("overdue-table");
  const header = table.locator("thead th");
  await expect(header).toHaveText([
    "Company",
    "PO number",
    "Supplier",
    "Item",
    "PO date",
    "Days open",
    "Pending qty",
    "Pending value",
  ]);
  const valueHeader = table.getByRole("columnheader", { name: "Pending value" });
  await expect(valueHeader).toHaveAttribute("aria-sort", "descending");

  const daysHeader = table.getByRole("columnheader", { name: "Days open" });
  await daysHeader.getByRole("button").click();
  await expect(daysHeader).toHaveAttribute("aria-sort", "descending");
  const days = async () =>
    (await table.locator("tbody tr td:nth-child(6)").allTextContents()).map((text) =>
      Number(text.replaceAll(",", "")),
    );
  const descending = await days();
  expect(descending.length).toBeGreaterThan(1);
  expect(descending).toEqual([...descending].sort((a, b) => b - a));
  await daysHeader.getByRole("button").click();
  await expect(daysHeader).toHaveAttribute("aria-sort", "ascending");
  const ascending = await days();
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
  // Overdue means more than 84 days open.
  expect(Math.min(...ascending)).toBeGreaterThanOrEqual(84);

  const downloadEvent = page.waitForEvent("download");
  await table.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("overdue-po-lines.csv");
  const csv = (await readFile(await download.path())).toString("utf8").replace(/^﻿/, "");
  const lines = csv.trim().split(/\r\n/);
  expect(lines[0]).toBe("Company,PO number,Supplier,Item,PO date,Days open,Pending qty,Pending value");
  expect(lines[1]).toMatch(/,\d{4}-\d\d-\d\d,\d+,[\d.]+,[\d.]+$/);
});

test("the zero exchange rate warning shows only when there are such receipts", async ({ page }) => {
  await page.goto(`/purchasing?range=custom&from=${year}-01-01&to=${year}-12-31`);
  await waitForData(page);
  const callout = page.getByTestId("zero-rate-callout");
  await expect(callout).toBeVisible();
  await expect(callout).toContainText("2 receipt lines in foreign currency with an exchange rate of 0");

  await page.goto(`/purchasing?range=custom&from=${year}-10-01&to=${year}-10-31`);
  await waitForData(page);
  await expect(page.getByTestId("kpi-card").first()).toBeVisible();
  await expect(callout).toHaveCount(0);
});
