-- =============================================================================================
-- Fabric validation: every hand query, both sides, so the check can be re-run.
-- See README.md in this folder for what each one feeds and how the results were compared.
--
-- Periods used for the 2026-10-21 run (change the literals to re-run for another day):
--   last 12 closed months  2025-10-01 .. 2026-09-30
--   current YTD            2026-01-01 .. 2026-10-21 (today, Asia/Dubai)
--   latest closed month    2026-09-01 .. 2026-09-30
--
-- Rules on both sides: posted lines only (TD_STATUS ending 'C': PYC, CYC; CYU is unposted),
-- NVL/ISNULL on debit and credit, net = credit - debit (revenue positive, costs negative).
--
-- No hosts, IDs or secrets are written here. Placeholders:
--   <workspace-id>  the Fabric workspace "Data Engine" (look it up by name, GET /v1/workspaces)
--   <lakehouse-id>  the lakehouse "lh_enterprise_core" in that workspace
--   Fabric T-SQL runs on lh_enterprise_core's SQL analytics endpoint, database lh_enterprise_core:
--     sqlcmd -S <sql-endpoint> -d lh_enterprise_core --authentication-method ActiveDirectoryDefault
--   Oracle SQL runs on Orion (MBALI schema, read-only) with the app's .env credentials.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- PART A. FABRIC (T-SQL, lh_enterprise_core SQL analytics endpoint)
-- ---------------------------------------------------------------------------------------------

-- F0. Load timestamps: what Fabric holds and when it was last written.
--     (Delta commit times come from OneLake: Tables/<table>/_delta_log, newest *.json.)
SELECT 'finance' AS tbl, COUNT_BIG(*) AS row_count, MAX([date]) AS max_posting_date,
       MAX(CREATION_DATE) AS max_created, MAX(UPDATED_DATE) AS max_updated FROM dbo.finance
UNION ALL SELECT 'gl', COUNT_BIG(*), MAX([date]), MAX(CREATION_DATE), MAX(UPDATED_DATE) FROM dbo.gl
UNION ALL SELECT 'sales', COUNT_BIG(*), MAX([date]), MAX(CREATION_DATE), NULL FROM dbo.sales
UNION ALL SELECT 'inventory', COUNT_BIG(*), MAX(Report_Date), NULL, NULL FROM dbo.inventory
UNION ALL SELECT 'receivables', COUNT_BIG(*), MAX(DOC_DT), NULL, NULL FROM dbo.receivables
UNION ALL SELECT 'payable', COUNT_BIG(*), MAX(DOC_DT), NULL, NULL FROM dbo.payable
UNION ALL SELECT 'pos', COUNT_BIG(*), MAX(po_PO_DATE), NULL, NULL FROM dbo.pos
UNION ALL SELECT 'pending_pos', COUNT_BIG(*), MAX([date]), MAX(h_cr_dt), MAX(h_upd_dt) FROM dbo.pending_pos
UNION ALL SELECT 'sop', COUNT_BIG(*), MAX(H_DT), NULL, NULL FROM dbo.sop;


-- F1. Fabric's chart of accounts. There is no chart_of_account table in the lakehouse: the
--     notebook "Data Ingestion" INNER JOINs the GL to this parquet file to build dbo.finance.
SELECT main_acnt_code, main_acnt_name1, level_0, level_1, level_2, main_level
FROM OPENROWSET(
    BULK 'https://onelake.dfs.fabric.microsoft.com/<workspace-id>/<lakehouse-id>/Files/Finance/map/main_acount_map_new/*.parquet',
    FORMAT = 'PARQUET') AS m
ORDER BY main_acnt_code;


-- F2. GL accounts with posted lines in the last 24 months (from the first of the current month),
--     and whether Fabric's map has them. Unmapped ones are dropped from dbo.finance.
WITH m AS (
    SELECT main_acnt_code, level_1
    FROM OPENROWSET(
        BULK 'https://onelake.dfs.fabric.microsoft.com/<workspace-id>/<lakehouse-id>/Files/Finance/map/main_acount_map_new/*.parquet',
        FORMAT = 'PARQUET') AS x
)
SELECT g.main_acnt_code, MAX(g.MAIN_ACNT_NAME) AS main_acnt_name, COUNT_BIG(*) AS line_count,
       MAX(m.level_1) AS fabric_level_1,
       CASE WHEN MAX(m.main_acnt_code) IS NULL THEN 'unmapped in Fabric' ELSE 'mapped' END AS fabric_status
