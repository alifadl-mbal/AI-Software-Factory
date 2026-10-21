import { addDays } from "./filters";
import { formatDate, formatMonth } from "./format";
import { isoWeek, rangeDrill, shortRange } from "./sales-drill";

/**
 * The Sales "by month, week and day" table: daily figures rolled up into ISO weeks and calendar
 * months. A week that runs across a month end is split, so each month's weeks add up to the month
 * and the months to the period. Every day of the range has a row, with zeros when nothing sold.
 */

/** One day's figures, as `salesDaily` returns them. */
export interface DayFigures {
  /** YYYY-MM-DD. */
  date: string;
  netRevenue: number;
  cost: number;
  /** Negative. */
  returnsValue: number;
  invoiceCount: number;
}

export interface CalendarFigures {
  /** Days with at least one invoice. */
  sellingDays: number;
  invoiceCount: number;
  netRevenue: number;
  cost: number;
  returnsValue: number;
}

export interface CalendarRow extends CalendarFigures {
  level: "month" | "week" | "day";
  /** The `?drill=` value that lists this row's documents. */
  drill: string;
  label: string;
  /** Inclusive, YYYY-MM-DD, already cut to the month and the range. */
  start: string;
  end: string;
  children: CalendarRow[];
}

const EMPTY: CalendarFigures = { sellingDays: 0, invoiceCount: 0, netRevenue: 0, cost: 0, returnsValue: 0 };

function add(total: CalendarFigures, figures: CalendarFigures): CalendarFigures {
  return {
    sellingDays: total.sellingDays + figures.sellingDays,
    invoiceCount: total.invoiceCount + figures.invoiceCount,
    netRevenue: total.netRevenue + figures.netRevenue,
    cost: total.cost + figures.cost,
    returnsValue: total.returnsValue + figures.returnsValue,
  };
}

/** The sum of some rows' figures. */
export function totalOf(rows: CalendarFigures[]): CalendarFigures {
  return rows.reduce<CalendarFigures>(add, EMPTY);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(date: string): string {
  return `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${formatDate(date)}`;
}

function group(rows: CalendarRow[], keyOf: (row: CalendarRow) => string): CalendarRow[][] {
  const groups: CalendarRow[][] = [];
  let previous: string | undefined;
  for (const row of rows) {
    const key = keyOf(row);
    if (key !== previous) groups.push([]);
    groups[groups.length - 1].push(row);
    previous = key;
  }
  return groups;
}

function parent(
  level: "month" | "week",
  children: CalendarRow[],
  label: string,
  drill?: string,
): CalendarRow {
  const start = children[0].start;
  const end = children[children.length - 1].end;
  return { level, drill: drill ?? rangeDrill(start, end), label, start, end, children, ...totalOf(children) };
}

/** Months → ISO weeks → days for `start..end` (inclusive), from the days that had sales. */
export function buildCalendar(start: string, end: string, days: DayFigures[]): CalendarRow[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const dayRows: CalendarRow[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const day = byDate.get(date);
    dayRows.push({
      level: "day",
      drill: date,
      label: dayLabel(date),
      start: date,
      end: date,
      children: [],
      sellingDays: day && day.invoiceCount > 0 ? 1 : 0,
      invoiceCount: day?.invoiceCount ?? 0,
      netRevenue: day?.netRevenue ?? 0,
      cost: day?.cost ?? 0,
      returnsValue: day?.returnsValue ?? 0,
    });
  }
  return group(dayRows, (row) => row.start.slice(0, 7)).map((monthDays) => {
    const month = monthDays[0].start.slice(0, 7);
    const weeks = group(monthDays, (row) => {
      const { year, week } = isoWeek(row.start);
      return `${year}-${week}`;
    }).map((weekDays) => {
      const { week } = isoWeek(weekDays[0].start);
      return parent(
        "week",
        weekDays,
        `Week ${week} · ${shortRange(weekDays[0].start, weekDays[weekDays.length - 1].end)}`,
      );
    });
    // A month row drills by its month, which the dialog cuts to the range just as here.
    return parent("month", weeks, formatMonth(month), month);
  });
}

/** Margin as a fraction of net revenue; `null` with no revenue. */
export function marginPct(figures: Pick<CalendarFigures, "netRevenue" | "cost">): number | null {
  return figures.netRevenue ? (figures.netRevenue - figures.cost) / figures.netRevenue : null;
}
