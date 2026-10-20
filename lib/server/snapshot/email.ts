import { BUSINESS_TIME_ZONE, todayIso } from "@/lib/filters";
import {
  formatAed,
  formatDate,
  formatDeltaPct,
  formatDeltaPp,
  formatInt,
  formatMonth,
  formatPct,
  pctChange,
} from "@/lib/format";
import { AP_CURRENCY_NOTE, salesOrderCurrencyNote } from "@/lib/notes";
import { DEFAULT_ORDER_AGE, orderAgeScope } from "@/lib/order-age";

import type { Loaded } from "../errors";
import { DEFAULT_DEAD_STOCK_MONTHS } from "../queries/inventory";
import type { OverviewFigures, VsLastYear } from "../overview";

/**
 * The daily snapshot email: the Overview's headline figures, as HTML that holds up in Outlook
 * (desktop, web and phone) and as a plain-text alternative.
 *
 * Both are rendered from one list of sections, so they always carry the same figures. The HTML is a
 * 600px table layout (fluid below 600px; a fixed 600px table for Outlook desktop, which ignores
 * max-width) with inline styles only: no `<style>`, scripts, images or web fonts, and
 * mid-tone colours on explicit backgrounds so Outlook's dark mode can re-colour them legibly. Money
 * is full AED (`lib/format.ts`), the same figure the dashboards show in their tooltips.
 */

export const NOT_AVAILABLE = "Not available today";

/** Pending POs and the order book count the dashboards' default order age. */
const ORDER_SCOPE = orderAgeScope(DEFAULT_ORDER_AGE);

export interface SnapshotEmail {
  subject: string;
  html: string;
  text: string;
}

export interface SnapshotOptions {
  /** Where the dashboards live, e.g. `https://bi.mbal.local`; no trailing slash needed. */
  appUrl: string;
  sample: boolean;
  /** When the figures were read from the source. */
  readAt: Date;
}

type Tone = "up" | "down" | "flat";

interface Metric {
  label: string;
  value: string;
  /** A comparison or explanation after the value. */
  note?: string;
  /** Colours the note: a change vs last year. */
  tone?: Tone;
  /** Needs-attention rows link to their section. */
  href?: string;
}

interface Section {
  id: string;
  title: string;
  href: string;
  /** `null` when the section's loader failed: it then says {@link NOT_AVAILABLE}. */
  metrics: Metric[] | null;
  /** Small print under the figures, such as currency notes. */
  notes?: string[];
}

interface Group {
  title: string;
  caption: string;
  sections: Section[];
}

// ---------------------------------------------------------------------------------------------
// Figures to sections

function tone(change: number | null): Tone | undefined {
  if (change === null) return undefined;
  return change > 0.0005 ? "up" : change < -0.0005 ? "down" : "flat";
}

/** Money vs last year: `+12.3% vs AED 1,234 last year`, like the KPI cards. */
function moneyVsLastYear(label: string, { current, previous }: VsLastYear<number>): Metric {
  const change = pctChange(current, previous);
  return {
    label,
    value: formatAed(current),
    note: `${change === null ? "No comparison" : formatDeltaPct(change)} vs ${formatAed(previous)} last year`,
    tone: tone(change),
  };
}

/** A ratio vs last year, in percentage points. */
function pctVsLastYear(label: string, { current, previous }: VsLastYear<number | null>): Metric {
  const change = current === null || previous === null ? null : current - previous;
  return {
    label,
    value: formatPct(current),
    note: `${change === null ? "No comparison" : formatDeltaPp(change)} vs ${formatPct(previous)} last year`,
    tone: tone(change),
  };
}

function pick<T, U>(pair: VsLastYear<T>, field: (value: T) => U): VsLastYear<U> {
  return { current: field(pair.current), previous: field(pair.previous) };
}

function metricsOf<T>(loaded: Loaded<T>, build: (data: T) => Metric[]): Metric[] | null {
  return loaded.ok ? build(loaded.data) : null;
}

function plural(count: number, one: string, many: string): string {
  return `${formatInt(count)} ${count === 1 ? one : many}`;
}

