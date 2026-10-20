import Link from "next/link";
import { Compass } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={Compass}
        title="Page not found"
        message="That dashboard doesn't exist (yet)."
        className="w-full max-w-md"
      />
      <Button asChild variant="outline">
        <Link href="/">Back to the overview</Link>
      </Button>
    </div>
  );
}
