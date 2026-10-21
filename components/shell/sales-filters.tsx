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
 * The salesperson and brand filters. Their choices cascade from the companies (and, for sales
 * data, the period). On pages whose data lacks one, that one is disabled, with a hint, and the hint
 * says so when it is set: an active filter is never ignored silently.
 */
export function SalesFilterSelects() {
  const pathname = usePathname();
  const { filters, setFilters, salesOptions } = useShell();
  const support = salesFilterSupport(pathname);
  const data = salesOptions.status === "ok" ? salesOptions.data : null;
  const error = salesOptions.status === "error";
  const both = !support.salespeople && !support.brands;
  const salespersonSet = filters.salespeople.length > 0;
  const brandSet = filters.brands.length > 0;
  // Only shown while a select is disabled.
  const hint = (noun: Noun, set: boolean) =>
    set
      ? `A ${noun.one} is set but doesn't apply here: this page's data has no ${noun.one}`
      : `This page's data has no ${noun.one}`;
  const bothHint = hasSalesFilter(filters)
    ? "Salesperson and brand are set but don't apply here: this page's data has neither"
    : "This page's data has no salesperson or brand";
  const salespersonHint = both ? bothHint : hint(SALESPERSON_NOUN, salespersonSet);
  const brandHint = both ? bothHint : hint(BRAND_NOUN, brandSet);

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
        disabled={!support.salespeople}
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
        disabled={!support.brands}
        disabledHint={brandHint}
      />
      {(!support.salespeople || !support.brands) && (
        <span
          className="text-xs text-muted-foreground lg:max-w-44 lg:leading-tight"
          data-testid="sales-filter-hint"
        >
          {both
            ? hasSalesFilter(filters)
              ? "Salesperson and brand don't apply here"
              : "No salesperson or brand here"
            : !support.salespeople
              ? salespersonSet
                ? "Salesperson doesn't apply here"
                : "No salesperson here"
              : brandSet
                ? "Brand doesn't apply here"
                : "No brand here"}
        </span>
      )}
    </>
  );
}
