"use client";

import { usePathname } from "next/navigation";

import { BRAND_NOUN, SALESPERSON_NOUN, selectionLabel, type Noun } from "@/components/shell/checklist-filter";
import { useShell } from "@/components/shell/shell-context";
import { salesFilterSupport, type SalesFilterSupport } from "@/lib/dashboards";
import { DATE_PRESETS, hasSalesFilter, type Filters } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import type { FilterOption } from "@/lib/server/queries/sales-filters";

function companiesPart(companies: readonly string[]): string {
  return companies.length > 0
    ? `${companies.length} ${companies.length === 1 ? "company" : "companies"}`
    : "All companies";
}

/** "all salespeople", "salesperson: Priya Nair" or "salespeople: 3 of 14". */
export function codesPart(selected: readonly string[], options: FilterOption[] | null, noun: Noun): string {
  if (selected.length === 0) return `all ${noun.many}`;
  const label = selectionLabel(selected, options, noun);
  if (selected.length === 1) return options ? `${noun.one}: ${label}` : label;
  return options ? `${noun.many}: ${selected.length} of ${options.length}` : label;
}

/**
 * The active scope as one sentence, so a screenshot explains itself: the period, the companies,
 * and the salesperson and brand filters as far as this page applies them.
 */
export function scopeSentence({
  filters,
  asOf,
  support,
  salespeople,
  brands,
}: {
  filters: Filters;
  asOf?: string;
  support: SalesFilterSupport;
  salespeople: FilterOption[] | null;
  brands: FilterOption[] | null;
}): string {
  const parts: string[] = [];
  if (asOf) {
    parts.push(`As of today, ${formatDate(asOf)}`);
  } else {
    const range = DATE_PRESETS.find((preset) => preset.id === filters.range)?.label ?? "Custom range";
    parts.push(`${range} (${formatDate(filters.start)} – ${formatDate(filters.end)})`);
  }
  parts.push(companiesPart(filters.companies));
  if (support === "brand") {
    parts.push(codesPart(filters.brands, brands, BRAND_NOUN));
    if (filters.salespeople.length > 0) parts.push("the salesperson filter doesn't apply here");
  } else if (support !== "none") {
    const sales = `${codesPart(filters.salespeople, salespeople, SALESPERSON_NOUN)} · ${codesPart(filters.brands, brands, BRAND_NOUN)}`;
    const only = { all: "", sales: " (sales figures only)", "sales-orders": " (sales and open orders only)" }[
      support as Exclude<SalesFilterSupport, "brand" | "none">
    ];
    parts.push(hasSalesFilter(filters) ? `${sales}${only}` : sales);
  } else if (hasSalesFilter(filters)) {
    parts.push("the salesperson and brand filters don't apply here");
  }
  parts.push(asOf ? "the date filter doesn't apply here" : "compared with the same period last year");
  return parts.join(" · ");
}

export function ScopeLine({ filters, asOf }: { filters: Filters; asOf?: string }) {
  const pathname = usePathname();
  const { salesOptions } = useShell();
  const data = salesOptions.status === "ok" ? salesOptions.data : null;
  return (
    <p className="tabular text-sm text-pretty text-muted-foreground" data-testid="period">
      {scopeSentence({
        filters,
        asOf,
        support: salesFilterSupport(pathname),
        salespeople: data?.salespeople ?? null,
        brands: data?.brands ?? null,
      })}
    </p>
  );
}
