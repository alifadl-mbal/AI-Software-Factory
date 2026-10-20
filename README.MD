# MBAL BI dashboards

Business-intelligence dashboards for MBAL, built on **Orion**, MBAL's Oracle ERP. Orion is read
through the `MBALI.ZF_*_BI` views and is **read-only** for this app.

Stack: Python 3.12 · Streamlit (multipage) · python-oracledb (thin mode, no Instant Client) ·
pandas · Plotly · pytest · ruff · GitHub Actions.

Dashboards so far:

| Page | View | What it shows |
|---|---|---|
| Sales | `MBALI.ZF_CSL_BI` | Net revenue, gross margin, margin %, invoices, returns (vs last year); monthly trend; revenue by company, customer, item, salesperson and item group |

## Setup

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

## Running

### Sample mode (default)

No network or credentials needed. Data comes from synthetic CSV fixtures in
`mbal_bi/sample_data/`, and every page shows a **Sample data** banner.

```bash
streamlit run app.py --server.port 8501 --server.headless true
```

Sample dates are shifted by whole years so the newest fixture year is the current year, so
"year to date" always has something to show.

### Oracle mode (live Orion)

Needs the office network or VPN. Set the variables below in your shell or service environment.
The app reads real environment variables and does not load `.env` files itself.

```bash
export MBAL_DATA_SOURCE=oracle
export ORACLE_USER=...
export ORACLE_PASSWORD=...
export ORACLE_DSN=host:port/service_name
streamlit run app.py --server.port 8501 --server.headless true
```

PowerShell: `$env:MBAL_DATA_SOURCE = "oracle"` and so on.

If Orion can't be reached, or a query fails, the page shows a short error message instead of a
stack trace; full details go to the server log. The connect timeout is 15 seconds.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `MBAL_DATA_SOURCE` | no | `sample` (default) or `oracle` |
| `ORACLE_USER` | oracle mode | Orion user |
| `ORACLE_PASSWORD` | oracle mode | Orion password |
| `ORACLE_DSN` | oracle mode | Easy Connect string, `host:port/service_name` |

There are no built-in defaults for the Oracle settings. See `.env.example`. Never commit a `.env`
file, a password or an internal host name.

## How it fits together

```
app.py                     home page: dashboard list + headline sales figures
pages/1_Sales.py           Sales dashboard (one file per dashboard)
mbal_bi/
  config.py                MBAL_DATA_SOURCE, Oracle env vars, cache TTL
  db.py                    Oracle connection + the read-only guard
  datasource.py            run_query(): picks sample or oracle, caches, friendly errors
  filters.py               Filters (date range, companies) -> SQL fragment + bind variables
  formatting.py            AED / number / percent formatting
  ui.py                    page_setup, sidebar_filters, load, KPI tiles, charts
  dashboards.py            the list the home page shows
  queries/                 SQL per domain (sales.py, common.py)
  sample_data/             synthetic fixtures, one CSV per view, real column names
scripts/generate_sample_data.py   regenerates the sample CSVs (deterministic)
tests/                     unit tests + AppTest smoke tests
```

Rules every query follows:

- **Read-only.** All SQL goes through `run_query`, which only accepts a single `SELECT` or `WITH`
  statement and rejects `;` and DML/DDL keywords (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `DROP`,
  ...). The check is textual: those words are refused even inside string literals or comments.
- **Bind variables** for every filter value (`:start_date`, `:company_0`, ...). Never format
  values into SQL text.
- **Aggregate in Oracle** (`GROUP BY`, top-N with `ROW_NUMBER()`). Never pull a whole fact table
  into pandas.
- **Same SQL in both modes.** Sample mode loads the CSVs into in-memory SQLite as `MBALI.<VIEW>`
  and runs the Oracle SQL unchanged, with small shims for `NVL` and `TO_CHAR(date, 'YYYY-MM')`.
  Stick to portable SQL (`CASE`, `COALESCE`, `NULLIF`, `TRIM`, window functions), or add a shim
  in `datasource.py`.
- Results are cached for 15 minutes (`st.cache_data`); the sidebar's **Refresh data** clears it.
- Blank dimension values show as **Unassigned**, never dropped (`label_or_unassigned`).

Business rules for Orion (signs, statuses, traps) are in the `mbal-db` Claude skill,
`references/business-rules.md` and `references/schema.md`. The Sales rules are summarised at the
top of `mbal_bi/queries/sales.py`.

## Adding a dashboard

1. **Queries.** Create `mbal_bi/queries/<domain>.py`. Write `*_query(filters) -> Query` builders
   (SQL + binds) and loader functions that call `.run()`. Use `filters.where(DATE_COLUMN,
   COMPANY_COLUMN)` for the shared filters.
2. **Sample data.** Add the view's columns to a CSV named after the view, e.g.
   `mbal_bi/sample_data/ZF_F_T_DETAIL_BI.csv` (real Oracle column names, dates as `YYYY-MM-DD`,
   synthetic values only). Extend `scripts/generate_sample_data.py` to produce it.
3. **Page.** Create `pages/<n>_<Name>.py`:

   ```python
   import streamlit as st
   from mbal_bi import ui
   from mbal_bi.queries import finance

   ui.page_setup("Finance", ":material/account_balance:")
   filters = ui.sidebar_filters()
   totals = ui.load(finance.totals, filters)   # friendly error + stop on failure
   ...
   ```

4. **Home page.** Add a `Dashboard(...)` entry to `mbal_bi/dashboards.py`.
5. **Tests.** Add hand-computed tests for the numbers (a small fixture in `tests/fixtures/` plus the
   `fixture_source` pytest fixture) and bind-variable tests. The smoke test in
   `tests/test_app_smoke.py` loads every registered page automatically.

## Checks

```bash
ruff check .
pytest
```

CI (`.github/workflows/ci.yml`) runs both on every push and pull request, in sample mode.
