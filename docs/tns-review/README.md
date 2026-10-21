# TNS Dashboard review (21 Oct 2026)

This is a review of the "TNS Dashboard" zip that the manager shared, compared with our dashboards. It is a report only: nothing in the app changed. The full report, with real figures and screenshots, is local to the manager's PC and is not in the repo:
`C:/Users/AliFadlalla/Documents/MBAL-BI-reports/tns-dashboard-review-2026-10-21.html`.

This file follows the same structure but has no amounts, no customer, salesperson or company names, and no screenshots. It gives statuses, % differences, account codes and the proposals.

**Method**

- **Our side:** live Orion, read through the app's own query functions (`salesMonthly`, `salesKpis`, `salesBreakdown`, `financeMonthly`, `monthlyAccountQuery`) with the cache bypassed (`setRunnerForTests` → `queryOracle`), on 21 Oct 2026 between 13:19 and 13:31 Dubai time.
- **TNS side:** the JSON snapshots in the zip, aggregated by a separate script.
- **Matching rule:** a cell is a **MATCH** when |diff| ≤ AED 1,000 **and** ≤ 0.5%.
- **Hand checks:** every DIFF was traced on Orion with hand queries through the `mbal-db` skill.

## Summary

**Top 5 UI/UX ideas**

| #   | Idea                                                               | Effort                     |
| --- | ------------------------------------------------------------------ | -------------------------- |
| P1  | Hover breakdown on every bar and row (company, brand, salesperson) | M                          |
| P2  | Drill from a period to its invoices, then to invoice lines         | L                          |
| P3  | Salesperson and brand filters, with a one-line scope summary       | L                          |
| P4  | Mark the partial month; growth % under each month                  | S                          |
| P5  | Overview: one-sentence summary and a ranked company table          | S (sentence) / M (ranking) |

**Data verdict: the underlying data agrees.** Every difference comes from a definition, the snapshot time or a TNS bug. None is left unexplained.

- **Sales by month and company:** 154 of 168 cells match. All 12 closed months match to the fils for all 11 TNS companies.
  - The 14 DIFFs are October to date and YTD only.
  - Each one equals exactly the **unconfirmed invoices**. TNS counts them (`ZF_CSL_USL_BI`, status CONFIRMED + UNCONFIRMED). We count confirmed invoices only (`ZF_CSL_BI`).
- **Top 20 customers and items:** they match once both sides group the same way.
  - TNS groups by code; we group by name. One customer name spans 148 customer codes.
  - YTD differences are the unconfirmed invoices, plus a few small item residuals from lines entered after TNS's extract.
- **Finance:** the GL agrees to the fils, apart from lines posted or updated after TNS's extract. Those are all on balance-sheet accounts.
  - **Net profit matches in 252 of 252** company-month cells.
  - Revenue, cost of sales and G&A splits differ because the two classifications disagree on **22 accounts**, and TNS's file lacks 32 of our P&L codes.
- **TNS's "vs last year" is wrong on both of its finance pages.** The current year is compared with a longer last year. Overview shows net profit −44.7% and P&L Detail shows −67.5%, while the like-for-like figure is −24.2%, the same as ours.

**3 most interesting extras**

1. Sales targets per salesperson, shown on the monthly chart. They are a manual file, not in Orion, so we would need a targets CSV.
2. A full-year projection based on recency-weighted YoY growth. It can be derived entirely from Orion.
3. Unconfirmed invoices as an "awaiting confirmation" figure. Companies 105, 130, 138 and 141 show nothing for October on our side, because none of their October invoices is confirmed yet.

## The zip and safety

- **Handling:** the zip was not modified or moved. It was extracted to a new scratch folder outside the repo, and none of its files are in this repo.
- **Nothing run:** no Python or npm script from the zip was run. The pages were viewed through a static server started outside the folder.
- **Credentials:** none are in the zip.
  - `refresh_sales_data.py` and `refresh_finance_data.py` read the Oracle user, password, host, port and SID from a `.env` file at a hard-coded path in **another Windows user's profile**.
  - Both scripts also hard-code an output folder in that profile.
- **Personal data:** the JSON holds customer names, invoice ids and salesperson names. It was served without sign-in by a plain local static server (`server.log`).
- **Other findings:**
  - `sales-react/` ships with its `node_modules` and hard-codes a local dev-server address.
  - Some labels go into `innerHTML` unescaped.
  - The only external resource is Google Fonts.
