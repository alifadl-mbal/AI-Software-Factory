"use client";

import { useState } from "react";

import { DataTable, type ColumnSpec, type TableRowData } from "@/components/dashboard/data-table";
import {
  DrillBack,
  DrillDialog,
  DrillLoading,
  DrillTotals,
  drillApiUrl,
  setDrillParams,
  useDrillParams,
  useLoaded,
  useOpenDrill,
  useReturnFocus,
} from "@/components/dashboard/drill-dialog";
import { ErrorCard } from "@/components/dashboard/error-card";
import { useShell } from "@/components/shell/shell-context";
import { customerHref } from "@/lib/customers";
import { filtersToSearch, type Filters } from "@/lib/filters";
import { formatAed, formatDate, formatInt, formatPct } from "@/lib/format";
import { itemHref } from "@/lib/items";
import {
  DOC_PARAM,
  docParam,
  DRILL_PARAM,
  drillRange,
  drillTitle,
  parseDocParam,
  type DocumentKey,
} from "@/lib/sales-drill";
import type { SalesDocument, SalesDocumentLine, SalesDocuments } from "@/lib/server/queries/sales";

const PARAMS = [DRILL_PARAM, DOC_PARAM] as const;

/** The open drill-down, from the URL, and the way to open one. */
export function useSalesDrill() {
  const params = useDrillParams(PARAMS);
  const open = useOpenDrill(DRILL_PARAM, [DOC_PARAM]);
  return { drill: params[DRILL_PARAM], doc: parseDocParam(params[DOC_PARAM]), open };
}

const DOCUMENT_COLUMNS: ColumnSpec[] = [
  { key: "date", header: "Date", format: "date" },
  { key: "company", header: "Company" },
  { key: "document", header: "Document", action: true },
  { key: "customer", header: "Customer", linkKey: "customerHref" },
  { key: "salesperson", header: "Salesperson" },
  { key: "netValue", header: "Net value", format: "aed", sum: true },
  { key: "cost", header: "Cost", format: "aed", sum: true },
  { key: "marginPct", header: "Margin %", format: "pct" },
];

const LINE_COLUMNS: ColumnSpec[] = [
  { key: "item", header: "Item", linkKey: "itemHref" },
  { key: "itemCode", header: "Code" },
  { key: "quantity", header: "Qty", format: "qty", sum: true },
  { key: "netValue", header: "Net value", format: "aed", sum: true },
  { key: "cost", header: "Cost", format: "aed", sum: true },
  { key: "margin", header: "Margin", format: "aed", sum: true },
  { key: "marginPct", header: "Margin %", format: "pct" },
];

function documentLabel(doc: DocumentKey): string {
  return `${doc.txnCode}-${doc.no}`;
}

/** The period's documents, largest first, with its exact totals. */
function DocumentsView({
  drill,
  filters,
  onOpen,
}: {
  drill: string;
  filters: Filters;
  onOpen: (doc: SalesDocument) => void;
}) {
  const { result, retry } = useLoaded<SalesDocuments>(
    drillApiUrl("/api/sales/documents", filters, { [DRILL_PARAM]: drill }),
  );
  if (result === null) return <DrillLoading what="documents" />;
  if (!result.ok) return <ErrorCard message={result.message} onRetry={retry} />;

  const { documents, total, totals, limit } = result.data;
  const byId = new Map(documents.map((doc) => [docParam(doc), doc]));
  return (
    <div className="flex flex-col gap-3" data-testid="drill-documents">
      <DrillTotals
        items={[
          { label: "Net revenue", value: formatAed(totals.netRevenue) },
          { label: "Cost", value: formatAed(totals.cost) },
          { label: "Gross margin", value: formatAed(totals.grossMargin) },
          { label: "Margin %", value: formatPct(totals.marginPct) },
          { label: "Invoices", value: formatInt(totals.invoiceCount) },
        ]}
      />
      {total > documents.length && (
        <p
          className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
          data-testid="drill-cap-note"
        >
          Showing the largest {formatInt(limit)} of {formatInt(total)} documents. The totals cover all of
          them; pick a week or a day to see the rest.
        </p>
      )}
      <DataTable
        title="Sales documents"
        columns={DOCUMENT_COLUMNS}
        rows={documents.map((doc) => ({
          id: docParam(doc),
          date: doc.date,
          company: doc.company,
          document: documentLabel(doc),
          customer: doc.customer,
          customerHref: doc.customerCode ? customerHref(doc.customerCode, filters) : null,
          salesperson: doc.salesperson,
          netValue: doc.netValue,
          cost: doc.cost,
          marginPct: doc.marginPct,
        }))}
        showTotals
        totals={{
          netValue: totals.netRevenue,
          cost: totals.cost,
          ...(totals.marginPct === null ? {} : { marginPct: totals.marginPct }),
        }}
        onAction={(row: TableRowData) => {
          const doc = byId.get(String(row.id));
          if (doc) onOpen(doc);
        }}
        pageSize={25}
        maxHeight={9999}
      />
    </div>
  );
}

