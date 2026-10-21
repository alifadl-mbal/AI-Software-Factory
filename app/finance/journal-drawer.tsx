"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import { ErrorCard } from "@/components/dashboard/error-card";
import { useShell } from "@/components/shell/shell-context";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { filtersToSearch, type Filters } from "@/lib/filters";
import { formatAed, formatDate, formatInt } from "@/lib/format";
import type { JournalLines } from "@/lib/server/queries/finance";

export interface DrillAccount {
  mainAcnt: string;
  name: string;
}

type Loaded = { ok: true; data: JournalLines } | { ok: false; message: string };

const COLUMNS: ColumnSpec[] = [
  { key: "date", header: "Date" },
  { key: "doc", header: "Document" },
  { key: "docRef", header: "Doc ref" },
  { key: "detail", header: "Detail" },
  { key: "debit", header: "Debit", format: "aed" },
  { key: "credit", header: "Credit", format: "aed" },
];

function linesUrl(search: string, mainAcnt: string): string {
  const params = new URLSearchParams(search);
  params.set("account", mainAcnt);
  return `/api/finance/journal-lines?${params.toString()}`;
}

/**
 * Loads and shows one account's posted journal lines for `filters`. Mounted afresh for each
 * account. The P&L drill-down passes the filters narrowed to one month.
 */
export function JournalLinesView({ account, filters }: { account: DrillAccount; filters: Filters }) {
  const search = filtersToSearch(filters);
  const [result, setResult] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(linesUrl(search, account.mainAcnt), { signal: controller.signal })
      .then((response) => response.json() as Promise<Loaded>)
      .then(setResult)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ ok: false, message: error instanceof Error ? error.message : "Loading failed." });
        }
      });
    return () => controller.abort();
  }, [search, account.mainAcnt, attempt]);

  if (result === null) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" aria-busy="true">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading journal lines…
      </div>
    );
  }
  if (!result.ok) {
    return (
      <ErrorCard
        message={result.message}
        onRetry={() => {
          setResult(null);
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  const { lines, total, totalDebit, totalCredit, limit } = result.data;
  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="journal-lines">
      <dl className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Debits</dt>
          <dd className="tabular font-medium">{formatAed(totalDebit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Credits</dt>
          <dd className="tabular font-medium">{formatAed(totalCredit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Net (credit − debit)</dt>
          <dd className="tabular font-medium">{formatAed(totalCredit - totalDebit)}</dd>
        </div>
      </dl>
      {total > lines.length && (
        <p
          className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
          data-testid="journal-cap-note"
        >
          Showing the newest {formatInt(limit)} of {formatInt(total)} lines. The totals above cover all of
          them; narrow the date range or company to see older lines.
        </p>
      )}
      <DataTable
        title={`Journal lines ${account.mainAcnt}`}
        columns={COLUMNS}
        rows={lines.map((line) => ({
          date: line.date,
          doc: [filters.companies.length === 1 ? "" : line.company, line.tranCode, line.docNo]
            .filter(Boolean)
            .join(" "),
          docRef: line.docRef,
          detail: line.detail,
          debit: line.debit || null,
          credit: line.credit || null,
        }))}
        pageSize={25}
        maxHeight={9999}
      />
    </div>
  );
}

/** Side panel with the posted journal lines behind one P&L account. */
export function JournalDrawer({ account, onClose }: { account: DrillAccount | null; onClose: () => void }) {
  const { filters } = useShell();
  return (
    <Sheet open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-5xl"
        data-testid="journal-drawer"
      >
        {account && (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle>
                {account.mainAcnt} · {account.name}
              </SheetTitle>
              <SheetDescription>
                Posted journal lines, {formatDate(filters.start)} – {formatDate(filters.end)}
                {filters.companies.length > 0
                  ? `, company ${filters.companies.join(", ")}`
                  : ", all companies"}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              <JournalLinesView key={account.mainAcnt} account={account} filters={filters} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
