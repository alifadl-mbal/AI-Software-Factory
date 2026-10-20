/** Bind values. Dates travel as `YYYY-MM-DD` strings and are wrapped in `TO_DATE` in the SQL. */
export type BindValue = string | number | null;
export type Binds = Record<string, BindValue>;

/** One result row. Column names are lower-cased whatever the source. */
export type Row = Record<string, unknown>;

/** SQL text plus its bind values. Query builders return these so tests can inspect them. */
export interface Query {
  sql: string;
  binds: Binds;
}
