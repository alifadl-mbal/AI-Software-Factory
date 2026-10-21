"use client";

import { useState } from "react";

import { DataTable, type ColumnSpec } from "@/components/dashboard/data-table";
import {
  DrillDialog,
  DrillTotals,
  DrillView,
  drillApiUrl,
  useDrillParams,
  useOpenDrill,
} from "@/components/dashboard/drill-dialog";
import {
  HoverBreakdown,
  HoverSheet,
  hoverUrl,
  neighbours,
  type HoverSelection,
  type HoverText,
  type HoverView,
} from "@/components/dashboard/hover-breakdown";
import { MonthEndChart, monthEndTitle, type MonthEndPoint } from "@/components/dashboard/month-end-chart";
import { useShell } from "@/components/shell/shell-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { filtersToSearch } from "@/lib/filters";
import { formatAed, formatInt, formatMonth } from "@/lib/format";
import { parseStockMonth, STOCK_MONTH_PARAM } from "@/lib/inventory-drill";
import { itemHref } from "@/lib/items";
import type { MonthEndDimension, MonthEndHover, MonthEndItems } from "@/lib/server/queries/inventory";

/**
 * The month-end stock chart with the Sales-style hover card and drill-down. Hovering (or focusing)
 * a bar shows its closing value against the same month-end last year and its top companies, brands
 * and item groups; selecting it (a click, Enter or Space; on phones, the sheet's button) lists its
 * items, each linking to its item page.
 */

const HOVER_PATH = "/api/inventory/month-end";
const PARAMS = [STOCK_MONTH_PARAM] as const;

const TEXT: HoverText = { totalLabel: "Closing value", emptyText: "No stock at this month-end." };

const DIMENSION_TITLES: Record<MonthEndDimension, string> = {
  company: "By company",
  brand: "By brand",
  itemGroup: "By item group",
};

/** `/api/inventory/month-end` as the card shows it. */
export function monthEndView(data: MonthEndHover): HoverView {
  return {
    total: data.closeValue,
    lastYear: data.lastYearCloseValue,
    sections: data.breakdowns.map((breakdown) => ({
      id: breakdown.dimension,
      title: DIMENSION_TITLES[breakdown.dimension],
      rows: breakdown.rows,
      share: true,
    })),
  };
}

/** The open drill-down, from the URL, and the way to open one. */
function useStockDrill() {
  const params = useDrillParams(PARAMS);
  return { month: parseStockMonth(params[STOCK_MONTH_PARAM]), open: useOpenDrill(STOCK_MONTH_PARAM) };
}

export function MonthEndHoverChart({ data, ariaLabel }: { data: MonthEndPoint[]; ariaLabel: string }) {
  const { filters } = useShell();
  const search = filtersToSearch(filters);
  const isMobile = useIsMobile();
  const { open } = useStockDrill();
  const [selected, setSelected] = useState<HoverSelection | null>(null);
  const urlFor = (month: string) => hoverUrl(HOVER_PATH, search, { month });
  const months = data.map((point) => point.month);

  return (
    <>
      <MonthEndChart
        data={data}
        ariaLabel={`${ariaLabel}. Select a month-end's bar to list its items.`}
        renderTooltip={
          isMobile
            ? undefined
            : (point) => (
                <HoverBreakdown
                  url={urlFor(point.month)}
                  title={monthEndTitle(point)}
                  toView={monthEndView}
                  text={TEXT}
                  current={point.value}
                  prefetch={neighbours(months, point.month).map(urlFor)}
                />
              )
        }
        onSelect={
          isMobile
            ? (point) =>
                setSelected({
                  url: urlFor(point.month),
                  title: monthEndTitle(point),
                  description: "Closing value by company, brand and item group",
                  current: point.value,
                  drill: point.value ? point.month : undefined,
                })
            : undefined
        }
        // On phones a tap opens the sheet, and the sheet's button opens the drill-down.
        onSelectBar={isMobile ? undefined : open}
      />
      <HoverSheet
        selected={selected}
        onClose={() => setSelected(null)}
        toView={monthEndView}
        text={TEXT}
        onDrill={open}
        drillLabel="List its items"
      />
    </>
  );
}

const ITEM_COLUMNS: ColumnSpec[] = [
  { key: "item", header: "Item", linkKey: "href" },
  { key: "itemCode", header: "Code" },
  { key: "company", header: "Company" },
  { key: "brand", header: "Brand" },
  { key: "itemGroup", header: "Item group" },
  { key: "closeQty", header: "Closing qty", format: "qty" },
  { key: "closeValue", header: "Closing value", format: "aed", sum: true },
];

function ItemsView({ data, search }: { data: MonthEndItems; search: string }) {
  const partial = data.count > data.rows.length;
  return (
    <div className="flex flex-col gap-3" data-testid="drill-stock-items">
      <DrillTotals
        items={[
          { label: "Closing value", value: formatAed(data.closeValue) },
          { label: "Items", value: formatInt(data.count) },
        ]}
      />
      {partial && (
        <p className="text-xs text-muted-foreground">
          The {formatInt(data.rows.length)} largest of {formatInt(data.count)} items by closing value are
          listed; the total covers all of them.
        </p>
      )}
      <DataTable
        title={`Stock ${data.month}`}
        columns={ITEM_COLUMNS}
        rows={data.rows.map((row) => ({
          id: `${row.companyCode}|${row.itemCode}`,
          item: row.item,
          href: itemHref(row.itemCode, search),
          itemCode: row.itemCode,
          company: row.company,
          brand: row.brand,
          itemGroup: row.itemGroup,
          closeQty: row.closeQty,
          closeValue: row.closeValue,
        }))}
        showTotals
        totals={{ closeValue: data.closeValue }}
        pageSize={25}
        maxHeight={9999}
      />
    </div>
  );
}

/**
 * The month-end drill-down dialog: a bar of the month-end stock chart → its items. It opens from
 * `?stockMonth=` in the URL, so reload and shared links keep it; a full-screen sheet on phones.
 */
export function MonthEndDrillDialog() {
  const { filters } = useShell();
  const { month } = useStockDrill();
  // The last bar stays on screen while the dialog fades out, and is where focus goes back to.
  const [lastMonth, setLastMonth] = useState(month);
  if (month !== null && month !== lastMonth) setLastMonth(month);
  const shown = month ?? lastMonth;
  const search = filtersToSearch(filters);

  return (
    <DrillDialog
      open={month !== null}
      params={PARAMS}
      testId="stock-drill"
      title={shown ? `Month-end stock · ${formatMonth(shown)}` : "Month-end stock"}
      description={`Items at this month-end by closing value${
        filters.companies.length > 0 ? `, company ${filters.companies.join(", ")}` : ", all companies"
      }${filters.brands.length > 0 ? `, ${filters.brands.length === 1 ? "1 brand" : `${filters.brands.length} brands`}` : ""}`}
      returnSelector={() => (shown ? `[data-drill="${CSS.escape(shown)}"]` : null)}
    >
      {shown && (
        <DrillView<MonthEndItems>
          key={`${shown}${search}`}
          url={drillApiUrl("/api/inventory/month-end-items", filters, { month: shown })}
          what="items"
        >
          {(data) => <ItemsView data={data} search={search} />}
        </DrillView>
      )}
    </DrillDialog>
  );
}
