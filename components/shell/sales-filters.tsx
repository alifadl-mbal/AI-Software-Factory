"use client";

import { usePathname } from "next/navigation";
import { Tag, UserRound } from "lucide-react";

import { salesFilterSupport } from "@/lib/dashboards";
import { hasSalesFilter } from "@/lib/filters";

import { CodeMultiSelect, type Noun } from "./code-multi-select";
import { useShell } from "./shell-context";

export const SALESPERSON_NOUN: Noun = { one: "salesperson", many: "salespeople" };
export const BRAND_NOUN: Noun = { one: "brand", many: "brands" };

/**
 * The salesperson and brand filters. Their choices cascade from the companies and period (only
 * those with sales there). On pages whose data has neither they are disabled, with a hint, and the
 * hint says so when one is set: an active filter is never ignored silently. On pages with brand
 * but no salesperson (Purchasing) only the salesperson filter is disabled.
 */
export function SalesFilterSelects() {
  const pathname = usePathname();
  const { filters, setFilters, salesOptions } = useShell();
  const support = salesFilterSupport(pathname);
  const disabled = support === "none";
  const salespersonDisabled = disabled || support === "brand";
  const data = salesOptions.status === "ok" ? salesOptions.data : null;
  const error = salesOptions.status === "error";
  const hint = hasSalesFilter(filters)
    ? "Salesperson and brand are set but don't apply here: this page's data has neither"
    : "This page's data has no salesperson or brand";
  const salespersonHint = disabled
    ? hint
    : filters.salespeople.length > 0
      ? "Salesperson is set but doesn't apply here: this page's data has no salesperson"
      : "This page's data has no salesperson";

  return (
    <>
      <CodeMultiSelect
        noun={SALESPERSON_NOUN}
        icon={UserRound}
        testId="salesperson"
        options={data?.salespeople ?? null}
        error={error}
        selected={filters.salespeople}
        onApply={(salespeople) => setFilters({ salespeople })}
        disabled={salespersonDisabled}
        disabledHint={salespersonHint}
      />
      <CodeMultiSelect
        noun={BRAND_NOUN}
        icon={Tag}
        testId="brand"
        options={data?.brands ?? null}
        error={error}
        selected={filters.brands}
        onApply={(brands) => setFilters({ brands })}
        disabled={disabled}
        disabledHint={hint}
      />
      {disabled && (
        <span
          className="text-xs text-muted-foreground lg:max-w-44 lg:leading-tight"
          data-testid="sales-filter-hint"
        >
          {hasSalesFilter(filters)
            ? "Salesperson and brand don't apply here"
            : "No salesperson or brand here"}
        </span>
      )}
    </>
  );
}
