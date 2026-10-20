/**
 * The daily snapshot email: its figures equal the Overview's loaders for the same day, its HTML
 * is safe for Outlook, a failing loader only blanks its own section, and the token check.
 *
 * Runs on the full sample data, anchored to TODAY like the app's sample mode.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { presetRange, previousYear, todayIso, type Filters } from "@/lib/filters";
import { formatAed, formatInt, formatPct } from "@/lib/format";
import { AP_CURRENCY_NOTE } from "@/lib/notes";
import { setRunnerForTests } from "@/lib/server/db";
import { overviewFigures, stockPosition, type OverviewFigures } from "@/lib/server/overview";
import { apSplit, arSummary } from "@/lib/server/queries/ar-ap";
import { financeKpis } from "@/lib/server/queries/finance";
import { deadStock, reorderAlerts } from "@/lib/server/queries/inventory";
import { pendingKpis } from "@/lib/server/queries/purchasing";
import { salesKpis } from "@/lib/server/queries/sales";
import { openBookKpis } from "@/lib/server/queries/sales-orders";
import { SampleSource } from "@/lib/server/sample";
import { hasCronToken } from "@/lib/server/snapshot";
import { buildSnapshotEmail, NOT_AVAILABLE, type SnapshotEmail } from "@/lib/server/snapshot/email";

const TODAY = todayIso();
const APP_URL = "https://bi.example.test";
const READ_AT = new Date("2026-10-20T03:30:00Z");

const sample = new SampleSource({
  rebaseToYear: Number(TODAY.slice(0, 4)),
  rebaseToMonth: TODAY.slice(0, 7),
  anchorToDate: TODAY,
});

/** Route every query to the sample data, failing those on `failingView`. */
function useSample(failingView?: string) {
  setRunnerForTests((sql, binds) =>
    failingView && sql.includes(failingView)
      ? Promise.reject(new Error("ORA-12541: TNS:no listener"))
      : sample.query(sql, binds),
  );
}

afterAll(() => setRunnerForTests(undefined));

function filters(range: "mtd" | "ytd"): Filters {
  return { range, ...presetRange(range, TODAY), companies: [] };
}

function build(figures: OverviewFigures, sampleMode = true): SnapshotEmail {
  return buildSnapshotEmail(figures, { appUrl: APP_URL, sample: sampleMode, readAt: READ_AT });
}

describe("snapshot figures equal the Overview's", () => {
  let figures: OverviewFigures;
  let email: SnapshotEmail;

  beforeEach(async () => {
    useSample();
    figures = await overviewFigures(TODAY);
    email = build(figures);
  });

  it("loads every area", () => {
    for (const area of [
      figures.sales,
      figures.finance,
      figures.inventory,
      figures.purchasing,
      figures.receivables,
      figures.payables,
      figures.salesOrders,
      ...Object.values(figures.attention),
    ]) {
      expect(area.ok).toBe(true);
    }
  });

  it("puts each loader's figure in both the HTML and the text", async () => {
    const ytd = filters("ytd");
    const mtd = filters("mtd");
    const [salesYtd, salesYtdLy, salesMtd, finance, financeLy, stock, pending, ar, ap, book, dead, reorder] =
      await Promise.all([
        salesKpis(ytd),
        salesKpis(previousYear(ytd)),
        salesKpis(mtd),
        financeKpis(ytd),
        financeKpis(previousYear(ytd)),
        stockPosition([], TODAY),
        pendingKpis([], TODAY),
        arSummary(TODAY, []),
        apSplit(TODAY, []),
        openBookKpis([], TODAY),
        deadStock([], 6, TODAY),
        reorderAlerts([]),
      ]);
    expect(salesYtd.netRevenue).toBeGreaterThan(0);

    const lines: [string, string][] = [
      ["Net revenue, year to date", formatAed(salesYtd.netRevenue)],
      ["Net revenue, month to date", formatAed(salesMtd.netRevenue)],
      ["Gross margin %, year to date", formatPct(salesYtd.marginPct)],
      ["Net profit, year to date", formatAed(finance.netProfit)],
      ["Net margin %, year to date", formatPct(finance.netMarginPct)],
      ["Stock value", formatAed(stock.stockValue)],
      ["Pending PO value", formatAed(pending.pendingValue)],
      ["Overdue %", formatPct(pending.overduePct)],
      ["AR outstanding", formatAed(ar.balance)],
      ["Share over 90 days", formatPct(ar.over90Pct)],
      ["AP outstanding", formatAed(ap.summary.balance)],
      ["Open order value", formatAed(book.openValue)],
      ["Overdue PO value", formatAed(pending.overdueValue)],
      ["AR over 90 days", formatAed(ar.over90)],
      ["Dead stock (6 months)", formatAed(dead.value)],
      ["Reorder alerts", formatInt(reorder.length)],
    ];
    for (const [label, value] of lines) {
      expect(email.text, label).toContain(`${label}: ${value}`);
      expect(email.html, label).toContain(value);
    }
    expect(email.text).toContain(`vs ${formatAed(salesYtdLy.netRevenue)} last year`);
    expect(email.text).toContain(`vs ${formatAed(financeLy.netProfit)} last year`);
    expect(email.text).toContain(AP_CURRENCY_NOTE);
    expect(email.text).toMatch(/Net revenue, yesterday \(\d{1,2} \w{3} \d{4}\): (-?AED [\d,]+)/);
  });

  it("links every section to its dashboard at APP_URL", () => {
    for (const path of [
      "/sales",
      "/finance",
      "/inventory",
      "/purchasing",
      "/receivables-payables",
      "/sales-orders",
      "/purchasing#overdue-po-lines",
      "/receivables-payables#ar-aging",
      "/inventory?dead=6#dead-and-slow-stock",
      "/inventory#reorder-alerts",
    ]) {
      expect(email.html).toContain(`href="${APP_URL}${path}"`);
      expect(email.text).toContain(`${APP_URL}${path}`);
    }
  });

  it("says when the data was read and where from", () => {
    expect(email.text).toContain("Data read at 07:30 on 20 Oct 2026 (Asia/Dubai) · Sample data");
    expect(email.html).toContain("Data read at 07:30 on 20 Oct 2026 (Asia/Dubai) · Sample data");
    expect(email.subject).toMatch(/^MBAL daily snapshot · \d{1,2} \w{3} \d{4} \(sample data\)$/);
    const live = build(figures, false);
    expect(live.text).toContain("· Live Orion");
    expect(live.subject).not.toContain("sample");
    expect(live.html).not.toContain("Sample data");
  });
});

