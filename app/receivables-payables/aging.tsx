"use client";

import { useState } from "react";

import { AgingChart } from "@/components/dashboard/aging-chart";
import { DataTable, type ColumnSpec, type TableRowData } from "@/components/dashboard/data-table";
import {
  DrillBack,
  DrillDialog,
  DrillTotals,
  DrillView,
  drillApiUrl,
  setDrillParams,
  useDrillParams,
  useOpenDrill,
  useReturnFocus,
} from "@/components/dashboard/drill-dialog";
import {
  HoverBreakdown,
  HoverSheet,
  hoverUrl,
  neighbours,
  type HoverSelection,
  type HoverText,
  type HoverView,
} from "@/components/dashboard/hover-breakdown";
import { useShell } from "@/components/shell/shell-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { AGING_BUCKETS } from "@/lib/aging";
import {
  AGING_ACCOUNT_PARAM,
  AGING_PARAM,
  agingParam,
  parseAgingAccount,
  parseAgingParam,
  type AgingSide,
} from "@/lib/aging-drill";
import { customerHref } from "@/lib/customers";
import { filtersToSearch, type Filters } from "@/lib/filters";
import { formatAed, formatInt } from "@/lib/format";
import type { AgingHover, ArDocument, BucketAccount, BucketAccounts } from "@/lib/server/queries/ar-ap";

/**
 * The AR and AP aging charts with the Sales-style hover card and drill-down. Hovering (or focusing)
 * a column shows its balance by company and by the customer's salesperson (AR) or the top vendors
 * (AP); selecting it (a click, Enter or Space; on phones, the sheet's button) lists the customers or
 * vendors in it → one account's open documents. Balances are as of today: there is no last year.
 */

const HOVER_PATH = "/api/receivables-payables/aging";
const PARAMS = [AGING_PARAM, AGING_ACCOUNT_PARAM] as const;
const KEYS = AGING_BUCKETS.map((_, index) => String(index));

const TEXT: Record<AgingSide, HoverText> = {
  ar: { totalLabel: "Outstanding", emptyText: "Nothing outstanding in this column.", compare: false },
  ap: { totalLabel: "Owed", emptyText: "Nothing owed in this column.", compare: false },
};

const SHEET_DESCRIPTION: Record<AgingSide, string> = {
  ar: "Outstanding by company and by the customer's salesperson",
  ap: "Owed by company and to the top vendors",
};

/** `/api/receivables-payables/aging` as the card shows it. */
export function agingView(data: AgingHover): HoverView {
  return { total: data.total, sections: data.sections.map((section) => ({ ...section, share: true })) };
}

/** The open aging drill-down, from the URL, and the way to open one. */
function useAgingDrill() {
  const params = useDrillParams(PARAMS);
  return {
    column: parseAgingParam(params[AGING_PARAM]),
    account: parseAgingAccount(params[AGING_ACCOUNT_PARAM]),
    open: useOpenDrill(AGING_PARAM, [AGING_ACCOUNT_PARAM]),
  };
}

/**
 * An aging chart with the hover card, and with `drill` the drill-down. `customer` narrows the card
 * to one customer (the customer page, which has no drill-down).
 */
export function AgingHoverChart({
  side,
  values,
  label,
  ariaLabel,
  customer,
  drill = true,
}: {
  side: AgingSide;
  values: number[];
  label: string;
  ariaLabel: string;
  customer?: string;
  drill?: boolean;
}) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const { open } = useAgingDrill();
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (bucket: string) =>
    hoverUrl(HOVER_PATH, search, { side, bucket, ...(customer !== undefined && { customer }) });
  const text = TEXT[side];

  return (
    <>
      <AgingChart
        values={values}
        label={label}
        ariaLabel={drill ? `${ariaLabel}. Select a column to list its accounts.` : ariaLabel}
        renderTooltip={
          isMobile
            ? undefined
            : (point) => (
                <HoverBreakdown
                  url={urlFor(String(point.index))}
                  title={point.bucket}
                  toView={agingView}
                  text={text}
                  current={point.value}
                  prefetch={neighbours(KEYS, String(point.index)).map(urlFor)}
                />
              )
        }
        onSelect={
          isMobile
            ? (point) =>
                setSelected({
                  url: urlFor(String(point.index)),
                  title: point.bucket,
                  description: SHEET_DESCRIPTION[side],
                  current: point.value,
                  drill: drill && point.value ? agingParam(side, point.index) : undefined,
                })
            : undefined
        }
        // On phones a tap opens the sheet, and the sheet's button opens the drill-down.
        onSelectBar={drill && !isMobile ? open : undefined}
        drillValue={(index) => agingParam(side, index)}
      />
      <HoverSheet
        selected={selected}
        onClose={() => setSelected(null)}
        toView={agingView}
        text={text}
        onDrill={open}
        drillLabel={side === "ar" ? "List its customers" : "List its vendors"}
      />
    </>
  );
}

