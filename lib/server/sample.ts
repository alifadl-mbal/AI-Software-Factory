import "server-only";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { addDays } from "@/lib/filters";

import { ensureReadOnly } from "./guard";
import type { Binds, Row } from "./types";

/**
 * Sample mode: runs the same Oracle SQL against CSV fixtures loaded into in-memory SQLite.
 *
 * Each `<VIEW>.csv` in the fixture directory becomes the table `MBALI.<VIEW>`. SQLite gets shims
 * for the Oracle functions our queries use (`NVL`, `TO_CHAR` and `TO_DATE` on dates). Fixture dates
 * are `YYYY-MM-DD` text, which compares correctly against `TO_DATE(:bind, 'YYYY-MM-DD')`. Period
 * columns (`*_PERIOD`, `YYYYMM` like `ZSL_PERIOD`) load as numbers, as they compare in Oracle.
 * See "Portable SQL" in the README for the subset queries must stay within.
 */

export const SAMPLE_DIR = path.join(process.cwd(), "data", "sample");
const SAMPLE_SCHEMA = "MBALI";
/**
 * Views of open balances, aged against today. Shifting them by whole years would leave documents in
 * the future or age them all into the same bucket, so with `anchorToDate` their dates move by whole
 * days instead, until the newest date in the file is that day.
 */
