import { createChartElement, createShapeElement, createTextElement } from "./factory";
import { createId } from "./ids";
import type { ChartElement, ShapeElement, Slide, SlideElement, TextElement } from "./schema";
import type { ChartKind, ShapeKind } from "./constants";

export interface Template {
  id: string;
  name: string;
  description: string;
  slides: Slide[];
}

/*
 * Built-in starting points. All copy is placeholder text in [brackets] and every chart is labelled
 * as placeholder data, so nothing here pretends to be real information.
 */

type Box = { x: number; y: number; width: number; height: number };

function text(content: string, box: Box, style: Partial<Omit<TextElement, "id" | "type" | "text">> = {}): TextElement {
  return createTextElement({ ...box, text: content, ...style });
}

function shape(kind: ShapeKind, box: Box, style: Partial<Pick<ShapeElement, "fill" | "stroke" | "strokeWidth">> = {}): ShapeElement {
  return createShapeElement(kind, { ...box, ...style });
}

function chart(kind: ChartKind, box: Box, data: Pick<ChartElement, "title" | "categories" | "series"> & { showLegend?: boolean }): ChartElement {
  return createChartElement(kind, { ...box, showLegend: data.series.length > 1, ...data });
}

function slide(background: string, elements: SlideElement[]): Slide {
  return { id: createId(), background, elements, notes: "" };
}

function pitchDeck(): Template {
  const bg = "#0f172a";
  const ink = "#ffffff";
  const muted = "#cbd5e1";
  const accent = "#38bdf8";
  const card = "#1e293b";
  const heading = (t: string) => text(t, { x: 96, y: 72, width: 1088, height: 72 }, { fontSize: 48, bold: true, color: ink });
  const rule = () => shape("rectangle", { x: 96, y: 152, width: 64, height: 6 }, { fill: accent });
  return {
    id: "pitch-deck",
    name: "Pitch Deck",
    description: "Problem, solution, market and ask for an early-stage startup.",
    slides: [
      slide(bg, [
        shape("rectangle", { x: 96, y: 236, width: 80, height: 8 }, { fill: accent }),
        text("[Company name]", { x: 96, y: 264, width: 1088, height: 88 }, { fontSize: 72, bold: true, color: ink }),
        text("[One sentence that explains what you do and for whom]", { x: 96, y: 368, width: 1088, height: 48 }, { fontSize: 28, color: muted }),
      ]),
      slide(bg, [
        heading("The problem"),
        rule(),
        text(
          "• [Who has this problem?]\n• [How do they solve it today?]\n• [Why isn't that good enough?]",
          { x: 96, y: 208, width: 1088, height: 200 },
          { fontSize: 32, color: muted },
        ),
      ]),
      slide(bg, [
        heading("Our solution"),
        rule(),
        text(
          "• [What your product does]\n• [The key insight behind it]\n• [Why now]",
          { x: 96, y: 208, width: 520, height: 220 },
          { fontSize: 28, color: muted },
        ),
        shape("rounded-rectangle", { x: 680, y: 200, width: 504, height: 400 }, { fill: card }),
        text("[Add a product screenshot]", { x: 680, y: 380, width: 504, height: 40 }, { fontSize: 22, color: muted, align: "center" }),
      ]),
      slide(bg, [
        heading("Market opportunity"),
        rule(),
        chart("bar", { x: 96, y: 200, width: 720, height: 420 }, {
          title: "Market size, $B (placeholder values)",
          categories: ["TAM", "SAM", "SOM"],
          series: [{ name: "Market size", values: [50, 12, 2] }],
        }),
        text(
          "Replace these placeholder values with your own research and cite the source.",
          { x: 856, y: 240, width: 328, height: 160 },
          { fontSize: 22, color: muted },
        ),
      ]),
      slide(bg, [
        heading("Business model"),
        rule(),
        ...[
          ["Pricing", "[How you charge]"],
          ["Customers", "[Who pays]"],
          ["Channels", "[How you reach them]"],
        ].flatMap(([title, body], i) => {
          const x = 96 + i * 368;
          return [
            shape("rounded-rectangle", { x, y: 216, width: 336, height: 320 }, { fill: card }),
            text(title, { x: x + 32, y: 248, width: 272, height: 48 }, { fontSize: 30, bold: true, color: ink }),
            text(body, { x: x + 32, y: 312, width: 272, height: 120 }, { fontSize: 22, color: muted }),
          ];
        }),
      ]),
      slide(bg, [
        heading("The ask"),
        rule(),
        text("[Amount] to reach [milestone] by [date]", { x: 96, y: 240, width: 1088, height: 64 }, { fontSize: 40, bold: true, color: ink }),
        text("[name@company.com]", { x: 96, y: 336, width: 1088, height: 44 }, { fontSize: 26, color: accent }),
      ]),
    ],
  };
}

