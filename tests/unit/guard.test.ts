import { afterEach, describe, expect, it } from "vitest";

import { runQuery, setRunnerForTests } from "@/lib/server/db";
import { DataSourceError } from "@/lib/server/errors";
import { ensureReadOnly, ReadOnlyViolation } from "@/lib/server/guard";
import { SampleSource } from "@/lib/server/sample";

import { FIXTURE_DIR } from "./fixture";

describe("ensureReadOnly", () => {
  it.each([
    "SELECT 1 FROM dual",
    "select CSL_COMP_CODE from MBALI.ZF_CSL_BI where CSL_DATE >= :start_date",
    "  \n WITH t AS (SELECT 1 AS x FROM dual) SELECT x FROM t",
    "-- leading comment\nSELECT 1 FROM dual",
    "/* hint-style comment */ SELECT 1 FROM dual",
    "SELECT updated_at, created_by FROM t", // keywords only as parts of longer names
  ])("accepts %j", (sql) => {
    expect(ensureReadOnly(sql)).toBe(sql);
  });

  it.each([
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET x = 1",
    "DELETE FROM t",
    "DROP TABLE t",
    "MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET x = 1",
    "TRUNCATE TABLE t",
    "CREATE TABLE t (x NUMBER)",
    "ALTER TABLE t ADD y NUMBER",
    "GRANT SELECT ON t TO someone",
    "BEGIN NULL; END;",
    "SELECT 1 FROM dual; DROP TABLE t",
    "SELECT 1 FROM dual;",
    "SELECT * FROM t FOR UPDATE",
    "WITH x AS (SELECT 1 FROM dual) DELETE FROM t",
    "select 1 from dual where 1 = 1 or delete_me is null union all select 1 from t; delete t",
    "EXPLAIN PLAN FOR SELECT 1 FROM dual",
    "",
    "   ",
  ])("rejects %j", (sql) => {
    expect(() => ensureReadOnly(sql)).toThrow(ReadOnlyViolation);
  });
});

describe("guard in the data layer", () => {
  afterEach(() => setRunnerForTests(undefined));

  it("runQuery refuses writes with a friendly message and never reaches the source", async () => {
    let called = false;
    setRunnerForTests(async () => {
      called = true;
      return [];
    });
    const error = await runQuery("DELETE FROM MBALI.ZF_CSL_BI").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DataSourceError);
    expect((error as DataSourceError).userMessage).toContain("read-only guard");
    expect(called).toBe(false);
  });

  it("the sample source applies the guard too", async () => {
    const source = new SampleSource({ fixtureDir: FIXTURE_DIR });
    await expect(source.query("DROP TABLE MBALI.ZF_CSL_BI")).rejects.toThrow(ReadOnlyViolation);
  });
});
