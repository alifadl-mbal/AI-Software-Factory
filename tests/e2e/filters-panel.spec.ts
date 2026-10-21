import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { kpiFull, waitForData, watchConsole } from "./helpers";

// The TNS Filters panel (issue #50): Year / Month, Custom dates and the Company, Salesman and Brand
// checklists, against the sample data (salespeople S01–S07, brands from ZF_STK_SO_PO_SL_BI.csv).

function panel(page: Page) {
  return page.getByTestId("filters-panel");
}

/** Today in Dubai, as the server sees it. */
function today(): { year: number; month: number } {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

const pad = (value: number) => String(value).padStart(2, "0");

test("Single applies one salesperson at once; Multi drafts until Apply", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/sales");
  await waitForData(page);
  const group = panel(page).getByTestId("salesperson-group");
  const multi = group.getByRole("button", { name: "Multi" });
  const single = group.getByRole("button", { name: "Single" });
  await expect(multi).toHaveAttribute("aria-pressed", "true");

  await single.click();
  await expect(single).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("radio", { name: "Priya Nair" }).check();
  await expect(page).toHaveURL(/[?&]salesperson=S06(&|$)/);
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText("salesperson: Priya Nair");

  // Back in Multi, ticking a second one changes nothing until Apply.
  await group.getByRole("button", { name: "Multi" }).click();
  await group.getByRole("checkbox", { name: "Aisha Rahman" }).check();
  await expect(group.getByTestId("salesperson-count")).toHaveText(/^2 of \d+$/);
  await expect(page).toHaveURL(/[?&]salesperson=S06(&|$)/);
  await group.getByTestId("salesperson-apply").click();
  await expect(page).toHaveURL(/[?&]salesperson=S01,S06(&|$)/);
  await waitForData(page);
  expect(errors).toEqual([]);
});

test("All and None set every tick, the count says x of y, and an empty pick can't be applied", async ({
  page,
}) => {
  await page.goto("/sales");
  await waitForData(page);
  const group = panel(page).getByTestId("brand-group");
  const count = group.getByTestId("brand-count");
  await expect(count).toHaveText(/^(\d+) of \1$/);
  const total = Number((await count.textContent())!.split(" of ")[1]);
  expect(total).toBeGreaterThan(1);

  await group.getByRole("button", { name: "None", exact: true }).click();
  await expect(count).toHaveText(`0 of ${total}`);
  await expect(group.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(group.getByTestId("brand-apply")).toBeDisabled();
  await expect(group).toContainText("Pick at least one");

  await group.getByRole("checkbox", { name: "Northwind" }).check();
  await group.getByRole("checkbox", { name: "Contoso" }).check();
  await expect(count).toHaveText(`2 of ${total}`);

  await group.getByRole("button", { name: "All", exact: true }).click();
  await expect(count).toHaveText(`${total} of ${total}`);
  await expect(group.getByRole("checkbox", { checked: false })).toHaveCount(0);
  // Every box ticked is the same as no brand filter: nothing to apply.
  await expect(group.getByTestId("brand-apply")).toHaveCount(0);
  await expect(page).not.toHaveURL(/brand=/);
});

test("search narrows the checklist and says when nothing matches", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  const group = panel(page).getByTestId("salesperson-group");
  await expect(group.getByTestId("salesperson-count")).toHaveText(/^\d+ of \d+$/);
  const search = group.getByRole("searchbox", { name: "Search salespeople" });
  await search.fill("priya");
  await expect(group.getByRole("checkbox")).toHaveCount(1);
  await expect(group.getByRole("checkbox", { name: "Priya Nair" })).toBeVisible();
  await search.fill("zzz");
  await expect(group.getByRole("checkbox")).toHaveCount(0);
  await expect(group).toContainText("No salesperson matches.");
  // Searching filters the list only; the count still covers every option.
  await expect(group.getByTestId("salesperson-count")).toHaveText(/^(\d+) of \1$/);
});

