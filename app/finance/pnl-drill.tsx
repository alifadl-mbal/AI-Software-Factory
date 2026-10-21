"use client";

import { useState } from "react";

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
import { PnlChart, type PnlBar, type PnlPoint } from "@/components/dashboard/pnl-chart";
import { useShell } from "@/components/shell/shell-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { filtersToSearch, type Filters } from "@/lib/filters";
import { formatAed, formatInt, pctChange } from "@/lib/format";
import { bucketTitle, periodBuckets } from "@/lib/periods";
import {
  ACCOUNT_PARAM,
  LINE_PARAM,
  parseAccountParam,
  parseLineParam,
  pnlDrillFilters,
  pnlDrillTitle,
  PNL_PARAM,
} from "@/lib/pnl-drill";
import type { PnlHover, StatementRow } from "@/lib/server/queries/finance";

import { JournalLinesView } from "./journal-drawer";

/**
 * The Monthly P&L with the Sales-style hover card and drill-down, on Finance and the Overview.
 * Hovering (or focusing) a bar shows its P&L against the same days last year and net profit by
 * company; selecting it (a click, Enter or Space; on phones, the sheet's button) opens its P&L
 * lines → GL accounts → journal lines.
 */

const PARAMS = [PNL_PARAM, LINE_PARAM, ACCOUNT_PARAM] as const;

const TEXT: HoverText = { totalLabel: "Net profit", emptyText: "No postings in this period." };

/** `/api/finance/pnl-breakdown` as the card shows it. Costs are flipped to positive, for display. */
export function pnlView(data: PnlHover): HoverView {
  const { current, lastYear } = data;
  return {
    total: current.netProfit,
    lastYear: lastYear.netProfit,
    figures: [
      { id: "revenue", label: "Revenue", value: current.revenue, lastYear: lastYear.revenue },
      {
        id: "cost-of-sales",
        label: "Cost of sales",
        value: -current.costOfSales,
        lastYear: -lastYear.costOfSales,
        lowerIsBetter: true,
      },
      {
        id: "general-and-admin",
        label: "G&A expenses",
        value: -current.generalAndAdmin,
        lastYear: -lastYear.generalAndAdmin,
        lowerIsBetter: true,
      },
    ],
    sections: [
      {
        id: "company",
        title: "Net profit by company",
        rows: data.companies.map((row) => ({ label: row.label, value: row.netProfit })),
      },
    ],
  };
}

/** The open P&L drill-down, from the URL, and the way to open one. */
export function usePnlDrill() {
  const params = useDrillParams(PARAMS);
  const open = useOpenDrill(PNL_PARAM, [LINE_PARAM, ACCOUNT_PARAM]);
  return {
    period: params[PNL_PARAM],
    line: parseLineParam(params[LINE_PARAM]),
    account: parseAccountParam(params[ACCOUNT_PARAM]),
    open,
  };
}

/** The Monthly P&L chart with partial months, growth, the hover card and the drill-down. */
export function PnlTrendChart({
  data,
  start,
  end,
  showGrossProfit = true,
}: {
  data: PnlPoint[];
  start: string;
  end: string;
  showGrossProfit?: boolean;
}) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const { open } = usePnlDrill();
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (period: string) => hoverUrl("/api/finance/pnl-breakdown", search, { period });
  const keys = periodBuckets(start, end).map((bucket) => bucket.key);

  return (
    <>
      <PnlChart
        data={data}
        period={{ start, end }}
        showGrossProfit={showGrossProfit}
        renderTooltip={
          isMobile
            ? undefined
            : (bar: PnlBar) => (
                <HoverBreakdown
                  url={urlFor(bar.month)}
                  title={bucketTitle(bar.bucket)}
                  toView={pnlView}
                  text={TEXT}
                  current={bar.netProfit}
                  prefetch={neighbours(keys, bar.month).map(urlFor)}
                />
              )
        }
        onSelect={
          isMobile
            ? (bar) =>
                setSelected({
                  url: urlFor(bar.month),
                  title: bucketTitle(bar.bucket),
                  description: "Revenue, costs and net profit against last year, and net profit by company",
                  current: bar.netProfit,
                  drill: bar.month,
                })
            : undefined
        }
        // On phones a tap opens the sheet, and the sheet's button opens the drill-down.
        onSelectBar={isMobile ? undefined : open}
      />
      <HoverSheet
        selected={selected}
        onClose={() => setSelected(null)}
        toView={pnlView}
        text={TEXT}
        onDrill={open}
        drillLabel="Open its P&L"
      />
    </>
  );
}

const LINE_COLUMNS: ColumnSpec[] = [
  { key: "label", header: "P&L line", action: true },
  { key: "current", header: "This period", format: "aed" },
  { key: "previous", header: "Last year", format: "aed" },
  { key: "change", header: "Change", format: "aed" },
  { key: "changePct", header: "Change %", format: "pct" },
];

const ACCOUNT_COLUMNS: ColumnSpec[] = [
  { key: "mainAcnt", header: "Account", action: true },
  { key: "name", header: "Name" },
  { key: "current", header: "This period", format: "aed", sum: true },
  { key: "previous", header: "Last year", format: "aed", sum: true },
  { key: "change", header: "Change", format: "aed", sum: true },
];

