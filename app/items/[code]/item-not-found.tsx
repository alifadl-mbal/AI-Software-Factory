import Link from "next/link";
import { PackageX } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";

/**
 * An unknown item code: a friendly state, not an error. Rendered by the page rather than through
 * notFound(), as on the customer page (throwing while the shell streams falls back to client
 * rendering).
 */
export function ItemNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-12" data-testid="item-not-found">
      <h1 className="sr-only">Item not found</h1>
      <EmptyState
        icon={PackageX}
        title="Item not found"
        message="Orion has no item with this code. Search for the item by description with Ctrl+K (⌘K on a Mac)."
        className="w-full max-w-md"
      />
      <Button asChild variant="outline">
        <Link href="/">Back to the overview</Link>
      </Button>
    </div>
  );
}