test("Salesman and Brand cascade from the selected companies", async ({ page, request }) => {
  const options = async (search: string) => {
    const body = (await (await request.get(`/api/filter-options${search}`)).json()) as {
      data: { salespeople: unknown[]; brands: unknown[] };
    };
    return body.data;
  };
  for (const search of ["?range=mtd", "?range=mtd&company=105"]) {
    const expected = await options(search);
    await page.goto(`/sales${search}`);
    await waitForData(page);
    await expect(panel(page).getByTestId("salesperson-count")).toHaveText(
      `${expected.salespeople.length} of ${expected.salespeople.length}`,
    );
    await expect(panel(page).getByTestId("brand-count")).toHaveText(
      `${expected.brands.length} of ${expected.brands.length}`,
    );
  }
  // And it follows a company picked in the panel.
  await page.goto("/sales?range=mtd");
  await waitForData(page);
  const company = panel(page).getByTestId("company-group");
  await company.getByRole("button", { name: "None", exact: true }).click();
  await company.getByRole("checkbox", { name: /Fictional Tech/ }).check();
  await company.getByTestId("company-apply").click();
  await expect(page).toHaveURL(/[?&]company=105(&|$)/);
  const expected = await options("?range=mtd&company=105");
  await expect(panel(page).getByTestId("salesperson-count")).toHaveText(
    `${expected.salespeople.length} of ${expected.salespeople.length}`,
  );
});

test("Year and Month resolve to one range in the URL, and Reset all restores the defaults", async ({
  page,
}) => {
  const errors = watchConsole(page);
  const { year, month } = today();
  await page.goto("/sales");
  await waitForData(page);
  const ytd = await kpiFull(page, "Net revenue");
  await expect(panel(page).getByTestId("year-trigger")).toHaveText(`Year:${year}`);
  await expect(panel(page).getByTestId("month-count")).toHaveText(`${month} of 12`);

  // One month: March of this year.
  await panel(page).getByTestId("month-trigger").click();
  const months = page.getByTestId("month-panel");
  await months.getByRole("button", { name: "Single" }).click();
  await months.getByRole("radio", { name: "March" }).check();
  await expect(page).toHaveURL(new RegExp(`range=custom&from=${year}-03-01&to=${year}-03-31`));
  await waitForData(page);
  await expect(page.getByTestId("period")).toContainText(`1 Mar ${year} – 31 Mar ${year}`);
  await expect(panel(page).getByTestId("month-trigger")).toHaveText("Month:March");

  // Two months in Multi: the first to the last.
  await panel(page).getByTestId("month-trigger").click();
  await months.getByRole("button", { name: "Multi" }).click();
  await months.getByRole("checkbox", { name: "May" }).check();
  await expect(page).toHaveURL(new RegExp(`from=${year}-03-01&to=${year}-05-31`));
  await page.keyboard.press("Escape");

  // Two years: from last year's first month to this year's last.
  await panel(page).getByTestId("year-trigger").click();
  await page
    .getByTestId("year-panel")
    .getByRole("checkbox", { name: String(year - 1) })
    .check();
  await expect(page).toHaveURL(new RegExp(`from=${year - 1}-03-01&to=${year}-05-31`));
  await page.keyboard.press("Escape");
  await waitForData(page);
  await expect(panel(page).getByTestId("year-count")).toHaveText(/^2 of \d+$/);

  // Months that haven't started can't be picked on their own.
  if (month < 12) {
    await page.goto("/sales");
    await waitForData(page);
    await panel(page).getByTestId("month-trigger").click();
    await expect(page.getByTestId("month-panel").getByRole("checkbox", { name: "December" })).toBeDisabled();
    await page.keyboard.press("Escape");
  }

  await page.goto(`/sales?range=custom&from=${year - 1}-03-01&to=${year}-05-31&company=101&brand=NW`);
  await waitForData(page);
  await panel(page).getByTestId("filters-reset").click();
  await expect(page).toHaveURL(/\/sales$/);
  await waitForData(page);
  await expect.poll(() => kpiFull(page, "Net revenue")).toBe(ytd);
  await expect(panel(page).getByTestId("filters-reset")).toBeDisabled();
  await expect(page.getByTestId("period")).toContainText("Year to date");
  expect(errors).toEqual([]);
});

