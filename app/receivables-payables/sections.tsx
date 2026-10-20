import "server-only";

import { AgingChart } from "@/components/dashboard/aging-chart";
import { BarBreakdown } from "@/components/dashboard/bar-breakdown";
import { ChartCard } from "@/components/dashboard/chart-card";
import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorCard } from "@/components/dashboard/error-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ReportAsOf } from "@/components/shell/shell-context";
import { AGING_BUCKETS } from "@/lib/aging";
import { customerHref } from "@/lib/customers";
import { formatAed, formatInt, formatPct } from "@/lib/format";
import { AP_CURRENCY_NOTE } from "@/lib/notes";
import { dataAsOf } from "@/lib/server/db";
import { load } from "@/lib/server/errors";
import {
  apSplit,
  arBalances,
  summarize,
  TOP_N,
  type ApBalance,
  type Balance,
} from "@/lib/server/queries/ar-ap";
import { ALL_OTHER, UNASSIGNED } from "@/lib/server/sql";

/**
 * Seven cards in two rows on wide screens (receivables, then payables and the net position), two
 * per row on phones with the odd last card spanning the row.
 */
export const AR_AP_KPI_GRID =
  "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1";

interface Scope {
  asOf: string;
  companies: string[];
  /** The page query string (filters), kept on links to customer pages. */
  search?: string;
}

/** The headline balances. None of them has a last-year comparison: they are as of today. */
export async function ArApKpis({ asOf, companies }: Scope) {
  const result = await load(() =>
    Promise.all([arBalances(asOf, companies, "customer"), apSplit(asOf, companies)]),
  );
  if (!result.ok) return <ErrorCard message={result.message} />;
  const [customers, ap] = result.data;
  const ar = summarize(customers);

  return (
    <div className={AR_AP_KPI_GRID} data-testid="ar-ap-kpis">
      <ReportAsOf iso={dataAsOf().toISOString()} />
      <KpiCard
        label="AR outstanding"
        value={ar.balance}
        hint={`${formatInt(customers.length)} customers; net of PDCs`}
      />
      <KpiCard
        label="AR over 90 days"
        value={ar.over90}
        hint={ar.over90Pct === null ? "No AR outstanding" : `${formatPct(ar.over90Pct)} of AR outstanding`}
      />
      <KpiCard label="PDCs in hand" value={ar.pdc} hint="Post-dated cheques; not in AR outstanding" />
      <KpiCard
        label="Net position"
        value={ar.balance - ap.summary.balance}
        hint="AR outstanding − AP outstanding"
      />
      <KpiCard
        label="AP outstanding"
        value={ap.summary.balance}
        hint={`Owed to ${formatInt(ap.owed.length)} vendors; net of PDCs issued`}
      />
      <KpiCard
        label="AP over 90 days"
        value={ap.summary.over90}
        hint={
          ap.summary.over90Pct === null
            ? "No AP outstanding"
            : `${formatPct(ap.summary.over90Pct)} of AP outstanding`
        }
      />
      <KpiCard
        label="Vendor prepayments"
        value={ap.prepayments}
        hint={`Paid ahead to ${formatInt(ap.prepaid.length)} vendors; not netted off AP`}
      />
    </div>
  );
}

function agingAria(title: string, values: number[]): string {
  return `${title}: ${AGING_BUCKETS.map((bucket, index) => `${bucket} ${formatAed(values[index])}`).join(", ")}`;
}

function oldest(row: Balance): string {
  return row.oldestBucket === null ? "—" : AGING_BUCKETS[row.oldestBucket];
}

const AGING_NOTE = "Orange columns are 3 months old or more";