const DOCUMENT_COLUMNS: ColumnSpec[] = [
  { key: "company", header: "Company" },
  { key: "document", header: "Document" },
  { key: "date", header: "Date", format: "date" },
  { key: "currency", header: "Currency" },
  { key: "amount", header: "Amount (AED)", format: "aed" },
  { key: "pdc", header: "PDCs", format: "aed", sum: true },
  { key: "balance", header: "Outstanding", format: "aed", sum: true },
];

function accountColumns(side: AgingSide): ColumnSpec[] {
  return side === "ar"
    ? [
        { key: "label", header: "Customer", action: true },
        { key: "page", header: "Customer page", linkKey: "href" },
        { key: "detail", header: "Salesperson" },
        { key: "lines", header: "Open documents", format: "int", sum: true },
        { key: "pdc", header: "PDCs", format: "aed", sum: true },
        { key: "balance", header: "Outstanding", format: "aed", sum: true },
      ]
    : [
        { key: "label", header: "Vendor", action: true },
        { key: "detail", header: "Company" },
        { key: "balance", header: "Owed", format: "aed", sum: true },
      ];
}

/** The column's customers or vendors; a row opens its documents. */
function AccountsView({
  data,
  search,
  onOpen,
}: {
  data: BucketAccounts;
  search: string;
  onOpen: (key: string) => void;
}) {
  const noun = data.side === "ar" ? "Customers" : "Vendors";
  return (
    <div className="flex flex-col gap-3" data-testid="drill-aging-accounts">
      <DrillTotals
        items={[
          { label: data.side === "ar" ? "Outstanding" : "Owed", value: formatAed(data.total) },
          { label: noun, value: formatInt(data.rows.length) },
        ]}
      />
      <DataTable
        title={`${data.side.toUpperCase()} ${AGING_BUCKETS[data.bucket]}`}
        columns={accountColumns(data.side)}
        rows={data.rows.map((row) => ({
          id: row.key,
          label: row.label,
          page: data.side === "ar" ? "Open" : null,
          href: data.side === "ar" && row.key !== "Unassigned" ? customerHref(row.key, search) : null,
          detail: row.detail,
          lines: row.lines,
          pdc: row.pdc,
          balance: row.balance,
        }))}
        showTotals
        onAction={(row: TableRowData) => onOpen(String(row.id))}
        pageSize={25}
        maxHeight={9999}
      />
      {data.side === "ap" && (
        <p className="text-xs text-muted-foreground">
          Vendors we have prepaid are left out, as in AP outstanding.
        </p>
      )}
    </div>
  );
}

