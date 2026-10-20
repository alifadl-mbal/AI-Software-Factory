import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";

import { GateCard } from "@/components/shell/gate-card";
import { accessMode } from "@/lib/server/access";

export const metadata: Metadata = { title: "Sign-in not configured" };

/** Production, live Orion, but no Microsoft sign-in configured: no data until IT sets it up. */
export default function NotConfiguredPage() {
  if (accessMode() !== "locked") redirect("/");

  return (
    <GateCard icon={LockKeyhole} title="Sign-in is not configured" testId="not-configured">
      <p className="text-sm text-muted-foreground">
        MBAL BI is connected to live Orion figures, so it only serves them to signed-in MBAL staff. Microsoft
        sign-in hasn&apos;t been set up on this server yet.
      </p>
      <p className="text-sm text-muted-foreground">
        IT: set the <code className="font-mono text-xs">AUTH_*</code> variables as described in{" "}
        <code className="font-mono text-xs">docs/deployment.md</code>, then restart the service.
      </p>
    </GateCard>
  );
}
