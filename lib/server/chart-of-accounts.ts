import "server-only";

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parseCsv } from "./sample";

/**
 * The chart of accounts: GL main account → P&L / balance-sheet grouping.
 *
 * It lives in `data/chart-of-accounts.csv` (`main_acnt, main_acnt_name, level_0, level_1,
 * level_2`), a plain data file finance can replace without touching code. Orion is read-only, so
 * the file can't be joined in SQL: queries aggregate by `D_MAIN_ACNT` and `classify` attaches the
 * levels afterwards. That is a LEFT JOIN: an account missing from the file comes back as
 * 'Unmapped', never dropped. The file is re-read whenever it changes on disk.
 */

export const CHART_OF_ACCOUNTS_PATH = path.join(process.cwd(), "data", "chart-of-accounts.csv");

/** Every level of an account that isn't in the chart of accounts. */
export const UNMAPPED = "Unmapped";

/** `level_0` of the income-statement accounts. */
export const PROFIT_AND_LOSS = "Profit and loss";

/** The P&L `level_1` groups, in statement order. */
export const REVENUE = "Revenue";
export const COST_OF_SALES = "Cost of sales";
export const GENERAL_AND_ADMIN = "General and admin expenses";
export const PNL_LEVELS = [REVENUE, COST_OF_SALES, GENERAL_AND_ADMIN] as const;
export type PnlLevel = (typeof PNL_LEVELS)[number];

/** The cost groups: they sum negative (debits) and are shown as positive costs on screen. */
export const EXPENSE_LEVELS: readonly string[] = [COST_OF_SALES, GENERAL_AND_ADMIN];

export interface AccountMapping {
  mainAcnt: string;
  name: string;
  level0: string;
  level1: string;
  level2: string;
}

const REQUIRED_COLUMNS = ["main_acnt", "main_acnt_name", "level_0", "level_1", "level_2"];

let filePath = CHART_OF_ACCOUNTS_PATH;
let cached: { path: string; mtimeMs: number; accounts: Map<string, AccountMapping> } | undefined;

/** Parse chart-of-accounts CSV text. Codes and names are trimmed; blank codes are skipped. */
export function parseChartOfAccounts(text: string): Map<string, AccountMapping> {
  const { header, rows } = parseCsv(text);
  const columns = header.map((column) => column.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    throw new Error(`The chart of accounts is missing column(s): ${missing.join(", ")}.`);
  }
  const at = (row: (string | null)[], column: string) => (row[columns.indexOf(column)] ?? "").trim();
  const accounts = new Map<string, AccountMapping>();
  for (const row of rows) {
    const mainAcnt = at(row, "main_acnt");
    if (!mainAcnt) continue;
    accounts.set(mainAcnt, {
      mainAcnt,
      name: at(row, "main_acnt_name"),
      level0: at(row, "level_0") || UNMAPPED,
      level1: at(row, "level_1") || UNMAPPED,
      level2: at(row, "level_2") || UNMAPPED,
    });
  }
  return accounts;
}

/** The chart of accounts, keyed by main account code. */
export function chartOfAccounts(): Map<string, AccountMapping> {
  // A runtime data file read from the working directory, like the sample fixtures: keep the bundler
  // from tracing the whole project because of the variable path.
  const { mtimeMs } = statSync(/*turbopackIgnore: true*/ filePath);
  if (cached?.path !== filePath || cached.mtimeMs !== mtimeMs) {
    cached = {
      path: filePath,
      mtimeMs,
      accounts: parseChartOfAccounts(readFileSync(/*turbopackIgnore: true*/ filePath, "utf8")),
    };
  }
  return cached.accounts;
}

/**
 * The levels for one account: from the chart of accounts, or 'Unmapped' at every level. The name
 * falls back to the one Orion has when the file has none.
 */
export function classify(
  accounts: Map<string, AccountMapping>,
  mainAcnt: string,
  orionName: string,
): AccountMapping {
  const mapping = accounts.get(mainAcnt);
  if (mapping) return { ...mapping, name: mapping.name || orionName || mainAcnt };
  return {
    mainAcnt,
    name: orionName || mainAcnt || UNMAPPED,
    level0: UNMAPPED,
    level1: UNMAPPED,
    level2: UNMAPPED,
  };
}

/** Test hook: read the chart of accounts from another file (or back to the real one). */
export function setChartOfAccountsPathForTests(override: string | undefined): void {
  filePath = override ?? CHART_OF_ACCOUNTS_PATH;
  cached = undefined;
}