FROM dbo.gl g
LEFT JOIN m ON m.main_acnt_code = g.main_acnt_code
WHERE SUBSTRING(g.TD_STATUS, 3, 1) = 'C'
  AND g.[date] >= DATEADD(MONTH, -24, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
GROUP BY g.main_acnt_code
ORDER BY g.main_acnt_code;


-- F3. Fabric P&L detail as its reports see it (dbo.finance = GL x map), by company, month and
--     account, posted lines only and all statuses side by side.
SELECT COMP_CODE AS comp_code, FORMAT([date], 'yyyy-MM') AS gl_month, main_acnt_code, level_1,
       SUM(CASE WHEN SUBSTRING(TD_STATUS, 3, 1) = 'C' THEN ISNULL(CREDIT_LC, 0) - ISNULL(DEBIT_LC, 0) ELSE 0 END) AS net_posted,
       SUM(ISNULL(CREDIT_LC, 0) - ISNULL(DEBIT_LC, 0)) AS net_all_status,
       COUNT_BIG(*) AS line_count
FROM dbo.finance
WHERE [date] >= '2025-10-01' AND [date] < '2026-10-22'
GROUP BY COMP_CODE, FORMAT([date], 'yyyy-MM'), main_acnt_code, level_1;


-- F4. The raw GL in Fabric (dbo.gl, every account, before the map), same grain as F3. This is
--     what the Orion side is compared with line for line, so mapping and loading can be told apart.
SELECT COMP_CODE AS comp_code, FORMAT([date], 'yyyy-MM') AS gl_month, main_acnt_code,
       SUM(CASE WHEN SUBSTRING(TD_STATUS, 3, 1) = 'C' THEN ISNULL(CREDIT_LC, 0) - ISNULL(DEBIT_LC, 0) ELSE 0 END) AS net_posted,
       SUM(ISNULL(CREDIT_LC, 0) - ISNULL(DEBIT_LC, 0)) AS net_all_status,
       COUNT_BIG(*) AS line_count
FROM dbo.gl
WHERE [date] >= '2025-10-01' AND [date] < '2026-10-22'
GROUP BY COMP_CODE, FORMAT([date], 'yyyy-MM'), main_acnt_code;


-- F5. Trial balance, latest closed month, by company and main account (dbo.gl, posted only).
SELECT COMP_CODE AS comp_code, main_acnt_code,
       SUM(ISNULL(DEBIT_LC, 0)) AS debit, SUM(ISNULL(CREDIT_LC, 0)) AS credit,
       SUM(ISNULL(CREDIT_LC, 0) - ISNULL(DEBIT_LC, 0)) AS net
FROM dbo.gl
WHERE [date] >= '2026-09-01' AND [date] < '2026-10-01' AND SUBSTRING(TD_STATUS, 3, 1) = 'C'
GROUP BY COMP_CODE, main_acnt_code;


-- F6. Fabric's own P&L lines as the "PNL - All" report computes them (report measures: each
--     level_1 is ABS(SUM(net_amount)); Net Profit = Revenue - CoS - G&A - Provisions; no status
--     filter). Per company and month; the report then sums over its slicers.
SELECT COMP_CODE AS comp_code, FORMAT([date], 'yyyy-MM') AS gl_month, level_1,
       SUM(NET_AMOUNT) AS net_amount
FROM dbo.finance
WHERE [date] >= '2025-10-01' AND [date] < '2026-10-22'
GROUP BY COMP_CODE, FORMAT([date], 'yyyy-MM'), level_1;


-- F7. Sales headline: net sales and returns, current YTD and the latest closed month.
SELECT 'ytd' AS period,
       SUM(NET_SALE_VALUE) AS net_sales,
       SUM(CASE WHEN TRANSACTION_TYPE_CODE = 'SARTN' THEN NET_SALE_VALUE ELSE 0 END) AS returns_value
FROM dbo.sales
WHERE TRANSACTION_TYPE_CODE IN ('INV', 'SARTN') AND [date] >= '2026-01-01' AND [date] < '2026-10-22'
UNION ALL
SELECT 'sep', SUM(NET_SALE_VALUE),
       SUM(CASE WHEN TRANSACTION_TYPE_CODE = 'SARTN' THEN NET_SALE_VALUE ELSE 0 END)
FROM dbo.sales
WHERE TRANSACTION_TYPE_CODE IN ('INV', 'SARTN') AND [date] >= '2026-09-01' AND [date] < '2026-10-01';


-- F7b. Same, confirmed invoices only. Fabric's current-year sales come from ZF_CSL_USL_BI, which
--      also carries UNCONFIRMED invoices; the dashboard reads ZF_CSL_BI (confirmed only).
SELECT 'ytd confirmed' AS period,
       SUM(NET_SALE_VALUE) AS net_sales,
       SUM(CASE WHEN TRANSACTION_TYPE_CODE = 'SARTN' THEN NET_SALE_VALUE ELSE 0 END) AS returns_value
FROM dbo.sales
WHERE TRANSACTION_TYPE_CODE IN ('INV', 'SARTN') AND [date] >= '2026-01-01' AND [date] < '2026-10-22'
  AND INV_STATUS = 'CONFIRMED';