- **Contents differ from the issue's list:** customers.html and projection.html are retired (`*.removed`), there is a sales.html, and the data is `.json`.

## Snapshot dates and logic

| Snapshot                                            | As of                                                               | Logic                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data_daily, data_detail, data_items, data_companies | 21 Oct 2026 ~10:26 (includes part of 21 Oct)                        | `ZF_CSL_USL_BI`, status CONFIRMED + UNCONFIRMED, txn types INV + SARTN, dates from 2019.<br>Sales = `CSL_NET_VALUE` (returns are negative). No cost or margin.<br>11 companies: 101 103 104 105 106 107 130 133 137 138 141.            |
| data_finance (+ companies, daily_py, meta)          | 21 Oct 2026 ~10:17. meta: latestYm 202610, cutoff day 21, PY 202510 | `ZF_F_T_DETAIL_BI` LEFT JOIN `ZF_BI_FM_MAIN_ACNT`, TD_STATUS CYC + PYC, from 2020, net = credit − debit.<br>19 entities: the 11 above plus 113 121 123 126 129 135 136 90.                                                              |
| data_finance_classification                         | 19 Oct 2026                                                         | 105 accounts, level_1 ∈ Revenue / Cost of sales / G&A / Provisions.<br>The Overview uses it, falling back to account type for accounts it doesn't list (I → Revenue, E → G&A).<br>P&L Detail ignores it and uses the account type only. |
| data_target, data_target_brand                      | 14 Oct 2026                                                         | Manual 2026 targets: per salesperson (used) and per brand (unused).                                                                                                                                                                     |
| data_advance, data_customers, order_items/\*        | 15 Oct 2026                                                         | Not refreshed since; the TNS author did not identify their source.                                                                                                                                                                      |
| **Ours**                                            | live                                                                | Sales: `ZF_CSL_BI` (confirmed only), revenue `CSL_NET_SL_VALUE`, cost `CSL_WAC_VALUE`.<br>Finance: `ZF_F_T_DETAIL_BI` posted lines, P&L from `data/chart-of-accounts.csv`.                                                              |

## 1 · UI/UX proposals

The local report has a TNS-vs-ours screenshot pair for each proposal. Its gallery covers every page at 1440 and 390 px, in light and dark. The manager picks which proposals get built.

