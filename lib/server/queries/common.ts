import "server-only";

import { run } from "../db";
import type { Query } from "../types";

export interface Company {
  code: string;
  name: string;
}

// Companies come from the sales view: it carries both code and name for every trading company.
export function companiesQuery(): Query {
  return {
    sql: `
SELECT CSL_COMP_CODE AS code, MAX(CSL_COMP_NAME) AS name
FROM MBALI.ZF_CSL_BI
WHERE CSL_COMP_CODE IS NOT NULL
GROUP BY CSL_COMP_CODE
ORDER BY CSL_COMP_CODE`,
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
