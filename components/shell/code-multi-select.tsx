"use client";

import { useState } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FilterOption } from "@/lib/server/queries/sales-filters";
import { cn } from "@/lib/utils";

export interface Noun {
  one: string;
  many: string;
}

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
 * A searchable checklist of codes with All / None and an "x of y" count. Ticks are a draft until
 * Apply, so picking several reloads the page once. Nothing selected in the URL means all; applying
 * with every option ticked goes back to that.
 */
export function CodeMultiSelect({
  noun,
  icon: Icon,
  testId,
  options,
  error,
  selected,
  onApply,
  disabled,
  disabledHint,
}: {
  noun: Noun;
  icon: LucideIcon;
  testId: string;
  /** `null` while loading. */
  options: FilterOption[] | null;
  /** Set when the options couldn't be loaded. */
  error?: boolean;
  selected: readonly string[];
  onApply: (codes: string[]) => void;
  disabled?: boolean;
  /** Why it's disabled, for screen readers and the tooltip. */
  disabledHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const list = options ? withSelected(options, selected) : null;
  const label = selectionLabel(selected, options, noun);
  const capital = noun.many[0].toUpperCase() + noun.many.slice(1);

  function openChange(next: boolean) {
    setOpen(next);
    if (next) setDraft(new Set(selected.length > 0 ? selected : (list ?? []).map((option) => option.code)));
  }

  function toggle(code: string) {
    const next = new Set(draft);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setDraft(next);
  }

  function apply() {
    const all = list !== null && list.every((option) => draft.has(option.code));
    onApply(all ? [] : [...draft].sort());
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          title={disabled ? disabledHint : undefined}
          className={cn(
            "h-9 min-w-0 justify-start gap-2 font-normal",
            selected.length > 0 && "border-primary/50",
          )}
          data-testid={`${testId}-trigger`}
        >
          <Icon className="text-muted-foreground" aria-hidden />
          <span className="sr-only">{capital}:</span>
          <span className="max-w-40 truncate font-medium">{label}</span>
          {disabled && disabledHint && <span className="sr-only">({disabledHint})</span>}
          <ChevronDown className="ml-auto text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0" aria-label={capital}>
        <Command>
          <CommandInput placeholder={`Search ${noun.many}…`} aria-label={`Search ${noun.many}`} />
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              disabled={!list}
              onClick={() => setDraft(new Set((list ?? []).map((option) => option.code)))}
            >
              All
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setDraft(new Set())}>
              None
            </Button>
            <span
              className="tabular ml-auto text-xs text-muted-foreground"
              aria-live="polite"
              data-testid={`${testId}-count`}
            >
              {list ? `${draft.size} of ${list.length}` : ""}
            </span>
          </div>
          <CommandList>
            <CommandEmpty>
              {error
                ? "The list couldn't be loaded."
                : list === null
                  ? "Loading…"
                  : list.length === 0
                    ? `No ${noun.many} with sales in this period.`
                    : `No ${noun.one} matches.`}
            </CommandEmpty>
            {list && (
              <CommandGroup>
                {list.map((option) => {
                  const checked = draft.has(option.code);
                  return (
                    <CommandItem
                      key={option.code}
                      value={`${option.name} ${option.code}`}
                      onSelect={() => toggle(option.code)}
                      data-checked={checked}
                      aria-checked={checked}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-sm border border-input",
                          checked && "border-primary bg-primary text-primary-foreground",
                        )}
                        aria-hidden
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      <span className="truncate">{option.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center justify-end gap-2 border-t p-2">
            {draft.size === 0 && list && (
              <span className="mr-auto text-xs text-muted-foreground">Pick at least one</span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={apply}
              disabled={draft.size === 0 || !list}
              data-testid={`${testId}-apply`}
            >
              Apply
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
