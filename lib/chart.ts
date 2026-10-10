import { CHART_COLORS_DARK, CHART_COLORS_LIGHT } from "./constants";
import { isDarkColor } from "./color";
import type { ChartElement } from "./schema";

/** Max pie slices before the smallest ones are folded into "Other" (one color per slot, never cycled). */
export const MAX_PIE_SLICES = 8;

export function chartPalette(background: string): readonly string[] {
  return isDarkColor(background) ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;
}

export interface PieSlice {
  name: string;
  value: number;
}

/**
 * Pie charts show the first series only. Negative/invalid values can't be drawn as slices and are
 * treated as 0; past MAX_PIE_SLICES the smallest slices are combined into "Other".
 */
export function pieSlices(chart: Pick<ChartElement, "categories" | "series">): PieSlice[] {
  const values = chart.series[0]?.values ?? [];
  const slices = chart.categories.map((name, i) => ({
    name,
    value: Number.isFinite(values[i]) && values[i] > 0 ? values[i] : 0,
  }));
  if (slices.length <= MAX_PIE_SLICES) return slices;
  const indexed = slices.map((slice, index) => ({ ...slice, index }));
  const top = [...indexed].sort((a, b) => b.value - a.value || a.index - b.index).slice(0, MAX_PIE_SLICES - 1);
  const keep = new Set(top.map((s) => s.index));
  const other = indexed.filter((s) => !keep.has(s.index)).reduce((sum, s) => sum + s.value, 0);
  // Remaining slices keep their original category order; "Other" goes last.
  return [...indexed.filter((s) => keep.has(s.index)).map(({ name, value }) => ({ name, value })), { name: "Other", value: other }];
}

export function hasDrawableData(chart: Pick<ChartElement, "chartType" | "categories" | "series">): boolean {
  if (chart.chartType === "pie") return pieSlices(chart).some((s) => s.value > 0);
  return chart.series.some((s) => s.values.some((v) => Number.isFinite(v)));
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 950 → "950", 1200 → "1.2K", 2500000 → "2.5M". */
export function formatCompact(value: number): string {
  return Number.isFinite(value) ? compact.format(value) : "";
}

/** Whether a legend adds information: pies always (categories), cartesian charts only with 2+ series. */
export function legendVisible(chart: Pick<ChartElement, "chartType" | "series" | "showLegend">): boolean {
  if (!chart.showLegend) return false;
  return chart.chartType === "pie" || chart.series.length > 1;
}