function groups(figures: OverviewFigures, url: (path: string) => string): Group[] {
  const { attention } = figures;
  const notes = (loaded: Loaded<unknown>, ...lines: (string | null)[]) =>
    loaded.ok ? lines.filter((line): line is string => line !== null) : undefined;

  return [
    {
      title: "Sales and finance",
      caption: `All companies, compared with the same period last year`,
      sections: [
        {
          id: "sales",
          title: "Sales",
          href: url("/sales"),
          metrics: metricsOf(figures.sales, ({ yesterday, mtd, ytd }) => [
            {
              label: `Net revenue, yesterday (${formatDate(figures.yesterday)})`,
              value: formatAed(yesterday.netRevenue),
            },
            moneyVsLastYear(
              "Net revenue, month to date",
              pick(mtd, (kpis) => kpis.netRevenue),
            ),
            moneyVsLastYear(
              "Net revenue, year to date",
              pick(ytd, (kpis) => kpis.netRevenue),
            ),
            pctVsLastYear(
              "Gross margin %, month to date",
              pick(mtd, (kpis) => kpis.marginPct),
            ),
            pctVsLastYear(
              "Gross margin %, year to date",
              pick(ytd, (kpis) => kpis.marginPct),
            ),
          ]),
        },
        {
          id: "finance",
          title: "Finance",
          href: url("/finance"),
          metrics: metricsOf(figures.finance, (ytd) => [
            moneyVsLastYear(
              "Net profit, year to date",
              pick(ytd, (pnl) => pnl.netProfit),
            ),
            pctVsLastYear(
              "Net margin %, year to date",
              pick(ytd, (pnl) => pnl.netMarginPct),
            ),
          ]),
        },
      ],
    },
    {
      title: "As of today",
      caption: `Balances on ${formatDate(figures.today)}, all companies`,
      sections: [
        {
          id: "inventory",
          title: "Inventory",
          href: url("/inventory"),
          metrics: metricsOf(figures.inventory, ({ stockValue, closed, change }) => [
            { label: "Stock value", value: formatAed(stockValue) },
            {
              label: "Change vs last month-end",
              value: formatAed(change),
              note: closed
                ? `vs ${formatMonth(closed.month)} close (${formatDeltaPct(pctChange(stockValue, closed.closeValue))})`
                : "No closed month-end yet",
            },
          ]),
        },
        {
          id: "purchasing",
          title: "Purchasing",
          href: url("/purchasing"),
          metrics: metricsOf(figures.purchasing, (pending) => [
            {
              label: `Pending PO value, ${ORDER_SCOPE}`,
              value: formatAed(pending.pendingValue),
              note: "Open PO lines",
            },
            {
              label: `Overdue %, ${ORDER_SCOPE}`,
              value: formatPct(pending.overduePct),
              note: `${formatAed(pending.overdueValue)} past PO date + 84 days`,
            },
          ]),
        },
        {
          id: "receivables",
          title: "Receivables",
          href: url("/receivables-payables"),
          metrics: metricsOf(figures.receivables, (ar) => [
            { label: "AR outstanding", value: formatAed(ar.balance), note: "Net of PDCs" },
            {
              label: "Share over 90 days",
              value: formatPct(ar.over90Pct),
              note: ar.over90Pct === null ? "No AR outstanding" : `${formatAed(ar.over90)} of AR outstanding`,
            },
          ]),
        },
        {
          id: "payables",
          title: "Payables",
          href: url("/receivables-payables"),
          metrics: metricsOf(figures.payables, ({ summary, vendorsOwed }) => [
            {
              label: "AP outstanding",
              value: formatAed(summary.balance),
              note: `Owed to ${plural(vendorsOwed, "vendor", "vendors")}, net of PDCs issued`,
            },
          ]),
          notes: notes(figures.payables, AP_CURRENCY_NOTE),
        },
        {
          id: "sales-orders",
          title: "Sales orders",
          href: url("/sales-orders"),
          metrics: metricsOf(figures.salesOrders, ({ book }) => [
            {
              label: `Open order value, ${ORDER_SCOPE}`,
              value: formatAed(book.openValue),
              note: "AED orders, still to deliver",
            },
            {
              label: `Open orders, ${ORDER_SCOPE}`,
              value: formatInt(book.openOrders),
              note: `${plural(book.openLines, "line", "lines")} still to deliver`,
            },
          ]),
          notes: figures.salesOrders.ok
            ? notes(figures.salesOrders, salesOrderCurrencyNote(figures.salesOrders.data.otherCurrencies))
            : undefined,
        },
      ],
    },
    {
      title: "Needs attention",
      caption: `As of ${formatDate(figures.today)}`,
      sections: [
        {
          id: "attention",
          title: "Needs attention",
          href: url("/"),
          metrics: [
            attentionMetric(
              "Overdue PO value",
              attention.overduePo,
              url("/purchasing#overdue-po-lines"),
              (po) => ({
                value: formatAed(po.overdueValue),
                note: `${plural(po.overdueLines, "line", "lines")} past PO date + 84 days, ${ORDER_SCOPE}`,
              }),
            ),
            attentionMetric(
              "AR over 90 days",
              attention.arOver90,
              url("/receivables-payables#ar-aging"),
              (over90) => ({
                value: formatAed(over90),
                note: "Customer balances 3 months old or more",
              }),
            ),
            attentionMetric(
              `Dead stock (${DEFAULT_DEAD_STOCK_MONTHS} months)`,
              attention.deadStock,
              url(`/inventory?dead=${DEFAULT_DEAD_STOCK_MONTHS}#dead-and-slow-stock`),
              (dead) => ({
                value: formatAed(dead.value),
                note: `${plural(dead.count, "item", "items")} with no movement`,
              }),
            ),
            attentionMetric(
              "Reorder alerts",
              attention.reorderCount,
              url("/inventory#reorder-alerts"),
              (count) => ({
                value: formatInt(count),
                note: "Items at or below their reorder level",
              }),
            ),
          ],
        },
      ],
    },
  ];
}