function projectUpdate(): Template {
  const bg = "#ffffff";
  const ink = "#111827";
  const body = "#374151";
  const accent = "#4f46e5";
  const heading = (t: string) => text(t, { x: 96, y: 64, width: 1088, height: 64 }, { fontSize: 44, bold: true, color: ink });
  const band = () => shape("rectangle", { x: 0, y: 0, width: 24, height: 720 }, { fill: accent });
  return {
    id: "project-update",
    name: "Project Update",
    description: "Status, progress, timeline and risks for a team check-in.",
    slides: [
      slide(bg, [
        band(),
        text("[Project name] update", { x: 96, y: 272, width: 1088, height: 80 }, { fontSize: 60, bold: true, color: ink }),
        text("[Team] · [Date]", { x: 96, y: 368, width: 1088, height: 44 }, { fontSize: 28, color: "#6b7280" }),
      ]),
      slide(bg, [
        band(),
        heading("Summary"),
        shape("rounded-rectangle", { x: 96, y: 152, width: 176, height: 44 }, { fill: "#dcfce7" }),
        text("[On track]", { x: 96, y: 158, width: 176, height: 32 }, { fontSize: 20, bold: true, color: "#166534", align: "center" }),
        text(
          "• [Biggest win since the last update]\n• [What changed]\n• [Decision or help needed]",
          { x: 96, y: 232, width: 1088, height: 200 },
          { fontSize: 30, color: body },
        ),
      ]),
      slide(bg, [
        band(),
        heading("Progress"),
        chart("bar", { x: 96, y: 152, width: 1088, height: 496 }, {
          title: "Tasks per week (placeholder values)",
          categories: ["Week 1", "Week 2", "Week 3", "Week 4"],
          series: [
            { name: "Planned", values: [10, 12, 12, 14] },
            { name: "Done", values: [8, 12, 10, 13] },
          ],
        }),
      ]),
      slide(bg, [
        band(),
        heading("Timeline"),
        shape("line", { x: 160, y: 348, width: 960, height: 24 }, { stroke: "#d1d5db", strokeWidth: 4 }),
        ...["Kickoff", "Design", "Build", "Launch"].flatMap((label, i) => {
          const cx = 160 + i * 320;
          return [
            shape("ellipse", { x: cx - 20, y: 340, width: 40, height: 40 }, { fill: i < 2 ? accent : "#e5e7eb" }),
            text(label, { x: cx - 120, y: 260, width: 240, height: 44 }, { fontSize: 26, bold: true, color: ink, align: "center" }),
            text("[Date]", { x: cx - 120, y: 404, width: 240, height: 36 }, { fontSize: 22, color: "#6b7280", align: "center" }),
          ];
        }),
      ]),
      slide(bg, [
        band(),
        heading("Risks & next steps"),
        text("Risks", { x: 96, y: 168, width: 512, height: 44 }, { fontSize: 30, bold: true, color: accent }),
        text("• [Risk and its impact]\n• [Mitigation]", { x: 96, y: 224, width: 512, height: 200 }, { fontSize: 26, color: body }),
        text("Next steps", { x: 672, y: 168, width: 512, height: 44 }, { fontSize: 30, bold: true, color: accent }),
        text("• [Next step] — [owner]\n• [Next step] — [owner]", { x: 672, y: 224, width: 512, height: 200 }, { fontSize: 26, color: body }),
      ]),
    ],
  };
}