/** One account's open documents in the column, with a way back to the accounts. */
function DocumentsView({
  side,
  bucket,
  account,
  filters,
  onBack,
}: {
  side: AgingSide;
  bucket: number;
  account: BucketAccount | { key: string; label: string };
  filters: Filters;
  onBack: () => void;
}) {
  const search = filtersToSearch(filters);
  return (
    <div className="flex flex-col gap-3" data-testid="drill-aging-documents">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DrillBack label={side === "ar" ? "Back to customers" : "Back to vendors"} onClick={onBack} />
        <h3 className="font-medium" data-testid="drill-account-title">
          {account.label}
          <span className="font-normal text-muted-foreground"> · {AGING_BUCKETS[bucket]}</span>
        </h3>
      </div>
      <DrillView<ArDocument[]>
        url={drillApiUrl("/api/receivables-payables/documents", filters, {
          side,
          bucket: String(bucket),
          account: account.key,
        })}
        what="documents"
      >
        {(documents) => {
          const balance = documents.reduce((sum, document) => sum + document.balance, 0);
          return (
            <>
              <DrillTotals
                items={[
                  { label: side === "ar" ? "Outstanding" : "Owed", value: formatAed(balance) },
                  { label: "Documents", value: formatInt(documents.length) },
                ]}
              />
              {side === "ar" && account.key !== "Unassigned" && (
                <a className="text-sm underline underline-offset-4" href={customerHref(account.key, search)}>
                  Open the customer page
                </a>
              )}
              <DataTable
                title={`${account.label} ${AGING_BUCKETS[bucket]}`}
                columns={DOCUMENT_COLUMNS.map((column) =>
                  side === "ap" && column.key === "balance" ? { ...column, header: "Owed" } : column,
                )}
                rows={documents.map((document) => ({
                  company: document.companyCode,
                  document: document.document,
                  date: document.date,
                  currency: document.currency,
                  amount: document.amount,
                  pdc: document.pdc,
                  balance: document.balance,
                }))}
                initialSort={[{ id: "balance", desc: true }]}
                showTotals
                pageSize={25}
                maxHeight={9999}
              />
            </>
          );
        }}
      </DrillView>
    </div>
  );
}

/**
 * The aging drill-down dialog: a column of the AR or AP aging chart → its customers or vendors →
 * one account's open documents. It opens from `?aging=` in the URL, so reload and shared links keep
 * it; a full-screen sheet on phones.
 */
export function AgingDrillDialog() {
  const { filters } = useShell();
  const { column, account } = useAgingDrill();
  // The last column stays on screen while the dialog fades out, and is where focus goes back to.
  const [lastColumn, setLastColumn] = useState(column);
  if (column !== null && (column.side !== lastColumn?.side || column.bucket !== lastColumn.bucket)) {
    setLastColumn(column);
  }
  const shown = column ?? lastColumn;
  const accounts = useReturnFocus(account);
  const search = filtersToSearch(filters);
  const side = shown?.side ?? "ar";

  return (
    <DrillDialog
      open={column !== null}
      params={PARAMS}
      testId="aging-drill"
      title={shown ? `${side === "ar" ? "AR" : "AP"} aging · ${AGING_BUCKETS[shown.bucket]}` : "Aging"}
      description={`As of today${
        filters.companies.length > 0 ? `, company ${filters.companies.join(", ")}` : ", all companies"
      }${side === "ar" && filters.salespeople.length > 0 ? `, ${formatInt(filters.salespeople.length)} salespeople` : ""}`}
      returnSelector={() =>
        shown ? `[data-drill="${CSS.escape(agingParam(shown.side, shown.bucket))}"]` : null
      }
    >
      {shown && (
        <DrillView<BucketAccounts>
          key={`${agingParam(shown.side, shown.bucket)}${search}`}
          url={drillApiUrl("/api/receivables-payables/bucket", filters, {
            side: shown.side,
            bucket: String(shown.bucket),
          })}
          what={shown.side === "ar" ? "customers" : "vendors"}
        >
          {(data) => {
            const row = account === null ? undefined : data.rows.find((entry) => entry.key === account);
            return (
              <>
                <div ref={accounts.container} hidden={account !== null}>
                  <AccountsView
                    data={data}
                    search={search}
                    onOpen={(key) => setDrillParams({ [AGING_ACCOUNT_PARAM]: key })}
                  />
                </div>
                {account && (
                  <DocumentsView
                    key={account}
                    side={shown.side}
                    bucket={shown.bucket}
                    account={row ?? { key: account, label: account }}
                    filters={filters}
                    onBack={() => {
                      accounts.setReturnTo(account);
                      setDrillParams({ [AGING_ACCOUNT_PARAM]: null });
                    }}
                  />
                )}
              </>
            );
          }}
        </DrillView>
      )}
    </DrillDialog>
  );
}
