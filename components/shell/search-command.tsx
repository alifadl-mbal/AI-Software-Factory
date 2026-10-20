"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Search, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { customerHref } from "@/lib/customers";

import { useShell } from "./shell-context";

/** Mirrors the server's `SEARCH_MIN_LENGTH`; shorter text isn't sent. */
const MIN_LENGTH = 2;
/** Wait this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 200;

interface SearchResult {
  kind: "customer";
  code: string;
  name: string;
  detail: string | null;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; query: string; results: SearchResult[] }
  | { status: "error"; message: string };

/** Search results for `query`, fetched from /api/search after a short pause in typing. */
function useSearch(query: string): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const text = query.trim();

  useEffect(() => {
    if (text.length < MIN_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState({ status: "loading" });
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(text)}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        setState(
          body.ok
            ? { status: "done", query: text, results: body.data }
            : { status: "error", message: body.message ?? "Search failed." },
        );
      } catch {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: "Search failed. Check the connection and try again." });
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  if (text.length < MIN_LENGTH) return { status: "idle" };
  // Results for an older query never show (or open on Enter) while the new one is on its way.
  if (state.status === "idle" || (state.status === "done" && state.query !== text))
    return { status: "loading" };
  return state;
}

/**
 * The search button in the top bar and its Ctrl/⌘+K dialog: find a customer by name or code and
 * open their page with the current filters.
 */
export function SearchCommand() {
  const router = useRouter();
  const { filters, startTransition } = useShell();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useSearch(query);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function openResult(result: SearchResult) {
    setOpen(false);
    setQuery("");
    startTransition(() => router.push(customerHref(result.code, filters)));
  }

  const results = search.status === "done" ? search.results : [];

  return (
    <>
      <Button
        variant="outline"
        className="h-9 gap-2 font-normal text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        data-testid="search-trigger"
        title="Search customers (Ctrl+K, ⌘K on a Mac)"
      >
        <Search aria-hidden />
        <span className="hidden 2xl:inline">Search customers…</span>
        <span className="sr-only 2xl:hidden">Search customers</span>
        <kbd className="pointer-events-none hidden h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium 2xl:inline-flex">
          Ctrl K
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setQuery("");
        }}
        title="Search customers"
        description="Find a customer by name or code and open their page."
        className="max-w-[calc(100vw-2rem)] sm:max-w-lg"
      >
        {/* The server does the matching, so cmdk shows its results as they come. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Customer name or code…"
            aria-label="Customer name or code"
            data-testid="search-input"
          />
          <CommandList aria-label="Search results">
            {search.status === "idle" && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Type at least {MIN_LENGTH} characters of a customer’s name or code.
              </p>
            )}
            {search.status === "loading" && (
              <p
                className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Searching…
              </p>
            )}
            {search.status === "error" && (
              <p className="py-6 text-center text-sm text-muted-foreground" role="alert">
                {search.message}
              </p>
            )}
            {search.status === "done" && <CommandEmpty>No customer matches “{search.query}”.</CommandEmpty>}
            {results.length > 0 && (
              <CommandGroup heading="Customers">
                {results.map((result) => (
                  <CommandItem
                    key={`${result.kind}:${result.code}`}
                    value={`${result.kind}:${result.code}`}
                    onSelect={() => openResult(result)}
                    data-testid="search-result"
                  >
                    <UserRound className="text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{result.name}</span>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {result.detail ? `${result.detail} · ` : ""}
                      {result.code}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
