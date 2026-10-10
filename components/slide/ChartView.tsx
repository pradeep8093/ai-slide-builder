import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { inkFor } from "@/lib/color";
import { chartPalette, formatCompact, hasDrawableData, legendVisible, pieSlices } from "@/lib/chart";
import type { ChartElement } from "@/lib/schema";

const FONT = "Arial, Helvetica, sans-serif";
export const CHART_TITLE_HEIGHT = 40;

interface ChartViewProps {
  element: ChartElement;
  background: string;
  /** Tooltips on hover (present mode). Off in the editor, thumbnails and exports. */
  interactive?: boolean;
}

export default function ChartView({ element, background, interactive = false }: ChartViewProps) {
  const ink = inkFor(background);
  const palette = chartPalette(background);
  const title = element.title.trim();
  const titleHeight = title ? CHART_TITLE_HEIGHT : 0;
  const width = Math.max(40, Math.round(element.width));
  const height = Math.max(40, Math.round(element.height - titleHeight));
  const showLegend = legendVisible(element);
  const pieOrder = new Map(element.chartType === "pie" ? pieSlices(element).map((slice, i) => [slice.name, i] as const) : []);

  const legend = showLegend ? (
    <Legend
      verticalAlign="bottom"
      iconType="circle"
      // Keep series/category order (Recharts sorts alphabetically by default).
      itemSorter={element.chartType === "pie" ? (item) => pieOrder.get(String(item.value)) ?? 0 : "dataKey"}
      iconSize={12}
      wrapperStyle={{ fontSize: 16, fontFamily: FONT }}
      // Legend text uses ink, never the series color; the swatch carries identity.
      formatter={(value) => <span style={{ color: ink.secondary }}>{String(value)}</span>}
    />
  ) : null;
  const tooltip = interactive ? (
    <Tooltip
      cursor={{ fill: ink.grid }}
      contentStyle={{ fontFamily: FONT, fontSize: 14, borderRadius: 8 }}
      formatter={(value) => (typeof value === "number" ? value.toLocaleString() : String(value))}
    />
  ) : null;

  let chart: React.ReactNode;
  if (!hasDrawableData(element)) {
    chart = (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", color: ink.secondary, fontFamily: FONT, fontSize: 18 }}>
        No data to display
      </div>
    );
  } else if (element.chartType === "pie") {
    const data = pieSlices(element).map((slice, i) => ({ ...slice, fill: palette[i % palette.length] }));
    chart = (
      <PieChart width={width} height={height} accessibilityLayer={false}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius="80%"
          // Start at 12 o'clock and go clockwise, like PowerPoint, so exports match.
          startAngle={90}
          endAngle={-270}
          stroke={background}
          strokeWidth={2}
          isAnimationActive={false}
        />
        {legend}
        {tooltip}
      </PieChart>
    );
  } else {
    const rows = element.categories.map((category, i) => {
      const row: Record<string, string | number> = { category };
      element.series.forEach((series, si) => {
        row[`s${si}`] = series.values[i];
      });
      return row;
    });
    const axes = [
      <CartesianGrid key="grid" vertical={false} stroke={ink.grid} />,
      <XAxis
        key="x"
        dataKey="category"
        tick={{ fill: ink.secondary, fontSize: 16, fontFamily: FONT }}
        tickLine={false}
        axisLine={{ stroke: ink.grid }}
        interval="preserveStartEnd"
      />,
      <YAxis
        key="y"
        tick={{ fill: ink.secondary, fontSize: 16, fontFamily: FONT }}
        tickLine={false}
        axisLine={false}
        tickFormatter={(v: number) => formatCompact(v)}
        width={56}
      />,
    ];
    // accessibilityLayer would make every chart (canvas, thumbnails) a tab stop; the element wrapper is labelled instead.
    const props = { width, height, data: rows, margin: { top: 12, right: 16, bottom: 4, left: 0 }, accessibilityLayer: false };

    if (element.chartType === "bar") {
      chart = (
        <BarChart {...props} barGap={2}>
          {axes}
          {element.series.map((s, i) => (
            <Bar key={i} dataKey={`s${i}`} name={s.name} fill={palette[i]} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />
          ))}
          {legend}
          {tooltip}
        </BarChart>
      );
    } else if (element.chartType === "line") {
      chart = (
        <LineChart {...props}>
          {axes}
          {element.series.map((s, i) => (
            <Line
              key={i}
              dataKey={`s${i}`}
              name={s.name}
              type="linear"
              stroke={palette[i]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, fill: palette[i], stroke: background, strokeWidth: 2 }}
              activeDot={interactive ? { r: 6, stroke: background, strokeWidth: 2 } : false}
              isAnimationActive={false}
            />
          ))}
          {legend}
          {tooltip}
        </LineChart>
      );
    } else {
      chart = (
        <AreaChart {...props}>
          {axes}
          {element.series.map((s, i) => (
            <Area
              key={i}
              dataKey={`s${i}`}
              name={s.name}
              type="linear"
              stroke={palette[i]}
              strokeWidth={2}
              fill={palette[i]}
              fillOpacity={0.12}
              isAnimationActive={false}
            />
          ))}
          {legend}
          {tooltip}
        </AreaChart>
      );
    }
  }

  return (
    <div style={{ width: "100%", height: "100%", fontFamily: FONT }} data-chart-type={element.chartType}>
      {title && (
        <div
          style={{
            height: CHART_TITLE_HEIGHT,
            color: ink.primary,
            fontSize: 20,
            fontWeight: 600,
            lineHeight: `${CHART_TITLE_HEIGHT}px`,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
      )}
      {chart}
    </div>
  );
}
