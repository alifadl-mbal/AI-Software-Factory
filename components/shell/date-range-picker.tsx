"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DATE_PRESETS, isoDate, presetRange, type PresetId } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useShell } from "./shell-context";

function toDate(iso: string): Date {
  return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function toIso(date: Date): string {
  return isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * "Custom dates" in the Filters panel: presets (MTD, QTD, YTD, last 12 months) plus a range
 * calendar, for any period the Year and Month groups can't pick.
 */
export function DateRangePicker() {
  const { filters, setFilters, today } = useShell();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();

  const presetLabel = DATE_PRESETS.find((preset) => preset.id === filters.range)?.label ?? "Custom";

  function choosePreset(id: PresetId) {
    setFilters({ range: id, ...presetRange(id, today) });
    setOpen(false);
  }

  function applyCustom() {
    if (!draft?.from) return;
    const start = toIso(draft.from);
    const end = toIso(draft.to ?? draft.from);
    setFilters({ range: "custom", start, end });
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft({ from: toDate(filters.start), to: toDate(filters.end) });
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group/dd flex min-h-[42px] w-full min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-1.5 text-left text-sm text-foreground outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="date-range-trigger"
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Date range:</span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium">{presetLabel}</span>
            <span className="truncate text-xs text-muted-foreground">
              {formatDate(filters.start)} – {formatDate(filters.end)}
            </span>
          </span>
          <ChevronDown
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded/dd:rotate-180"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] rounded-2xl p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-44 sm:flex-col sm:border-r sm:border-b-0">
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                variant={filters.range === preset.id ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => choosePreset(preset.id)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="p-2">
            <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">Custom range</p>
            <Calendar
              mode="range"
              numberOfMonths={1}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft?.from}
              disabled={{ after: toDate(today) }}
              weekStartsOn={1}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-1">
              <span className={cn("text-xs text-muted-foreground", !draft?.from && "invisible")}>
                {draft?.from ? formatDate(toIso(draft.from)) : ""}
                {draft?.to ? ` – ${formatDate(toIso(draft.to))}` : ""}
              </span>
              <Button size="sm" onClick={applyCustom} disabled={!draft?.from}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
