"use client";

import { Fragment, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAed, formatDeltaPct, pctChange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StatementAmounts as Amounts, StatementRow } from "@/lib/server/queries/finance";

import { JournalDrawer, type DrillAccount } from "./journal-drawer";

function Variance({ amounts }: { amounts: Amounts }) {
  const variance = amounts.current - amounts.previous;
  const change = pctChange(amounts.current, amounts.previous);
  const tone =
    amounts.signedChange === null || Math.abs(amounts.signedChange) < 0.5
      ? "none"
      : amounts.signedChange > 0
        ? "good"
        : "bad";
  const Arrow = variance > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <>
      <TableCell
        className={cn(
          "tabular text-right",
          tone === "good" && "text-positive",
          tone === "bad" && "text-negative",
        )}
      >
        <span className="inline-flex items-center gap-0.5">
          {tone !== "none" && <Arrow className="size-3.5" aria-hidden />}
          {formatAed(variance)}
          {tone !== "none" && (
            <span className="sr-only">{tone === "good" ? " (favourable)" : " (unfavourable)"}</span>
          )}
        </span>
      </TableCell>
      <TableCell className="tabular text-right text-muted-foreground">
        {change === null ? "—" : formatDeltaPct(change)}
      </TableCell>
    </>
  );
}

function Figures({ amounts }: { amounts: Amounts }) {
  return (
    <>
      <TableCell className="tabular text-right">{formatAed(amounts.current)}</TableCell>
      <TableCell className="tabular text-right text-muted-foreground">
        {formatAed(amounts.previous)}
      </TableCell>
      <Variance amounts={amounts} />
    </>
  );
}

/**
 * The P&L statement: level_1 groups that expand to their main accounts, with gross and net profit
 * between them. Clicking an account opens its journal lines in a side panel.
 */
export function PnlStatement({ rows }: { rows: StatementRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<DrillAccount | null>(null);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-hidden rounded-lg border" data-testid="pnl-statement">
      <Table className="min-w-[640px]">
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10">Line</TableHead>
            <TableHead className="h-10 text-right">This period</TableHead>
            <TableHead className="h-10 text-right">Same period last year</TableHead>
            <TableHead className="h-10 text-right">Variance</TableHead>
            <TableHead className="h-10 text-right">Variance %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isOpen = expanded.has(row.id);
            const expandable = row.kind !== "subtotal" && row.accounts.length > 0;
            const panelId = `pnl-accounts-${row.id}`;
            return (
              <Fragment key={row.id}>
                <TableRow
                  className={cn(
                    row.kind === "subtotal" && "bg-muted/40 font-semibold",
                    row.kind === "unmapped" && "bg-chart-4/10",
                  )}
                  data-testid={`pnl-row-${row.id}`}
                >
                  <TableCell className="min-w-56 font-medium whitespace-normal">
                    {expandable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-sm text-left hover:text-primary"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? panelId : undefined}
                        onClick={() => toggle(row.id)}
                      >
                        <ChevronRight
                          className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-90")}
                          aria-hidden
                        />
                        {row.label}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({row.accounts.length})
                        </span>
                      </button>
                    ) : (
                      <span className={cn(row.kind === "subtotal" && "pl-5.5")}>{row.label}</span>
                    )}
                    {row.note && (
                      <p className="max-w-md pl-5.5 text-xs font-normal text-muted-foreground">{row.note}</p>
                    )}
                  </TableCell>
                  <Figures amounts={row} />
                </TableRow>
                {expandable &&
                  isOpen &&
                  row.accounts.map((account, index) => (
                    <TableRow
                      key={account.mainAcnt}
                      id={index === 0 ? panelId : undefined}
                      className="text-muted-foreground"
                    >
                      <TableCell className="max-w-80 pl-8">
                        <button
                          type="button"
                          className="max-w-full truncate rounded-sm text-left text-foreground underline-offset-2 hover:text-primary hover:underline"
                          title={`Show journal lines for ${account.mainAcnt} · ${account.name}`}
                          onClick={() => setDrill({ mainAcnt: account.mainAcnt, name: account.name })}
                          data-testid="pnl-account"
                        >
                          <span className="tabular text-muted-foreground">{account.mainAcnt}</span> ·{" "}
                          {account.name}
                        </button>
                      </TableCell>
                      <Figures amounts={account} />
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      <JournalDrawer account={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
