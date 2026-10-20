import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { aedNumber, kpiFull, waitForData, watchConsole } from "./helpers";

const PATH = "/receivables-payables";
const LADDER = ["<30 D", "1-2 M", "2-3 M", "3-6 M", "6-12 M", "1-2 Y", "2+ Y"];

async function openTab(page: Page, name: "Receivables (AR)" | "Payables (AP)") {
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
  await waitForData(page);
}

test("is on the Overview and in the navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("dashboard-link-receivables-payables").click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Receivables & payables" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Receivables & payables", exact: true })).toBeVisible();
});

test("says balances are as of today and the date filter doesn't apply", async ({ page }) => {
  await page.goto(PATH);
  await expect(page.getByTestId("period")).toContainText("As of today");
  await expect(page.getByTestId("period")).toContainText("the date filter doesn't apply");
});

test("the tabs keep receivables and payables apart", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(PATH);
  await waitForData(page);

  await expect(page.getByRole("tab", { name: "Receivables (AR)" })).toHaveAttribute("aria-selected", "true");
  for (const title of [
    "AR aging",
    "Outstanding by salesperson",
    "Top customers by balance",
    "Collection follow-up",
  ]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "AP aging" })).toHaveCount(0);

  await openTab(page, "Payables (AP)");
  for (const title of ["AP aging", "Top vendors owed", "Vendor prepayments"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByTestId("ap-currency-note")).toBeVisible();
  await expect(page.getByRole("heading", { name: "AR aging" })).toHaveCount(0);
  await expect(page.getByTestId("error-card")).toHaveCount(0);

  // Arrow keys move between tabs, as the WAI-ARIA tabs pattern expects.
  await page.getByRole("tab", { name: "Payables (AP)" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Receivables (AR)" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "AR aging" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("aging charts show the ladder in order", async ({ page }) => {
  await page.goto(PATH);
  await waitForData(page);
  for (const tab of ["Receivables (AR)", "Payables (AP)"] as const) {
    await openTab(page, tab);
    const ticks = page
      .locator(".recharts-wrapper")
      .first()
      .locator(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value");
    await expect(ticks).toHaveText(LADDER);
  }
});

test("KPI figures agree with each other and with the tables", async ({ page }) => {
  await page.goto(PATH);
  await waitForData(page);
  const ar = aedNumber(await kpiFull(page, "AR outstanding"));
  const ap = aedNumber(await kpiFull(page, "AP outstanding"));
  const net = aedNumber(await kpiFull(page, "Net position"));
  expect(Math.abs(net - (ar - ap))).toBeLessThanOrEqual(1);
  expect(aedNumber(await kpiFull(page, "Vendor prepayments"))).toBeGreaterThan(0);
  expect(aedNumber(await kpiFull(page, "PDCs in hand"))).toBeGreaterThan(0);

  // The collection table covers every collector, so its total is AR outstanding.
  const collection = page
    .getByTestId("data-table")
    .filter({ has: page.getByRole("button", { name: "Collector" }) });
  await expect(collection.locator("tfoot td").nth(2)).toHaveText(await kpiFull(page, "AR outstanding"));
});

test("the company filter changes the balances and stays in the URL", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(PATH);
  await waitForData(page);
  const allCompanies = await kpiFull(page, "AR outstanding");

  await page.getByTestId("company-trigger").click();
  await page.getByPlaceholder("Search companies…").fill("Sample Trading");
  await page.getByRole("option", { name: /Sample Trading/ }).click();
  await expect(page).toHaveURL(/[?&]company=101/);
  await page.keyboard.press("Escape");
  await waitForData(page);
  await expect.poll(() => kpiFull(page, "AR outstanding")).not.toBe(allCompanies);
  await expect(page.getByTestId("period")).toContainText("1 company");

  await openTab(page, "Payables (AP)");
  await expect(page.getByTestId("error-card")).toHaveCount(0);
  const vendors = page.getByTestId("data-table").first();
  for (const company of await vendors.locator("tbody tr td:nth-child(2)").allTextContents()) {
    expect(company).toBe("Sample Trading LLC");
  }
  expect(errors).toEqual([]);
});

test("the collection follow-up table exports CSV", async ({ page }) => {
  await page.goto(PATH);
  await waitForData(page);
  const table = page
    .getByTestId("data-table")
    .filter({ has: page.getByRole("button", { name: "Collector" }) });
  const download = page.waitForEvent("download");
  await table.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("collection-follow-up.csv");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const header = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "").split("\r\n")[0];
  expect(header).toBe(`Collector,Customers,Outstanding,Over 90 days,${LADDER.join(",")},PDCs`);
});

test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("both tabs fit without sideways scrolling", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(PATH);
    await waitForData(page);
    for (const tab of ["Receivables (AR)", "Payables (AP)"] as const) {
      await openTab(page, tab);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, tab).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: no serious or critical violations on the payables tab (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(PATH);
    await waitForData(page);
    await openTab(page, "Payables (AP)");
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(
      serious.map(
        (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
      ),
    ).toEqual([]);
  });
}
