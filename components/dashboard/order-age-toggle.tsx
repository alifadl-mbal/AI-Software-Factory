"use client";

import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { DEFAULT_ORDER_AGE, ORDER_AGE_OPTIONS, ORDER_AGE_PARAM, type OrderAge } from "@/lib/order-age";
import { cn } from "@/lib/utils";

/**
 * "Orders placed: last 2 years · 12 months · all" for the as-of-today order books. It lives in the
 * URL as `?since=`, like the filters; the default is left out.
 */
export function OrderAgeToggle({ value }: { value: OrderAge }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { startTransition } = useShell();
  const labelId = useId();

  function choose(age: OrderAge) {
    const params = new URLSearchParams(searchParams);
    if (age === DEFAULT_ORDER_AGE) params.delete(ORDER_AGE_PARAM);
    else params.set(ORDER_AGE_PARAM, age);
    const search = params.toString().replaceAll("%2C", ",");
    startTransition(() => router.push(`${pathname}${search ? `?${search}` : ""}`, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="order-age-toggle">
      <span id={labelId} className="text-sm text-muted-foreground">
        Orders placed:
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="inline-flex overflow-hidden rounded-[10px] border bg-card"
      >
        {ORDER_AGE_OPTIONS.map((option, index) => (
          <Button
            key={option.id}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={option.id === value}
            onClick={() => option.id !== value && choose(option.id)}
            className={cn(
              "h-8 rounded-none px-3 text-[13px] font-semibold",
              option.id === value &&
                "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
            )}
          >
            {index === 0 ? option.label : option.short}
          </Button>
        ))}
      </div>
    </div>
  );
}