-- F8. Inventory: stock value now (dbo.inventory snapshot) and at the September month-end
--     (dbo.inventory_closing, the month summary).
SELECT 'now' AS point, MAX(Report_Date) AS as_of, SUM(Total_Stock_Value) AS stock_value FROM dbo.inventory
UNION ALL
SELECT 'close ' + ZSL_PERIOD, NULL, SUM(ZSL_CLOSE_VAL) FROM dbo.inventory_closing
WHERE ZSL_PERIOD IN ('202609', '202610') GROUP BY ZSL_PERIOD;


-- F9. Purchasing: pending PO value. dbo.pos with the dashboard's rule (open, pending qty > 0,
--     (LC value - LC discount) / qty * pending qty), all ages and orders of the last 2 years; then
--     the "POs" report's own measure (pending qty * rate * exchange rate); then dbo.pending_pos.
SELECT 'pos, dashboard rule, all ages' AS basis,
       SUM((ISNULL(po_LC_VAL, 0) - ISNULL(po_LC_DISC, 0)) / NULLIF(po_QTY, 0) * po_PEND_QTY) AS pending_value
FROM dbo.pos WHERE po_CLO_STATUS = 0 AND po_PEND_QTY > 0
UNION ALL
SELECT 'pos, dashboard rule, last 2 years',
       SUM((ISNULL(po_LC_VAL, 0) - ISNULL(po_LC_DISC, 0)) / NULLIF(po_QTY, 0) * po_PEND_QTY)
FROM dbo.pos WHERE po_CLO_STATUS = 0 AND po_PEND_QTY > 0 AND po_PO_DATE >= '2024-10-21'
UNION ALL
SELECT 'pos, report measure (Pending Amount LC)', SUM(po_PEND_QTY * po_ITEM_RATE * po_EXGE_RATE)
FROM dbo.pos WHERE po_status = 'Pending'
UNION ALL
SELECT 'pending_pos, dashboard rule, all ages',
       SUM((ISNULL(lc_val, 0) - ISNULL(lc_disc, 0)) / NULLIF(qty, 0) * pend_qty)
FROM dbo.pending_pos WHERE clo_status = 0 AND pend_qty > 0;


-- F10. AR: outstanding (open lines |TOT_BAL| >= 1, net of PDCs = NET_BAL) and over 90 days by
--      document date, as of today and of 2026-09-30.
SELECT SUM(ISNULL(TOT_BAL, 0) - ISNULL(TOT_PDC, 0)) AS outstanding,
       SUM(CASE WHEN DOC_DT < DATEADD(DAY, -90, CAST('2026-10-21' AS date))
                THEN ISNULL(TOT_BAL, 0) - ISNULL(TOT_PDC, 0) ELSE 0 END) AS over_90,
       SUM(CASE WHEN AGE_BUCKET_SORT >= 4 THEN ISNULL(TOT_BAL, 0) - ISNULL(TOT_PDC, 0) ELSE 0 END) AS over_3m_fabric_buckets
FROM dbo.receivables
WHERE ABS(ISNULL(TOT_BAL, 0)) >= 1;


-- F11. AP: what we owe. Open lines, -TOT_BAL - TOT_PDC, netted per company and vendor; vendors
--      above zero are owed (AP outstanding), below zero are prepaid (kept apart, as on our side).
WITH v AS (
    SELECT COMP_CODE, SUB_ACNT_CODE,
           SUM(-ISNULL(TOT_BAL, 0) - ISNULL(TOT_PDC, 0)) AS balance,
           SUM(CASE WHEN DOC_DT < DATEADD(DAY, -90, CAST('2026-10-21' AS date))
                    THEN -ISNULL(TOT_BAL, 0) - ISNULL(TOT_PDC, 0) ELSE 0 END) AS over_90
    FROM dbo.payable
    WHERE ABS(ISNULL(TOT_BAL, 0)) >= 1
    GROUP BY COMP_CODE, SUB_ACNT_CODE
)
SELECT SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END) AS owed,
       SUM(CASE WHEN balance > 0 THEN over_90 ELSE 0 END) AS owed_over_90,
       SUM(CASE WHEN balance < 0 THEN -balance ELSE 0 END) AS prepaid,
       SUM(balance) AS net_all
FROM v;


-- F12. Sales orders: open order value, AED orders, not Closed, value of the undelivered quantity.
SELECT 'all ages' AS basis,
       SUM(CASE WHEN D_QTY - ISNULL(D_DELIVERED_QTY, 0) > 0
                THEN ISNULL(D_FC_VAL, 0) * (D_QTY - ISNULL(D_DELIVERED_QTY, 0)) / D_QTY END) AS open_value
