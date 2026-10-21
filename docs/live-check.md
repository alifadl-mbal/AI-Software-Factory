# Live Orion check, 2026-10-20

Every dashboard checked end to end on live Orion (oracle mode), for figures and speed. Filters: the
defaults (year to date, 2026-01-01 to 2026-10-20, all companies), then one company, **106** (the
largest by volume, so the slowest). No amounts are recorded here: "matches" means equal to the fils
(counts exactly, percentages to 0.001 pp).

## How it was checked

- **Figures.** Every headline KPI was compared with a SQL query written by hand on Orion (through the
  `mbal-db` skill), independent of `lib/server/queries/*`: different constructs (`TRUNC(date)
BETWEEN`, `DECODE`, per-document subtotals, `TO_DATE(H_DEL_DT, 'DD-Mon-YYYY')`, `PO_DATE + 84`,
  `SYSDATE` arithmetic, the views' own `SDR_NET_BAL`, `H_SYS_ID` for orders), and the P&L classified
  from `data/chart-of-accounts.csv` in Python rather than in the app. The queries are at the end.
- **Breakdowns.** On live data every breakdown adds up to its KPI, `All other` and `Unassigned`
  included: sales by company / item group / salesperson / top customers / top items and the monthly
  trend; finance trend, P&L statement and the three cost breakdowns; stock by company / item group /
  location / grade; pending POs by bucket / supplier / company; receipts trend and suppliers; AR by
  customer / salesperson / collector and the aging ladder; AP owed vendors and ladder; open orders by
  age / salesperson / customer and the booked trend. The two capped tables (overdue PO lines, open
  order lines: top 1,000) are capped by design and say so on screen.
- **Speed.** Each section's loaders were run against Orion exactly as the section calls them, with
  the app cache empty, for the code on `main` ("before") and on this branch ("after"). Every query
  text carried a unique comment so Oracle had to parse and optimise it afresh: that matters on
  `ZF_SO_BI`, where Oracle's first plan for a new query text can be poor and is only corrected on the
  next run (statistics feedback). A section's time is the wall time of all its queries, run in
  parallel as the page runs them.
- **Errors.** Every page, with both filter sets, in a production build in oracle mode: no error card
  anywhere. The only empty state is "Nothing to reorder" for company 106, and the hand query agrees
  (no active item of 106 is at or below its reorder level).

## Figures

Each KPI matched its hand query for all companies and for company 106, so the two columns are
merged. Last-year comparisons use the same queries over 2025-01-01 to 2025-10-20.

### Overview

The overview's tiles are the headline figures of the other pages, from the same loaders: sales net
revenue and gross margin %, net profit and net margin %, stock value and change vs last month-end,
pending PO value and overdue %, AR outstanding and share over 90 days, AP outstanding, and the four
attention items (overdue POs, AR over 90 days, 6-month dead stock, reorder alerts).

| KPI                                         | Matches hand query | Note                              |
| ------------------------------------------- | ------------------ | --------------------------------- |
| Net revenue, gross margin % (and last year) | yes                | Sales hand query                  |
| Net profit, net margin % (and last year)    | yes                | Finance hand query                |
| Stock value, change vs last month-end       | yes                | Inventory hand query              |
| Pending PO value, overdue %                 | yes                | Purchasing hand query             |
| AR outstanding, over 90 days                | yes                | AR hand query                     |
| AP outstanding                              | yes                | AP hand query                     |
| 6-month dead stock, reorder alerts          | yes                | Dead stock and reorder hand query |

### Sales

| KPI          | Matches hand query | Note                                      |
| ------------ | ------------------ | ----------------------------------------- |
| Net revenue  | yes                | also last year                            |
| Gross margin | yes                |                                           |
| Margin %     | yes                |                                           |
| Invoices     | yes                |                                           |
| Returns      | yes                | see data quality: cancel-and-rebill pairs |

### Finance

| KPI                                                  | Matches hand query | Note                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revenue                                              | yes                | also last year                                                                                                                                                                                                                                                                                                                                      |
| Cost of sales                                        | yes                | also last year                                                                                                                                                                                                                                                                                                                                      |
| Gross profit, GP %                                   | yes                | also last year                                                                                                                                                                                                                                                                                                                                      |
| G&A                                                  | yes                | also last year                                                                                                                                                                                                                                                                                                                                      |
| Net profit, net margin %                             | yes                | also last year                                                                                                                                                                                                                                                                                                                                      |
| Unmapped accounts                                    | yes                | none: all 446 accounts with postings are in the chart of accounts                                                                                                                                                                                                                                                                                   |
| YTD debits = credits                                 | yes                | the ledger balances                                                                                                                                                                                                                                                                                                                                 |
| Skill's verified YTD debit/credit total (2026-08-27) | no, explained      | Today's posted total for 2026-01-01..2026-08-27 is 4.9% above the figure the skill recorded on 27 Aug. Counting only lines created by 27 Aug (`D_CR_DT`) brings it within 0.5%, and the rest is lines changed since. So the gap is entries back-dated into January-August after that day, not a query difference: app and hand query agree exactly. |

### Inventory

| KPI                          | Matches hand query | Note                                                     |
| ---------------------------- | ------------------ | -------------------------------------------------------- |
| Stock value                  | yes                |                                                          |
| Available value              | yes                |                                                          |
| Reserved value               | yes                |                                                          |
| Stocked items                | yes                |                                                          |
| Change vs last month-end     | yes                | includes negative month-end stock, now noted on the page |
| Dead stock, 6 months (items) | yes                | 3 and 12 months: all breakdowns add up                   |
| Reorder alerts               | yes                |                                                          |

### Purchasing

| KPI                      | Matches hand query | Note                               |
| ------------------------ | ------------------ | ---------------------------------- |
| Pending PO value         | yes                | stale lines, now noted on the page |
| Open lines               | yes                |                                    |
| Overdue value, overdue % | yes                |                                    |
| Receipts spend           | yes                | also last year                     |

### Receivables & payables

| KPI             | Matches hand query | Note                                         |
| --------------- | ------------------ | -------------------------------------------- |
| AR outstanding  | yes                | hand query sums the view's own `SDR_NET_BAL` |
| AR over 90 days | yes                |                                              |
| AP outstanding  | yes                |                                              |
| AP prepayments  | yes                |                                              |

### Sales orders

| KPI                         | Matches hand query | Note                                                 |
| --------------------------- | ------------------ | ---------------------------------------------------- |
| Open order value            | yes                | stale orders, now noted on the page                  |
| Open orders, open lines     | yes                | hand query counts `H_SYS_ID`                         |
| Delivered not invoiced      | yes                |                                                      |
| Overdue value               | yes                | hand query uses Oracle's own `TO_DATE` on `H_DEL_DT` |
| Orders booked, booked value | yes                | also last year                                       |

## Section times (cold, seconds)

"All" is all companies, "106" is company 106. Over 5 s in bold.

### Overview

The overview runs the sections below at once: sales KPIs, finance KPIs, inventory KPIs, pending PO
KPIs, AR and AP summaries, finance trend, sales trend, dead stock (6 months) and reorder alerts, plus
the company list in the top bar. Cold first load of the whole page, production build:

|                                            | Before                                      | After                                                 |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
| Slowest section other than AR              | **7.1** (dead stock, reorder, company list) | 2.2 (dead stock)                                      |
| AR tiles (AR over 90 days, AR outstanding) | **12.2**                                    | **12.1**, see below                                   |
| Whole page, all sections streamed          | **14**                                      | **14**, the AR tiles; every other tile is in by 2.2 s |

### Sales

| Section                              | All before | All after | 106 before | 106 after |
| ------------------------------------ | ---------- | --------- | ---------- | --------- |
| KPIs (this year, last year, monthly) | 1.7        | 1.3       | 1.0        | 1.1       |
| Monthly trend                        | 1.0        | 1.0       | 0.7        | 0.7       |
| By company                           | 0.7        | 0.7       | 0.5        | 0.6       |
| By item group                        | 0.7        | 0.7       | 0.6        | 0.6       |
| By salesperson                       | 0.7        | 0.7       | 0.5        | 0.6       |
| Top customers                        | 0.7        | 0.7       | 0.6        | 0.7       |
| Top items                            | 0.7        | 0.7       | 0.7        | 0.8       |

### Finance

| Section                                               | All before | All after | 106 before | 106 after |
| ----------------------------------------------------- | ---------- | --------- | ---------- | --------- |
| KPIs                                                  | 1.8        | 1.0       | 0.9        | 1.0       |
| Monthly P&L                                           | 0.6        | 0.5       | 0.5        | 0.5       |
| P&L statement                                         | 1.2        | 1.0       | 0.9        | 0.9       |
| Costs by account                                      | 0.5        | 0.5       | 0.5        | 0.4       |
| Costs by division                                     | 0.6        | 0.5       | 0.5        | 0.5       |
| Costs by department                                   | 0.6        | 0.5       | 0.5        | 0.5       |
| Journal-line drill-down (busiest accounts, 60K lines) | 0.2-0.3    | 0.2-0.3   |            |           |

### Inventory

| Section                               | All before | All after | 106 before | 106 after |
| ------------------------------------- | ---------- | --------- | ---------- | --------- |
| KPIs (live stock and month-end trend) | 3.6        | 2.1       | 3.1        | 2.0       |
| By company                            | **7.0**    | 0.2       | **7.0**    | 0.1       |
| By item group                         | 0.2        | 0.2       | 0.2        | 0.2       |
| By location                           | 0.3        | 0.3       | 0.2        | 0.2       |
| By grade                              | 0.2        | 0.2       | 0.1        | 0.2       |
| Month-end trend                       | 3.6        | 2.1       | 3.1        | 2.0       |
| Dead stock, 3 months                  | **7.1**    | 1.6       | **7.1**    | 1.8       |
| Dead stock, 6 months                  | **7.1**    | 2.2       | **7.1**    | 2.4       |
| Dead stock, 12 months                 | **7.1**    | 2.9       | **7.1**    | 3.5       |
| Reorder alerts                        | **6.9**    | 0.1       | **7.2**    | 0.1       |

### Purchasing

| Section                  | All before | All after | 106 before | 106 after |
| ------------------------ | ---------- | --------- | ---------- | --------- |
| KPIs                     | 0.2        | 0.2       | 0.2        | 0.2       |
| Pending by aging         | 0.1        | 0.1       | 0.0        | 0.0       |
| Pending by supplier      | 0.1        | 0.1       | 0.0        | 0.1       |
| Pending by company       | **7.0**    | 0.1       | **6.9**    | 0.0       |
| Overdue PO lines         | 0.2        | 0.2       | 0.1        | 0.1       |
| Receipts trend           | 0.2        | 0.2       | 0.2        | 0.2       |
| Receipts top suppliers   | 0.1        | 0.1       | 0.1        | 0.1       |
| Zero exchange rate check | 0.2        | 0.1       | 0.1        | 0.2       |

### Receivables & payables

| Section                                        | All before | All after | 106 before | 106 after |
| ---------------------------------------------- | ---------- | --------- | ---------- | --------- |
| KPIs (AR and AP)                               | **12.2**   | **12.1**  | **8.7**    | **9.0**   |
| AR aging, top customers (one query)            | **12.4**   | **12.3**  | **8.7**    | **8.9**   |
| AR by salesperson                              | **10.6**   | **10.7**  | **7.3**    | **7.5**   |
| AR collection (finance salesperson)            | **12.0**   | **12.0**  | **8.6**    | **8.8**   |
| AP aging, top vendors, prepayments (one query) | 1.2        | 1.2       | 0.7        | 0.7       |

### Sales orders

| Section                                     | All before | All after | 106 before | 106 after |
| ------------------------------------------- | ---------- | --------- | ---------- | --------- |
| KPIs (open book, booked this year and last) | 1.1        | 1.2       | 1.2        | 1.1       |
| Non-AED currency note                       | 0.3        | 0.9       | 0.3        | 0.8       |
| Open value by order age                     | 4.9        | 0.9       | 1.0        | 0.8       |
| Open value by salesperson                   | 4.7        | 0.9       | 0.8        | 0.8       |
| Open value by customer                      | **14.0**   | 0.9       | **16.5**   | 0.9       |
| Monthly orders booked                       | 0.8        | 0.8       | 0.8        | 0.8       |
| Open order lines (top 1,000)                | **5.4**    | 1.6       | 1.3        | 1.3       |

Company list (top bar, and names on inventory and purchasing): **7.0** before, 0.02 after.

### What was slow, and what changed

- **Company list, 7 s.** It was the distinct companies of `ZF_CSL_BI`, a scan of 3.7M sales lines,
  on every page that names companies (top bar, stock by company, dead stock, reorder alerts, pending
  by company). It now reads `MBALI.FM_COMPANY`, Orion's company master (21 rows).
- **Open value by customer, 9-38 s.** `ZF_SO_BI.H_CUST_NAME` is a lookup Orion's view runs for every
  row. The query now groups by `H_CUST_CODE` and names the ~2K codes from `MBALI.ZF_CUSTOMER`, the
  table that lookup reads, so codes sharing a name still add up under it.
- **Sales-order breakdowns, ~5 s on a new query text.** A `WHERE` on the book's computed columns
  (`pend_qty > 0 AND is_aed = 1`) made Oracle's first plan for each new query text slow. They now sum
  conditionally (`SUM(CASE WHEN ... THEN pend_value ELSE 0 END)` with a `HAVING`), under a second
  from the first run.
- **Month-end trend and dead stock, 3.4-5.5 s.** Both ranked every period of the 8M-row closing view.
  They now bind a lower period bound worked out from today (newest periods needed, plus three months
  of slack in case Orion's month-end run is late) and compare `ZSL_PERIOD` against it directly.

### Why AR can't be faster: 8-12 s

`ZF_SOA_DETL_CUST_INV_SM_BI` takes 12 s to return `COUNT(*)` of its 22K rows, with no columns
selected at all; company 106 alone takes 9 s. The view sits on `orion11j_live.zf_bi_soa_detl_cust_inv_sm`,
which builds every balance from the full open-item ledger of the receivables control account, settled
items included, with several correlated subqueries per ledger line (matched amounts, PDCs, and the
aging flags), then groups and drops the settled rows. Nothing the app can push down shortens that:
balances only exist after the grouping, and an old document can still be open, so there is no date
to filter on. The company filter is the only predicate that reaches the ledger, and it is pushed down
already. Orion is read-only, so an index or a materialised copy is not an option. The three AR
queries on the page run in parallel and the page still completes in ~12.5 s, so they don't slow
each other much. Every other section on the page, and on the overview, streams in before them. A
lasting fix is on the Orion side: a lighter AR view, or one refreshed on a schedule.

## Order age: "last 2 years" by default (issue #28), 2026-10-20

Pending POs and the open sales-order book now count orders placed since a cut-off (`?since=`): the
last 2 years by default (`PO_DATE` / `H_DT` on or after 2024-10-20), 12 months, or all. Checked on
live Orion the same day, for all companies and company 106, the same way as above.

**Figures.**

- **All** equals the code on `main` to the fils on every pending-PO and open-book KPI (all companies
  and 106), so the hand queries above still match.
- **Last 2 years** (and 12 months) matched a hand query with the cut-off written independently
  (`TRUNC(PO_DATE) >= ADD_MONTHS(TRUNC(SYSDATE), -24)`, `H_SYS_ID` for orders, Oracle's own
  `TO_DATE` on `H_DEL_DT`; below): pending PO value, open lines, overdue value; open order value,
  open orders, open lines, delivered not invoiced, overdue value; and the lines and value the
  default leaves out.
- With every choice, each breakdown adds up to its KPI: pending POs by bucket / supplier / company,
  open value by age / salesperson / customer. Shown plus left out equals **All** exactly, in value
  and lines.
- What the default leaves out, all companies: 74% of pending PO value (58% of the lines) and 75% of
  open sales-order value (90% of the open lines). For company 106: 74% of pending PO value and 93%
  of open order value. Overdue % on pending POs is still 92% with the default (98% with All): most
  PO lines from the last 2 years are past PO date + 84 days too.

**Section times (cold, seconds).** Each section's loaders as the page calls them, the app cache
empty, every query text with a unique comment; "before" is the code on `main`.

| Section                            | All before | All 2 years | All 12 months | All all | 106 before | 106 2 years | 106 12 months | 106 all |
| ---------------------------------- | ---------- | ----------- | ------------- | ------- | ---------- | ----------- | ------------- | ------- |
| Purchasing KPIs (and hidden note)  | 0.6        | 0.2         | 0.2           | 0.1     | 0.2        | 0.2         | 0.2           | 0.2     |
| Pending by aging                   | 0.1        | 0.1         | 0.1           | 0.1     | 0.0        | 0.0         | 0.0           | 0.1     |
| Pending by supplier                | 0.1        | 0.1         | 0.1           | 0.1     | 0.1        | 0.0         | 0.0           | 0.1     |
| Pending by company                 | 0.1        | 0.1         | 0.1           | 0.1     | 0.0        | 0.0         | 0.0           | 0.0     |
| Overdue PO lines                   | 0.2        | 0.1         | 0.1           | 0.2     | 0.1        | 0.0         | 0.0           | 0.1     |
| Sales-order KPIs (and hidden note) | 1.2        | 1.0         | 0.9           | 1.2     | 1.1        | 0.9         | 0.9           | 1.1     |
| Non-AED currency note              | 0.9        | 0.7         | 0.7           | 0.9     | 0.9        | 0.7         | 0.7           | 0.8     |
| Open value by order age            | 0.9        | 0.8         | 0.7           | 0.9     | 0.8        | 0.7         | 0.7           | 0.8     |
| Open value by salesperson          | 0.9        | 0.7         | 0.7           | 0.9     | 0.8        | 0.7         | 0.7           | 0.9     |
| Open value by customer             | 1.0        | 0.8         | 0.8           | 1.0     | 0.9        | 0.8         | 0.7           | 0.9     |
| Open order lines (top 1,000)       | 1.7        | 1.3         | 1.2           | 1.7     | 1.3        | 1.2         | 1.0           | 1.4     |

The `H_DT` predicate is on the view's base column with a bound date, so Oracle's first plan stays
good: no section is slower than before, and the default is a little faster. The hidden-lines note
costs no extra round trip: the KPI query sums the older lines conditionally (`in_scope = 0`), and
the note reads the same cached result.

## Cache warm-up and stale-while-revalidate (issue #29), 2026-10-20

Production build (`next start`), oracle mode, default view (year to date, all companies). A page
time is the full streamed response, every section resolved, AR included; measured with `fetch` from
the server itself, so network to the browser isn't in it. In a browser (Playwright, first visit,
JS and CSS included) the Overview showed the AR tiles 0.84 s after navigation once warm.

| Load                                                       | Overview    | Receivables & payables |
| ---------------------------------------------------------- | ----------- | ---------------------- |
| Cold (empty cache, as before this change)                  | **13.8**    | **12.4**               |
| After one `POST /api/cron/warm`                            | 0.09        | 0.06                   |
| 15.5 min later (past the TTL, nothing re-warmed)           | 0.08, stale | 0.06, stale            |
| 25 s after that (the background refresh had landed)        | 0.10        | 0.07                   |
| First load after a restart (warm-up on start, ~30 s later) | 0.27        | 0.13                   |

Every other dashboard, warm: 0.04-0.07 s. No error card anywhere.

"Data as of" on the stale load still said 16:18:38 UTC (the warm-up's start), and on the next load
16:34:12, the time the refresh started: the stale figures were shown and dated, then replaced.

The warm-up itself takes ~29 s and loads 44 sections; the slow ones are the four AR queries (10.8-13.6
s, Orion's AR view, see above), everything else is 0-3 s. Pages are warmed one after another, so it
never uses more Orion connections than one page view. Run every 10 minutes, the default views are
never older than about 10 minutes and nobody waits for AR.

## Salesperson and brand filters (issue #39), 2026-10-21

Percentages and counts only, no amounts. Year to date is 1 Jan – 21 Oct 2026, net revenue as on
the Sales page (`ZF_CSL_BI`, `INV` + `SARTN`).

**Salesperson** is `CSL_SM_CODE` / `CSL_SM_NAME`. 51 salespeople sold this year; no code is
space-padded and none has two names; every revenue line this year has a code. `ZF_SO_BI.H_SM_CODE`
is the same code space: 99.94% of this year's revenue is booked by a code that is also on orders.

**Brand.** `ZF_CSL_BI` has no brand column. The candidates, checked for one brand per item code and
for the share of this year's revenue whose item they map:

| Source                                                         | Items with a brand | Items with 2+ brands | Revenue mapped YTD      | Cost                              |
| -------------------------------------------------------------- | ------------------ | -------------------- | ----------------------- | --------------------------------- |
| `ZF_STK_SO_PO_SL_BI."Brand"` / `"Brand_Name"` (**chosen**)     | 6,989              | 0                    | 94.49%                  | ~12K rows, under 1 s              |
| `ZF_STK_MTH_SUMM_BI.ZSL_BRAND` / `ZSL_BRAND_NAME`, all periods | 36,948             | 0                    | 92.69%                  | 8M rows, ~5 s per scan            |
| the same, latest period only                                   |                    |                      | 91.89% (last 12 months) | ~3 s                              |
| `ZF_SO_BI.D_FLEX_01_BRAND`                                     | 4,546              | 420                  |                         | not one brand per item: ruled out |

- The issue named `ZF_CURR_STK_BI.ZSL_BRAND`; the live `ZF_CURR_STK_BI` has no brand column. The
  `ZSL_*` brand columns are on the month-end view `ZF_STK_MTH_SUMM_BI`.
- Where both stock views give an item a brand they never disagree (0 items). Together they would
  map 97.27%, but the month-end view would add ~5 s to every brand query, so it isn't used.
- In `ZF_STK_SO_PO_SL_BI` no brand code has two names; 201 brand codes, 52 with sales this year.
- TNS (read from its refresh script, nothing run): its "brand" was `CSL_GROUP_NAME AS BRAND`, the
  item group, which the Sales page already breaks down by.

**Hand SQL agrees with the app.** The app's generated SQL and binds were run on live Orion next to
hand-written SQL, for this year's top salesperson (35.17% of revenue) and top brand (26.01%):

| Check                                                             | Result |
| ----------------------------------------------------------------- | ------ |
| One salesperson: net revenue and cost = hand SQL on `CSL_SM_CODE` | equal  |
| One brand: net revenue and cost = hand SQL joining the brand map  | equal  |
| Revenue by brand adds up to the all-sales KPI                     | equal  |
| Its Unassigned row = the KPI with brand `_none`                   | equal  |
| Brand X or Unassigned = X + Unassigned                            | equal  |
| Revenue by salesperson under one brand = that brand's KPI         | equal  |
| Booked orders for the salesperson (`ZF_SO_BI`)                    | found  |

**Times (seconds, cold, one query each):** KPIs for all 0.9, one salesperson 0.5, one brand 1.3,
Unassigned brand 1.8; revenue by brand 1.9; booked orders for a salesperson 0.5; open book with
Unassigned brand 1.8. Options: salespeople 0.7 and brands 1.8, fetched in parallel. Warm they come
from the cache (tens of milliseconds through `/api/filter-options`), and the warm-up job loads them.

What was slow: "Unassigned" first read as `item IS NULL OR NOT EXISTS (… brand view …)`, and "X or
Unassigned" as an `OR` of two subqueries. Oracle then re-ran the brand view for every sales line
(over 60 s, timed out). Each filter is now a single `IN` or `NOT IN` with no `OR` (blank codes are
compared as a stand-in value), which Oracle runs as a semi- or anti-join in about 2 s.

## Monthly P&L hover and drill-down (issue #51), 2026-10-21

The app's own loaders run against live Orion (oracle mode, cache cleared before each period), for
September 2026 and 1–21 October 2026, all companies and company 106. No amounts are recorded.

**Figures.** For every period and company filter, to the fils:

- the hover card's net profit and revenue (`pnlHover`) equal `financeKpis` for the same days, and its
  last-year net profit equals the statement's last-year column;
- its companies (top 5 plus `All other`) add up to net profit;
- the drill-down's net profit (`pnlStatement` → `statementRows`) equals `financeKpis`;
- the journal lines of the largest G&A account add up (debit − credit) to that account's figure.

**Speed** (cold, seconds):

| Section                                 | All companies | Company 106 |
| --------------------------------------- | ------------- | ----------- |
| Overview Monthly P&L (now vs last year) | 1.21          | 0.99        |
| Hover card, one month                   | 0.12–0.23     | 0.12–0.22   |
| Drill-down: P&L lines and accounts      | 0.14–0.18     | 0.15–0.16   |
| Drill-down: journal lines               | 0.02–0.03     | 0.02–0.03   |

## Inventory, AR/AP and customer page hover and drill-down (issue #53), 2026-10-21

The app's own loaders against live Orion (oracle mode, cache cleared before each section), for all
companies, company 106, the brand with the most items (`H0075`) on Inventory and salesperson
`TNS22` on AR. No amounts are recorded.

**Codes.** `SDR_CUST_SM_CODE` on the AR view is the code space of `CSL_SM_CODE`: of the 101 codes
on open AR, every one that also sold since 2025 has the same name in both views. About half have no
sales this year, which is why the AR page lists its own salespeople (`?source=receivables`).
`ZF_STK_MTH_SUMM_BI.ZSL_BRAND` against the brand map, September 2026 month-end, lines with stock:
0 of 9,598 disagree, so no data-quality note is needed. Lines with a `ZSL_BRAND` the map lacks
(Unassigned in the app) hold under 1% of that month-end's value. The closing view has no item group:
it is `ZF_ITEM.IM_GROUP_NAME`.

**Figures**, to the fils, for every filter set above:

- the month-end card's closing value equals the trend's bar for the newest closed and the
  provisional month-end; its companies, brands and item groups each add up to it; its last year
  equals the trend's bar twelve months earlier; the drill-down's total equals it;
- the brand's live stock value equals a hand query (`EXISTS` on the brand view instead of the
  app's join);
- every AR column (all seven): the card's total and both sections equal the aging chart's column,
  the customers add up to it, and the largest customer's documents add up to that customer's row,
  with the same count of lines;
- every AP column: the same, against the owed vendors (prepaid vendors left out, as in AP);
- the customer page (largest AR customer): the aging card equals the customer's column, and the
  trend card for September and October 2026 equals the bar and last year, by company and item
  group.

**Speed** (cold, seconds):

| Section                                        | All                     | Company 106 | Brand / salesperson |
| ---------------------------------------------- | ----------------------- | ----------- | ------------------- |
| Month-end trend                                | 2.2                     | 1.9         | 3.2                 |
| Inventory KPIs                                 | 0.3                     | 0.2         | 1.1                 |
| Stock by item group                            | 0.2                     | 0.2         | 1.0                 |
| Dead stock (6 months)                          | 2.2                     | 2.3         | 2.3                 |
| Reorder alerts                                 | 0.1                     | 0.0         | 1.2                 |
| Month-end card, one month                      | 2.0                     | 1.9         | 1.9–2.0             |
| Month-end drill-down, one month                | 1.3–1.5                 | 1.1         | 1.3–1.4             |
| Brand choices (`?source=stock`)                | 1.0                     |             |                     |
| AR (any one query)                             | 12.3                    | 8.7         | 10.6                |
| AR page queries and the aggregate, in parallel | 12.5                    | 9.2         | 10.9                |
| AR card and customers, any column              | 0.00 (cached aggregate) | 0.00        | 0.00                |
| AR documents of one customer in a column       | 0.02–0.21               | 0.02–0.12   | 0.01–0.06           |
| AP split / documents of one vendor             | 1.1 / 0.01              | 0.6 / 0.01  |                     |
| Customer page: aging card / trend card         | 0.06 / 0.01–0.12        |             |                     |

What was slow: the brand filter first went through `salesWhere`'s `IN (subquery on the brand view)`.
On reorder alerts (live stock joined to the item master) Oracle's plan for it ran past the 120 s call
timeout, and it did so again on a rerun. Inventory now LEFT JOINs the grouped brand map and filters
on its brand code (about 1 s). With no brand set, every Inventory query's SQL is unchanged.

## Purchasing, Sales orders and item page hover and drill-down (issue #52), 2026-10-21

The app's own loaders run against live Orion (oracle mode, cache cleared before each call), year to
date (1 Jan – 21 Oct 2026), all companies and company 106, for September and 1–21 October 2026. No
amounts are recorded.

**Figures.** For every bar and company filter, to the fils:

- receipts: the hover card's spend equals `receiptsMonthly` for the month, and its companies,
  suppliers and brands (top 5 plus `All other`) each add up to it; the drill's totals equal it, and
  the largest receipt's lines add up to that receipt;
- brand filter on Purchasing (the top-selling brand): receipts by month add up to receipts spend
  and pending by bucket to pending value, both below the unfiltered figures (about 37% of spend and
  31% of pending value for all companies);
- orders booked: the card's value and order count equal `bookedMonthly`, its companies, salespeople
  and brands each add up to it, the drill's totals and order count equal it, and the largest
  order's lines add up to that order;
- order age (`<30 D`, `3-6 M`, `1-2 Y`, last 2 years): the card equals the column of
  `openByAge`, its companies and salespeople add up to it, the drill's total equals it, and the
  largest order's open lines add up to that order;
- item page (the top-selling item, September): the card's net revenue and units equal
  `salesMonthly` for the item, and its companies add up to them.

**Speed** (cold, seconds; the slowest of the two months or three columns):

| Section                                  | All companies | Company 106 |
| ---------------------------------------- | ------------- | ----------- |
| Receipts hover card, one month           | 0.99          | 0.87        |
| Receipts drill: receipts / lines         | 0.03 / 0.02   | 0.05 / 0.03 |
| Purchasing with a brand: KPIs, by bucket | 0.89, 0.83    | 0.89, 0.84  |
| Booked hover card, one month             | 1.04          | 1.07        |
| Booked drill: orders / lines             | 0.70 / 0.07   | 0.96 / 0.25 |
| Order-age hover card, one column         | 0.84          | 0.79        |
| Order-age drill: orders / lines          | 0.93 / 0.07   | 0.76 / 0.04 |
| Item page hover card                     | 0.08          | 0.02        |

## Data quality on live Orion

| Finding                                                                                                                                                                                                                                                                                                                         | Effect on screen                                                  | Note on the page                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| The company filter listed only companies with sales. Companies 121, 123, 126, 129 and 135 have GL postings, 123 has stock and 460 has a pending PO, but none could be picked, and stock by company showed company 123 as a bare code.                                                                                           | Company list and names                                            | Fixed: the list comes from `FM_COMPANY` (21 companies, including two with no data yet, 90 and 142).          |
| GL accounts missing from `data/chart-of-accounts.csv`                                                                                                                                                                                                                                                                           | None: every account with postings (446) is in the file            | no                                                                                                           |
| Month-end stock below zero: 405 lines at the September close, a negative value inside the closing figure; another 13K lines with zero quantity carry small leftover values that almost cancel out. Live stock has no negative quantities.                                                                                       | Month-end trend and "Change vs last month-end"                    | yes, under the month-end trend                                                                               |
| Live stock: 55 lines with more reserved than on hand, so a negative available quantity                                                                                                                                                                                                                                          | Available and reserved value                                      | no (small; available value is still exact by Orion's rule)                                                   |
| Pending POs back to 2000: 79.5% of pending value is more than a year overdue, and lines from before 2024 hold about two thirds of it. They are almost certainly received or cancelled lines never closed in Orion.                                                                                                              | Pending PO value, overdue value and %                             | yes, under pending value by aging; hidden by default since #28 (`?since=`), with a note on what is left out  |
| Open sales orders: 74.6% of open value is on orders over two years old; 47% of open lines have an expected delivery date equal to the order date (Orion's default), so 99.7% of open lines are overdue.                                                                                                                         | Open order value, overdue value                                   | yes, under open value by order age; hidden by default since #28 (`?since=`), with a note on what is left out |
| Sales returns are about a quarter of gross invoicing year to date, and about a third of those returns look like cancel-and-rebill pairs (`IUP5` invoices against `SRUP` returns of the same quantities, `INP5` against `PPR1`). Net revenue is right; the Returns card and the invoice count include both halves.               | Returns, invoices                                                 | no; worth confirming with finance                                                                            |
| AP: about 7% of open lines carry a foreign currency code (USD, EUR, legacy DEM and ITL, and odd codes `EL1`, `WT1`, `RAN`). Their amounts are AED: the view is built from the ledger's local-currency columns, and its totals tie to the AP control accounts in the GL. The page said balances were in each account's currency. | AP note                                                           | Fixed: the note now says amounts are AED.                                                                    |
| AR: 156 open lines in a foreign currency; amounts are AED (`SDR_*` is the ledger's local currency)                                                                                                                                                                                                                              | None                                                              | no                                                                                                           |
| Sales orders in USD, OMR and SAR have no AED value in the view                                                                                                                                                                                                                                                                  | Open book in AED orders only                                      | already noted on the page                                                                                    |
| Finance: 2,274 unposted lines (`CYU`) since 2025                                                                                                                                                                                                                                                                                | Left out of every figure, by rule                                 | no                                                                                                           |
| Future dates                                                                                                                                                                                                                                                                                                                    | None in sales, finance, receipts, sales orders, pending POs or AP | no                                                                                                           |
| Zero exchange rates on non-AED receipts                                                                                                                                                                                                                                                                                         | None this year                                                    | (existing callout shows when there are)                                                                      |

## Hand queries

All run on live Orion through the `mbal-db` skill on 2026-10-20. `:s` and `:e` are the period's first
and last day (`YYYY-MM-DD`); `:c` is a company code, or `NULL` for all companies.

```sql
-- Sales: net revenue, cost, returns, invoices. Summed per document, then overall.
SELECT SUM(doc_net) AS net_revenue, SUM(doc_wac) AS cost,
       SUM(DECODE(txn_type, 'SARTN', doc_net, 0)) AS returns_value,
       SUM(CASE WHEN txn_type = 'INV' AND nonzero_lines > 0 THEN 1 ELSE 0 END) AS invoices
FROM (
  SELECT CSL_TXN_TYPE txn_type, CSL_COMP_CODE, CSL_TXN_CODE, CSL_NO,
         SUM(NVL(CSL_NET_SL_VALUE, 0)) doc_net, SUM(NVL(CSL_WAC_VALUE, 0)) doc_wac,
         SUM(CASE WHEN NVL(CSL_NET_SL_VALUE, 0) <> 0 THEN 1 ELSE 0 END) nonzero_lines
  FROM MBALI.ZF_CSL_BI
  WHERE CSL_TXN_TYPE IN ('INV', 'SARTN')
    AND TRUNC(CSL_DATE) BETWEEN TO_DATE(:s, 'YYYY-MM-DD') AND TO_DATE(:e, 'YYYY-MM-DD')
    AND (:c IS NULL OR CSL_COMP_CODE = :c)
  GROUP BY CSL_TXN_TYPE, CSL_COMP_CODE, CSL_TXN_CODE, CSL_NO)
```

```sql
-- Finance: posted debit and credit per GL account. Revenue, cost of sales and G&A are then summed
-- (credit - debit) in Python over the accounts data/chart-of-accounts.csv puts under each level_1
-- of 'Profit and loss'; accounts missing from the file are counted as unmapped.
SELECT TRIM(D_MAIN_ACNT) AS acnt, SUM(NVL(D_DEBIT_LC, 0)) AS debit, SUM(NVL(D_CREDIT_LC, 0)) AS credit
FROM MBALI.ZF_F_T_DETAIL_BI
WHERE TD_STATUS IN ('PYC', 'CYC')
  AND TRUNC(D_DT) BETWEEN TO_DATE(:s, 'YYYY-MM-DD') AND TO_DATE(:e, 'YYYY-MM-DD')
  AND (:c IS NULL OR D_COMP_CODE = :c)
GROUP BY TRIM(D_MAIN_ACNT)
```

```sql
-- Inventory: live stock value, available value, stocked items; last closed month-end value.
SELECT live.*,
       (SELECT SUM(ZSL_CLOSE_VAL) FROM MBALI.ZF_STK_MTH_SUMM_BI
         WHERE ZSL_PERIOD = TO_CHAR(ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -1), 'YYYYMM')
           AND (:c IS NULL OR ZSL_COMP_CODE = :c)) AS last_close_value
FROM (SELECT SUM(CS_VAL) AS stock_value,
             SUM((CS_UNCONF_QTY - NVL(CS_RESV_QTY, 0)) * CS_WAC) AS available_value,
             COUNT(DISTINCT CASE WHEN CS_UNCONF_QTY > 0 THEN CS_COMP_CODE || '/' || CS_ITEM_CODE END) AS stocked_items
      FROM MBALI.ZF_CURR_STK_BI
      WHERE (:c IS NULL OR CS_COMP_CODE = :c)) live
```

```sql
-- Inventory attention: 6-month dead stock (same closing qty > 0 in each of the newest 7 periods)
-- and reorder alerts.
SELECT (SELECT COUNT(*) FROM (
          SELECT ZSL_COMP_CODE, ZSL_LOCN_CODE, ZSL_ITEM_CODE
          FROM (SELECT ZSL_COMP_CODE, ZSL_LOCN_CODE, ZSL_ITEM_CODE, ZSL_PERIOD, SUM(ZSL_CLOSE_QTY) qty
                FROM MBALI.ZF_STK_MTH_SUMM_BI
                WHERE ZSL_PERIOD >= TO_CHAR(ADD_MONTHS(SYSDATE, -6), 'YYYYMM') AND (:c IS NULL OR ZSL_COMP_CODE = :c)
                GROUP BY ZSL_COMP_CODE, ZSL_LOCN_CODE, ZSL_ITEM_CODE, ZSL_PERIOD)
          GROUP BY ZSL_COMP_CODE, ZSL_LOCN_CODE, ZSL_ITEM_CODE
          HAVING COUNT(*) = 7 AND MIN(qty) = MAX(qty) AND MIN(qty) > 0)) AS dead6_items,
       (SELECT COUNT(*) FROM (
          SELECT s.CS_COMP_CODE FROM MBALI.ZF_CURR_STK_BI s, MBALI.ZF_ITEM i
          WHERE i.IM_COMP_CODE = s.CS_COMP_CODE AND i.IM_ITEM_CODE = s.CS_ITEM_CODE
            AND i.IM_FRZ_FLAG = 'Active' AND i.IM_RORD_LVL > 0 AND (:c IS NULL OR s.CS_COMP_CODE = :c)
          GROUP BY s.CS_COMP_CODE, s.CS_LOCN_CODE, s.CS_ITEM_CODE
          HAVING SUM(NVL(s.CS_UNCONF_QTY, 0) - NVL(s.CS_RESV_QTY, 0)) <= MAX(i.IM_RORD_LVL))) AS reorder_alerts
FROM DUAL
```

```sql
-- Purchasing: pending PO value and lines, overdue (PO date + 84 days on or before today);
-- receipts spend in the period.
SELECT po.*,
       (SELECT SUM(CPR_LANDED_VALUE) FROM MBALI.ZF_CPR_BI
         WHERE TRUNC(CPR_DATE) BETWEEN TO_DATE(:s, 'YYYY-MM-DD') AND TO_DATE(:e, 'YYYY-MM-DD')
           AND (:c IS NULL OR CPR_COMP_CODE = :c)) AS receipts_spend
FROM (SELECT SUM((NVL(PO_LC_VAL, 0) - NVL(PO_LC_DISC, 0)) / PO_QTY * PO_PEND_QTY) AS pending_value,
             COUNT(*) AS open_lines,
             SUM(CASE WHEN PO_DATE + 84 <= TRUNC(SYSDATE)
                      THEN (NVL(PO_LC_VAL, 0) - NVL(PO_LC_DISC, 0)) / PO_QTY * PO_PEND_QTY END) AS overdue_value
      FROM MBALI.ZF_PO_PENDING_BI
      WHERE PO_CLO_STATUS = 0 AND PO_PEND_QTY > 0 AND (:c IS NULL OR PO_COMP_CODE = :c)) po
```

```sql
-- Receivables: outstanding net of PDCs on open lines, and the part on documents over 90 days old.
SELECT SUM(SDR_NET_BAL) AS outstanding,
       SUM(CASE WHEN SDR_DOC_DT < TRUNC(SYSDATE) - 90 THEN SDR_NET_BAL END) AS over_90
FROM MBALI.ZF_SOA_DETL_CUST_INV_SM_BI
WHERE ABS(SDR_TOT_BAL) >= 1 AND (:c IS NULL OR SDR_COMP_CODE = :c)
```

```sql
-- Payables: vendors (company + sub-account) netted; owed = vendors above zero, prepaid = below.
SELECT SUM(CASE WHEN vbal > 0 THEN vbal END) AS owed, -SUM(CASE WHEN vbal < 0 THEN vbal END) AS prepaid
FROM (SELECT SUM(-SOAP_TOT_BAL - NVL(SOAP_TOT_PDC, 0)) vbal
      FROM MBALI.ZF_SOAP_DETL_BI
      WHERE ABS(SOAP_TOT_BAL) >= 1 AND (:c IS NULL OR SOAP_COMP_CODE = :c)
      GROUP BY SOAP_COMP_CODE, SOAP_SUB_ACNT_CODE)
```

```sql
-- Sales orders: the open book as of today (not Closed, D_QTY > 0).
SELECT SUM(CASE WHEN H_CURR_CODE = 'AED' AND pend > 0 THEN D_FC_VAL * pend / D_QTY END) AS open_value,
       COUNT(DISTINCT CASE WHEN pend > 0 THEN H_SYS_ID END) AS open_orders,
       COUNT(CASE WHEN pend > 0 THEN 1 END) AS open_lines,
       SUM(CASE WHEN H_CURR_CODE = 'AED' AND uninv > 0 THEN D_FC_VAL * uninv / D_QTY END) AS uninvoiced_value,
       SUM(CASE WHEN H_CURR_CODE = 'AED' AND pend > 0
                 AND TO_DATE(H_DEL_DT, 'DD-Mon-YYYY', 'NLS_DATE_LANGUAGE=ENGLISH') < TRUNC(SYSDATE)
                THEN D_FC_VAL * pend / D_QTY END) AS overdue_value
FROM (SELECT s.*, D_QTY - NVL(D_DELIVERED_QTY, 0) pend, NVL(D_DELIVERED_QTY, 0) - NVL(D_INVOICED_QTY, 0) uninv
      FROM MBALI.ZF_SO_BI s
      WHERE NVL(H_DOC_STATUS, '-') <> 'Closed' AND D_QTY > 0 AND (:c IS NULL OR H_COMP_CODE = :c))
```

```sql
-- Orders booked in the period; a Closed line counts only for its delivered part.
SELECT COUNT(DISTINCT H_SYS_ID) AS orders,
       SUM(CASE WHEN H_CURR_CODE = 'AED' THEN
             CASE WHEN H_DOC_STATUS = 'Closed' THEN NVL(D_FC_VAL, 0) * NVL(D_DELIVERED_QTY, 0) / D_QTY
                  ELSE NVL(D_FC_VAL, 0) END END) AS booked_value
FROM MBALI.ZF_SO_BI
WHERE D_QTY > 0 AND (NVL(H_DOC_STATUS, '-') <> 'Closed' OR D_DELIVERED_QTY > 0)
  AND TRUNC(H_DT) BETWEEN TO_DATE(:s, 'YYYY-MM-DD') AND TO_DATE(:e, 'YYYY-MM-DD')
  AND (:c IS NULL OR H_COMP_CODE = :c)
```

```sql
-- Order age (issue #28): pending POs and the open book on orders placed in the last 2 years, and
-- what the cut-off leaves out. :c as above ('ALL' for all companies here). For 12 months, -12.
SELECT po.*, so.*
FROM (SELECT SUM(CASE WHEN TRUNC(PO_DATE) >= ADD_MONTHS(TRUNC(SYSDATE), -24)
                      THEN (NVL(PO_LC_VAL, 0) - NVL(PO_LC_DISC, 0)) / PO_QTY * PO_PEND_QTY END) AS po_pending_value,
             COUNT(CASE WHEN TRUNC(PO_DATE) >= ADD_MONTHS(TRUNC(SYSDATE), -24) THEN 1 END) AS po_open_lines,
             SUM(CASE WHEN TRUNC(PO_DATE) >= ADD_MONTHS(TRUNC(SYSDATE), -24) AND PO_DATE + 84 <= TRUNC(SYSDATE)
                      THEN (NVL(PO_LC_VAL, 0) - NVL(PO_LC_DISC, 0)) / PO_QTY * PO_PEND_QTY END) AS po_overdue_value,
             COUNT(CASE WHEN TRUNC(PO_DATE) < ADD_MONTHS(TRUNC(SYSDATE), -24) THEN 1 END) AS po_hidden_lines,
             SUM(CASE WHEN TRUNC(PO_DATE) < ADD_MONTHS(TRUNC(SYSDATE), -24)
                      THEN (NVL(PO_LC_VAL, 0) - NVL(PO_LC_DISC, 0)) / PO_QTY * PO_PEND_QTY END) AS po_hidden_value
      FROM MBALI.ZF_PO_PENDING_BI
      WHERE PO_CLO_STATUS = 0 AND PO_PEND_QTY > 0 AND (:c = 'ALL' OR PO_COMP_CODE = :c)) po,
     (SELECT SUM(CASE WHEN recent = 1 AND H_CURR_CODE = 'AED' AND pend > 0 THEN D_FC_VAL * pend / D_QTY END) AS so_open_value,
             COUNT(DISTINCT CASE WHEN recent = 1 AND pend > 0 THEN H_SYS_ID END) AS so_open_orders,
             COUNT(CASE WHEN recent = 1 AND pend > 0 THEN 1 END) AS so_open_lines,
             SUM(CASE WHEN recent = 1 AND H_CURR_CODE = 'AED' AND uninv > 0 THEN D_FC_VAL * uninv / D_QTY END) AS so_uninvoiced_value,
             SUM(CASE WHEN recent = 1 AND H_CURR_CODE = 'AED' AND pend > 0
                       AND TO_DATE(H_DEL_DT, 'DD-Mon-YYYY', 'NLS_DATE_LANGUAGE=ENGLISH') < TRUNC(SYSDATE)
                      THEN D_FC_VAL * pend / D_QTY END) AS so_overdue_value,
             COUNT(CASE WHEN recent = 0 AND pend > 0 THEN 1 END) AS so_hidden_lines,
             SUM(CASE WHEN recent = 0 AND H_CURR_CODE = 'AED' AND pend > 0 THEN D_FC_VAL * pend / D_QTY END) AS so_hidden_value
      FROM (SELECT s.*, D_QTY - NVL(D_DELIVERED_QTY, 0) pend, NVL(D_DELIVERED_QTY, 0) - NVL(D_INVOICED_QTY, 0) uninv,
                   CASE WHEN TRUNC(H_DT) >= ADD_MONTHS(TRUNC(SYSDATE), -24) THEN 1 ELSE 0 END recent
            FROM MBALI.ZF_SO_BI s
            WHERE NVL(H_DOC_STATUS, '-') <> 'Closed' AND D_QTY > 0 AND (:c = 'ALL' OR H_COMP_CODE = :c))) so
```