| #   | Idea                                             | TNS does                                                                                                                                     | We do                                                                          | Why better                                                                                  | Effort | Files it would touch                                                                                                                                                                                      |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Hover breakdown                                  | Hovering a month bar or row opens a card: company donut, brand and salesperson bars, Value/Qty toggle.                                       | Tooltip with this year vs last year only.                                      | Answers "what drove this month?" in one gesture.                                            | M      | `components/dashboard/trend-chart.tsx`, `components/ui/chart.tsx`, `lib/server/queries/sales.ts`, `app/sales/sections.tsx`                                                                                |
| P2  | Period → invoices → lines drill                  | A dialog lists the orders for a day or month (sortable, column filters, totals). Clicking an order shows its item lines, with a Back button. | No transaction drill on Sales. Finance has the account → journal-lines drawer. | Lets people check a figure down to the document.                                            | L      | `lib/server/queries/sales.ts`, new route like `app/api/finance/journal-lines/route.ts`, new `components/dashboard/drill-dialog.tsx` (pattern: `app/finance/journal-drawer.tsx`), `app/sales/sections.tsx` |
| P3  | Salesperson and brand filters, plus a scope line | Sidebar with searchable checklists (All/None, Single/Multi, "x of y"), cascading by company. A scope sentence sits under the title.          | Date range and company only.                                                   | Each manager gets their own slice on every chart; screenshots explain themselves.           | L      | `lib/filters.ts`, `lib/server/sql.ts`, `components/shell/top-bar.tsx`, `components/shell/company-select.tsx`, `lib/server/queries/sales.ts`, `components/dashboard/page-header.tsx`                       |
| P4  | Partial month and growth %                       | Hatched "MTD/Partial" bar, YoY % under each month, yearly bars when several years are selected.                                              | The running month looks like a full month; YoY is only in the tooltip.         | Removes the most common misreading of a YTD chart.                                          | S      | `components/dashboard/trend-chart.tsx`, `components/dashboard/pnl-chart.tsx`, `lib/filters.ts`                                                                                                            |
| P5  | Overview sentence and company ranking            | "Revenue was X, down Y% YoY, at Z% net margin, led by …", plus companies ranked by net profit with CY/PY bars, margin and YoY.               | Domain tiles and trends; no per-company comparison on the overview.            | Executives read these first. Ours must use the like-for-like period (see the data section). | S / M  | `app/_overview/sections.tsx`, `lib/server/overview.ts`, `components/dashboard/bar-breakdown.tsx`, `lib/server/queries/finance.ts`                                                                         |
| P6  | More sales KPIs                                  | 14 cards, including customers, orders per customer, AOV and discounts. Cost-type KPIs have inverted colours and an "LYSP" footer.            | 5 cards with sparklines.                                                       | Shows whether a change is volume or basket size. Add 2–3, not 14.                           | S–M    | `lib/server/queries/sales.ts`, `app/sales/sections.tsx`, `components/dashboard/kpi-card.tsx`                                                                                                              |
| P7  | Month → week → day table                         | Expandable rows with selling days, orders, quantity, gross, net and discounts. No-sale days stay visible.                                    | Monthly chart only.                                                            | Makes daily rhythm visible.                                                                 | M      | `lib/server/queries/sales.ts`, `app/sales/sections.tsx`, `components/dashboard/data-table.tsx`                                                                                                            |
| P8  | Item treemap and watchlists                      | Brand → item treemap coloured by YoY. Lists of growers, decliners, discount and returns, with a minimum base.                                | Top-20 items table and item pages.                                             | Shows where growth and decline come from.                                                   | M      | `lib/server/queries/sales.ts`, new `components/dashboard/treemap.tsx`, `app/sales/sections.tsx` or a new items page                                                                                       |
| P9  | Logo follows the company filter                  | With one company selected, the header shows that company's logo and name.                                                                    | "MBAL BI" always.                                                              | Single-company views are unmistakable. Logos must come from MBAL, not from the zip.         | S      | `components/shell/top-bar.tsx`, `components/shell/app-sidebar.tsx`, `public/logos/`                                                                                                                       |

**Where ours is already better**

- **Like-for-like last year:** ours is correct; TNS's finance pages are not.
- **Speed:** the TNS Sales page downloads about 178 MB of JSON on every visit, with cache-busting. Ours is server-aggregated and cached.
- **Freshness:** ours is live Orion. TNS is a manual snapshot, and part of it is 6 days old.
- **Mobile:** every TNS page scrolls sideways at 390 px, and its filters push the figures far down the page.
- **Dark mode:** TNS's dark-mode icons and active buttons are near-invisible.
- **Margins:** TNS Sales has no cost or margin.
- **Coverage:** ours also has inventory, purchasing, sales orders, AR/AP, customer and item pages, search, the journal drill and CSV export.
- **Security:** ours has Entra sign-in and escaped rendering.
- **One P&L definition:** ours lists unmapped accounts. TNS's two finance pages disagree with each other.

## 2 · Data comparison

### Sales by month and company (11 TNS companies)

The periods are the last 12 closed months (2025-10 to 2026-09), plus 2026-10 days 1–20 and YTD to 20 Oct. TNS's partial 21 Oct is excluded on both sides.

| Company            | 2025-10 … 2026-09            | 2026-10 (1–20)   | YTD                          | Cause of DIFF                          |
| ------------------ | ---------------------------- | ---------------- | ---------------------------- | -------------------------------------- |
| 101                | MATCH (no sales either side) | MATCH            | MATCH                        |                                        |
| 103, 104, 133, 137 | MATCH                        | MATCH            | MATCH                        | 104 has 3 unconfirmed lines worth zero |
| 105                | MATCH                        | DIFF (ours none) | DIFF +42.34%                 | Unconfirmed invoices (exact)           |
| 106                | MATCH                        | DIFF +27.61%     | DIFF +2.12%                  | Unconfirmed invoices (exact)           |
| 107                | MATCH                        | DIFF +5.31%      | DIFF +0.40% (over AED 1,000) | Unconfirmed invoices (exact)           |
| 130                | MATCH                        | DIFF (ours none) | DIFF +9.84%                  | Unconfirmed invoices (exact)           |
| 138                | MATCH                        | DIFF (ours none) | DIFF +0.05% (over AED 1,000) | Unconfirmed invoices (exact)           |
| 141                | MATCH                        | DIFF (ours none) | DIFF +0.73%                  | Unconfirmed invoices (exact)           |
| All 11             | MATCH                        | DIFF +31.64%     | DIFF +2.28%                  | Unconfirmed invoices (exact)           |

