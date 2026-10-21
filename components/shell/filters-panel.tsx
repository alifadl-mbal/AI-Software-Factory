"use client";

import { usePathname } from "next/navigation";
import { Suspense, use } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { filterGroupsForPath, type FilterGroup } from "@/lib/dashboards";
import { DEFAULT_RANGE, hasSalesFilter, presetRange } from "@/lib/filters";
import type { Company } from "@/lib/server/queries/common";
import { cn } from "@/lib/utils";

import { BRAND_NOUN, COMPANY_NOUN, ChecklistFilter, SALESPERSON_NOUN } from "./checklist-filter";
import { PeriodFilter } from "./period-filter";
import { useShell } from "./shell-context";

function CompanyFilter({ companies: companiesPromise }: { companies: Promise<Company[]> }) {
  const companies = use(companiesPromise);
  const { filters, setFilters } = useShell();
  return (
    <ChecklistFilter
      key={`company:${filters.companies.join(",")}`}
      title="Company"
      noun={COMPANY_NOUN}
      testId="company"
      options={companies.map((company) => ({ code: company.code, name: company.name }))}
      error={companies.length === 0}
      selected={filters.companies}
      onApply={(codes) => setFilters({ companies: codes })}
      showCode
    />
  );
}

function SalesFilters({ groups }: { groups: readonly FilterGroup[] }) {
  const { filters, setFilters, salesOptions } = useShell();
  const data = salesOptions.status === "ok" ? salesOptions.data : null;
  const error = salesOptions.status === "error";
  return (
    <>
      {groups.includes("salesperson") && (
        <ChecklistFilter
          key={`salesperson:${filters.salespeople.join(",")}`}
          title="Salesman"
          noun={SALESPERSON_NOUN}
          testId="salesperson"
          options={data?.salespeople ?? null}
          error={error}
          selected={filters.salespeople}
          onApply={(salespeople) => setFilters({ salespeople })}
        />
      )}
      {groups.includes("brand") && (
        <ChecklistFilter
          key={`brand:${filters.brands.join(",")}`}
          title="Brand"
          noun={BRAND_NOUN}
          testId="brand"
          options={data?.brands ?? null}
          error={error}
          selected={filters.brands}
          onApply={(brands) => setFilters({ brands })}
        />
      )}
    </>
  );
}

/** How many filters narrow this page: the Filters button's badge. */
function useActiveCount(groups: readonly FilterGroup[]): number {
  const { filters } = useShell();
  return [
    groups.includes("year") && filters.range !== DEFAULT_RANGE,
    groups.includes("company") && filters.companies.length > 0,
    groups.includes("salesperson") && filters.salespeople.length > 0,
    groups.includes("brand") && filters.brands.length > 0,
  ].filter(Boolean).length;
}

/**
 * The TNS Filters panel: a heading with Reset all, then the groups this page's registry entry
 * lists (`filters` in `lib/dashboards.ts`). Salesman and Brand cascade from the companies and the
 * period through `/api/filter-options`.
 */
function FiltersBody({
  companies,
  groups,
}: {
  companies: Promise<Company[]>;
  groups: readonly FilterGroup[];
}) {
  const { filters } = useShell();
  const salesHidden = !groups.includes("salesperson") && !groups.includes("brand");
  return (
    <>
      {groups.includes("year") && <PeriodFilter />}
      {groups.includes("company") && (
        <Suspense
          fallback={
            <ChecklistFilter
              title="Company"
              noun={COMPANY_NOUN}
              testId="company"
              options={null}
              selected={filters.companies}
              onApply={() => {}}
            />
          }
        >
          <CompanyFilter companies={companies} />
        </Suspense>
      )}
      <SalesFilters groups={groups} />
      {salesHidden && (
        // An active filter is never ignored silently.
        <p className="text-xs text-muted-foreground" data-testid="sales-filter-hint">
          {hasSalesFilter(filters)
            ? "Salesperson and brand don't apply here"
            : "No salesperson or brand here"}
        </p>
      )}
    </>
  );
}

function PanelHeading({ titleId }: { titleId?: string }) {
  const { filters, setFilters, today } = useShell();
  const defaults =
    filters.range === DEFAULT_RANGE &&
    filters.companies.length === 0 &&
    filters.salespeople.length === 0 &&
    filters.brands.length === 0;
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={titleId} className="text-[19px] font-semibold tracking-tight">
        Filters
      </h2>
      <Button
        variant="secondary"
        size="pill"
        disabled={defaults}
        onClick={() =>
          setFilters({
            range: DEFAULT_RANGE,
            ...presetRange(DEFAULT_RANGE, today),
            companies: [],
            salespeople: [],
            brands: [],
          })
        }
        data-testid="filters-reset"
      >
        Reset all
      </Button>
    </div>
  );
}

/** The panel beside the content on wide screens (1024 px and up): glass, sticky, 240–288 px. */
export function FiltersAside({ companies }: { companies: Promise<Company[]> }) {
  const groups = filterGroupsForPath(usePathname());
  if (groups.length === 0) return null;
  return (
    <aside
      aria-labelledby="filters-heading"
      className="sticky top-5 hidden max-h-[calc(100svh-2.5rem)] w-[clamp(240px,22vw,288px)] shrink-0 flex-col gap-6 overflow-y-auto overscroll-contain glass p-6 lg:flex"
      data-testid="filters-panel"
    >
      <PanelHeading titleId="filters-heading" />
      <FiltersBody companies={companies} groups={groups} />
    </aside>
  );
}

/** Under 1024 px the same panel sits in a sheet behind one button that counts the active filters. */
export function FiltersSheet({
  companies,
  className,
}: {
  companies: Promise<Company[]>;
  className?: string;
}) {
  const groups = filterGroupsForPath(usePathname());
  const active = useActiveCount(groups);
  if (groups.length === 0) return null;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-[42px] w-full gap-2 rounded-xl lg:hidden", className)}
          data-testid="filters-trigger"
        >
          <SlidersHorizontal aria-hidden />
          Filters
          {active > 0 && (
            <span
              className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
              aria-label={`${active} active`}
              data-testid="filters-active-count"
            >
              {active}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85svh] gap-0 overflow-y-auto rounded-t-[20px]"
        data-testid="filters-drawer"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="sr-only">Filters</SheetTitle>
          <SheetDescription className="sr-only">They apply to every figure on this page.</SheetDescription>
          <PanelHeading />
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          <FiltersBody companies={companies} groups={groups} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
