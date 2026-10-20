import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * A data-quality callout under a chart or table: something in Orion's data that changes the figure
 * shown, with what it means. A bold headline, then the detail in muted text.
 */
export function DataQualityNote({
  title,
  children,
  testId,
}: {
  title: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
      data-testid={testId}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
      <p>
        <span className="font-semibold">Data quality: {title}</span>{" "}
        <span className="text-muted-foreground">{children}</span>
      </p>
    </div>
  );
}
