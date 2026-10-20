"use server";

import { signIn, signOut } from "@/auth";
import { authEnabled, safeCallbackPath, SIGN_IN_PATH } from "@/lib/server/access";

/** The sign-in page's button: off to Microsoft, then back to the page the user asked for. */
export async function signInWithMicrosoft(formData: FormData): Promise<void> {
  if (!authEnabled()) return;
  await signIn("microsoft-entra-id", { redirectTo: safeCallbackPath(formData.get("callbackUrl")) });
}

/** The user menu's "Sign out". */
export async function signOutOfMbal(): Promise<void> {
  if (!authEnabled()) return;
  await signOut({ redirectTo: SIGN_IN_PATH });
}