test("Year to date and month to date come back as presets, so URLs stay short", async ({ page }) => {
  const { month } = today();
  await page.goto(
    `/sales?range=custom&from=${today().year}-${pad(month)}-01&to=${today().year}-${pad(month)}-02`,
  );
  await waitForData(page);
  await panel(page).getByTestId("month-trigger").click();
  const months = page.getByTestId("month-panel");
  await months.getByRole("button", { name: "All", exact: true }).click();
  await expect(page).toHaveURL(/\/sales$/);
  await months.getByRole("button", { name: "Single" }).click();
  await months
    .getByRole("radio", {
      name: new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(2026, month - 1, 1)),
    })
    .check();
  await expect(page).toHaveURL(/[?&]range=mtd$/);
});

test("every filter control works by keyboard, with a visible focus ring", async ({ page }) => {
  await page.goto("/sales");
  await waitForData(page);
  const group = panel(page).getByTestId("salesperson-group");
  await expect(group.getByTestId("salesperson-count")).toHaveText(/^(\d+) of \1$/);
  const box = group.getByRole("checkbox", { name: "Priya Nair" });
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).not.toBeChecked();
  // The visible box beside the (transparent) input carries the ring.
  const ring = await box.evaluate((input) => getComputedStyle(input.nextElementSibling!).boxShadow);
  expect(ring).not.toBe("none");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(group.getByTestId("salesperson-apply")).toBeVisible();

  // The period dropdown opens with Enter and closes with Escape.
  await panel(page).getByTestId("year-trigger").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("year-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("year-panel")).toBeHidden();
  await expect(panel(page).getByTestId("year-trigger")).toBeFocused();
});

test("the nav rail expands and remembers it", async ({ page }) => {
  await page.goto("/sales");
  const rail = page.getByTestId("nav-rail");
  await expect(rail).toHaveAttribute("data-expanded", "false");
  expect((await rail.boundingBox())!.width).toBe(120);
  // The toggle works once the shell has hydrated: click until it takes.
  await expect(async () => {
    await page.getByRole("button", { name: "Expand navigation" }).click({ timeout: 1_000 });
    await expect(rail).toHaveAttribute("data-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.reload();
  await expect(rail).toHaveAttribute("data-expanded", "true");
  await expect.poll(async () => (await rail.boundingBox())!.width).toBe(260);
  await expect(rail.getByRole("link", { name: "Receivables & payables" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(rail).toHaveAttribute("data-expanded", "false");
});

test.describe("phone 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("figures come first; the Filters button counts the active filters and opens the panel in a sheet", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/sales?range=mtd&salesperson=S06&brand=NW");
    await waitForData(page);
    await expect(panel(page)).toBeHidden();
    const trigger = page.getByTestId("filters-trigger");
    await expect(page.getByTestId("filters-active-count")).toHaveText("3");
    // The trigger sits above the page title and the KPIs, not a screen of filters.
    expect((await page.getByTestId("kpi-card").first().boundingBox())!.y).toBeLessThan(844);

    await trigger.click();
    const drawer = page.getByTestId("filters-drawer");
    await expect(drawer.getByTestId("year-group")).toBeVisible();
    await drawer.getByTestId("salesperson-group").getByRole("checkbox", { name: "Aisha Rahman" }).check();
    await drawer.getByTestId("salesperson-apply").click();
    await expect(page).toHaveURL(/[?&]salesperson=S01,S06(&|$)/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await drawer.getByTestId("filters-reset").click();
    await expect(page).toHaveURL(/\/sales$/);
    expect(errors).toEqual([]);
  });

  for (const width of [390, 768, 1000]) {
    test(`the sheet's Close button stays clear of Reset all at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/sales?salesperson=S06");
      await waitForData(page);
      await page.getByTestId("filters-trigger").click();
      const drawer = page.getByTestId("filters-drawer");
      const reset = (await drawer.getByTestId("filters-reset").boundingBox())!;
      const close = (await drawer.getByRole("button", { name: "Close" }).boundingBox())!;
      const intersect =
        reset.x < close.x + close.width &&
        close.x < reset.x + reset.width &&
        reset.y < close.y + close.height &&
        close.y < reset.y + reset.height;
      expect(intersect).toBe(false);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`axe: the Filters sheet (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/sales?salesperson=S06");
      await waitForData(page);
      await page.getByTestId("filters-trigger").click();
      await expect(page.getByTestId("filters-drawer").getByTestId("salesperson-count")).toHaveText(
        /^\d+ of \d+$/,
      );
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );
      expect(serious.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
    });
  }
});