/** The bar's P&L lines: totals for the profit lines, and a row per line that opens its accounts. */
function LinesView({ rows, onOpen }: { rows: StatementRow[]; onOpen: (line: string) => void }) {
  const figure = (id: string) => rows.find((row) => row.id === id)?.current ?? 0;
  const lines = rows.filter((row) => row.kind !== "subtotal");
  return (
    <div className="flex flex-col gap-3" data-testid="drill-pnl-lines">
      <DrillTotals
        items={[
          { label: "Revenue", value: formatAed(figure("revenue")) },
          { label: "Cost of sales", value: formatAed(figure("cost-of-sales")) },
          { label: "Gross profit", value: formatAed(figure("gross-profit")) },
          { label: "G&A expenses", value: formatAed(figure("general-and-admin-expenses")) },
          { label: "Net profit", value: formatAed(figure("net-profit")) },
        ]}
      />
      <DataTable
        title="P&L lines"
        columns={LINE_COLUMNS}
        rows={lines.map((row) => ({
          id: row.id,
          label: row.label,
          current: row.current,
          previous: row.previous,
          change: row.current - row.previous,
          changePct: pctChange(row.current, row.previous),
        }))}
        onAction={(row: TableRowData) => onOpen(String(row.id))}
        pageSize={25}
        maxHeight={9999}
      />
      <p className="text-xs text-muted-foreground">
        Costs are shown as positive amounts. Last year is the same days a year earlier. Unmapped accounts are
        kept out of profit.
      </p>
    </div>
  );
}

/** One P&L line's GL accounts, with a way back to the lines. */
function AccountsView({
  row,
  onBack,
  onOpen,
}: {
  row: StatementRow;
  onBack: () => void;
  onOpen: (account: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="drill-accounts">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DrillBack label="Back to P&L lines" onClick={onBack} />
        <h3 className="font-medium" data-testid="drill-line-title">
          {row.label}
          <span className="font-normal text-muted-foreground"> · GL accounts</span>
        </h3>
      </div>
      <DrillTotals
        items={[
          { label: "This period", value: formatAed(row.current) },
          { label: "Last year", value: formatAed(row.previous) },
          { label: "Change", value: formatAed(row.current - row.previous) },
          { label: "Accounts", value: formatInt(row.accounts.length) },
        ]}
      />
      <DataTable
        title={`${row.label} accounts`}
        columns={ACCOUNT_COLUMNS}
        rows={row.accounts.map((account) => ({
          id: account.mainAcnt,
          mainAcnt: account.mainAcnt,
          name: account.name,
          current: account.current,
          previous: account.previous,
          change: account.current - account.previous,
        }))}
        showTotals
        onAction={(account: TableRowData) => onOpen(String(account.id))}
        pageSize={25}
        maxHeight={9999}
      />
    </div>
  );
}

/** One account's posted journal lines for the bar's days. */
function JournalView({
  account,
  name,
  filters,
  backLabel,
  onBack,
}: {
  account: string;
  name: string;
  filters: Filters;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="drill-journal">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DrillBack label={backLabel} onClick={onBack} />
        <h3 className="font-medium" data-testid="drill-account-title">
          {account}
          {name && <span className="font-normal text-muted-foreground"> · {name}</span>}
        </h3>
      </div>
      <JournalLinesView account={{ mainAcnt: account, name }} filters={filters} />
    </div>
  );
}

/**
 * The P&L drill-down dialog: a bar of the Monthly P&L → its P&L lines → one line's GL accounts →
 * one account's posted journal lines. It opens from `?pnl=` in the URL, so reload and shared links
 * keep it; a full-screen sheet on phones.
 */
export function PnlDrillDialog() {
  const { filters } = useShell();
  const { period, line, account } = usePnlDrill();
  // The last bar stays on screen while the dialog fades out, and is where focus goes back to.
  const [lastPeriod, setLastPeriod] = useState(period);
  if (period !== null && period !== lastPeriod) setLastPeriod(period);
  const shown = period ?? lastPeriod;
  const narrowed = pnlDrillFilters(filters, shown);
  const lines = useReturnFocus(line);
  const accounts = useReturnFocus(account);

  return (
    <DrillDialog
      open={period !== null && narrowed !== null}
      params={PARAMS}
      testId="pnl-drill"
      title={shown && narrowed ? `P&L · ${pnlDrillTitle(shown, filters)}` : "P&L"}
      description={`Posted lines${
        filters.companies.length > 0 ? `, company ${filters.companies.join(", ")}` : ", all companies"
      }, against the same days last year`}
      returnSelector={() => (shown ? `[data-drill="${CSS.escape(shown)}"]` : null)}
    >
      {shown && narrowed && (
        <DrillView<StatementRow[]>
          key={`${shown}${filtersToSearch(filters)}`}
          url={drillApiUrl("/api/finance/statement", filters, { period: shown })}
          what="the P&L"
        >
          {(rows) => {
            const row = line === null ? undefined : rows.find((entry) => entry.id === line);
            const name = row?.accounts.find((entry) => entry.mainAcnt === account)?.name ?? "";
            return (
              <>
                <div ref={lines.container} hidden={line !== null || account !== null}>
                  <LinesView
                    rows={rows}
                    onOpen={(id) => setDrillParams({ [LINE_PARAM]: id, [ACCOUNT_PARAM]: null })}
                  />
                </div>
                {row && (
                  <div ref={accounts.container} hidden={account !== null}>
                    <AccountsView
                      key={row.id}
                      row={row}
                      onBack={() => {
                        lines.setReturnTo(row.id);
                        setDrillParams({ [LINE_PARAM]: null, [ACCOUNT_PARAM]: null });
                      }}
                      onOpen={(id) => setDrillParams({ [ACCOUNT_PARAM]: id })}
                    />
                  </div>
                )}
                {account && (
                  <JournalView
                    key={account}
                    account={account}
                    name={name}
                    filters={{ ...narrowed, range: "custom" }}
                    backLabel={row ? "Back to accounts" : "Back to P&L lines"}
                    onBack={() => {
                      accounts.setReturnTo(account);
                      setDrillParams({ [ACCOUNT_PARAM]: null });
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
