"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactElement } from "react";
import { ChevronRight } from "lucide-react";
import { ResponsiveContainer, Tooltip, Treemap, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

import { useIsMobile } from "@/hooks/use-mobile";
import { DataTable, type ColumnSpec, type TableRowData } from "@/components/dashboard/data-table";
import { formatAed, formatAedCompact, formatDeltaPct, formatPct, MISSING } from "@/lib/format";
import { itemHref } from "@/lib/items";
import {
  marginPct,
  yoyBucket,
  yoyChange,
  yoyColors,
  YOY_LEGEND,
  type MixBrand,
  type MixTile,
} from "@/lib/product-mix";

const HEIGHT = 440;
/** Tiles smaller than this get no label (the tooltip and the table still name them). */
const MIN_LABEL_WIDTH = 56;
const MIN_LABEL_HEIGHT = 30;
const CHAR_WIDTH = 7;

interface TileDatum extends MixTile {
  [key: string]: unknown;
  name: string;
  /** The tile's area: net revenue, never below zero. */
  size: number;
  yoy: number | null;
  /** Brand tiles zoom in; item tiles with a code link to the item page. */
  zoomIndex: number | null;
  href: string | null;
}

function describe(tile: TileDatum): string {
  return `${tile.label}: ${formatAed(tile.netRevenue)}, last year ${formatAed(tile.lastYearNetRevenue)}, ${
    tile.yoy === null ? "new (no sales last year)" : `${formatDeltaPct(tile.yoy)} YoY`
  }, margin ${formatPct(marginPct(tile))}`;
}

function truncate(text: string, width: number): string {
  const fits = Math.max(Math.floor((width - 12) / CHAR_WIDTH), 1);
  return text.length <= fits ? text : `${text.slice(0, Math.max(fits - 1, 1))}…`;
}

function TileShape({
  node,
  onZoom,
  onOpen,
}: {
  node: Record<string, unknown>;
  onZoom: (index: number) => void;
  onOpen: (href: string) => void;
}) {
  const { x, y, width, height, depth } = node as {
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
  };
  // Depth 0 is the root rectangle around the tiles.
  if (depth !== 1 || width <= 0 || height <= 0) return <g />;
  const tile = node as unknown as TileDatum;
  const colors = yoyColors(yoyBucket(tile.yoy));
  const showLabel = width >= MIN_LABEL_WIDTH && height >= MIN_LABEL_HEIGHT;
  // The labels sit beside the focusable tile, not in it: its accessible name is the full figures,
  // which a truncated compact label would contradict (axe's label-content-name-mismatch).
  const rect = (
    <rect x={x} y={y} width={width} height={height} fill={colors.fill} stroke="var(--card)" strokeWidth={2} />
  );
  const labels = (
    <>
      {showLabel && (
        <text
          x={x + 6}
          y={y + 17}
          fill={colors.text}
          fontSize={12}
          fontWeight={500}
          pointerEvents="none"
          aria-hidden
        >
          {truncate(tile.label, width)}
        </text>
      )}
      {showLabel && height >= 48 && (
        <text x={x + 6} y={y + 33} fill={colors.text} fontSize={11} pointerEvents="none" aria-hidden>
          {truncate(
            `${formatAedCompact(tile.netRevenue)} · ${tile.yoy === null ? "new" : formatDeltaPct(tile.yoy)}`,
            width,
          )}
        </text>
      )}
    </>
  );
  const focusClass =
    "cursor-pointer outline-none [&:focus-visible>rect]:stroke-[var(--ring)] [&:focus-visible>rect]:stroke-[3px]";
  let tileElement: ReactElement;
  if (tile.zoomIndex !== null) {
    const zoom = () => onZoom(tile.zoomIndex!);
    tileElement = (
      <g
        role="button"
        tabIndex={0}
        aria-label={`${describe(tile)}. Show its items`}
        className={focusClass}
        data-testid="treemap-brand"
        onClick={zoom}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            zoom();
          }
        }}
      >
        {rect}
      </g>
    );
  } else if (tile.href) {
    const href = tile.href;
    tileElement = (
      <a
        href={href}
        aria-label={describe(tile)}
        className={focusClass}
        data-testid="treemap-item"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onOpen(href);
        }}
      >
        {rect}
      </a>
    );
  } else {
    tileElement = (
      <g role="img" aria-label={describe(tile)}>
        {rect}
      </g>
    );
  }
  return (
    <g>
      {tileElement}
      {labels}
    </g>
  );
}

function TileTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const tile = payload?.[0]?.payload as TileDatum | undefined;
  if (!active || !tile) return null;
  const rows: [string, string][] = [
    ["Net revenue", formatAed(tile.netRevenue)],
    ["Last year", formatAed(tile.lastYearNetRevenue)],
    ["YoY", tile.yoy === null ? "New" : formatDeltaPct(tile.yoy)],
    ["Margin", formatPct(marginPct(tile))],
  ];
  return (
    <div className="grid min-w-48 gap-1 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{tile.label}</p>
      {rows.map(([label, value]) => (
        <p key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular font-medium">{value}</span>
        </p>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <ul
      className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
      aria-label="Colour: change vs last year"
      data-testid="yoy-legend"
    >
      {YOY_LEGEND.map(({ bucket, label }) => (
        <li key={String(bucket)} className="flex items-center gap-1.5">
          <span
            className="size-3 shrink-0 rounded-sm border border-border"
            style={{ background: yoyColors(bucket).fill }}
            aria-hidden
          />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** The phone view: the same tiles as a ranked list, each with its YoY colour. */
function RankedList({ tiles, onZoom }: { tiles: TileDatum[]; onZoom: (index: number) => void }) {
  const total = tiles.reduce((sum, tile) => sum + tile.netRevenue, 0);
  return (
    <ol className="flex flex-col divide-y text-sm" data-testid="mix-ranked-list">
      {tiles.map((tile, index) => {
        const colors = yoyColors(yoyBucket(tile.yoy));
        const linkClass =
          "truncate text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:underline";
        return (
          <li key={`${tile.label}-${index}`} className="flex items-center gap-3 py-2">
            <span
              className="h-8 w-2 shrink-0 rounded-sm border border-border"
              style={{ background: colors.fill }}
              aria-hidden
            />
            <span className="flex min-w-0 flex-1 flex-col">
              {tile.zoomIndex !== null ? (
                <button type="button" className={linkClass} onClick={() => onZoom(tile.zoomIndex!)}>
                  {tile.label}
                </button>
              ) : tile.href ? (
                <Link href={tile.href} className={linkClass}>
                  {tile.label}
                </Link>
              ) : (
                <span className="truncate font-medium">{tile.label}</span>
              )}
              <span className="tabular text-xs text-muted-foreground">
                {formatPct(total ? tile.netRevenue / total : null)} of the total · margin{" "}
                {formatPct(marginPct(tile))}
              </span>
            </span>
            <span className="tabular flex shrink-0 flex-col items-end">
              <span className="font-medium">{formatAedCompact(tile.netRevenue)}</span>
              <span className="text-xs text-muted-foreground">
                {tile.yoy === null ? "New" : formatDeltaPct(tile.yoy)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const TABLE_COLUMNS = (level: "brand" | "item"): ColumnSpec[] => [
  level === "brand"
    ? { key: "label", header: "Brand", action: true }
    : { key: "label", header: "Item", linkKey: "href" },
  ...(level === "item" ? [{ key: "code", header: "Code" }] : []),
  { key: "netRevenue", header: "Net revenue", format: "aed", sum: true },
  { key: "lastYearNetRevenue", header: "Last year", format: "aed", sum: true },
  { key: "yoy", header: "YoY", format: "deltaPct" },
  { key: "marginPct", header: "Margin %", format: "pct" },
];

/**
 * Brand → item treemap, sized by net revenue and coloured by YoY. Selecting a brand zooms into its
 * items; item tiles open the item page. Tiles are focusable, and the table under the treemap holds
 * the same tiles. On phones, where small tiles can't be read, a ranked list replaces both.
 */
export function MixTreemap({ brands, search }: { brands: MixBrand[]; search: string }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [zoom, setZoom] = useState<number | null>(null);
  const brand = zoom === null ? undefined : brands[zoom];
  const tiles: TileDatum[] = (brand ? brand.items : brands).map((tile, index) => ({
    ...tile,
    name: tile.label,
    size: Math.max(tile.netRevenue, 0),
    yoy: yoyChange(tile.netRevenue, tile.lastYearNetRevenue),
    zoomIndex: brand ? null : index,
    href: brand && tile.code !== null ? itemHref(tile.code, search) : null,
  }));
  const rows: TableRowData[] = tiles.map((tile, index) => ({
    id: String(index),
    label: tile.label,
    code: tile.code ?? "",
    href: tile.href,
    netRevenue: tile.netRevenue,
    lastYearNetRevenue: tile.lastYearNetRevenue,
    yoy: tile.yoy,
    marginPct: marginPct(tile),
  }));

  return (
    <div className="flex flex-col gap-4" data-testid="product-treemap">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <nav
          aria-label="Treemap level"
          className="flex items-center gap-1 text-sm"
          data-testid="treemap-breadcrumb"
        >
          {brand ? (
            <>
              <button
                type="button"
                className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
                onClick={() => setZoom(null)}
              >
                All brands
              </button>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-medium" aria-current="page">
                {brand.label}
              </span>
            </>
          ) : (
            <span className="font-medium" aria-current="page">
              All brands
            </span>
          )}
        </nav>
        <Legend />
      </div>
      <p className="text-xs text-muted-foreground">
        {brand
          ? `${brand.label}: ${formatAed(brand.netRevenue)}, ${
              brand.lastYearNetRevenue > 0
                ? `${formatDeltaPct(yoyChange(brand.netRevenue, brand.lastYearNetRevenue))} vs last year`
                : `${MISSING} last year`
            }. Select an item to open its page.`
          : "Select a brand to see its items."}
      </p>
      {isMobile ? (
        <RankedList tiles={tiles} onZoom={setZoom} />
      ) : (
        <>
          <div style={{ height: HEIGHT }} data-testid="treemap-chart">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: HEIGHT }}>
              <Treemap
                key={zoom ?? "brands"}
                data={tiles}
                dataKey="size"
                nameKey="name"
                isAnimationActive={false}
                content={(node) => (
                  <TileShape
                    node={node as unknown as Record<string, unknown>}
                    onZoom={setZoom}
                    onOpen={(href) => router.push(href)}
                  />
                )}
              >
                <Tooltip content={TileTooltip} isAnimationActive={false} />
              </Treemap>
            </ResponsiveContainer>
          </div>
          <DataTable
            key={zoom ?? "brands"}
            title={brand ? `${brand.label} items` : "Revenue by brand"}
            columns={TABLE_COLUMNS(brand ? "item" : "brand")}
            rows={rows}
            showTotals
            pageSize={10}
            onAction={(row) => setZoom(Number(row.id))}
          />
        </>
      )}
    </div>
  );
}