Percentages are TNS vs ours. Every DIFF equals, to the fils, the sum of `CSL_NET_VALUE` on `ZF_CSL_USL_BI` rows with `CSL_INV_STATUS = 'UNCONFIRMED'`, 1–20 Oct, for that company. This is a logic difference. No company outside the 11 has 2026 sales in either view.

### Top 20 customers and items

| Comparison                       | Result                                                                                                                         | Cause                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customers, last 12 closed months | 20 of 20 MATCH when grouped by name (0.000%)                                                                                   | TNS ranks by customer code; we group by name. One name covers 148 codes, so TNS ranks it 3rd and we rank it 1st. Another (11 codes) has no single code in TNS's top 40.                                                                        |
| Customers, YTD                   | 7 MATCH, 13 DIFF (−0.07% to +42.34%)                                                                                           | Every DIFF equals that customer's unconfirmed invoices (exact). Residual 0.00.                                                                                                                                                                 |
| Items, last 12 closed months     | All 25 of TNS's top codes MATCH a code-level hand query on `ZF_CSL_BI` (0.000%). Grouped by our label, 19 of our top 20 match. | We group by name (`CSL_NAME`); TNS groups by code (`MAX(CSL_ITEM_NAME)`). One item (our #15, −3.45%) has 2 codes whose names differ between the two views, so the name groups don't line up.                                                   |
| Items, YTD                       | DIFF on most (−1.6% to +6.2%)                                                                                                  | Unconfirmed invoice lines. After removing them, the residuals by code are ≤ 0.7%; the largest is our #5. Those are lines entered or confirmed after TNS's 10:26 extract, a snapshot-timing effect. Our #17 is the same naming case as L12 #15. |

### Finance P&L by month and company

Ours is `financeMonthly` per company. TNS is its Overview logic, with Provisions folded into G&A so the lines align. The months are 2025-10 to 2026-10 (1–21 Oct) plus YTD, over 17 companies with postings (113 and 90 have none) and the group.

| Line                   | MATCH | DIFF | Cause                                                                                                                                                                                                                                                                      |
| ---------------------- | ----- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Net profit             | 252   | 0    |                                                                                                                                                                                                                                                                            |
| Revenue                | 243   | 9    | Classification: 40837 (TNS: revenue / investment income; ours: G&A / investment gains and losses) and 30686 (TNS: provisions; ours: revenue / investment income).<br>Group revenue for 2025-10 is +122.9% on TNS (company 136) and −9.2% for 2025-12. Group YTD is +0.16%. |
| Cost of sales          | 98    | 154  | Classification: 40827, 40870, 40724, 40727, 40829, 40877 and 40854. Group YTD is −0.95%.                                                                                                                                                                                   |
| Gross profit           | 97    | 155  | Same as cost of sales and revenue. Group YTD is −0.83%.                                                                                                                                                                                                                    |
| G&A (incl. provisions) | 99    | 153  | Mirror of cost of sales. Group YTD is +1.33%.                                                                                                                                                                                                                              |

- **Attribution:** every DIFF is fully explained by accounts the two classifications place differently. The account contributions sum to each difference.
- **Ledger:** account × company × month amounts agree to the fils, except in 6 company-months.
  - In those, the lines were created or updated after TNS's 10:17 extract (`D_CR_DT` / `D_UPD_DT`): 106 in 2026-09; 104, 106, 121, 123 and 129 in 2026-10.
  - The accounts involved are 10251, 10252, 10284, 12291, 12292, 20311 and 20322. All are balance-sheet accounts, so there is no P&L effect.
- **TNS's P&L Detail** uses the Orion account type (I/E) instead of the classification. Its net profit differs from ours (and from TNS's own Overview) in 37 of 234 company-months. The cause is three accounts whose type disagrees with their P&L role: 30704 (type L, revenue for us), 40808 (type A, G&A for us) and 40844 (type E, balance sheet for us).

