import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ChartCardProps {
  title: string;
  /** Anchor for links into the page (`/inventory#reorder-alerts`). Defaults to the title, slugged. */
  id?: string;
  description?: string;
  /** Top-right slot: a total, a toggle, an export button. */
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}

/** The frame every chart and table sits in: title, optional description and action, content. */
export function ChartCard({
  title,
  id = slug(title),
  description,
  action,
  className,
  contentClassName,
  children,
}: ChartCardProps) {
  return (
    <Card id={id} className={cn("min-w-0 scroll-mt-20 gap-4", className)}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold tracking-tight">
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={cn("min-w-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** "Dead and slow stock" → "dead-and-slow-stock". */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
