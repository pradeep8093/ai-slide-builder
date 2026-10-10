import type PptxGenJS from "pptxgenjs";
import { PX_PER_INCH } from "../constants";
import { inkFor } from "../color";
import { chartPalette, legendVisible, pieSlices } from "../chart";
import type { ChartElement, Deck, ShapeElement, Slide, SlideElement, TextElement } from "../schema";
import { exportFileName, UNTITLED } from "./filename";

/** CSS px → inches (PowerPoint's coordinate unit in pptxgenjs). */
export const inches = (px: number) => Math.round((px / PX_PER_INCH) * 10000) / 10000;
/** CSS px → typographic points (font sizes, line widths). */
export const points = (px: number) => Math.round(px * 0.75 * 100) / 100;
const hex = (color: string) => color.replace("#", "").toUpperCase();

const SHAPE_NAMES: Record<ShapeElement["shape"], string> = {
  rectangle: "rect",
  "rounded-rectangle": "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  arrow: "rightArrow",
  line: "line",
};

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

function box(element: SlideElement) {
  return { x: inches(element.x), y: inches(element.y), w: inches(element.width), h: inches(element.height) };
}

function addText(target: PptxSlide, element: TextElement) {
  if (!element.text.trim()) return;
  target.addText(element.text, {
    ...box(element),
    fontFace: element.fontFamily,
    fontSize: points(element.fontSize),
    color: hex(element.color),
    bold: element.bold,
    italic: element.italic,
    underline: element.underline ? { style: "sng" } : undefined,
    align: element.align,
    valign: "top",
    margin: 0,
    fit: "none",
    objectName: element.id,
  });
}

function addShape(target: PptxSlide, element: ShapeElement) {
  const name = SHAPE_NAMES[element.shape] as PptxGenJS.SHAPE_NAME;
  if (element.shape === "line") {
    target.addShape(name, {
      x: inches(element.x),
      y: inches(element.y + element.height / 2),
      w: inches(element.width),
      h: 0,
      line: { color: hex(element.stroke ?? "#1f2937"), width: points(element.strokeWidth) },
      objectName: element.id,
    });
    return;
  }
  const hasStroke = element.stroke !== null && element.strokeWidth > 0;
  target.addShape(name, {
    ...box(element),
    fill: element.fill ? { color: hex(element.fill) } : { type: "none" },
    line: hasStroke ? { color: hex(element.stroke as string), width: points(element.strokeWidth) } : { type: "none" },
    objectName: element.id,
  });
}

function addChart(target: PptxSlide, element: ChartElement, background: string) {
  const ink = inkFor(background);
  const palette = chartPalette(background).map(hex);
  const isPie = element.chartType === "pie";
  const data = isPie
    ? (() => {
        const slices = pieSlices(element);
        return [{ name: element.series[0]?.name ?? "Series 1", labels: slices.map((s) => s.name), values: slices.map((s) => s.value) }];
      })()
    : element.series.map((s) => ({ name: s.name, labels: element.categories, values: s.values }));

  const type: PptxGenJS.CHART_NAME = element.chartType;
  const title = element.title.trim();
  target.addChart(type, data, {
    ...box(element),
    chartColors: palette,
    chartColorsOpacity: element.chartType === "area" ? 35 : undefined,
    showLegend: legendVisible(element),
    legendPos: "b",
    legendColor: hex(ink.secondary),
    legendFontSize: 11,
    showTitle: Boolean(title),
    title: title || undefined,
    titleColor: hex(ink.primary),
    titleFontSize: 14,
    ...(isPie
      ? { dataBorder: { pt: 1.5, color: hex(background) } }
      : {
          barDir: "col",
          barGrouping: "clustered",
          catAxisLabelColor: hex(ink.secondary),
          valAxisLabelColor: hex(ink.secondary),
          catAxisLabelFontSize: 11,
          valAxisLabelFontSize: 11,
          catAxisLineShow: false,
          valAxisLineShow: false,
          valGridLine: { color: "D9D9D9", size: 0.75, style: "solid" },
          catGridLine: { style: "none" },
          lineSize: 2,
          lineDataSymbol: "circle",
          lineDataSymbolSize: 6,
        }),
    objectName: element.id,
  });
}

function addSlideContent(pptx: PptxGenJS, slide: Slide) {
  const target = pptx.addSlide();
  target.background = { color: hex(slide.background) };
  for (const element of slide.elements) {
    switch (element.type) {
      case "text":
        addText(target, element);
        break;
      case "shape":
        addShape(target, element);
        break;
      case "image":
        target.addImage({ data: element.src, ...box(element), altText: element.alt || undefined, objectName: element.id });
        break;
      case "chart":
        addChart(target, element, slide.background);
        break;
    }
  }
}

/** Fills a pptxgenjs presentation with the deck. Kept separate from file writing so it can be tested. */
export function buildPresentation(pptx: PptxGenJS, deck: Deck): PptxGenJS {
  pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in == 1280 × 720 px at 96 px/in
  pptx.title = deck.title.trim() || UNTITLED;
  for (const slide of deck.slides) addSlideContent(pptx, slide);
  return pptx;
}

export async function exportPptx(deck: Deck): Promise<string> {
  if (deck.slides.length === 0) throw new Error("Add at least one slide before exporting.");
  const { default: PptxGenJSClass } = await import("pptxgenjs");
  const pptx = buildPresentation(new PptxGenJSClass(), deck);
  const fileName = exportFileName(deck.title, "pptx");
  await pptx.writeFile({ fileName, compression: true });
  return fileName;
}
