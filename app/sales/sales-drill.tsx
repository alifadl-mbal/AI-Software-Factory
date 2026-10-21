"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { DataTable, type ColumnSpec, type TableRowData } from "@/components/dashboard/data-table";
import { ErrorCard } from "@/components/dashboard/error-card";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

type Loaded<T> = { ok: true; data: T } | { ok: false; message: string };

/** Where focus goes back to when the dialog closes: the bar or row that opened it. */
let opener: HTMLElement | SVGElement | null = null;

/** Write drill parameters into the URL without a server round trip (Next syncs `useSearchParams`). */
function setParams(changes: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) params.delete(name);
    else params.set(name, value);
  }
  const search = params.toString().replaceAll("%2C", ",");
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}

/** The open drill-down, from the URL, and the ways to change it. */
export function useSalesDrill() {
  const searchParams = useSearchParams();
  const open = useCallback((drill: string) => {
    const active = document.activeElement;
    opener =
      (active instanceof HTMLElement || active instanceof SVGElement) && active !== document.body
        ? active
        : null;
    setParams({ [DRILL_PARAM]: drill, [DOC_PARAM]: null });
  }, []);
  return {
    drill: searchParams.get(DRILL_PARAM),
    doc: parseDocParam(searchParams.get(DOC_PARAM)),
    open,
  };
}

function useLoaded<T>(url: string): { result: Loaded<T> | null; retry: () => void } {
  const [state, setState] = useState<{ url: string; result: Loaded<T> } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => response.json() as Promise<Loaded<T>>)
      .then((result) => setState({ url, result }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            url,
            result: { ok: false, message: error instanceof Error ? error.message : "Loading failed." },
          });
        }
      });
    return () => controller.abort();
  }, [url, attempt]);

  return {
    result: state?.url === url ? state.result : null,
    retry: () => {
      setState(null);
      setAttempt((value) => value + 1);
    },
  };
}

function apiUrl(path: string, filters: Filters, changes: Record<string, string>): string {
  const params = new URLSearchParams(filtersToSearch(filters));
  for (const [name, value] of Object.entries(changes)) params.set(name, value);
  return `${path}?${params.toString()}`;
}

function Loading({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" aria-busy="true">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Loading {what}…
    </div>
  );
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

function Totals({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl
      className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-5"
      data-testid="drill-totals"
    >
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd
            className="tabular font-medium"
            data-testid={`drill-total-${item.label.toLowerCase().replace(/\W+/g, "-")}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
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
    apiUrl("/api/sales/documents", filters, { [DRILL_PARAM]: drill }),
  );
  if (result === null) return <Loading what="documents" />;
  if (!result.ok) return <ErrorCard message={result.message} onRetry={retry} />;

  const { documents, total, totals, limit } = result.data;
  const byId = new Map(documents.map((doc) => [docParam(doc), doc]));
  return (
    <div className="flex flex-col gap-3" data-testid="drill-documents">
      <Totals
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
    apiUrl("/api/sales/document-lines", filters, { [DRILL_PARAM]: drill, [DOC_PARAM]: docParam(doc) }),
  );
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);

  const lines = result?.ok ? result.data : [];
  const netValue = lines.reduce((sum, line) => sum + line.netValue, 0);
  const cost = lines.reduce((sum, line) => sum + line.cost, 0);
  return (
    <div className="flex flex-col gap-3" data-testid="drill-lines">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button ref={back} variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden />
          Back to documents
        </Button>
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
        <Loading what="lines" />
      ) : !result.ok ? (
        <ErrorCard message={result.message} onRetry={retry} />
      ) : (
        <>
          <Totals
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
  const documentsRef = useRef<HTMLDivElement>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  // After Back, focus the document that was open.
  useEffect(() => {
    if (doc !== null || returnTo === null) return;
    documentsRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(returnTo)}"]`)?.focus();
  }, [doc, returnTo]);

  return (
    <Dialog
      open={drill !== null && range !== null}
      onOpenChange={(open) => {
        if (!open) setParams({ [DRILL_PARAM]: null, [DOC_PARAM]: null });
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-5xl"
        data-testid="sales-drill"
        onCloseAutoFocus={(event) => {
          // Back to the bar or row that opened it; after a reload, to the one for this period.
          const target =
            opener?.isConnected === true
              ? opener
              : shown
                ? document.querySelector<HTMLElement | SVGElement>(`[data-drill="${CSS.escape(shown)}"]`)
                : null;
          opener = null;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        {shown && range && (
          <>
            <DialogHeader className="border-b p-4 pr-12">
              <DialogTitle>Sales · {drillTitle(shown, range)}</DialogTitle>
              <DialogDescription>
                Invoices, returns and delivery notes
                {filters.companies.length > 0
                  ? `, company ${filters.companies.join(", ")}`
                  : ", all companies"}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div ref={documentsRef} hidden={doc !== null}>
                <DocumentsView
                  key={`${shown}${filtersToSearch(filters)}`}
                  drill={shown}
                  filters={filters}
                  onOpen={(opened) => {
                    setSummaries((current) => new Map(current).set(docParam(opened), opened));
                    setParams({ [DOC_PARAM]: docParam(opened) });
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
                    setParams({ [DOC_PARAM]: null });
                  }}
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
