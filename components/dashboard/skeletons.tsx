import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The grid for a row of KpiCards: two per row on phones and tablets (an odd last card spans the
 * row), all five on one row on wide screens. Use it for the cards and their skeleton alike.
 */
export const KPI_GRID =
  "grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 xl:[&>*:last-child:nth-child(odd)]:col-span-1";

/** Placeholder for a row of KPI cards while they stream in. `grid` replaces the default layout. */
export function KpiRowSkeleton({
  count = 4,
  grid = KPI_GRID,
  className,
}: {
  count?: number;
  grid?: string;
  className?: string;
}) {
  return (
    <div className={cn(grid, className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="gap-0 py-0">
          <CardContent className="flex flex-col gap-3 p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-40" />
          </CardContent>
          <Skeleton className="h-12 rounded-none rounded-b-xl" />
        </Card>
      ))}
    </div>
  );
}

/** Placeholder for a ChartCard while its data streams in. */
export function ChartCardSkeleton({ height = 280, className }: { height?: number; className?: string }) {
  return (
    <Card className={cn("gap-4", className)} aria-busy="true" aria-label="Loading">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </CardHeader>
      <CardContent>
        <Skeleton className="w-full" style={{ height }} />
      </CardContent>
    </Card>
  );
}
