import { formatInt, formatNumber } from "./format";

/**
 * Notes about what a figure covers, shared by the pages and the daily snapshot email so both say
 * the same thing. Plain text: the pages render it in a paragraph, the email in HTML and plain text.
 */

export const AP_CURRENCY_NOTE =
  "Orion’s payables view has no AED column, so each vendor’s balance is in its account currency as booked " +
  "(AED for most vendors). Vendors are netted per company before splitting into what we owe and what we " +
  "have prepaid.";

export interface ForeignCurrencyBook {
  currency: string;
  lines: number;
  openValue: number;
}

/** The sales-order currency note; `null` when every open order is in AED. */
export function salesOrderCurrencyNote(rows: readonly ForeignCurrencyBook[]): string | null {
  if (rows.length === 0) return null;
  const list = rows
    .map(
      (row) =>
        `${row.currency} ${formatNumber(row.openValue)} (${formatInt(row.lines)} ${row.lines === 1 ? "line" : "lines"})`,
    )
    .join(", ");
  return (
    "Orion’s sales-order view has no AED value or exchange rate, so the AED figures cover AED orders only. " +
    `Open orders in other currencies, still to deliver: ${list}. They are counted in open orders and lines.`
  );
}