/** One document's lines, with a way back to the list. */
function LinesView({
  drill,
  filters,
  doc,
  summary,
  onBack,
}: {
  drill: string;
  filters: Filters;
  doc: DocumentKey;
  summary: SalesDocument | undefined;
  onBack: () => void;
}) {
  const { result, retry } = useLoaded<SalesDocumentLine[]>(
    drillApiUrl("/api/sales/document-lines", filters, { [DRILL_PARAM]: drill, [DOC_PARAM]: docParam(doc) }),
  );

  const lines = result?.ok ? result.data : [];
  const netValue = lines.reduce((sum, line) => sum + line.netValue, 0);
  const cost = lines.reduce((sum, line) => sum + line.cost, 0);
  return (
    <div className="flex flex-col gap-3" data-testid="drill-lines">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DrillBack label="Back to documents" onClick={onBack} />
        <h3 className="font-medium" data-testid="drill-document-title">
          Document {documentLabel(doc)}
          <span className="font-normal text-muted-foreground">
            {" "}
            · company {doc.company}
            {summary && ` · ${formatDate(summary.date)} · ${summary.customer}`}
          </span>
        </h3>
      </div>
      {result === null ? (
        <DrillLoading what="lines" />
      ) : !result.ok ? (
        <ErrorCard message={result.message} onRetry={retry} />
      ) : (
        <>
          <DrillTotals
            items={[
              { label: "Net value", value: formatAed(netValue) },
              { label: "Cost", value: formatAed(cost) },
              { label: "Margin", value: formatAed(netValue - cost) },
              { label: "Margin %", value: formatPct(netValue ? (netValue - cost) / netValue : null) },
              { label: "Lines", value: formatInt(lines.length) },
            ]}
          />
          <DataTable
            title={`Document ${documentLabel(doc)} lines`}
            columns={LINE_COLUMNS}
            rows={lines.map((line) => ({
              item: line.item,
              itemHref: line.itemCode ? itemHref(line.itemCode, filters) : null,
              itemCode: line.itemCode,
              quantity: line.quantity,
              netValue: line.netValue,
              cost: line.cost,
              margin: line.netValue - line.cost,
              marginPct: line.marginPct,
            }))}
            showTotals
            totals={netValue ? { marginPct: (netValue - cost) / netValue } : undefined}
            pageSize={50}
            maxHeight={9999}
          />
        </>
      )}
    </div>
  );
}

/**
 * The Sales drill-down dialog: a month, week or day → its documents → one document's lines. It
 * opens from `?drill=` in the URL, so reload and shared links keep it; a full-screen sheet on phones.
 */
export function SalesDrillDialog() {
  const { filters } = useShell();
  const { drill, doc } = useSalesDrill();
  // The last period stays on screen while the dialog fades out, and is where focus goes back to.
  const [lastDrill, setLastDrill] = useState(drill);
  if (drill !== null && drill !== lastDrill) setLastDrill(drill);
  const shown = drill ?? lastDrill;
  const range = drillRange(shown, filters);
  const [summaries, setSummaries] = useState<Map<string, SalesDocument>>(new Map());
  const { container, setReturnTo } = useReturnFocus(doc === null ? null : docParam(doc));

  return (
    <DrillDialog
      open={drill !== null && range !== null}
      params={PARAMS}
      testId="sales-drill"
      title={shown && range ? `Sales · ${drillTitle(shown, range)}` : "Sales"}
      description={`Invoices, returns and delivery notes${
        filters.companies.length > 0 ? `, company ${filters.companies.join(", ")}` : ", all companies"
      }`}
      // After a reload, focus goes back to the bar for this period.
      returnSelector={() => (shown ? `[data-drill="${CSS.escape(shown)}"]` : null)}
    >
      {shown && range && (
        <>
          <div ref={container} hidden={doc !== null}>
            <DocumentsView
              key={`${shown}${filtersToSearch(filters)}`}
              drill={shown}
              filters={filters}
              onOpen={(opened) => {
                setSummaries((current) => new Map(current).set(docParam(opened), opened));
                setDrillParams({ [DOC_PARAM]: docParam(opened) });
              }}
            />
          </div>
          {doc && (
            <LinesView
              key={docParam(doc)}
              drill={shown}
              filters={filters}
              doc={doc}
              summary={summaries.get(docParam(doc))}
              onBack={() => {
                setReturnTo(docParam(doc));
                setDrillParams({ [DOC_PARAM]: null });
              }}
            />
          )}
        </>
      )}
    </DrillDialog>
  );
}
