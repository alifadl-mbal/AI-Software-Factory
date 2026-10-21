"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The 3 / 6 / 12 month choice for dead stock. It lives in the URL as `?dead=`, like the filters. */
export function DeadStockToggle({
  options,
  value,
  defaultValue,
}: {
  options: readonly number[];
  value: number;
  defaultValue: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { startTransition } = useShell();

  function choose(months: number) {
    const params = new URLSearchParams(searchParams);
    if (months === defaultValue) params.delete("dead");
    else params.set("dead", String(months));
    const search = params.toString().replaceAll("%2C", ",");
    startTransition(() => router.push(`${pathname}${search ? `?${search}` : ""}`, { scroll: false }));
  }

  return (
    <div
      role="group"
      aria-label="No movement for"
      className="inline-flex overflow-hidden rounded-[10px] border bg-card"
      data-testid="dead-stock-toggle"
    >
      {options.map((months) => (
        <Button
          key={months}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={months === value}
          onClick={() => months !== value && choose(months)}
          className={cn(
            "h-8 rounded-none px-3 text-[13px] font-semibold",
            months === value &&
              "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
          )}
        >
          {months}m<span className="sr-only"> or more without movement</span>
        </Button>
      ))}
    </div>
  );
}
