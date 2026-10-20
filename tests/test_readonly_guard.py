import pytest

from mbal_bi import datasource
from mbal_bi.db import ReadOnlyViolation, ensure_read_only


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1 FROM dual",
        "select CSL_COMP_CODE from MBALI.ZF_CSL_BI where CSL_DATE >= :start_date",
        "  \n WITH t AS (SELECT 1 AS x FROM dual) SELECT x FROM t",
        "-- leading comment\nSELECT 1 FROM dual",
        "/* hint-style comment */ SELECT 1 FROM dual",
        "SELECT updated_at, created_by FROM t",  # keywords only as parts of longer names
    ],
)
def test_accepts_select_and_with(sql):
    assert ensure_read_only(sql) == sql


@pytest.mark.parametrize(
    "sql",
    [
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
    ],
)
def test_rejects_dml_ddl_and_multiple_statements(sql):
    with pytest.raises(ReadOnlyViolation):
        ensure_read_only(sql)


def test_run_query_refuses_writes_with_friendly_message():
    with pytest.raises(datasource.DataSourceError) as error:
        datasource.run_query("DELETE FROM MBALI.ZF_CSL_BI")
    assert "read-only guard" in error.value.user_message


def test_sample_source_also_applies_guard():
    with pytest.raises(ReadOnlyViolation):
        datasource.SampleSource().query("DROP TABLE MBALI.ZF_CSL_BI")
