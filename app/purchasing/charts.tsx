"use client";

import { useState } from "react";

import { DataTable, type ColumnSpec, type TableRowData } from "@/components/dashboard/data-table";
import { DocumentDrill, useDocumentDrill } from "@/components/dashboard/document-drill";
import { drillApiUrl, DrillTotals } from "@/components/dashboard/drill-dialog";
import {
  HoverBreakdown,
  HoverSheet,
  hoverUrl,
  neighbours,
  type HoverSelection,
  type HoverText,
  type HoverView,
} from "@/components/dashboard/hover-breakdown";
import { barPeriod, TrendChart, type TrendBar, type TrendPoint } from "@/components/dashboard/trend-chart";
import { useShell } from "@/components/shell/shell-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { filtersToSearch } from "@/lib/filters";
import { formatAed, formatInt } from "@/lib/format";
import { itemHref } from "@/lib/items";
import { bucketTitle, periodBuckets } from "@/lib/periods";
import { DOC_PARAM, docParam, DRILL_PARAM, drillRange, drillTitle } from "@/lib/sales-drill";
import type {
  ReceiptDimension,
  ReceiptDocuments,
  ReceiptLine,
  ReceiptsHover,
} from "@/lib/server/queries/purchasing";

/**
 * The receipts trend with the hover breakdown and the drill-down, as on Sales: hover (or focus
 * and arrow keys) shows a month's spend by company, supplier and brand; on phones a tap opens it
 * as a bottom sheet. Selecting a bar lists the month's receipts, and a receipt its lines.
 */

const BREAKDOWN_PATH = "/api/purchasing/breakdown";

const TITLES: Record<ReceiptDimension, string> = {
  company: "By company",
  supplier: "By supplier",
  brand: "By brand",
};

const TEXT: HoverText = { totalLabel: "Receipts spend", emptyText: "Nothing received in this period." };

function receiptsView(data: ReceiptsHover): HoverView {
  return {
    total: data.spend,
    lastYear: data.lastYearSpend,
    sections: data.breakdowns.map((breakdown) => ({
      id: breakdown.dimension,
      title: TITLES[breakdown.dimension],
      rows: breakdown.rows,
      share: true,
    })),
  };
}

export function ReceiptsTrendChart({ data, start, end }: { data: TrendPoint[]; start: string; end: string }) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const { open } = useDocumentDrill(DRILL_PARAM, DOC_PARAM);
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (period: string) => hoverUrl(BREAKDOWN_PATH, search, { period });
  const keys = periodBuckets(start, end).map((bucket) => bucket.key);

  return (
    <>
      <TrendChart
        data={data}
        period={{ start, end }}
        ariaLabel="Monthly receipts spend, this year compared with last year. Select a month's bar to list its receipts."
        selectHint="List its receipts"
        renderTooltip={
          isMobile
            ? undefined
            : (bar) => (
                <HoverBreakdown
                  url={urlFor(bar.month)}
                  title={bucketTitle(bar.bucket)}
                  toView={receiptsView}
                  text={TEXT}
                  current={bar.thisYear}
                  lastYear={bar.lastYear}
                  prefetch={neighbours(keys, bar.month).map(urlFor)}
                />
              )
        }
        onSelect={
          isMobile
            ? (bar: TrendBar) =>
                setSelected({
                  url: urlFor(bar.month),
                  title: bucketTitle(bar.bucket),
                  description: "Receipts spend by company, supplier and brand",
                  current: bar.thisYear,
                  lastYear: bar.lastYear,
                  drill: bar.thisYear ? barPeriod(bar) : undefined,
                })
            : undefined
        }
        onSelectMonth={isMobile ? undefined : open}
      />
      <HoverSheet
        selected={selected}
        onClose={() => setSelected(null)}
        toView={receiptsView}
        text={TEXT}
        onDrill={open}
        drillLabel="List its receipts"
      />
    </>
  );
}

const DOCUMENT_COLUMNS: ColumnSpec[] = [
  { key: "date", header: "Date", format: "date" },
  { key: "company", header: "Company" },
  { key: "document", header: "Receipt", action: true },
  { key: "type", header: "Type" },
  { key: "supplier", header: "Supplier" },
  { key: "lines", header: "Lines", format: "int", sum: true },
  { key: "spend", header: "Spend", format: "aed", sum: true },
];

