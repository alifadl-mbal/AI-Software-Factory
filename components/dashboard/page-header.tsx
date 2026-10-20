import { formatDate } from "@/lib/format";
import type { Filters } from "@/lib/filters";

/**
 * Page title, one-line description and the period being shown. With `asOf`, the page shows balances
 * on that day instead of a period, and says the date filter doesn't apply.
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
  const companies =
    filters.companies.length > 0
      ? `${filters.companies.length} ${filters.companies.length === 1 ? "company" : "companies"}`
      : "All companies";
  return (
    <div className="mb-6 flex flex-col gap-1 md:mb-8">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p>
      {asOf ? (
        <p className="tabular text-xs text-muted-foreground" data-testid="period">
          Balances as of {formatDate(asOf)} · {companies} · the date filter doesn&rsquo;t apply here, the
          company filter does
        </p>
      ) : (
        <p className="tabular text-xs text-muted-foreground" data-testid="period">
          {formatDate(filters.start)} – {formatDate(filters.end)} · {companies} · compared with the same
          period last year
        </p>
      )}
      {note && (
        <p className="text-xs text-muted-foreground" data-testid="period-note">
          {note}
        </p>
      )}
    </div>
  );
}
