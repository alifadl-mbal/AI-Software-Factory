import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldX } from "lucide-react";

import { auth } from "@/auth";
import { signOutOfMbal } from "@/app/auth-actions";
import { GateCard } from "@/components/shell/gate-card";
import { Button } from "@/components/ui/button";
import { accessMode, SIGN_IN_PATH } from "@/lib/server/access";

export const metadata: Metadata = { title: "No access" };

/** Signed in, but not in `AUTH_ALLOWED_GROUP`. */
export default async function NoAccessPage() {
  if (accessMode() !== "auth") redirect("/");
  const session = await auth();
  if (!session?.user) redirect(SIGN_IN_PATH);
  if (session.allowed) redirect("/");

  return (
    <GateCard icon={ShieldX} title="You don't have access yet" testId="no-access">
      <p className="text-sm text-muted-foreground">
        {session.user.email ? `${session.user.email} is` : "Your account is"} not in the group that may use
        MBAL BI. Ask your manager or IT to add you, then sign in again.
      </p>
      <form action={signOutOfMbal} className="w-full">
        <Button type="submit" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </GateCard>
  );
}
