"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAed, formatInt, formatPct } from "@/lib/format";
import { marginPct, totalOf, type CalendarFigures, type CalendarRow } from "@/lib/sales-calendar";
import { cn } from "@/lib/utils";

import { useSalesDrill } from "./sales-drill";

const INDENT = { month: "pl-0", week: "pl-6", day: "pl-12" } as const;

function Figures({ figures }: { figures: CalendarFigures }) {
  const pct = marginPct(figures);
  return (
    <>
      <TableCell className="tabular text-right">{formatInt(figures.sellingDays)}</TableCell>
      <TableCell className="tabular text-right">{formatInt(figures.invoiceCount)}</TableCell>
      <TableCell className={cn("tabular text-right", figures.netRevenue < 0 && "text-negative")}>
        {formatAed(figures.netRevenue)}
      </TableCell>
      <TableCell className={cn("tabular text-right", figures.returnsValue < 0 && "text-negative")}>
        {formatAed(figures.returnsValue)}
      </TableCell>
      <TableCell className="tabular text-right">{pct === null ? "—" : formatPct(pct)}</TableCell>
    </>
  );
}

/**
 * Sales by month, expanding to ISO weeks and then days, with zero rows for days without sales.
 * A period's label opens its documents in the drill-down dialog.
 */
export function CalendarTable({ months }: { months: CalendarRow[] }) {
  const { open } = useSalesDrill();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // `firstId` marks the first row of an expanded group, for its toggle's aria-controls.
  const renderRows = (rows: CalendarRow[], firstId?: string): React.ReactNode =>
    rows.map((row, index) => {
      const isOpen = expanded.has(row.drill);
      const panelId = `sales-calendar-${row.drill}`;
      const empty = row.netRevenue === 0 && row.cost === 0 && row.invoiceCount === 0;
      return (
        <Fragment key={row.drill}>
          <TableRow
            id={index === 0 ? firstId : undefined}
            className={cn(
              row.level === "month" && "font-medium",
              row.level === "day" && empty && "text-muted-foreground",
            )}
            data-testid={`calendar-${row.level}`}
          >
            <TableCell className={cn("whitespace-nowrap", INDENT[row.level])}>
              <span className="inline-flex items-center gap-1">
                {row.children.length > 0 ? (
                  <button
                    type="button"
                    className="rounded-sm p-0.5 hover:text-primary"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? panelId : undefined}
                    aria-label={`${isOpen ? "Collapse" : "Expand"} ${row.label}`}
                    onClick={() => toggle(row.drill)}
                  >
                    <ChevronRight
                      className={cn("size-4 transition-transform", isOpen && "rotate-90")}
                      aria-hidden
                    />
                  </button>
                ) : (
                  <span className="w-5" aria-hidden />
                )}
                <button
                  type="button"
                  className="rounded-sm text-left underline-offset-4 hover:text-primary hover:underline"
                  title={`List the documents of ${row.label}`}
                  data-drill={row.drill}
                  onClick={() => open(row.drill)}
                >
                  {row.label}
                </button>
              </span>
            </TableCell>
            <Figures figures={row} />
          </TableRow>
          {isOpen && renderRows(row.children, panelId)}
        </Fragment>
      );
    });

  return (
    <div className="overflow-hidden rounded-lg border" data-testid="sales-calendar">
      <Table className="min-w-[640px]">
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10">Period</TableHead>
            <TableHead className="h-10 text-right">Selling days</TableHead>
            <TableHead className="h-10 text-right">Invoices</TableHead>
            <TableHead className="h-10 text-right">Net revenue</TableHead>
            <TableHead className="h-10 text-right">Returns</TableHead>
            <TableHead className="h-10 text-right">Margin %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{renderRows(months)}</TableBody>
        <TableFooter className="bg-muted/60">
          <TableRow className="font-semibold hover:bg-transparent" data-testid="calendar-total">
            <TableCell>Total</TableCell>
            <Figures figures={totalOf(months)} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
