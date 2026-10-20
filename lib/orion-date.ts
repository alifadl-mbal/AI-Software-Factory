import { isoDate } from "./filters";

/**
 * Orion's text dates, `DD-Mon-YYYY` (`10-Oct-2026`), as `VARCHAR2(11)` columns such as
 * `ZF_SO_BI.H_DEL_DT`. Month names are English and always three letters. This module converts them
 * to and from the app's `YYYY-MM-DD` and builds the same conversion in portable SQL, so a query can
 * compare them with a bound date. Safe on client and server.
 */
export const ORION_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const ORION_DATE_RE = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/;

/** `10-Oct-2026` → `2026-10-10`; `null` for blanks and anything that isn't a real date. */
export function parseOrionDate(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const match = ORION_DATE_RE.exec(text.trim());
  if (!match) return null;
  const month = ORION_MONTHS.findIndex((name) => name.toUpperCase() === match[2].toUpperCase()) + 1;
  if (month === 0) return null;
  const iso = isoDate(Number(match[3]), month, Number(match[1]));
  // Rejects 31-Feb and the like: they don't survive a round trip through Date.
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/** `2026-10-10` → `10-Oct-2026`. */
export function formatOrionDate(iso: string): string {
  return `${iso.slice(8, 10)}-${ORION_MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;
}

/**
 * SQL that turns a `DD-Mon-YYYY` column into `YYYY-MM-DD` text, `NULL` when the month isn't
 * recognised. Only `CASE`, `UPPER`, `SUBSTR` and `||`, so it runs unchanged on Oracle and on SQLite
 * in sample mode, and doesn't depend on Oracle's NLS date language. Each branch builds the whole
 * string because Oracle treats `NULL || 'x'` as `'x'` where SQLite gives `NULL`.
 */
export function orionDateSql(column: string): string {
  const branches = ORION_MONTHS.map(
    (name, index) =>
      `WHEN '${name.toUpperCase()}' THEN SUBSTR(${column}, 8, 4) || '-${String(index + 1).padStart(2, "0")}-' || SUBSTR(${column}, 1, 2)`,
  );
  return `CASE UPPER(SUBSTR(${column}, 4, 3)) ${branches.join(" ")} END`;
}
