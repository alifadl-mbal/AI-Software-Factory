"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export type PickMode = "single" | "multi";

/** A group's title on the left and its "x of y" count on the right. */
export function FilterGroupHead({
  id,
  title,
  count,
  countTestId,
}: {
  id: string;
  title: string;
  count: string;
  countTestId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span id={id} className="text-[13px] font-medium text-muted-foreground">
        {title}
      </span>
      <span className="text-xs text-muted-foreground" aria-live="polite" data-testid={countTestId}>
        {count}
      </span>
    </div>
  );
}

/** The Single / Multi switch: two toggle buttons, the active one navy. */
export function ModeToggle({
  label,
  mode,
  onChange,
}: {
  label: string;
  mode: PickMode;
  onChange: (mode: PickMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label={`${label}: pick one or several`}
      className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border"
    >
      {(["single", "multi"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
          className={cn(
            "px-2.75 py-0.75 text-[11px] font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-inset",
            mode === option && "bg-primary text-primary-foreground",
          )}
        >
          {option === "single" ? "Single" : "Multi"}
        </button>
      ))}
    </div>
  );
}

/**
 * One option of a checklist or chip grid: a real checkbox (a radio in Single mode) under the TNS
 * box, so it works by keyboard and shows a focus ring.
 */
export function CheckOption({
  type,
  name,
  checked,
  disabled,
  onChange,
  children,
  aside,
}: {
  type: "checkbox" | "radio";
  /** The radio group's name. */
  name?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: React.ReactNode;
  /** Shown right-aligned and muted, such as a code. */
  aside?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm hover:bg-accent",
        disabled ? "cursor-not-allowed opacity-50 hover:bg-transparent" : "cursor-pointer",
      )}
    >
      <span className="relative flex size-4.5 shrink-0">
        <input
          type={type}
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className="peer absolute inset-0 m-0 cursor-[inherit] opacity-0"
        />
        <span
          className={cn(
            "pointer-events-none flex size-4.5 items-center justify-center border-[1.5px] border-input bg-card text-primary-foreground peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-3 peer-focus-visible:ring-ring/60",
            type === "radio" ? "rounded-full" : "rounded-[5px]",
          )}
          aria-hidden
        >
          {checked && <Check className="size-3" strokeWidth={3} />}
        </span>
      </span>
      <span className="min-w-0 truncate">{children}</span>
      {aside && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{aside}</span>}
    </label>
  );
}