/** A Needs-attention row; if its loader failed it says {@link NOT_AVAILABLE} and still links. */
function attentionMetric<T>(
  label: string,
  loaded: Loaded<T>,
  href: string,
  build: (data: T) => Pick<Metric, "value" | "note">,
): Metric {
  return { label, href, ...(loaded.ok ? build(loaded.data) : { value: NOT_AVAILABLE }) };
}

// ---------------------------------------------------------------------------------------------
// Rendering

const FONT = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";
const COLOR = {
  page: "#eef1f5",
  card: "#ffffff",
  text: "#1f2937",
  muted: "#4b5563",
  border: "#d9dee5",
  link: "#0b5cad",
  header: "#0f3d6e",
  headerText: "#ffffff",
  up: "#137333",
  down: "#b3261e",
  flatTone: "#4b5563",
  warnBg: "#fff4d6",
  warnText: "#7a4a00",
} as const;

const TONE_COLOR: Record<Tone, string> = { up: COLOR.up, down: COLOR.down, flat: COLOR.flatTone };
const TONE_MARK: Record<Tone, string> = { up: "▲ ", down: "▼ ", flat: "" };

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function link(href: string, label: string, extra = ""): string {
  return `<a href="${escapeHtml(href)}" target="_blank" style="color:${COLOR.link};text-decoration:underline;${extra}">${label}</a>`;
}

function metricRowHtml(metric: Metric): string {
  const label = metric.href ? link(metric.href, escapeHtml(metric.label)) : escapeHtml(metric.label);
  const unavailable = metric.value === NOT_AVAILABLE;
  const noteColor = metric.tone ? TONE_COLOR[metric.tone] : COLOR.muted;
  const note = metric.note
    ? `<br><span style="${FONT}font-size:12px;line-height:18px;font-weight:normal;color:${noteColor};">${escapeHtml(
        (metric.tone ? TONE_MARK[metric.tone] : "") + metric.note,
      )}</span>`
    : "";
  return `<tr>
<td valign="top" style="${FONT}font-size:14px;line-height:20px;color:${COLOR.text};padding:8px 0;border-top:1px solid ${COLOR.border};">${label}</td>
<td valign="top" align="right" style="${FONT}font-size:15px;line-height:20px;font-weight:bold;color:${unavailable ? COLOR.warnText : COLOR.text};padding:8px 0 8px 12px;border-top:1px solid ${COLOR.border};"><span style="white-space:nowrap;">${escapeHtml(metric.value)}</span>${note}</td>
</tr>`;
}