export async function ArAging({ asOf, companies }: Scope) {
  const result = await load(() => arBalances(asOf, companies, "customer"));
  const summary = result.ok ? summarize(result.data) : null;
  return (
    <ChartCard
      title="AR aging"
      description={`Outstanding by document age. ${AGING_NOTE}.`}
      action={
        summary ? (
          <span className="tabular text-sm font-medium">{formatAed(summary.balance)}</span>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.length === 0 ? (
        <EmptyState message="No open receivables for these companies." />
      ) : (
        <AgingChart
          values={summary!.buckets}
          label="Outstanding"
          ariaLabel={agingAria("AR aging", summary!.buckets)}
        />
      )}
    </ChartCard>
  );
}

/** Top 12 salespeople as bars; the rest are folded into 'All other'. */
const SALESPERSON_BARS = 12;

export async function ArBySalesperson({ asOf, companies }: Scope) {
  const result = await load(() => arBalances(asOf, companies, "salesperson"));
  const bars = result.ok
    ? [
        ...result.data.slice(0, SALESPERSON_BARS).map((row) => ({ label: row.label, value: row.balance })),
        ...(result.data.length > SALESPERSON_BARS
          ? [
              {
                label: ALL_OTHER,
                value: result.data.slice(SALESPERSON_BARS).reduce((sum, row) => sum + row.balance, 0),
              },
            ]
          : []),
      ]
    : [];
  return (
    <ChartCard
      title="Outstanding by salesperson"
      description={`The customer's own salesperson (sales-attributed AR). Top ${SALESPERSON_BARS}; the rest are “All other”.`}
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : bars.length === 0 ? (
        <EmptyState message="No open receivables for these companies." />
      ) : (
        <BarBreakdown
          data={bars}
          label="Outstanding"
          ariaLabel={`Outstanding by salesperson: ${bars
            .slice(0, 5)
            .map((bar) => `${bar.label} ${formatAed(bar.value)}`)
            .join(", ")}`}
        />
      )}
    </ChartCard>
  );
}

export async function ArTopCustomers({ asOf, companies, search = "" }: Scope) {
  const result = await load(() => arBalances(asOf, companies, "customer"));
  const columns: ColumnSpec[] = [
    { key: "label", header: "Customer", linkKey: "href" },
    { key: "balance", header: "Outstanding", format: "aed", sum: true },
    { key: "over90", header: "Over 90 days", format: "aed", sum: true },
    { key: "pdc", header: "PDCs", format: "aed", sum: true },
    { key: "lines", header: "Open documents", format: "int", sum: true },
    { key: "oldest", header: "Oldest bucket" },
  ];
  return (
    <ChartCard
      title="Top customers by balance"
      description={
        result.ok
          ? `Top ${TOP_N} of ${formatInt(result.data.length)} customers with an open balance; oldest bucket is the oldest unpaid document`
          : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : (
        <DataTable
          title="Top customers by balance"
          columns={columns}
          pageSize={TOP_N}
          rows={result.data.slice(0, TOP_N).map((row) => ({
            label: row.label,
            // Grouped by customer code (the AR sub-account), so every row knows its page.
            href: row.key === UNASSIGNED ? null : customerHref(row.key, search),
            balance: row.balance,
            over90: row.over90,
            pdc: row.pdc,
            lines: row.lines,
            oldest: oldest(row),
          }))}
          showTotals
        />
      )}
    </ChartCard>
  );
}

const BUCKET_COLUMNS: ColumnSpec[] = AGING_BUCKETS.map((bucket, index) => ({
  key: `b${index}`,
  header: bucket,
  format: "aed",
  sum: true,
}));

/** Collection follow-up: open AR by the finance-side salesperson who chases it, with CSV export. */
export async function ArCollection({ asOf, companies }: Scope) {
  const result = await load(() => arBalances(asOf, companies, "collector"));
  const columns: ColumnSpec[] = [
    { key: "label", header: "Collector" },
    { key: "customers", header: "Customers", format: "int" },
    { key: "balance", header: "Outstanding", format: "aed", sum: true },
    { key: "over90", header: "Over 90 days", format: "aed", sum: true },
    ...BUCKET_COLUMNS,
    { key: "pdc", header: "PDCs", format: "aed", sum: true },
  ];
  return (
    <ChartCard
      title="Collection follow-up"
      description="Open AR by the salesperson who chases collection, split by age. Export CSV for the follow-up list."
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : (
        <DataTable
          title="Collection follow-up"
          columns={columns}
          rows={result.data.map((row) => ({
            label: row.label,
            customers: row.customers,
            balance: row.balance,
            over90: row.over90,
            ...Object.fromEntries(row.buckets.map((value, index) => [`b${index}`, value])),
            pdc: row.pdc,
          }))}
          showTotals
        />
      )}
    </ChartCard>
  );
}

