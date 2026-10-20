import { afterEach, describe, expect, it, vi } from "vitest";

import { runQuery, setRunnerForTests } from "@/lib/server/db";
import { DataSourceError, friendlyMessage } from "@/lib/server/errors";

describe("friendly Oracle error messages", () => {
  it.each([
    ["DPY-6005: cannot connect to database", "Couldn't connect to Orion (DPY-6005)"],
    ["NJS-510: connection to host 10.0.0.1 port 1521 timed out", "Couldn't connect to Orion (NJS-510)"],
    ["ORA-12541: TNS:no listener", "Couldn't connect to Orion (ORA-12541)"],
    [
      'NJS-040: connection request timeout. Request exceeded "queueTimeout"',
      "Couldn't connect to Orion (NJS-040)",
    ],
    ["ORA-01017: invalid username/password; logon denied", "Orion rejected the login (ORA-01017)"],
    ["ORA-00942: table or view does not exist", "The Orion query failed (ORA-00942)"],
    ["something odd", "Loading data failed"],
  ])("%s", (raw, expected) => {
    const message = friendlyMessage(new Error(raw));
    expect(message).toContain(expected);
    expect(message).not.toContain("10.0.0.1");
  });
});

describe("runQuery errors and cache", () => {
  afterEach(() => {
    setRunnerForTests(undefined);
    vi.unstubAllEnvs();
  });

  it("wraps driver errors and does not cache failures", async () => {
    let calls = 0;
    setRunnerForTests(async () => {
      calls += 1;
      if (calls === 1) throw new Error("DPY-6005: cannot connect to database (host secret-host)");
      return [{ x: 1 }];
    });
    const error = await runQuery("SELECT 1 AS x FROM dual").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DataSourceError);
    expect((error as DataSourceError).userMessage).not.toContain("secret-host");
    expect(await runQuery("SELECT 1 AS x FROM dual")).toEqual([{ x: 1 }]);
    expect(await runQuery("SELECT 1 AS x FROM dual")).toEqual([{ x: 1 }]);
    expect(calls).toBe(2); // the third call came from the cache
  });

  it("keys the cache by binds", async () => {
    let calls = 0;
    setRunnerForTests(async (_sql, binds) => {
      calls += 1;
      return [binds];
    });
    await runQuery("SELECT :a FROM dual", { a: 1 });
    await runQuery("SELECT :a FROM dual", { a: 2 });
    await runQuery("SELECT :a FROM dual", { a: 1 });
    expect(calls).toBe(2);
  });

  it("explains a bad data source setting", async () => {
    vi.stubEnv("MBAL_DATA_SOURCE", "excel");
    const error = await runQuery("SELECT 1 FROM dual").catch((caught: unknown) => caught);
    expect((error as DataSourceError).userMessage).toContain("must be 'sample' or 'oracle'");
  });

  it("oracle mode without credentials says which variables are missing", async () => {
    vi.stubEnv("MBAL_DATA_SOURCE", "oracle");
    vi.stubEnv("ORACLE_USER", "");
    vi.stubEnv("ORACLE_PASSWORD", "");
    vi.stubEnv("ORACLE_DSN", "");
    const error = await runQuery("SELECT 1 FROM dual").catch((caught: unknown) => caught);
    expect((error as DataSourceError).userMessage).toContain("ORACLE_USER, ORACLE_PASSWORD, ORACLE_DSN");
  });
});
