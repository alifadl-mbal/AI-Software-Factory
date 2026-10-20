import "server-only";

import { run } from "../db";
import type { Query } from "../types";

export interface Company {
  code: string;
  name: string;
}

// Companies come from Orion's company master, `MBALI.FM_COMPANY` (one row per company). It used to
// be the distinct companies of the sales view, which took 7 s on live Orion (a full scan of 3.7M
// lines, on every page that names companies) and left out companies that never sold anything but
// do have postings, stock or POs, so the filter couldn't select them.
export function companiesQuery(): Query {
  return {
    sql: `
SELECT TRIM(COMP_CODE) AS code, MAX(TRIM(COMP_NAME)) AS name
FROM MBALI.FM_COMPANY
WHERE COMP_CODE IS NOT NULL
GROUP BY TRIM(COMP_CODE)
ORDER BY TRIM(COMP_CODE)`,
    binds: {},
  };
}

/** Every company, for the company filter. */
export async function companies(): Promise<Company[]> {
  const rows = await run(companiesQuery());
  return rows.map((row) => ({
    code: String(row.code),
    name: row.name ? String(row.name) : String(row.code),
  }));
}
