import { TriangleAlert } from "lucide-react";

/** `next dev` on live Orion without sign-in: fine on the developer's PC, never on the server. */
export function NoSignInBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-chart-4/40 bg-chart-4/15 px-4 py-2 text-sm md:px-6"
      data-testid="no-sign-in-banner"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Live Orion data without sign-in. That is allowed in development only; a production server shows
        nothing until Microsoft sign-in is configured (see docs/deployment.md).
      </span>
    </div>
  );
}
