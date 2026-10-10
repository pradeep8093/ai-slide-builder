import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inkFor, isDarkColor } from "@/lib/color";
import { chartPalette, dualAxisApplies, formatCompact, hasDrawableData, isRadial, legendVisible, pieSlices, scatterPoints, stackingApplies } from "@/lib/chart";
import type { ChartElement } from "@/lib/schema";

const FONT = "Arial, Helvetica, sans-serif";
export const CHART_TITLE_HEIGHT = 40;
const LABEL_SIZE = 15;

interface ChartViewProps {
  element: ChartElement;
  background: string;
  /** Tooltips on hover (present mode). Off in the editor, thumbnails and exports. */
  interactive?: boolean;
}

const formatLabel = (value: unknown) => (typeof value === "number" ? formatCompact(value) : String(value ?? ""));

export default function ChartView({ element, background, interactive = false }: ChartViewProps) {
  const ink = inkFor(background);
  const palette = chartPalette(background);
  const title = element.title.trim();
  const titleHeight = title ? CHART_TITLE_HEIGHT : 0;
  const width = Math.max(40, Math.round(element.width));
  const height = Math.max(40, Math.round(element.height - titleHeight));
  const showLegend = legendVisible(element);
  const showValues = Boolean(element.showValues);
  const radial = isRadial(element.chartType);
  const pieOrder = new Map(radial ? pieSlices(element).map((slice, i) => [slice.name, i] as const) : []);
  const seriesOrder = new Map(element.series.map((s, i) => [s.name, i] as const));

  const legend = showLegend ? (
    <Legend
      verticalAlign="bottom"
      iconType="circle"
      // Keep series/category order (Recharts sorts alphabetically by default).
      itemSorter={radial ? (item) => pieOrder.get(String(item.value)) ?? 0 : element.chartType === "scatter" ? (item) => seriesOrder.get(String(item.value)) ?? 0 : "dataKey"}
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
  const tick = { fill: ink.secondary, fontSize: 16, fontFamily: FONT };
  const margin = { top: showValues ? 24 : 12, right: 16, bottom: 4, left: 0 };

  let chart: React.ReactNode;
  if (!hasDrawableData(element)) {
    chart = (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", color: ink.secondary, fontFamily: FONT, fontSize: 18 }}>
        {element.chartType === "scatter" ? "Scatter charts need numbers in the first column (X values)" : "No data to display"}
      </div>
    );
  } else if (radial) {
    const data = pieSlices(element).map((slice, i) => ({ ...slice, fill: palette[i % palette.length] }));
    chart = (
      <PieChart width={width} height={height} accessibilityLayer={false}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={element.chartType === "doughnut" ? "50%" : 0}
          // Slides are pictures, not widgets: keep pies out of the keyboard tab order like other charts.
          rootTabIndex={-1}
          outerRadius={showValues ? "72%" : "80%"}
          // Start at 12 o'clock and go clockwise, like PowerPoint, so exports match.
          startAngle={90}
          endAngle={-270}
          stroke={background}
          strokeWidth={2}
          isAnimationActive={false}
          labelLine={false}
          label={
            showValues
              ? (props: { x?: number; y?: number; value?: unknown; textAnchor?: string }) => (
                  <text x={props.x} y={props.y} fill={ink.secondary} fontSize={LABEL_SIZE} fontFamily={FONT} textAnchor={props.textAnchor as "start" | "middle" | "end" | undefined} dominantBaseline="central">
                    {formatLabel(props.value)}
                  </text>
                )
              : false
          }
        />
        {legend}
        {tooltip}
      </PieChart>
    );
  } else if (element.chartType === "scatter") {
    const pointsBySeries = scatterPoints(element);
    chart = (
      <ScatterChart width={width} height={height} margin={margin} accessibilityLayer={false}>
        <CartesianGrid stroke={ink.grid} />
        <XAxis type="number" dataKey="x" name="X" tick={tick} tickLine={false} axisLine={{ stroke: ink.grid }} tickFormatter={(v: number) => formatCompact(v)} domain={["auto", "auto"]} />
        <YAxis type="number" dataKey="y" name="Y" tick={tick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={56} domain={["auto", "auto"]} />
        {element.series.map((s, i) => (
          <Scatter key={i} name={s.name} data={pointsBySeries[i]} fill={palette[i]} stroke={background} strokeWidth={2} isAnimationActive={false}>
            {showValues && <LabelList dataKey="y" position="top" fill={ink.secondary} fontSize={LABEL_SIZE} formatter={formatLabel} />}
          </Scatter>
        ))}
        {legend}
        {tooltip}
      </ScatterChart>
    );
  } else {
    const rows = element.categories.map((category, i) => {
      const row: Record<string, string | number> = { category };
      element.series.forEach((series, si) => {
        row[`s${si}`] = series.values[i];
      });
      return row;
    });
    const dual = dualAxisApplies(element);
    const stacked = stackingApplies(element);
    const lastIndex = element.series.length - 1;
    const axes = [
      <CartesianGrid key="grid" vertical={false} stroke={ink.grid} yAxisId="left" />,
      <XAxis key="x" dataKey="category" tick={tick} tickLine={false} axisLine={{ stroke: ink.grid }} interval="preserveStartEnd" />,
      <YAxis key="y" yAxisId="left" tick={tick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={56} />,
      ...(dual
        ? [<YAxis key="y2" yAxisId="right" orientation="right" tick={tick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={56} />]
        : []),
    ];
    const props = { width, height, data: rows, margin: { ...margin, right: dual ? 4 : 16 }, accessibilityLayer: false };
    const axisFor = (i: number) => (dual && i === lastIndex ? "right" : "left");

    const line = (i: number) => (
      <Line
        key={i}
        yAxisId={axisFor(i)}
        dataKey={`s${i}`}
        name={element.series[i].name}
        type="linear"
        stroke={palette[i]}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        dot={{ r: 4, fill: palette[i], stroke: background, strokeWidth: 2 }}
        activeDot={interactive ? { r: 6, stroke: background, strokeWidth: 2 } : false}
        isAnimationActive={false}
      >
        {showValues && <LabelList dataKey={`s${i}`} position="top" fill={ink.secondary} fontSize={LABEL_SIZE} formatter={formatLabel} />}
      </Line>
    );

    if (element.chartType === "bar") {
      const barCount = dual ? lastIndex : element.series.length;
      chart = (
        <ComposedChart {...props} barGap={2}>
          {axes}
          {element.series.slice(0, barCount).map((s, i) => {
            const topOfStack = !stacked || i === barCount - 1;
            const labelInside = stacked;
            return (
              <Bar
                key={i}
                yAxisId="left"
                dataKey={`s${i}`}
                name={s.name}
                fill={palette[i]}
                stackId={stacked ? "stack" : undefined}
                // 2px gap between stacked segments, in the surface color.
                stroke={stacked ? background : undefined}
                strokeWidth={stacked ? 2 : 0}
                radius={topOfStack ? [4, 4, 0, 0] : 0}
                maxBarSize={56}
                isAnimationActive={false}
              >
                {showValues && (
                  <LabelList
                    dataKey={`s${i}`}
                    position={labelInside ? "center" : "top"}
                    fill={labelInside ? (isDarkColor(palette[i]) ? "#ffffff" : "#111111") : ink.secondary}
                    fontSize={LABEL_SIZE}
                    formatter={formatLabel}
                  />
                )}
              </Bar>
            );
          })}
          {dual && line(lastIndex)}
          {legend}
          {tooltip}
        </ComposedChart>
      );
    } else if (element.chartType === "line") {
      chart = (
        <LineChart {...props}>
          {axes}
          {element.series.map((_, i) => line(i))}
          {legend}
          {tooltip}
        </LineChart>
      );
    } else {
      chart = (
        <AreaChart {...props}>
          {axes}
          {element.series.map((s, i) => (
            <Area key={i} yAxisId="left" dataKey={`s${i}`} name={s.name} type="linear" stroke={palette[i]} strokeWidth={2} fill={palette[i]} fillOpacity={0.12} isAnimationActive={false}>
              {showValues && <LabelList dataKey={`s${i}`} position="top" fill={ink.secondary} fontSize={LABEL_SIZE} formatter={formatLabel} />}
            </Area>
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
