import type { ReactNode } from "react";
import { BarChart3, type LucideIcon } from "lucide-react";

/**
 * The one card on the pages shown before the dashboards: sign-in, no access, not configured.
 * Rendered without the sidebar and top bar (see the root layout).
 */
export function GateCard({
  icon: Icon = BarChart3,
  title,
  children,
  testId,
}: {
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <div
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl bg-card p-6 text-center text-card-foreground ring-1 ring-foreground/10"
        data-testid={testId}
      >
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">MBAL BI</p>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}
