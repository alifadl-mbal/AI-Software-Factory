"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { EmptyState } from "./empty-state";
import { formatValue, type ValueFormat } from "./value-format";

/** A column, described with plain data so server components can pass it in. */
export interface ColumnSpec {
  key: string;
  header: string;
  /** Default `text`. Money columns use `aed` (full figures, as tables should). */
  format?: ValueFormat;
  /** Add the column up in the totals row. Leave off for ratios like margin %. */
  sum?: boolean;
}

export type TableRowData = Record<string, string | number | null>;

export interface DataTableProps {
  columns: ColumnSpec[];
  rows: TableRowData[];
  /** Used for the CSV file name and the search box label. */
  title: string;
  pageSize?: number;
  /** Show a totals row summing the `sum` columns over every row (not just the page). */
  showTotals?: boolean;
  initialSort?: SortingState;
  /** Height of the scroll area; the header stays put while the body scrolls. */
  maxHeight?: number;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Turn rows into CSV text with raw (unformatted) numbers, ready for Excel. */
export function toCsv(columns: ColumnSpec[], rows: TableRowData[]): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column.key])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function download(fileName: string, text: string) {
  // The BOM makes Excel read the file as UTF-8.
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

const isNumeric = (format: ValueFormat | undefined) => format !== undefined && format !== "text";

/** Sortable, searchable, paginated table with a sticky header and CSV export. */
export function DataTable({
  columns,
  rows,
  title,
  pageSize = 10,
  showTotals = false,
  initialSort = [],
  maxHeight = 520,
}: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [globalFilter, setGlobalFilter] = useState("");

  const columnDefs = useMemo<ColumnDef<TableRowData>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        accessorFn: (row) => row[column.key],
        header: column.header,
        sortDescFirst: isNumeric(column.format),
        enableGlobalFilter: !isNumeric(column.format),
        cell: (context) => formatValue(column.format ?? "text", context.getValue()),
      })),
    [columns],
  );

  // The React Compiler isn't enabled, so TanStack's unmemoizable table object is fine here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const filteredRows = table.getFilteredRowModel().rows;
  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const fileName = `${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}.csv`;

  if (rows.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="data-table">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={globalFilter}
            onChange={(event) => {
              setGlobalFilter(event.target.value);
              table.setPageIndex(0);
            }}
            placeholder="Search…"
            aria-label={`Search ${title}`}
            className="h-8 pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() =>
            // Every row that matches the search, in the current sort order, not just this page.
            download(
              fileName,
              toCsv(
                columns,
                table.getPrePaginationRowModel().rows.map((row) => row.original),
              ),
            )
          }
        >
          <Download aria-hidden />
          Export CSV
        </Button>
      </div>

      <div className="overflow-auto rounded-lg border" style={{ maxHeight }}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const spec = columns.find((column) => column.key === header.column.id);
                  const sorted = header.column.getIsSorted();
                  const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
                  return (
                    <TableHead
                      key={header.id}
                      className={cn("h-10", isNumeric(spec?.format) && "text-right")}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm font-medium hover:text-foreground",
                          isNumeric(spec?.format) && "flex-row-reverse",
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIcon className={cn("size-3.5", !sorted && "opacity-40")} aria-hidden />
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-20 text-center text-muted-foreground">
                  No rows match “{globalFilter}”.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const spec = columns.find((column) => column.key === cell.column.id);
                    const value = cell.getValue();
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          isNumeric(spec?.format) && "tabular text-right",
                          typeof value === "number" && value < 0 && "text-negative",
                          !isNumeric(spec?.format) && "max-w-72 truncate",
                        )}
                        title={!isNumeric(spec?.format) ? String(value ?? "") : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
          {showTotals && (
            <TableFooter className="sticky bottom-0 bg-muted/80">
              <TableRow className="hover:bg-transparent">
                {columns.map((column, index) => (
                  <TableCell
                    key={column.key}
                    className={cn("font-semibold", isNumeric(column.format) && "tabular text-right")}
                  >
                    {index === 0
                      ? globalFilter
                        ? `Total (${filteredRows.length} shown)`
                        : "Total"
                      : column.sum
                        ? formatValue(
                            column.format ?? "text",
                            filteredRows.reduce(
                              (total, row) => total + (Number(row.original[column.key]) || 0),
                              0,
                            ),
                          )
                        : ""}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="tabular">
            {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, filteredRows.length)} of{" "}
            {filteredRows.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="tabular px-2">
              Page {pageIndex + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
