import type { ShapeElement } from "@/lib/schema";

/** Rounded rectangles use PowerPoint's default corner radius (1/6 of the shorter side) so exports match. */
export const ROUNDED_RADIUS_RATIO = 1 / 6;

/** Block arrow geometry matching PowerPoint's default rightArrow (50% shaft, head = half the shorter side). */
export function arrowPoints(width: number, height: number, inset = 0): string {
  const head = Math.min(width, height) / 2;
  const top = height * 0.25;
  const bottom = height * 0.75;
  const neck = Math.max(inset, width - head);
  const pts: [number, number][] = [
    [inset, top],
    [neck, top],
    [neck, inset],
    [width - inset, height / 2],
    [neck, height - inset],
    [neck, bottom],
    [inset, bottom],
  ];
  return pts.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

export default function ShapeView({ element }: { element: ShapeElement }) {
  const { width: w, height: h, fill, stroke, strokeWidth, shape } = element;
  const hasStroke = stroke !== null && strokeWidth > 0;
  // Draw the stroke inside the box so the visual size matches the element size.
  const inset = hasStroke ? strokeWidth / 2 : 0;
  const paint = {
    fill: fill ?? "none",
    stroke: hasStroke ? stroke : "none",
    strokeWidth: hasStroke ? strokeWidth : 0,
    strokeLinejoin: "round" as const,
  };

  let body: React.ReactNode;
  switch (shape) {
    case "rectangle":
      body = <rect x={inset} y={inset} width={Math.max(0, w - 2 * inset)} height={Math.max(0, h - 2 * inset)} {...paint} />;
      break;
    case "rounded-rectangle": {
      const r = Math.min(w, h) * ROUNDED_RADIUS_RATIO;
      body = <rect x={inset} y={inset} width={Math.max(0, w - 2 * inset)} height={Math.max(0, h - 2 * inset)} rx={r} ry={r} {...paint} />;
      break;
    }
    case "ellipse":
      body = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - inset)} ry={Math.max(0, h / 2 - inset)} {...paint} />;
      break;
    case "triangle":
      body = <polygon points={`${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}`} {...paint} />;
      break;
    case "arrow":
      body = <polygon points={arrowPoints(w, h, inset)} {...paint} />;
      break;
    case "line":
      body = (
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={stroke ?? "#1f2937"} strokeWidth={Math.max(1, strokeWidth)} strokeLinecap="round" />
      );
      break;
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}
      data-shape={shape}
      aria-hidden="true"
    >
      {body}
    </svg>
  );
}
