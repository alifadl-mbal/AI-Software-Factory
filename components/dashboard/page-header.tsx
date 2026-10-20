import { formatDate } from "@/lib/format";
import type { Filters } from "@/lib/filters";

/** Page title, one-line description and the period being shown. */
export function PageHeader({
  title,
  description,
  filters,
}: {
  title: string;
  description: string;
  filters: Filters;
}) {
  return (
    <div className="mb-6 flex flex-col gap-1 md:mb-8">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p>
      <p className="tabular text-xs text-muted-foreground" data-testid="period">
        {formatDate(filters.start)} – {formatDate(filters.end)}
        {filters.companies.length > 0
          ? ` · ${filters.companies.length} ${filters.companies.length === 1 ? "company" : "companies"}`
          : " · All companies"}{" "}
        · compared with the same period last year
      </p>
    </div>
  );
}
