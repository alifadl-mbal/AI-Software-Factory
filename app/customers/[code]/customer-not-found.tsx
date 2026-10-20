import Link from "next/link";
import { UserX } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";

/**
 * An unknown customer code: a friendly state, not an error. Rendered by the page rather than through
 * notFound(): throwing while the shell streams made React fall back to client rendering (error 419).
 */
export function CustomerNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-12" data-testid="customer-not-found">
      <h1 className="sr-only">Customer not found</h1>
      <EmptyState
        icon={UserX}
        title="Customer not found"
        message="Orion has no customer with this code. Search for the customer by name with Ctrl+K (⌘K on a Mac)."
        className="w-full max-w-md"
      />
      <Button asChild variant="outline">
        <Link href="/">Back to the overview</Link>
      </Button>
    </div>
  );
}