FROM dbo.sop
WHERE ISNULL(DOC_STATUS, ' ') <> 'Closed' AND D_QTY > 0 AND CURR_CODE = 'AED'
UNION ALL
SELECT 'last 2 years',
       SUM(CASE WHEN D_QTY - ISNULL(D_DELIVERED_QTY, 0) > 0
                THEN ISNULL(D_FC_VAL, 0) * (D_QTY - ISNULL(D_DELIVERED_QTY, 0)) / D_QTY END)
FROM dbo.sop
WHERE ISNULL(DOC_STATUS, ' ') <> 'Closed' AND D_QTY > 0 AND CURR_CODE = 'AED' AND H_DT >= '2024-10-21';


-- ---------------------------------------------------------------------------------------------
-- PART B. ORION (Oracle, MBALI, read-only)
-- Our figures were taken from the app's own functions in lib/server/queries/* (oracle mode,
-- fresh process, cache empty): financeMonthly / financeKpis / accountBalances (finance.ts),
-- salesKpis (sales.ts), inventoryKpis / monthEndTrend (inventory.ts), pendingKpis
-- (purchasing.ts), arSummary / apSplit (ar-ap.ts), openBookKpis (sales-orders.ts). The SQL
-- those functions send is reproduced below for the Finance part, plus the two extra hand queries.
-- The P&L levels are attached afterwards from data/chart-of-accounts.csv (LEFT JOIN in code:
-- an account missing from the file is 'Unmapped' and kept out of profit).
-- ---------------------------------------------------------------------------------------------

-- O1. Posted net amount per month and GL main account (finance.ts monthlyAccountQuery), run once
--     per company with :company bound, for 2025-10-01 .. 2026-10-21.
SELECT TO_CHAR(D_DT, 'YYYY-MM') AS gl_month, D_MAIN_ACNT AS main_acnt,
    SUM(NVL(D_CREDIT_LC, 0) - NVL(D_DEBIT_LC, 0)) AS net_amount
FROM MBALI.ZF_F_T_DETAIL_BI
WHERE SUBSTR(TD_STATUS, 3, 1) = 'C'
  AND D_DT >= TO_DATE('2025-10-01', 'YYYY-MM-DD') AND D_DT < TO_DATE('2026-10-22', 'YYYY-MM-DD')
  AND D_COMP_CODE IN (:company)
GROUP BY TO_CHAR(D_DT, 'YYYY-MM'), D_MAIN_ACNT
ORDER BY gl_month, main_acnt;

-- O2. Trial balance, latest closed month: posted debit, credit and net per main account
--     (finance.ts accountTotalsQuery), per company and for all companies.
SELECT D_MAIN_ACNT AS main_acnt, MAX(D_MAIN_ACNT_NAME) AS main_acnt_name,
    SUM(NVL(D_DEBIT_LC, 0)) AS debit, SUM(NVL(D_CREDIT_LC, 0)) AS credit,
    SUM(NVL(D_CREDIT_LC, 0) - NVL(D_DEBIT_LC, 0)) AS net_amount
FROM MBALI.ZF_F_T_DETAIL_BI
WHERE SUBSTR(TD_STATUS, 3, 1) = 'C'
  AND D_DT >= TO_DATE('2026-09-01', 'YYYY-MM-DD') AND D_DT < TO_DATE('2026-10-01', 'YYYY-MM-DD')
  AND D_COMP_CODE IN (:company)
GROUP BY D_MAIN_ACNT
ORDER BY D_MAIN_ACNT;

-- O3. GL accounts with posted lines in the last 24 months (hand query), for the unmapped check.
SELECT D_MAIN_ACNT AS main_acnt, MAX(D_MAIN_ACNT_NAME) AS main_acnt_name, COUNT(*) AS line_count,
    SUM(NVL(D_CREDIT_LC, 0) - NVL(D_DEBIT_LC, 0)) AS net_amount
FROM MBALI.ZF_F_T_DETAIL_BI
WHERE SUBSTR(TD_STATUS, 3, 1) = 'C' AND D_DT >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -24)
GROUP BY D_MAIN_ACNT
ORDER BY D_MAIN_ACNT;

-- O4. Unposted lines since 2025-10-01 (hand query): what a status-blind P&L picks up.
SELECT D_COMP_CODE AS comp_code, TO_CHAR(D_DT, 'YYYY-MM') AS gl_month, TD_STATUS AS td_status,
    D_MAIN_ACNT AS main_acnt, COUNT(*) AS line_count,
    SUM(NVL(D_CREDIT_LC, 0) - NVL(D_DEBIT_LC, 0)) AS net_amount
FROM MBALI.ZF_F_T_DETAIL_BI
WHERE D_DT >= DATE '2025-10-01' AND SUBSTR(TD_STATUS, 3, 1) <> 'C'
GROUP BY D_COMP_CODE, TO_CHAR(D_DT, 'YYYY-MM'), TD_STATUS, D_MAIN_ACNT;
