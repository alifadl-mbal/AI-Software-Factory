import { SearchX, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title?: string;
  message?: string;
  icon?: LucideIcon;
  className?: string;
}

/** Shown in place of a chart or table when the filters match no data. */
export function EmptyState({
  title = "No data for these filters",
  message = "Try a wider date range or more companies.",
  icon: Icon = SearchX,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-panel p-6 text-center",
        className,
      )}
      data-testid="empty-state"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
