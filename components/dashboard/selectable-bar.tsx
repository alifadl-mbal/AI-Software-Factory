"use client";

import { Rectangle, type BarShapeProps } from "recharts";

/**
 * A bar that is also a button: a click, Enter or Space selects its period. `data-drill` names the
 * period, so the drill-down can return focus here after a reload. Bars without a value stay plain.
 */
export function SelectableBar({
  select,
  period,
  label,
  ...props
}: BarShapeProps & {
  select: (period: string) => void;
  /** What selecting this bar opens, or `null` for a plain bar. */
  period: string | null;
  /** The button's accessible name. */
  label: string;
}) {
  if (period === null) return <Rectangle {...props} />;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      data-drill={period}
      className="cursor-pointer outline-none [&:focus-visible>path]:stroke-ring [&:focus-visible>path]:stroke-[3px]"
      onClick={(event) => {
        // A mouse click doesn't focus an SVG element; focus it so focus can come back here.
        event.currentTarget.focus();
        select(period);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(period);
        }
      }}
    >
      <Rectangle {...props} />
    </g>
  );
}
