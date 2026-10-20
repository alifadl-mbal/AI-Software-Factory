import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";

import { auth } from "@/auth";
import { signInWithMicrosoft } from "@/app/auth-actions";
import { GateCard } from "@/components/shell/gate-card";
import { Button } from "@/components/ui/button";
import { accessMode, NO_ACCESS_PATH, safeCallbackPath } from "@/lib/server/access";

export const metadata: Metadata = { title: "Sign in" };

/** Auth.js error codes (`?error=`) that mean "you can't come in" rather than "try again". */
const ERRORS: Record<string, string> = {
  AccessDenied: "That account isn't allowed to use MBAL BI.",
  Configuration: "Sign-in isn't set up correctly on the server. Ask IT to check the logs.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (accessMode() !== "auth") redirect("/");
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(params.callbackUrl);
  const session = await auth();
  if (session?.user) redirect(session.allowed ? callbackUrl : NO_ACCESS_PATH);
  const error =
    typeof params.error === "string" ? (ERRORS[params.error] ?? "Sign-in failed. Please try again.") : null;

  return (
    <GateCard title="Sign in to continue" testId="sign-in">
      <p className="text-sm text-muted-foreground">
        The dashboards are for MBAL staff only. Use your MBAL Microsoft 365 account.
      </p>
      {error && (
        <p role="alert" className="w-full rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <form action={signInWithMicrosoft} className="w-full">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <Button type="submit" className="w-full" data-testid="sign-in-microsoft">
          <LogIn aria-hidden />
          Sign in with Microsoft
        </Button>
      </form>
    </GateCard>
  );
}
