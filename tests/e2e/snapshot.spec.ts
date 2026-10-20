import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { kpiFull, waitForData, watchConsole } from "./helpers";
import { SNAPSHOT_SECRET } from "./snapshot-env";

const ENDPOINT = "/api/cron/snapshot";

async function attentionFull(page: Page, testId: string): Promise<string> {
  const value = page.getByTestId(testId).getByTestId("attention-value");
  return (await value.getAttribute("title")) ?? (await value.textContent()) ?? "";
}

test("a wrong or missing token gets 401, and GET gets 405", async ({ request }) => {
  expect((await request.post(ENDPOINT)).status()).toBe(401);
  expect((await request.post(ENDPOINT, { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
  expect(
    (await request.post(ENDPOINT, { headers: { Authorization: `Basic ${SNAPSHOT_SECRET}` } })).status(),
  ).toBe(401);
  const get = await request.get(ENDPOINT, { headers: { Authorization: `Bearer ${SNAPSHOT_SECRET}` } });
  expect(get.status()).toBe(405);
});

test("the emailed figures equal the Overview's for the same day", async ({ request, page }) => {
  const response = await request.post(ENDPOINT, { headers: { Authorization: `Bearer ${SNAPSHOT_SECRET}` } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ ok: true, transport: "file", recipients: 1, unavailable: [] });
  const [htmlFile, textFile] = body.files as string[];
  expect(htmlFile).toMatch(/snapshot-\d{4}-\d{2}-\d{2}\.html$/);
  const html = await readFile(htmlFile, "utf8");
  const text = await readFile(textFile, "utf8");
  expect(html).not.toContain("<script");
  expect(text).toContain("· Sample data");

  // Year to date, all companies: the Overview's default view.
  await page.goto("/");
  await waitForData(page);
  const expected: [string, string][] = [
    ["Net revenue, year to date", await kpiFull(page, "Net revenue")],
    ["Gross margin %, year to date", await kpiFull(page, "Gross margin %")],
    ["Net profit, year to date", await kpiFull(page, "Net profit")],
    ["Net margin %, year to date", await kpiFull(page, "Net margin %")],
    ["Stock value", await kpiFull(page, "Stock value")],
    ["Change vs last month-end", await kpiFull(page, "Change vs last month-end")],
    ["Pending PO value", await kpiFull(page, "Pending PO value")],
    ["Overdue %", await kpiFull(page, "Overdue %")],
    ["AR outstanding", await kpiFull(page, "AR outstanding")],
    ["Share over 90 days", await kpiFull(page, "Share over 90 days")],
    ["AP outstanding", await kpiFull(page, "AP outstanding")],
    ["Overdue PO value", await attentionFull(page, "attention-overdue-po")],
    ["AR over 90 days", await attentionFull(page, "attention-ar-over-90")],
    ["Dead stock (6 months)", await attentionFull(page, "attention-dead-stock")],
    ["Reorder alerts", await attentionFull(page, "attention-reorder")],
  ];

  await page.goto("/?range=mtd");
  await waitForData(page);
  expected.push(["Net revenue, month to date", await kpiFull(page, "Net revenue")]);
  expected.push(["Gross margin %, month to date", await kpiFull(page, "Gross margin %")]);

  await page.goto("/sales-orders");
  await waitForData(page);
  expected.push(["Open order value", await kpiFull(page, "Open order value")]);

  for (const [label, value] of expected) {
    expect(value, label).toMatch(/\d/);
    expect(text, label).toContain(`${label}: ${value}`);
    expect(html, label).toContain(value);
  }
});

test("the /snapshot page previews today's email", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/snapshot");
  await expect(page.getByRole("heading", { level: 1, name: "Daily snapshot" })).toBeVisible();
  await waitForData(page);
  await expect(page.getByTestId("snapshot-subject")).toContainText("MBAL daily snapshot");
  const frame = page.frameLocator('[data-testid="snapshot-frame"]');
  await expect(frame.getByText("MBAL daily snapshot", { exact: true })).toBeVisible();
  await expect(frame.getByText(/Data read at \d\d:\d\d on/)).toBeVisible();
  // Not a dashboard: no filters, and no sidebar entry.
  await expect(page.getByTestId("date-range-trigger")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Daily snapshot" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Plain text" }).click();
  await expect(page.getByTestId("snapshot-text")).toContainText("Net revenue, year to date: AED");
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: no serious or critical violations on /snapshot (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/snapshot");
    await waitForData(page);
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /light/);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious.map((violation) => violation.id)).toEqual([]);
  });
}
