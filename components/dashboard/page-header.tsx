import type { Filters } from "@/lib/filters";

import { ScopeLine } from "./scope-line";

/**
 * Page title, one-line description and the scope line: the period, companies, salespeople and
 * brands being shown. With `asOf` (YYYY-MM-DD) the page
 * shows figures as of that day instead of a date range, and says so.
 */
export function PageHeader({
  title,
  description,
  filters,
  asOf,
  note,
}: {
  title: string;
  description: string;
  filters: Filters;
  asOf?: string;
  /** A second line for figures that don't follow the period, such as "as of today" ones. */
  note?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-1 md:mb-8">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p>
      <ScopeLine filters={filters} asOf={asOf} />
      {note && (
        <p className="text-xs text-muted-foreground" data-testid="period-note">
          {note}
        </p>
      )}
    </div>
  );
}