function sectionHtml(section: Section, showTitle: boolean): string {
  const title = showTitle
    ? `<tr><td colspan="2" style="${FONT}font-size:16px;line-height:22px;font-weight:bold;color:${COLOR.text};padding:16px 0 6px 0;">${link(section.href, `${escapeHtml(section.title)} &rarr;`, `color:${COLOR.link};`)}</td></tr>`
    : "";
  const body =
    section.metrics === null
      ? `<tr><td colspan="2" bgcolor="${COLOR.warnBg}" style="${FONT}font-size:14px;line-height:20px;color:${COLOR.warnText};background-color:${COLOR.warnBg};padding:10px 12px;border:1px solid ${COLOR.border};">${NOT_AVAILABLE}. ${link(section.href, "Open the dashboard")} to try again.</td></tr>`
      : section.metrics.map(metricRowHtml).join("\n");
  const notes = (section.notes ?? [])
    .map(
      (note) =>
        `<tr><td colspan="2" style="${FONT}font-size:12px;line-height:17px;color:${COLOR.muted};padding:6px 0 0 0;">${escapeHtml(note)}</td></tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;" data-section="${section.id}">
${title}
${body}
${notes}
</table>`;
}

function groupHtml(group: Group): string {
  // A one-section group (Needs attention) has the group heading only.
  const showTitles = group.sections.length > 1;
  return `<tr><td bgcolor="${COLOR.card}" style="background-color:${COLOR.card};padding:20px 24px 4px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
<tr><td style="${FONT}font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${COLOR.header};padding:0;">${escapeHtml(group.title)}</td></tr>
<tr><td style="${FONT}font-size:12px;line-height:18px;color:${COLOR.muted};padding:2px 0 0 0;">${escapeHtml(group.caption)}</td></tr>
</table>
${group.sections.map((section) => sectionHtml(section, showTitles)).join("\n")}
</td></tr>`;
}

function metricText(metric: Metric): string {
  const note = metric.note ? ` (${(metric.tone ? TONE_MARK[metric.tone] : "") + metric.note})` : "";
  const href = metric.href ? `\n    ${metric.href}` : "";
  return `  ${metric.label}: ${metric.value}${note}${href}`;
}

function groupText(group: Group): string {
  const lines = [group.title.toUpperCase(), group.caption, ""];
  for (const section of group.sections) {
    if (group.sections.length > 1) lines.push(`${section.title} — ${section.href}`);
    if (section.metrics === null) lines.push(`  ${NOT_AVAILABLE}.`);
    else lines.push(...section.metrics.map(metricText));
    for (const note of section.notes ?? []) lines.push(`  Note: ${note}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** `07:30 on 20 Oct 2026` in Asia/Dubai. */
export function formatReadAt(readAt: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(readAt);
  return `${time} on ${formatDate(todayIso(readAt))}`;
}

/** Build the email for `figures`. Pure: the same input always gives the same email. */
export function buildSnapshotEmail(figures: OverviewFigures, options: SnapshotOptions): SnapshotEmail {
  const base = options.appUrl.replace(/\/+$/, "");
  const url = (path: string) => `${base}${path}`;
  const content = groups(figures, url);
  const source = options.sample ? "Sample data" : "Live Orion";
  const date = formatDate(figures.today);
  const subject = `MBAL daily snapshot · ${date}${options.sample ? " (sample data)" : ""}`;
  const footer = `Data read at ${formatReadAt(options.readAt)} (Asia/Dubai) · ${source}`;
  const failed = content.flatMap((group) => group.sections).filter((section) => section.metrics === null);
  const preheader = figures.sales.ok
    ? `Net revenue yesterday ${formatAed(figures.sales.data.yesterday.netRevenue)}; year to date ${formatAed(figures.sales.data.ytd.current.netRevenue)}.`
    : "MBAL's headline figures from Orion.";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
</head>
<body bgcolor="${COLOR.page}" style="margin:0;padding:0;background-color:${COLOR.page};">
<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.page}" style="width:100%;background-color:${COLOR.page};">
<tr><td align="center" style="padding:24px 8px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.card}" style="width:100%;max-width:600px;background-color:${COLOR.card};border:1px solid ${COLOR.border};">
<tr><td bgcolor="${COLOR.header}" style="background-color:${COLOR.header};padding:20px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr><td style="${FONT}font-size:22px;line-height:28px;font-weight:bold;color:${COLOR.headerText};">MBAL daily snapshot</td></tr>
<tr><td style="${FONT}font-size:14px;line-height:20px;color:${COLOR.headerText};padding-top:4px;">${escapeHtml(date)} · ${link(url("/"), "Open the Overview", `color:${COLOR.headerText};`)}</td></tr>
</table>
</td></tr>
${options.sample ? `<tr><td bgcolor="${COLOR.warnBg}" style="${FONT}font-size:13px;line-height:18px;color:${COLOR.warnText};background-color:${COLOR.warnBg};padding:10px 24px;">Sample data: these figures are synthetic, not from Orion.</td></tr>` : ""}
${content.map(groupHtml).join("\n")}
<tr><td bgcolor="${COLOR.card}" style="background-color:${COLOR.card};padding:16px 24px 20px 24px;border-top:1px solid ${COLOR.border};${FONT}font-size:12px;line-height:18px;color:${COLOR.muted};" data-footer="">${escapeHtml(footer)}<br>Figures for all companies, from the same loaders as the dashboards. Money is in AED.</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;

  const text = [
    `MBAL daily snapshot · ${date}`,
    `Overview: ${url("/")}`,
    ...(options.sample ? ["Sample data: these figures are synthetic, not from Orion."] : []),
    "",
    ...content.map(groupText),
    "--",
    footer,
    "Figures for all companies, from the same loaders as the dashboards. Money is in AED.",
    ...(failed.length > 0 ? [`${NOT_AVAILABLE}: ${failed.map((section) => section.title).join(", ")}.`] : []),
    "",
  ].join("\n");

  return { subject, html, text };
}
