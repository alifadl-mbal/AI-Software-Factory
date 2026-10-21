"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorCardProps {
  title?: string;
  /** Already friendly: from `DataSourceError.userMessage`. Never a stack trace. */
  message: string;
  /** Custom retry; by default the page is re-rendered from the server. */
  onRetry?: () => void;
  className?: string;
}

/** A section that failed to load: what went wrong in plain words, and a Retry button. */
export function ErrorCard({
  title = "Couldn't load this data",
  message,
  onRetry,
  className,
}: ErrorCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-[20px] border border-bad/30 bg-bad/5 p-5 shadow-glass sm:flex-row sm:items-start",
        className,
      )}
      data-testid="error-card"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bad/10 text-negative">
        <AlertTriangle className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-foreground/75">{message}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => startTransition(() => (onRetry ? onRetry() : router.refresh()))}
      >
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
        Retry
      </Button>
    </div>
  );
}
