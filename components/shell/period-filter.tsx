"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ALL_MONTHS,
  MONTH_NAMES,
  isFutureMonth,
  monthsLabel,
  periodToPick,
  pickToPeriod,
  yearOptions,
  yearsLabel,
  type PeriodPick,
} from "@/lib/period-picker";

import { DateRangePicker } from "./date-range-picker";
import { CheckOption, FilterGroupHead, ModeToggle, type PickMode } from "./filter-parts";
import { useShell } from "./shell-context";

/**
 * A dropdown group (Year or Month): a trigger with the current pick, and a panel with All / None,
 * Single / Multi and a two-column grid of options. Every change applies at once.
 */
function DropdownGroup({
  title,
  testId,
  label,
  options,
  selected,
  isDisabled,
  onChange,
  footer,
}: {
  title: string;
  testId: string;
  label: string;
  options: { value: number; label: string }[];
  selected: readonly number[];
  isDisabled?: (value: number) => boolean;
  onChange: (values: number[]) => void;
  footer?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PickMode>("multi");
  const enabled = options.filter((option) => !isDisabled?.(option.value)).map((option) => option.value);

  function toggle(value: number) {
    if (mode === "single") {
      onChange([value]);
      setOpen(false);
      return;
    }
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value].sort((a, b) => a - b),
    );
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
        count={`${selected.length} of ${options.length}`}
        countTestId={`${testId}-count`}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group/dd flex h-[42px] w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            data-testid={`${testId}-trigger`}
          >
            <span className="sr-only">{title}:</span>
            <span className="truncate">{label}</span>
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded/dd:rotate-180"
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-60 gap-1.5 rounded-2xl p-2.5"
          aria-label={title}
          data-testid={`${testId}-panel`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-1 pb-2.5">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="pill"
                disabled={mode === "single"}
                onClick={() => onChange(enabled)}
              >
                All
              </Button>
              <Button variant="outline" size="pill" disabled={mode === "single"} onClick={() => onChange([])}>
                None
              </Button>
            </div>
            <ModeToggle label={title} mode={mode} onChange={setMode} />
          </div>
          <div className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
            {options.map((option) => (
              <CheckOption
                key={option.value}
                type={mode === "single" ? "radio" : "checkbox"}
                name={mode === "single" ? id : undefined}
                // In Single mode only a single pick shows as chosen.
                checked={selected.includes(option.value) && (mode === "multi" || selected.length === 1)}
                disabled={isDisabled?.(option.value)}
                onChange={() => toggle(option.value)}
              >
                {option.label}
              </CheckOption>
            ))}
          </div>
          {footer && (
            <p className="px-1.5 pt-1 text-xs text-muted-foreground" role="status">
              {footer}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * The Year and Month groups, and Custom dates. Year + Month always resolve to one contiguous range
 * (see `lib/period-picker.ts`), so the URL keeps `range`, `from` and `to` as before.
 */
export function PeriodFilter() {
  const { filters, setFilters, today, isPending } = useShell();
  const key = `${filters.start}|${filters.end}`;
  // A pick that hasn't reached the URL yet, or can't (nothing ticked, or a month that hasn't
  // started), stays on screen; anything else shows the range the URL holds.
  const [draft, setDraft] = useState<{ pick: PeriodPick; base: string } | null>(null);
  const draftPeriod = draft && pickToPeriod(draft.pick, today);
  const showDraft =
    draft !== null &&
    (isPending ||
      (draftPeriod === null && draft.base === key) ||
      (draftPeriod !== null && `${draftPeriod.start}|${draftPeriod.end}` === key));
  const shown = showDraft ? draft.pick : periodToPick(filters, today);
  const currentYear = Number(today.slice(0, 4));

  function change(pick: PeriodPick) {
    setDraft({ pick, base: key });
    const period = pickToPeriod(pick, today);
    if (
      period &&
      (period.start !== filters.start || period.end !== filters.end || period.range !== filters.range)
    ) {
      setFilters(period);
    }
  }

  const empty = shown.years.length === 0 || shown.months.length === 0;
  const notStarted = !empty && pickToPeriod(shown, today) === null;
  const hint = empty
    ? "Pick at least one to change the period."
    : notStarted
      ? "That period hasn't started yet."
      : undefined;

  return (
    <>
      <DropdownGroup
        title="Year"
        testId="year"
        label={yearsLabel(shown.years)}
        options={yearOptions(today).map((year) => ({ value: year, label: String(year) }))}
        selected={shown.years}
        onChange={(years) => change({ ...shown, years })}
        footer={hint}
      />
      <DropdownGroup
        title="Month"
        testId="month"
        label={monthsLabel(shown.months)}
        options={ALL_MONTHS.map((month) => ({ value: month, label: MONTH_NAMES[month - 1] }))}
        selected={shown.months}
        // Only this year has months that haven't started.
        isDisabled={(month) =>
          shown.years.length > 0 &&
          Math.min(...shown.years) === currentYear &&
          isFutureMonth(currentYear, month, today)
        }
        onChange={(months) => change({ ...shown, months })}
        footer={hint}
      />
      <div className="flex flex-col gap-2.5" data-testid="custom-dates-group">
        <span className="text-[13px] font-medium text-muted-foreground">Custom dates</span>
        <DateRangePicker />
      </div>
    </>
  );
}
