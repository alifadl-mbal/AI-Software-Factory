import { expect, type Page } from "@playwright/test";

/** Every page, with the KPI card whose full value must be a real AED figure. */
export const PAGES = [
  { path: "/", heading: "Overview", kpi: "Net revenue" },
  { path: "/sales", heading: "Sales", kpi: "Net revenue" },
  { path: "/purchasing", heading: "Purchasing", kpi: "Pending PO value" },
] as const;

/** Collect console errors and uncaught exceptions for the life of the page. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Wait until every streamed section has replaced its skeleton. */
export async function waitForData(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

/** The full (unrounded) value of a KPI card, from its title tooltip. */
export async function kpiFull(page: Page, label: string): Promise<string> {
  const card = page.getByTestId("kpi-card").filter({ hasText: label }).first();
  return (await card.getByTestId("kpi-value").getAttribute("title")) ?? "";
}
