"use client";

import { useId, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { FilterOption } from "@/lib/server/queries/sales-filters";

import { CheckOption, FilterGroupHead, ModeToggle, type PickMode } from "./filter-parts";

export interface Noun {
  one: string;
  many: string;
}

export const COMPANY_NOUN: Noun = { one: "company", many: "companies" };
export const SALESPERSON_NOUN: Noun = { one: "salesperson", many: "salespeople" };
export const BRAND_NOUN: Noun = { one: "brand", many: "brands" };

/** "All salespeople", one name, or "3 of 14 salespeople" (without the total while it loads). */
export function selectionLabel(
  selected: readonly string[],
  options: FilterOption[] | null,
  noun: Noun,
): string {
  if (selected.length === 0) return `All ${noun.many}`;
  if (selected.length === 1) {
    return options?.find((option) => option.code === selected[0])?.name ?? `1 ${noun.one}`;
  }
  return options ? `${selected.length} of ${options.length} ${noun.many}` : `${selected.length} ${noun.many}`;
}

/** The options, plus any selected code they don't list (no sales in this scope), so it can be unticked. */
function withSelected(options: FilterOption[], selected: readonly string[]): FilterOption[] {
  const known = new Set(options.map((option) => option.code));
  return [...options, ...selected.filter((code) => !known.has(code)).map((code) => ({ code, name: code }))];
}

/**
 * One checklist group of the Filters panel, as on TNS: a search box, All / None, Single / Multi, the
 * ticks and an "x of y" count.
 *
 * - Single: picking an option applies it at once.
 * - Multi: ticks are a draft until Apply, so picking several reloads the page once. Nothing selected
 *   in the URL means all; applying with every option ticked goes back to that, and an empty draft
 *   can't be applied.
 *
 * Mount it with a `key` of the applied selection, so a change from elsewhere (Reset all, Back)
 * drops the draft.
 */
export function ChecklistFilter({
  title,
  noun,
  testId,
  options,
  error,
  selected,
  onApply,
  showCode,
}: {
  title: string;
  noun: Noun;
  testId: string;
  /** `null` while loading. */
  options: FilterOption[] | null;
  /** Set when the options couldn't be loaded. */
  error?: boolean;
  selected: readonly string[];
  onApply: (codes: string[]) => void;
  /** Show each option's code beside its name (companies). */
  showCode?: boolean;
}) {
  const id = useId();
  const [mode, setMode] = useState<PickMode>("multi");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const list = options ? withSelected(options, selected) : null;
  const allCodes = (list ?? []).map((option) => option.code);
  // Untouched, the ticks mirror the URL: nothing selected there means every box is ticked. In Single
  // mode only a single selection shows as picked.
  const ticked =
    mode === "single"
      ? new Set(draft?.size === 1 ? draft : selected.length === 1 ? selected : [])
      : (draft ?? new Set(selected.length > 0 ? selected : allCodes));
  const applied = selected.length > 0 ? selected : allCodes;
  const changed =
    mode === "multi" &&
    draft !== null &&
    (draft.size !== applied.length || applied.some((code) => !draft.has(code)));
  const needle = query.trim().toLowerCase();
  const shown = (list ?? []).filter(
    (option) => !needle || `${option.name} ${option.code}`.toLowerCase().includes(needle),
  );
  const capital = noun.many[0].toUpperCase() + noun.many.slice(1);

  function apply(codes: Set<string>) {
    const all = list !== null && list.every((option) => codes.has(option.code));
    onApply(all ? [] : [...codes].sort());
  }

  function pick(code: string) {
    if (mode === "single") {
      setDraft(new Set([code]));
      apply(new Set([code]));
      return;
    }
    const next = new Set(ticked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setDraft(next);
  }

  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-2.5"
      data-testid={`${testId}-group`}
    >
      <FilterGroupHead
        id={`${id}-title`}
        title={title}
        // Single mode with nothing picked yet still shows every option: the URL says "all".
        count={
          list
            ? `${mode === "single" && ticked.size === 0 ? applied.length : ticked.size} of ${list.length}`
            : ""
        }
        countTestId={`${testId}-count`}
      />
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${noun.many}`}
          aria-label={`Search ${noun.many}`}
          className="h-[42px] w-full min-w-0 rounded-xl border border-input bg-card pr-3 pl-10 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid={`${testId}-search`}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="pill"
            disabled={!list || mode === "single"}
            onClick={() => setDraft(new Set(allCodes))}
          >
            All
          </Button>
          <Button
            variant="outline"
            size="pill"
            disabled={!list || mode === "single"}
            onClick={() => setDraft(new Set())}
          >
            None
          </Button>
        </div>
        <ModeToggle
          label={capital}
          mode={mode}
          onChange={(next) => {
            setMode(next);
            setDraft(null);
          }}
        />
      </div>
      <ul
        className="-mx-1.5 flex max-h-59 flex-col overflow-y-auto overscroll-contain"
        aria-label={capital}
        data-testid={`${testId}-list`}
      >
        {list === null ? (
          <li className="p-2 text-sm text-muted-foreground">
            {error ? "The list couldn't be loaded." : "Loading…"}
          </li>
        ) : shown.length === 0 ? (
          <li className="p-2 text-sm text-muted-foreground">
            {list.length === 0 ? `No ${noun.many} with sales in this period.` : `No ${noun.one} matches.`}
          </li>
        ) : (
          shown.map((option) => {
            const checked = ticked.has(option.code);
            return (
              <li key={option.code}>
                <CheckOption
                  type={mode === "single" ? "radio" : "checkbox"}
                  name={mode === "single" ? id : undefined}
                  checked={checked}
                  onChange={() => pick(option.code)}
                  aside={showCode ? option.code : undefined}
                >
                  {option.name}
                </CheckOption>
              </li>
            );
          })
        )}
      </ul>
      {changed && (
        <div className="flex items-center justify-end gap-2">
          {ticked.size === 0 && (
            <span className="mr-auto text-xs text-muted-foreground">Pick at least one</span>
          )}
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => apply(ticked)}
            disabled={ticked.size === 0}
            data-testid={`${testId}-apply`}
          >
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