export function ApCurrencyNote() {
  return (
    <p className="text-xs text-muted-foreground" data-testid="ap-currency-note">
      {AP_CURRENCY_NOTE}
    </p>
  );
}

export async function ApAging({ asOf, companies }: Scope) {
  const result = await load(() => apSplit(asOf, companies));
  return (
    <ChartCard
      title="AP aging"
      description={`What we owe by document age, vendors we have prepaid left out. ${AGING_NOTE}.`}
      action={
        result.ok ? (
          <span className="tabular text-sm font-medium">{formatAed(result.data.summary.balance)}</span>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.owed.length === 0 ? (
        <EmptyState message="Nothing owed to vendors for these companies." />
      ) : (
        <AgingChart
          values={result.data.summary.buckets}
          label="Owed"
          ariaLabel={agingAria("AP aging", result.data.summary.buckets)}
        />
      )}
    </ChartCard>
  );
}

function vendorRows(rows: ApBalance[], sign: 1 | -1) {
  return rows.map((row) => ({
    label: row.label,
    company: row.company,
    account: row.account,
    balance: sign * row.balance,
    over90: row.over90,
    lines: row.lines,
    oldest: oldest(row),
  }));
}

export async function ApTopVendors({ asOf, companies }: Scope) {
  const result = await load(() => apSplit(asOf, companies));
  const columns: ColumnSpec[] = [
    { key: "label", header: "Vendor" },
    { key: "company", header: "Company" },
    { key: "account", header: "Account" },
    { key: "balance", header: "Owed", format: "aed", sum: true },
    { key: "over90", header: "Over 90 days", format: "aed", sum: true },
    { key: "lines", header: "Open documents", format: "int", sum: true },
    { key: "oldest", header: "Oldest bucket" },
  ];
  return (
    <ChartCard
      title="Top vendors owed"
      description={
        result.ok
          ? `Top ${TOP_N} of ${formatInt(result.data.owed.length)} vendors we owe; oldest bucket is the oldest unpaid document`
          : undefined
      }
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : (
        <DataTable
          title="Top vendors owed"
          columns={columns}
          pageSize={TOP_N}
          rows={vendorRows(result.data.owed.slice(0, TOP_N), 1)}
          showTotals
        />
      )}
    </ChartCard>
  );
}

export async function ApPrepayments({ asOf, companies }: Scope) {
  const result = await load(() => apSplit(asOf, companies));
  const columns: ColumnSpec[] = [
    { key: "label", header: "Vendor" },
    { key: "company", header: "Company" },
    { key: "account", header: "Account" },
    { key: "balance", header: "Prepaid", format: "aed", sum: true },
    { key: "lines", header: "Open documents", format: "int", sum: true },
  ];
  return (
    <ChartCard
      title="Vendor prepayments"
      description="Vendors whose open lines net to a credit in our favour: advances and payments ahead of invoices. Not netted off AP outstanding."
    >
      {!result.ok ? (
        <ErrorCard message={result.message} />
      ) : result.data.prepaid.length === 0 ? (
        <EmptyState
          title="No vendor prepayments"
          message="No vendor has been paid ahead for these companies."
        />
      ) : (
        <DataTable
          title="Vendor prepayments"
          columns={columns}
          rows={vendorRows(result.data.prepaid, -1)}
          showTotals
        />
      )}
    </ChartCard>
  );
}
