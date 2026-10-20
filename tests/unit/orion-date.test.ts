import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { formatOrionDate, orionDateSql, parseOrionDate } from "@/lib/orion-date";

describe("Orion DD-Mon-YYYY dates", () => {
  it.each([
    ["10-Oct-2026", "2026-10-10"],
    ["01-Jan-2025", "2025-01-01"],
    ["29-Feb-2024", "2024-02-29"],
    ["31-Dec-1999", "1999-12-31"],
    ["05-SEP-2025", "2025-09-05"],
  ])("%s is %s", (text, iso) => {
    expect(parseOrionDate(text)).toBe(iso);
  });

  it.each([null, undefined, "", "2026-10-10", "10-Okt-2026", "31-Feb-2025", "1-Oct-2026", 20261010])(
    "%s is not a date",
    (text) => {
      expect(parseOrionDate(text)).toBeNull();
    },
  );

  it("round-trips", () => {
    for (const iso of ["2026-10-10", "2025-01-01", "2024-02-29", "2025-12-31"]) {
      expect(parseOrionDate(formatOrionDate(iso))).toBe(iso);
    }
    expect(formatOrionDate("2026-03-07")).toBe("07-Mar-2026");
  });

  it("the SQL gives the same date as the TypeScript parser, and NULL for an unknown month", () => {
    const database = new DatabaseSync(":memory:");
    const texts = ["10-Oct-2026", "01-Jan-2025", "29-Feb-2024", "31-Dec-1999", "05-SEP-2025", "10-Okt-2026"];
    for (const text of texts) {
      const row = database.prepare(`SELECT ${orionDateSql(":d")} AS iso`).get({ d: text });
      expect(row?.iso ?? null).toBe(parseOrionDate(text));
    }
  });
});
