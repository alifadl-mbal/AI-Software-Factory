import { expect, test, type Page } from "@playwright/test";

import { aedNumber, kpiFull, waitForData, watchConsole } from "./helpers";

// The "Orders placed" toggle on the two as-of-today order books. The sample data holds open lines on
// orders more than two years old (pending POs from 2022-2023, sales orders from early in the
// anchored range), so each choice changes the figures. The shared checks in app.spec.ts (390px, axe
// in both themes) cover both pages with the toggle on them.

const BOOKS = [
  { path: "/purchasing", headline: "Pending PO value", chart: "Pending value by supplier" },
  { path: "/sales-orders", headline: "Open order value", chart: "Open value by salesperson" },
] as const;

function toggle(page: Page) {
  return page.getByTestId("order-age-toggle");
}

/**
 * Press one of the toggle's buttons until the URL changes. The toggle renders with the page, before
 * the data streams in, so a click can land before React has hydrated it and do nothing.
 */
async function choose(page: Page, name: string, url: RegExp, press?: "Enter") {
  const button = toggle(page).getByRole("button", { name, exact: true });
  await expect(async () => {
    if (press) {
      await button.focus();
      await page.keyboard.press(press);
    } else {
      await button.click();
    }
    await expect(page).toHaveURL(url, { timeout: 1_000 });
  }).toPass();
}

/** The total in a chart card's header. */
async function cardTotal(page: Page, title: string): Promise<number> {
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: title }) });
  return aedNumber((await card.locator('[data-slot="card-action"]').textContent()) ?? "");
}

for (const book of BOOKS) {
  test(`${book.path}: the order-age toggle changes every figure, the URL and survives a reload`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    // Another parameter, to check the toggle keeps it.
    await page.goto(`${book.path}?range=mtd`);
    await waitForData(page);

    // Default: last 2 years, left out of the URL, with a note on what it hides.
    await expect(toggle(page).getByRole("button", { name: "last 2 years" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page).not.toHaveURL(/since=/);
    const note = page.getByTestId("order-age-note");
    await expect(note).toContainText(
      /Leaves out [\d,]+ lines? worth AED [\d,]+ on orders placed before \d{1,2} \w{3} \d{4}\./,
    );
    const twoYears = aedNumber(await kpiFull(page, book.headline));
    const hidden = aedNumber((await note.locator("span").nth(1).textContent()) ?? "");
    expect(twoYears).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
    expect(Math.abs((await cardTotal(page, book.chart)) - twoYears)).toBeLessThanOrEqual(1);

    // All: today's full book, which is the default plus what the note said was left out.
    await choose(page, "all", /[?&]since=all/);
    await expect(page).toHaveURL(/range=mtd/);
    await waitForData(page);
    await expect(toggle(page).getByRole("button", { name: "all" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("order-age-note")).toHaveCount(0);
    const all = aedNumber(await kpiFull(page, book.headline));
    expect(Math.abs(all - (twoYears + hidden))).toBeLessThanOrEqual(1);
    expect(Math.abs((await cardTotal(page, book.chart)) - all)).toBeLessThanOrEqual(1);

    await page.reload();
    await waitForData(page);
    await expect(toggle(page).getByRole("button", { name: "all" })).toHaveAttribute("aria-pressed", "true");
    expect(aedNumber(await kpiFull(page, book.headline))).toBe(all);

    // 12 months: less again.
    await choose(page, "12 months", /[?&]since=12m/);
    await waitForData(page);
    const twelveMonths = aedNumber(await kpiFull(page, book.headline));
    expect(twelveMonths).toBeLessThan(twoYears);
    expect(Math.abs((await cardTotal(page, book.chart)) - twelveMonths)).toBeLessThanOrEqual(1);

    // Back to the default, which drops the parameter again; then "Show all" from the note.
    await choose(page, "last 2 years", /^(?!.*since=)/);
    await waitForData(page);
    expect(aedNumber(await kpiFull(page, book.headline))).toBe(twoYears);
    await page.getByTestId("order-age-note").getByRole("link", { name: "Show all" }).click();
    await expect(page).toHaveURL(/[?&]since=all/);
    await waitForData(page);
    expect(aedNumber(await kpiFull(page, book.headline))).toBe(all);
    expect(errors).toEqual([]);
  });
}

test("the toggle works from the keyboard", async ({ page }) => {
  await page.goto("/sales-orders");
  await waitForData(page);
  await choose(page, "12 months", /[?&]since=12m/, "Enter");
  await expect(toggle(page).getByRole("group", { name: "Orders placed:" })).toBeVisible();
});

test("the choice is kept when moving between pages", async ({ page }) => {
  await page.goto("/purchasing?since=12m");
  await waitForData(page);
  await page.getByRole("link", { name: "Sales orders" }).first().click();
  await expect(page).toHaveURL(/\/sales-orders\?.*since=12m/);
  await waitForData(page);
  await expect(toggle(page).getByRole("button", { name: "12 months" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the overview uses the default order age and says so", async ({ page }) => {
  await page.goto("/");
  await waitForData(page);
  await expect(page.getByTestId("area-caption-purchasing")).toContainText("orders from the last 2 years");
  await expect(page.getByTestId("attention-overdue-po")).toContainText("orders from the last 2 years");
  const pending = await kpiFull(page, "Pending PO value");
  await page.getByTestId("area-link-purchasing").click();
  await expect(page).toHaveURL(/\/purchasing/);
  await waitForData(page);
  expect(await kpiFull(page, "Pending PO value")).toBe(pending);
  await expect(toggle(page).getByRole("button", { name: "last 2 years" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
