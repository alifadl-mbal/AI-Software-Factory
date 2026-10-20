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

/** Presets (MTD, QTD, YTD, last 12 months) plus a custom range calendar. */
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
        <Button
          variant="outline"
          className="h-9 min-w-0 justify-start gap-2 font-normal"
          data-testid="date-range-trigger"
        >
          <CalendarDays className="text-muted-foreground" aria-hidden />
          <span className="sr-only">Date range:</span>
          <span className="font-medium">{presetLabel}</span>
          <span className="hidden truncate text-muted-foreground sm:inline">
            {formatDate(filters.start)} – {formatDate(filters.end)}
          </span>
          <ChevronDown className="ml-auto text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-0">
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
