"use client";

import { ErrorCard } from "@/components/dashboard/error-card";

/** Last-resort boundary: sections render their own ErrorCard, so this only catches the unexpected. */
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorCard
      title="Something went wrong on this page"
      message="The error has been logged on the server. Try again, or come back in a minute."
      onRetry={reset}
    />
  );
}