const LINE_COLUMNS: ColumnSpec[] = [
  { key: "item", header: "Item", linkKey: "itemHref" },
  { key: "itemCode", header: "Code" },
  { key: "quantity", header: "Qty", format: "qty", sum: true },
  { key: "currency", header: "Currency" },
  { key: "fcValue", header: "Value (currency)", format: "qty" },
  { key: "spend", header: "Spend (AED)", format: "aed", sum: true },
];

/**
 * The Purchasing drill-down: a month of the receipts trend → its receipts (GRNs and returns to
 * supplier) → one receipt's lines, with item links. It opens from `?drill=` in the URL.
 */
export function ReceiptsDrillDialog() {
  const { filters } = useShell();
  const companies =
    filters.companies.length > 0 ? `company ${filters.companies.join(", ")}` : "all companies";

  return (
    <DocumentDrill<ReceiptDocuments, ReceiptLine[]>
      param={DRILL_PARAM}
      docParam={DOC_PARAM}
      testId="receipts-drill"
      title={(drill) => {
        const range = drillRange(drill, filters);
        return range ? `Receipts · ${drillTitle(drill, range)}` : null;
      }}
      description={`Goods received and returns to suppliers, ${companies}`}
      documentsUrl={(drill) => drillApiUrl("/api/purchasing/documents", filters, { [DRILL_PARAM]: drill })}
      linesUrl={(drill, doc) =>
        drillApiUrl("/api/purchasing/document-lines", filters, { [DRILL_PARAM]: drill, [DOC_PARAM]: doc })
      }
      documentsWhat="receipts"
      backLabel="Back to receipts"
      renderDocuments={({ documents, total, totals, limit }, open) => {
        const byId = new Map(documents.map((doc) => [docParam(doc), doc]));
        return (
          <div className="flex flex-col gap-3" data-testid="drill-documents">
            <DrillTotals
              items={[
                { label: "Receipts spend", value: formatAed(totals.spend) },
                { label: "Returns", value: formatAed(totals.returnsValue) },
                { label: "Receipt lines", value: formatInt(totals.lineCount) },
                { label: "Receipts", value: formatInt(total) },
              ]}
            />
            {total > documents.length && (
              <p
                className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                data-testid="drill-cap-note"
              >
                Showing the largest {formatInt(limit)} of {formatInt(total)} receipts. The totals cover all of
                them.
              </p>
            )}
            <DataTable
              title="Receipts"
              columns={DOCUMENT_COLUMNS}
              rows={documents.map((doc) => ({
                id: docParam(doc),
                date: doc.date,
                company: doc.company,
                document: `${doc.txnCode}-${doc.no}`,
                type: doc.txnType === "GRN" ? "Receipt" : doc.spend < 0 ? "Return" : doc.txnType,
                supplier: doc.supplier,
                lines: doc.lineCount,
                spend: doc.spend,
              }))}
              showTotals
              totals={{ spend: totals.spend, lines: totals.lineCount }}
              onAction={(row: TableRowData) => {
                const doc = byId.get(String(row.id));
                if (doc)
                  open(
                    docParam(doc),
                    `Receipt ${doc.txnCode}-${doc.no} · company ${doc.company} · ${doc.supplier}`,
                  );
              }}
              pageSize={25}
              maxHeight={9999}
            />
          </div>
        );
      }}
      renderLines={(lines) => {
        const spend = lines.reduce((sum, line) => sum + line.spend, 0);
        return (
          <>
            <DrillTotals
              items={[
                { label: "Spend", value: formatAed(spend) },
                { label: "Lines", value: formatInt(lines.length) },
              ]}
            />
            <DataTable
              title="Receipt lines"
              columns={LINE_COLUMNS}
              rows={lines.map((line) => ({
                item: line.item,
                itemHref: line.itemCode ? itemHref(line.itemCode, filters) : null,
                itemCode: line.itemCode,
                quantity: line.quantity,
                currency: line.currency,
                fcValue: line.fcValue,
                spend: line.spend,
              }))}
              showTotals
              pageSize={50}
              maxHeight={9999}
            />
          </>
        );
      }}
    />
  );
}
