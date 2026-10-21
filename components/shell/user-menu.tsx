"use client";

import { useTransition } from "react";
import { Loader2, LogOut } from "lucide-react";

import { signOutOfMbal } from "@/app/auth-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface SignedInUser {
  name: string | null;
  email: string | null;
}

/** "Ali Fadlalla" -> "AF", "ali@mbal.ae" -> "A". */
export function initials(user: SignedInUser): string {
  const source = user.name?.trim() || user.email?.split("@")[0] || "?";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : source[0];
  return letters.toUpperCase();
}

/** The signed-in user in the header: initials, and name plus a "Sign out" item in the menu. */
export function UserMenu({ user }: { user: SignedInUser }) {
  const [isPending, startTransition] = useTransition();
  const label = user.name || user.email || "Signed in";

  return (
    // Non-modal: a modal menu aria-hides the page while focus can still sit on the trigger.
    // The trigger's name starts with its visible initials (WCAG 2.5.3, label in name).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="user-menu">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials(user)}
          </span>
          <span className="sr-only">Account: {label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{label}</span>
          {user.name && user.email && (
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isPending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(() => signOutOfMbal());
          }}
          data-testid="sign-out"
        >
          {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
