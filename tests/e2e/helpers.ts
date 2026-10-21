import { expect, type BrowserContext, type Page } from "@playwright/test";

import { E2E_AUTH, E2E_GROUP } from "./auth-env";

/** The session cookie's name over plain http (the e2e server's AUTH_URL). */
const SESSION_COOKIE = "authjs.session-token";

/**
 * Sign a user in without Microsoft: mint the encrypted session cookie Auth.js would set after
 * the Entra callback. `member: false` leaves them out of AUTH_ALLOWED_GROUP.
 */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  { member = true, name = "Test User" }: { member?: boolean; name?: string } = {},
) {
  const { encode } = await import("next-auth/jwt");
  const value = await encode({
    salt: SESSION_COOKIE,
    secret: E2E_AUTH.AUTH_SECRET,
    token: {
      name,
      email: "test.user@mbal.example",
      sub: "e2e-user",
      signedInAt: Date.now(),
      groups: member ? [E2E_GROUP] : [],
    },
  });
  await context.addCookies([{ name: SESSION_COOKIE, value, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}

/** Every page, with how many KPI cards it shows and one money KPI that must have a value. */
export const PAGES = [
  { path: "/", heading: "Overview", kpis: 11, headline: "Net revenue" },
  { path: "/sales", heading: "Sales", kpis: 8, headline: "Net revenue" },
  { path: "/products", heading: "Product mix", kpis: 4, headline: "Net revenue" },
  { path: "/inventory", heading: "Inventory", kpis: 5, headline: "Stock value" },
  { path: "/sales-orders", heading: "Sales orders", kpis: 8, headline: "Open order value" },
  { path: "/purchasing", heading: "Purchasing", kpis: 5, headline: "Pending PO value" },
  { path: "/finance", heading: "Finance", kpis: 7, headline: "Revenue" },
  {
    path: "/receivables-payables",
    heading: "Receivables & payables",
    kpis: 7,
    headline: "AR outstanding",
  },
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

/** A full AED figure like "AED 1,234,567" or "-AED 1,234" as a number. */
export function aedNumber(text: string): number {
  const value = Number(text.replace(/[^\d.-]/g, ""));
  return text.trim().startsWith("-") ? -Math.abs(value) : value;
}

/** The full (unrounded) value of a KPI card, from its title tooltip. */
export async function kpiFull(page: Page, label: string): Promise<string> {
  // Match the label exactly: a hint on another card may mention it ("AR outstanding − AP outstanding").
  const card = page
    .getByTestId("kpi-card")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();
  return (await card.getByTestId("kpi-value").getAttribute("title")) ?? "";
}

/**
 * Open the top-bar search with Ctrl/⌘+K. The shortcut's listener is attached once the shell has
 * hydrated, which on a slow runner can be after the data has streamed in, so the key is pressed
 * again until the dialog shows (it toggles, so never while it is open).
 */
export async function openSearchByKeyboard(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Search customers and items" });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}
