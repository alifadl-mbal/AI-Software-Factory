import { formatAed, formatAedCompact, formatDate, formatInt, formatPct, formatQty } from "@/lib/format";

/**
 * How a value is shown. Server components pass these names to client components (functions
 * can't cross that boundary), and the client formats with them.
 */
export type ValueFormat = "aed" | "aedCompact" | "int" | "qty" | "pct" | "date" | "text";

/** Formats that are numbers: right-aligned, summable, sorted largest first. */
export function isNumericFormat(format: ValueFormat | undefined): boolean {
  return format !== undefined && format !== "text" && format !== "date";
}

export function formatValue(format: ValueFormat, value: unknown): string {
  if (format === "text") return value === null || value === undefined ? "" : String(value);
  // Dates travel as YYYY-MM-DD, so they also sort correctly as text.
  if (format === "date") return typeof value === "string" && value ? formatDate(value) : "";
  const number = value === null || value === undefined ? null : Number(value);
  switch (format) {
    case "aed":
      return formatAed(number);
    case "aedCompact":
      return formatAedCompact(number);
    case "int":
      return formatInt(number);
    case "qty":
      return formatQty(number);
    case "pct":
      return formatPct(number);
  }
}