describe("snapshot HTML works in email clients", () => {
  let html: string;

  beforeEach(async () => {
    useSample();
    html = build(await overviewFigures(TODAY)).html;
  });

  it("has no scripts, styles, forms or embedded content", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/<(img|iframe|object|embed|video|audio|svg|form|input|button)\b/i);
    expect(html).not.toMatch(/\bon\w+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("loads nothing external: no src, url(), @import or web fonts", () => {
    expect(html).not.toMatch(/\bsrc\s*=/i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).not.toMatch(/@import|@font-face/i);
    // The only addresses are link targets.
    const urls = html.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
    for (const url of urls) expect(hrefs).toContain(url.replaceAll("&amp;", "&"));
    for (const href of hrefs) expect(href.startsWith(APP_URL)).toBe(true);
  });

  it("styles inline only, with no classes or ids", () => {
    expect(html).not.toMatch(/\sclass\s*=/i);
    expect(html).not.toMatch(/\sid\s*=/i);
    expect(html).toMatch(/style="/);
  });

  it("lays out with tables 600px wide", () => {
    expect(html).not.toMatch(/<div\b/i);
    expect(html).not.toMatch(/display\s*:\s*(flex|grid)/i);
    // Fluid up to 600px for phones and the web; Outlook desktop gets a fixed 600px ghost table.
    expect(html).toContain("width:100%;max-width:600px");
    expect(html).toContain('<!--[if mso]><table role="presentation" width="600"');
    expect(html).toContain("<!--[if mso]></td></tr></table><![endif]-->");
    for (const table of html.match(/<table\b[^>]*>/g) ?? []) {
      expect(table).toContain('role="presentation"');
      expect(table).toContain('cellpadding="0"');
    }
  });

  it("gives every coloured element an explicit background, for dark mode", () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    for (const cell of html.match(/<(td|body)\b[^>]*bgcolor="[^"]+"[^>]*>/g) ?? []) {
      expect(cell).toMatch(/background-color:#[0-9a-f]{6}/i);
    }
  });
});

describe("a failing loader", () => {
  it("blanks only its own section, and the email still has the rest", async () => {
    useSample("ZF_PO_PENDING_BI");
    const figures = await overviewFigures(TODAY);
    expect(figures.purchasing.ok).toBe(false);
    expect(figures.sales.ok).toBe(true);
    const email = build(figures);

    expect(email.text).toMatch(/Purchasing — \S+\n {2}Not available today\./);
    expect(email.text).toContain(`Overdue PO value: ${NOT_AVAILABLE}`);
    expect(email.html).toContain(`${NOT_AVAILABLE}.`);
    expect(email.html).toContain(`href="${APP_URL}/purchasing"`);
    // The rest is still there.
    expect(email.text).toMatch(/Net revenue, year to date: AED [1-9]/);
    expect(email.text).toMatch(/AR outstanding: AED [1-9]/);
    expect(email.text).not.toContain("Pending PO value");
    // The friendly reason (with the Oracle code) goes to the log, not into the email.
    expect(email.text).not.toContain("ORA-");
  });

  it("can fail every section and still build an email", async () => {
    setRunnerForTests(() => Promise.reject(new Error("ORA-12541")));
    const email = build(await overviewFigures(TODAY));
    expect(email.text.match(/Not available today/g)?.length).toBeGreaterThanOrEqual(7);
    expect(email.html).toContain("Data read at");
  });
});

describe("the cron token", () => {
  it("accepts only Bearer and the exact secret", () => {
    expect(hasCronToken("Bearer s3cret", "s3cret")).toBe(true);
    expect(hasCronToken("bearer   s3cret", "s3cret")).toBe(true);
    expect(hasCronToken("Bearer s3cre", "s3cret")).toBe(false);
    expect(hasCronToken("Bearer s3cret!", "s3cret")).toBe(false);
    expect(hasCronToken("s3cret", "s3cret")).toBe(false);
    expect(hasCronToken("Basic s3cret", "s3cret")).toBe(false);
    expect(hasCronToken(null, "s3cret")).toBe(false);
    expect(hasCronToken("Bearer ", "")).toBe(false);
  });

  it("refuses everything when no secret is set", () => {
    expect(hasCronToken("Bearer undefined", undefined)).toBe(false);
    expect(hasCronToken("Bearer ", undefined)).toBe(false);
  });
});

vi.setConfig({ testTimeout: 30_000 });
