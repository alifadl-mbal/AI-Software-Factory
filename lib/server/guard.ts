/**
 * The read-only guard that every query passes through before it reaches a data source.
 *
 * Orion is the ERP's source of truth and the account we use can technically write, so the guard
 * is the line of defence: only a single `SELECT` or `WITH` statement is ever executed. The check
 * is textual and deliberately strict. A forbidden word anywhere in the statement, even inside a
 * string literal or a comment, gets it rejected; reword the query or use a bind variable.
 */

export const FORBIDDEN_KEYWORDS = [
  "ALTER",
  "BEGIN",
  "CALL",
  "COMMIT",
  "CREATE",
  "DECLARE",
  "DELETE",
  "DROP",
  "EXEC",
  "EXECUTE",
  "GRANT",
  "INSERT",
  "LOCK",
  "MERGE",
  "RENAME",
  "REVOKE",
  "ROLLBACK",
  "SAVEPOINT",
  "TRUNCATE",
  "UPDATE",
  "UPSERT",
] as const;

const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join("|")})\\b`, "i");
const LEADING_COMMENTS_RE = /^\s*(?:(?:--[^\n]*\n?|\/\*[\s\S]*?\*\/)\s*)*/;
const FIRST_WORD_RE = /^[A-Za-z]+/;

/** The statement is not a single read-only query. */
export class ReadOnlyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyViolation";
  }
}

/** Return `sql` unchanged if it is a single SELECT/WITH statement, else throw ReadOnlyViolation. */
export function ensureReadOnly(sql: string): string {
  if (!sql || !sql.trim()) {
    throw new ReadOnlyViolation("Empty statement.");
  }
  if (sql.includes(";")) {
    throw new ReadOnlyViolation("Only a single statement is allowed (found ';').");
  }
  const forbidden = FORBIDDEN_RE.exec(sql);
  if (forbidden) {
    throw new ReadOnlyViolation(`Forbidden keyword: ${forbidden[1].toUpperCase()}.`);
  }
  const body = sql.replace(LEADING_COMMENTS_RE, "");
  const firstWord = FIRST_WORD_RE.exec(body)?.[0].toUpperCase();
  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    throw new ReadOnlyViolation("Only SELECT or WITH statements are allowed.");
  }
  return sql;
}
