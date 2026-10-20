import Link from "next/link";

import { formatAed, formatDate, formatInt } from "@/lib/format";

/**
 * One line under the KPIs saying what the order-age choice leaves out, with a link to show
 * everything. Renders nothing when nothing is left out.
 */
export function OrderAgeNote({
  hiddenLines,
  hiddenValue,
  cutoff,
  showAllHref,
}: {
  hiddenLines: number;
  hiddenValue: number;
  /** The first order date that counts, `YYYY-MM-DD`. */
  cutoff: string;
  showAllHref: string;
}) {
  if (hiddenLines === 0) return null;
  return (
    <p className="text-sm text-muted-foreground" data-testid="order-age-note">
      Leaves out <span className="tabular font-medium text-foreground">{formatInt(hiddenLines)}</span>{" "}
      {hiddenLines === 1 ? "line" : "lines"} worth{" "}
      <span className="tabular font-medium text-foreground">{formatAed(hiddenValue)}</span> on orders placed
      before {formatDate(cutoff)}.{" "}
      <Link
        href={showAllHref}
        scroll={false}
        className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Show all
      </Link>
    </p>
  );
}