function quarterlyReview(): Template {
  const bg = "#fbfaf7";
  const ink = "#1c1917";
  const body = "#44403c";
  const accent = "#ea580c";
  const heading = (t: string) => text(t, { x: 96, y: 64, width: 1088, height: 64 }, { fontSize: 44, bold: true, color: ink, fontFamily: "Georgia" });
  return {
    id: "quarterly-review",
    name: "Quarterly Review",
    description: "Key metrics, revenue charts and priorities for a business review.",
    slides: [
      slide(bg, [
        text("Quarterly Business Review", { x: 96, y: 264, width: 1088, height: 84 }, { fontSize: 64, bold: true, color: ink, fontFamily: "Georgia" }),
        shape("rectangle", { x: 96, y: 364, width: 96, height: 6 }, { fill: accent }),
        text("[Quarter] [Year]", { x: 96, y: 392, width: 1088, height: 44 }, { fontSize: 28, color: body }),
      ]),
      slide(bg, [
        heading("Key metrics"),
        ...["Revenue", "New customers", "Retention"].flatMap((label, i) => {
          const x = 96 + i * 368;
          return [
            shape("rounded-rectangle", { x, y: 216, width: 336, height: 240 }, { fill: "#ffffff", stroke: "#e7e5e4", strokeWidth: 2 }),
            text("[0]", { x: x + 32, y: 256, width: 272, height: 80 }, { fontSize: 60, bold: true, color: accent }),
            text(label, { x: x + 32, y: 352, width: 272, height: 40 }, { fontSize: 24, color: body }),
          ];
        }),
      ]),
      slide(bg, [
        heading("Revenue trend"),
        chart("line", { x: 96, y: 152, width: 1088, height: 496 }, {
          title: "Monthly revenue, $K (placeholder values)",
          categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
          series: [{ name: "Revenue", values: [120, 132, 128, 150, 162, 175] }],
        }),
      ]),
      slide(bg, [
        heading("Revenue by segment"),
        chart("pie", { x: 96, y: 152, width: 640, height: 496 }, {
          title: "Share of revenue (placeholder values)",
          categories: ["Enterprise", "Mid-market", "Small business"],
          series: [{ name: "Revenue", values: [55, 30, 15] }],
          showLegend: true,
        }),
        text("[What drove the change this quarter?]", { x: 784, y: 280, width: 400, height: 120 }, { fontSize: 26, color: body }),
      ]),
      slide(bg, [
        heading("Priorities for next quarter"),
        text(
          "1. [Priority] — [measurable goal]\n2. [Priority] — [measurable goal]\n3. [Priority] — [measurable goal]",
          { x: 96, y: 184, width: 1088, height: 220 },
          { fontSize: 32, color: body },
        ),
      ]),
    ],
  };
}

function productLaunch(): Template {
  const dark = "#312e81";
  const light = "#ffffff";
  const ink = "#1e1b4b";
  const body = "#4b5563";
  const accent = "#6366f1";
  const heading = (t: string) => text(t, { x: 96, y: 64, width: 1088, height: 64 }, { fontSize: 44, bold: true, color: ink, fontFamily: "Trebuchet MS" });
  return {
    id: "product-launch",
    name: "Product Launch",
    description: "Announce a product: why, key features, launch plan and Q&A.",
    slides: [
      slide(dark, [
        text("[Product name]", { x: 96, y: 256, width: 1088, height: 92 }, { fontSize: 72, bold: true, color: "#ffffff", fontFamily: "Trebuchet MS" }),
        text("Launching [date]", { x: 96, y: 364, width: 1088, height: 44 }, { fontSize: 28, color: "#c7d2fe" }),
      ]),
      slide(light, [
        heading("Why we built it"),
        text(
          "[The customer problem in one or two sentences, and what makes this the right moment to solve it.]",
          { x: 96, y: 176, width: 900, height: 160 },
          { fontSize: 32, color: body },
        ),
      ]),
      slide(light, [
        heading("Key features"),
        ...[1, 2, 3].flatMap((n, i) => {
          const x = 96 + i * 368;
          return [
            shape("ellipse", { x, y: 200, width: 72, height: 72 }, { fill: "#e0e7ff" }),
            text(String(n), { x, y: 214, width: 72, height: 44 }, { fontSize: 30, bold: true, color: accent, align: "center" }),
            text(`[Feature ${n}]`, { x, y: 304, width: 320, height: 44 }, { fontSize: 28, bold: true, color: ink }),
            text("[What it does and why it matters]", { x, y: 356, width: 320, height: 100 }, { fontSize: 22, color: body }),
          ];
        }),
      ]),
      slide(light, [
        heading("Launch plan"),
        ...["Announce", "Onboard", "Grow"].flatMap((label, i) => {
          const x = 96 + i * 368;
          return [
            shape("arrow", { x, y: 240, width: 336, height: 160 }, { fill: i === 0 ? accent : "#a5b4fc" }),
            text(label, { x: x + 24, y: 298, width: 240, height: 44 }, { fontSize: 28, bold: true, color: "#ffffff", align: "center" }),
            text("[Date] · [Owner]", { x, y: 432, width: 336, height: 36 }, { fontSize: 22, color: body, align: "center" }),
          ];
        }),
      ]),
      slide(dark, [
        text("Questions?", { x: 96, y: 280, width: 1088, height: 92 }, { fontSize: 72, bold: true, color: "#ffffff", align: "center", fontFamily: "Trebuchet MS" }),
        text("[name@company.com]", { x: 96, y: 388, width: 1088, height: 44 }, { fontSize: 26, color: "#c7d2fe", align: "center" }),
      ]),
    ],
  };
}

let cache: Template[] | null = null;

/** Built lazily (ids are generated on first use, never during server rendering). */
export function getTemplates(): Template[] {
  if (!cache) cache = [pitchDeck(), projectUpdate(), quarterlyReview(), productLaunch()];
  return cache;
}