### Classification: `data_finance_classification` vs `data/chart-of-accounts.csv`

- **Codes only in TNS's file:** none.
- **TNS P&L codes that we put on the balance sheet:** 40844 and 40860. Neither has postings in the period, so there is no effect.
- **Our P&L codes missing from TNS's file:** 32.
  - 25 have no postings since 2025-10.
  - 7 do: 30801, 40727, 40818, 40834, 40864, 40872 and 40883. TNS buckets them by account type, which is the same bucket as ours for all except **40727** (cost of sales for us, G&A on TNS).
- **Classified differently:** 22 accounts. None of them changes net profit.

| Account                                                                            | TNS (level_1 / level_2)                                                                 | Ours (level_1 / level_2)                                                   | Effect                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------- |
| 30686                                                                              | Provisions / Other provisions                                                           | Revenue / Investment income                                                | revenue, gross profit       |
| 40837                                                                              | Revenue / Investment income                                                             | G&A / Investment gains and losses                                          | revenue, gross profit       |
| 40629, 40724, 40827, 40829, 40853, 40854, 40870                                    | Cost of sales / Direct costs                                                            | G&A (other expenses, staff costs, selling and distribution, finance costs) | gross profit, cost of sales |
| 40877                                                                              | G&A / Miscellaneous                                                                     | Cost of sales                                                              | gross profit, cost of sales |
| 40831, 40832, 40836, 40840, 40842, 40843, 40852, 40862, 40863, 40875, 40880, 40881 | Provisions (write-offs, D&A, finance charges, unrealised gains, charity, corporate tax) | G&A                                                                        | TNS EBITDA only             |

### TNS's "vs last year" on its finance pages

| Page                   | TNS shows | Like-for-like         | Cause                                                                                                                      |
| ---------------------- | --------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Overview, revenue      | −36.7%    | −9.4%                 | With "All months" selected, last year includes Nov–Dec 2025. Only October is cut at day 21 (`scopedRowsPY` in index.html). |
| Overview, net profit   | −44.7%    | −24.2% (ours: −24.2%) | Same                                                                                                                       |
| P&L Detail, net profit | −67.5%    | −24.2%                | Compared with the full year 2025, with no cut-off.                                                                         |

TNS's Sales page gets this right: it compares the same calendar days last year, and its last-year figure equals ours within 0.03%.

## 3 · Interesting to take

| Feature                              | What it is                                                                                                                                                                                                                         | Data source                                       | From Orion?                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sales targets** (top 3)            | A per-salesperson monthly target line on the Sales chart. Brand targets are loaded but unused.                                                                                                                                     | Manual 2026 file                                  | No. No target or budget tables are visible in any schema we can read. We would need a small CSV like `data/chart-of-accounts.csv` (e.g. `data/targets.csv`), owned by sales management. |
| **Full-year projection** (top 3)     | Recency-weighted YoY growth from finished months, applied to last year's remaining days and months. Shown as a projected full-year KPI and achieved vs projected. The retired page cross-checked it against customer order cycles. | Computed in the browser from daily sales          | Yes, from `ZF_CSL_BI`.                                                                                                                                                                  |
| **Unconfirmed invoices** (top 3)     | TNS counts them as sales. A separate "awaiting confirmation" figure would explain a low running month without changing confirmed revenue. Including them is a scope decision for the manager.                                      | `ZF_CSL_USL_BI`, `CSL_INV_STATUS = 'UNCONFIRMED'` | Yes                                                                                                                                                                                     |
| Customer status / RFM (retired page) | Active ≤ 90 days since last order, At risk ≤ 180, Dormant ≤ 365, else Lost; RFM quintiles.                                                                                                                                         | data_detail + customer master                     | Yes, from `ZF_CSL_BI` + `ZF_CUSTOMER`                                                                                                                                                   |
| Advance payments                     | About 20 invoice headers mapped to an advance amount. Some values look implausible; the KPI shows zero today.                                                                                                                      | Unknown; not refreshed since 15 Oct               | Not found in our views. Ask finance (possibly unapplied receipts in AR).                                                                                                                |
| Daily and order-line files           | Feed the by-day table and the invoice drill (209 MB of order-line files).                                                                                                                                                          | `ZF_CSL_USL_BI`                                   | Yes. Query on demand instead (P2, P7).                                                                                                                                                  |