export const BALANCE_VIEWS: ReadonlySet<string> = new Set(["ZF_SOA_DETL_CUST_INV_SM_BI", "ZF_SOAP_DETL_BI"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const PERIOD_RE = /^\d{6}$/;
const DATE_FORMATS: Record<string, (text: string) => string> = {
  "YYYY-MM-DD": (text) => text.slice(0, 10),
  "YYYY-MM": (text) => text.slice(0, 7),
  YYYY: (text) => text.slice(0, 4),
};

export interface SampleOptions {
  fixtureDir?: string;
  /**
   * Shift every fixture date by whole years so the newest fixture year becomes this year. The app
   * passes the current year so "year to date" always has data; tests pass `null` for fixed dates.
   */
  rebaseToYear?: number | null;
  /**
   * Shift every `*_PERIOD` (`YYYYMM`) value by whole months so the newest becomes this month
   * (`YYYY-MM`), making it the current, provisional month-end. `null` leaves periods as they are.
   */
  rebaseToMonth?: string | null;
  /**
   * Shift the dates of the `BALANCE_VIEWS` fixtures by whole days so the newest is this date
   * (`YYYY-MM-DD`). The app passes today; tests pass `null` for fixed dates.
   */
  anchorToDate?: string | null;
}

export class SampleSource {
  private readonly fixtureDir: string;
  private readonly rebaseToYear: number | null;
  private readonly rebaseToMonth: string | null;
  private readonly anchorToDate: string | null;
  private database: DatabaseSync | undefined;

  constructor({
    fixtureDir = SAMPLE_DIR,
    rebaseToYear = null,
    rebaseToMonth = null,
    anchorToDate = null,
  }: SampleOptions = {}) {
    this.fixtureDir = fixtureDir;
    this.rebaseToYear = rebaseToYear;
    this.rebaseToMonth = rebaseToMonth;
    this.anchorToDate = anchorToDate;
  }

  async query<T extends Row = Row>(sql: string, binds: Binds = {}): Promise<T[]> {
    ensureReadOnly(sql);
    const statement = this.connect().prepare(sql);
    const rows = statement.all(binds as Record<string, SQLInputValue>);
    return rows.map((row) => lowerCaseKeys(row) as T);
  }

  private connect(): DatabaseSync {
    if (!this.database) {
      const database = new DatabaseSync(":memory:");
      database.exec(`ATTACH DATABASE ':memory:' AS ${SAMPLE_SCHEMA}`);
      database.function("NVL", { deterministic: true }, (value, fallback) =>
        value === null ? fallback : value,
      );
      database.function("TO_CHAR", { deterministic: true }, (value, format) =>
        value === null ? null : dateFormatter(format)(String(value)),
      );
      database.function("TO_DATE", { deterministic: true }, (value, format) =>
        value === null ? null : dateFormatter(format)(String(value)),
      );
      for (const file of readdirSync(this.fixtureDir).filter((name) => name.endsWith(".csv"))) {
        const table = parseCsv(readFileSync(path.join(this.fixtureDir, file), "utf8"));
        const view = path.basename(file, ".csv").toUpperCase();
        if (BALANCE_VIEWS.has(view)) {
          if (this.anchorToDate !== null) anchorDates(table, this.anchorToDate);
        } else if (this.rebaseToYear !== null) {
          rebaseDates(table, this.rebaseToYear);
        }
        if (this.rebaseToMonth !== null) {
          rebasePeriods(table, this.rebaseToMonth);
        }
        loadTable(database, `${SAMPLE_SCHEMA}."${view}"`, table);
      }
      this.database = database;
    }
    return this.database;
  }
}

function dateFormatter(format: unknown): (text: string) => string {
  const formatter = DATE_FORMATS[String(format)];
  if (!formatter) {
    throw new Error(`Date format '${String(format)}' is not supported in sample mode.`);
  }
  return formatter;
}

function lowerCaseKeys(row: Record<string, unknown>): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
}

export interface Table {
  header: string[];
  /** One array per row; `null` for an empty cell. */
  rows: (string | null)[][];
}

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF line ends. */
export function parseCsv(text: string): Table {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const [header = [], ...rows] = records.filter((row) => row.some((cell) => cell !== ""));
  return { header, rows: rows.map((row) => header.map((_, i) => (row[i] ? row[i] : null))) };
}

/** The indexes of the columns that hold nothing but `YYYY-MM-DD` dates, with their values. */
function dateColumns(table: Table): { column: number; values: string[] }[] {
  return table.header.flatMap((_, column) => {
    const values = table.rows.map((row) => row[column]).filter((value) => value !== null);
    return values.length > 0 && values.every((value) => ISO_DATE_RE.test(value)) ? [{ column, values }] : [];
  });
}

/** Move every date by the same number of days, so the newest one in the table is `date`. */
export function anchorDates(table: Table, date: string): void {
  const columns = dateColumns(table);
  if (columns.length === 0) return;
  const newest = columns.flatMap(({ values }) => values).reduce((max, value) => (value > max ? value : max));
  const offset = Math.round((Date.parse(date) - Date.parse(newest)) / 86_400_000);
  for (const { column } of columns) {
    for (const row of table.rows) {
      const value = row[column];
      if (value !== null) row[column] = addDays(value, offset);
    }
  }
}

function rebaseDates(table: Table, targetYear: number): void {
  for (const { column, values } of dateColumns(table)) {
    const offset = targetYear - Math.max(...values.map((value) => Number(value.slice(0, 4))));
    if (offset === 0) continue;
    for (const row of table.rows) {
      const value = row[column];
      if (value !== null) row[column] = shiftYear(value, offset);
    }
  }
}

function rebasePeriods(table: Table, targetMonth: string): void {
  const target = Number(targetMonth.slice(0, 4)) * 12 + Number(targetMonth.slice(5, 7)) - 1;
  const index = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(4, 6)) - 1;
  table.header.forEach((name, column) => {
    if (!name.endsWith("_PERIOD")) return;
    const values = table.rows.map((row) => row[column]).filter((value) => value !== null);
    if (values.length === 0 || !values.every((value) => PERIOD_RE.test(value))) return;
    const offset = target - Math.max(...values.map(index));
    if (offset === 0) return;
    for (const row of table.rows) {
      const value = row[column];
      if (value === null) continue;
      const shifted = index(value) + offset;
      row[column] = `${Math.floor(shifted / 12)}${String((shifted % 12) + 1).padStart(2, "0")}`;
    }
  });
}

function shiftYear(text: string, offset: number): string {
  const year = Number(text.slice(0, 4)) + offset;
  const monthDay = text.slice(4) === "-02-29" ? "-02-28" : text.slice(4);
  return `${year}${monthDay}`;
}

function loadTable(database: DatabaseSync, name: string, table: Table): void {
  // Codes like '107' and GL accounts like '40809' are VARCHAR2 in Orion: keep *_CODE, *_NAME and
  // *_ACNT as text, not numbers.
  const numeric = table.header.map(
    (column, index) =>
      !/_(CODE|NAME|ACNT)$/.test(column) &&
      table.rows.some((row) => row[index] !== null) &&
      table.rows.every((row) => row[index] === null || NUMBER_RE.test(row[index])),
  );
  const columns = table.header
    .map((column, index) => `"${column}" ${numeric[index] ? "REAL" : "TEXT"}`)
    .join(", ");
  database.exec(`CREATE TABLE ${name} (${columns})`);
  const insert = database.prepare(`INSERT INTO ${name} VALUES (${table.header.map(() => "?").join(", ")})`);
  database.exec("BEGIN");
  for (const row of table.rows) {
    insert.run(...row.map((value, index) => (value !== null && numeric[index] ? Number(value) : value)));
  }
  database.exec("COMMIT");
}
