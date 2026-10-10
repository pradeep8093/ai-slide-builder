import type PptxGenJS from "pptxgenjs";
import { PX_PER_INCH } from "../constants";
import { inkFor, isDarkColor } from "../color";
import { chartPalette, dualAxisApplies, isRadial, legendVisible, pieSlices, stackingApplies } from "../chart";
import { parseNumber } from "../tabular";
import type { ChartElement, Deck, ImageCrop, ImageElement, ShapeElement, Slide, SlideElement, TableElement, TextElement } from "../schema";
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

/** Data rows in the shape pptxgenjs expects for each chart type. */
export function chartData(element: ChartElement) {
  if (isRadial(element.chartType)) {
    const slices = pieSlices(element);
    return [{ name: element.series[0]?.name ?? "Series 1", labels: slices.map((s) => s.name), values: slices.map((s) => s.value) }];
  }
  if (element.chartType === "scatter") {
    // pptxgenjs scatter data: the first entry holds the X values, every following entry one series of Y values.
    // Rows whose X isn't a number are left out, like on the slide.
    const rows = element.categories.flatMap((category, i) => {
      const x = parseNumber(category);
      return x === null ? [] : [{ i, x }];
    });
    return [
      { name: "X", values: rows.map((r) => r.x) },
      ...element.series.map((s) => ({ name: s.name, values: rows.map((r) => s.values[r.i]) })),
    ];
  }
  return element.series.map((s) => ({ name: s.name, labels: element.categories, values: s.values }));
}

function addChart(target: PptxSlide, element: ChartElement, background: string) {
  const ink = inkFor(background);
  const palette = chartPalette(background).map(hex);
  const radial = isRadial(element.chartType);
  const title = element.title.trim();
  const showValues = Boolean(element.showValues);
  const stacked = stackingApplies(element);
  const common = {
    ...box(element),
    showLegend: legendVisible(element),
    legendPos: "b" as const,
    legendColor: hex(ink.secondary),
    legendFontSize: 11,
    showTitle: Boolean(title),
    title: title || undefined,
    titleColor: hex(ink.primary),
    titleFontSize: 14,
    showValue: showValues,
    dataLabelColor: hex(ink.secondary),
    dataLabelFontSize: 10,
    objectName: element.id,
  };
  const axes = {
    catAxisLabelColor: hex(ink.secondary),
    valAxisLabelColor: hex(ink.secondary),
    catAxisLabelFontSize: 11,
    valAxisLabelFontSize: 11,
    catAxisLineShow: false,
    valAxisLineShow: false,
    valGridLine: { color: "D9D9D9", size: 0.75, style: "solid" as const },
    catGridLine: { style: "none" as const },
  };

  if (radial) {
    target.addChart(element.chartType, chartData(element), {
      ...common,
      chartColors: palette,
      dataBorder: { pt: 1.5, color: hex(background) },
      ...(element.chartType === "doughnut" ? { holeSize: 50 } : { dataLabelPosition: "outEnd" as const }),
    });
    return;
  }

  if (element.chartType === "scatter") {
    target.addChart("scatter", chartData(element), {
      ...common,
      ...axes,
      chartColors: palette,
      lineSize: 0, // markers only
      lineDataSymbol: "circle",
      lineDataSymbolSize: 8,
      dataLabelPosition: "t",
    });
    return;
  }

  if (dualAxisApplies(element)) {
    // The last series is a line against a second value axis on the right; the others keep their chart type.
    const last = element.series.length - 1;
    const data = chartData(element);
    const primaryType = element.chartType === "bar" ? "bar" : "line";
    const multi: PptxGenJS.IChartMulti[] = [
      {
        type: primaryType,
        data: data.slice(0, last),
        options: {
          chartColors: palette.slice(0, last),
          barDir: "col",
          barGrouping: stacked && last > 1 ? "stacked" : "clustered",
          lineSize: 2,
          lineDataSymbol: "circle",
          lineDataSymbolSize: 6,
        },
      },
      {
        type: "line",
        data: data.slice(last),
        options: { chartColors: [palette[last % palette.length]], secondaryValAxis: true, secondaryCatAxis: true, lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 6 },
      },
    ];
    // For multi-type charts pptxgenjs reads the options from the 2nd argument when it is truthy,
    // so the (unused) data argument must be empty-but-falsy for the 3rd argument to be used.
    target.addChart(multi, null as unknown as [], {
      ...common,
      ...axes,
      valAxes: [
        { valAxisLabelColor: hex(ink.secondary), valAxisLabelFontSize: 11, valGridLine: { color: "D9D9D9", size: 0.75, style: "solid" } },
        { valAxisLabelColor: hex(ink.secondary), valAxisLabelFontSize: 11, valGridLine: { style: "none" } },
      ],
      catAxes: [{ catAxisLabelColor: hex(ink.secondary), catAxisLabelFontSize: 11 }, { catAxisHidden: true }],
    });
    return;
  }

  target.addChart(element.chartType, chartData(element), {
    ...common,
    ...axes,
    // pptxgenjs colors every bar differently when a single-series bar chart gets several colors.
    chartColors: element.series.length === 1 ? palette.slice(0, 1) : palette,
    chartColorsOpacity: element.chartType === "area" ? 35 : undefined,
    barDir: "col",
    barGrouping: stacked ? "stacked" : "clustered",
    ...(stacked ? { dataLabelPosition: "ctr" as const } : element.chartType === "bar" ? { dataLabelPosition: "outEnd" as const } : { dataLabelPosition: "t" as const }),
    lineSize: 2,
    lineDataSymbol: "circle",
    lineDataSymbolSize: 6,
  });
}

function addTable(target: PptxSlide, element: TableElement) {
  const { rows, headerRow, headerFill, borderColor, fontSize, fontFamily, color } = element;
  if (rows.length === 0 || rows[0].length === 0) return;
  const headerColor = headerFill && isDarkColor(headerFill) ? "#ffffff" : color;
  const border: PptxGenJS.BorderProps = borderColor ? { type: "solid", color: hex(borderColor), pt: points(1.5) } : { type: "none" };
  const vertical = inches(Math.round(fontSize * 0.25));
  const horizontal = inches(Math.round(fontSize * 0.45));
  const cells: PptxGenJS.TableRow[] = rows.map((row, ri) => {
    const header = headerRow && ri === 0;
    return row.map((cell) => ({
      text: cell,
      options: {
        bold: header,
        color: hex(header ? headerColor : color),
        fill: header && headerFill ? { color: hex(headerFill) } : undefined,
        border: [border, border, border, border],
        margin: [vertical, horizontal, vertical, horizontal],
        valign: "middle",
      },
    }));
  });
  target.addTable(cells, {
    ...box(element),
    colW: inches(element.width / rows[0].length),
    rowH: inches(element.height / rows.length),
    fontFace: fontFamily,
    fontSize: points(fontSize),
    autoPage: false,
    objectName: element.id,
  });
}

/** Image sources to use in the export (cropped images are replaced by their cropped pixels). */
export type ImageSources = Map<string, string>;

/** Crops a data-URL image with a canvas. The crop is in fractions of the image size. */
export async function cropImageDataUrl(src: string, crop: ImageCrop): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const sx = Math.round(crop.x * img.naturalWidth);
  const sy = Math.round(crop.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(crop.width * img.naturalWidth));
  const sh = Math.max(1, Math.round(crop.height * img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser couldn't crop an image for the export.");
  context.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL(src.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png", 0.92);
}

/** Prepares cropped versions of every cropped image in the deck. */
export async function prepareImages(deck: Deck, cropImage: (src: string, crop: ImageCrop) => Promise<string> = cropImageDataUrl): Promise<ImageSources> {
  const sources: ImageSources = new Map();
  for (const slide of deck.slides) {
    for (const element of slide.elements) {
      if (element.type === "image" && element.crop) sources.set(element.id, await cropImage(element.src, element.crop));
    }
  }
  return sources;
}

function addImage(target: PptxSlide, element: ImageElement, sources: ImageSources) {
  target.addImage({ data: sources.get(element.id) ?? element.src, ...box(element), altText: element.alt || undefined, objectName: element.id });
}

function addSlideContent(pptx: PptxGenJS, slide: Slide, sources: ImageSources) {
  const target = pptx.addSlide();
  target.background = { color: hex(slide.background) };
  if (slide.notes.trim()) target.addNotes(slide.notes);
  for (const element of slide.elements) {
    switch (element.type) {
      case "text":
        addText(target, element);
        break;
      case "shape":
        addShape(target, element);
        break;
      case "image":
        addImage(target, element, sources);
        break;
      case "chart":
        addChart(target, element, slide.background);
        break;
      case "table":
        addTable(target, element);
        break;
    }
  }
}

/** Fills a pptxgenjs presentation with the deck. Kept separate from file writing so it can be tested. */
export function buildPresentation(pptx: PptxGenJS, deck: Deck, sources: ImageSources = new Map()): PptxGenJS {
  pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in == 1280 × 720 px at 96 px/in
  pptx.title = deck.title.trim() || UNTITLED;
  for (const slide of deck.slides) addSlideContent(pptx, slide, sources);
  return pptx;
}

export interface PptxExportOptions {
  /** Produces the cropped pixels of an image (injectable for tests). */
  cropImage?: (src: string, crop: ImageCrop) => Promise<string>;
}

export async function exportPptx(deck: Deck, options: PptxExportOptions = {}): Promise<string> {
  if (deck.slides.length === 0) throw new Error("Add at least one slide before exporting.");
  const sources = await prepareImages(deck, options.cropImage);
  const { default: PptxGenJSClass } = await import("pptxgenjs");
  const pptx = buildPresentation(new PptxGenJSClass(), deck, sources);
  const fileName = exportFileName(deck.title, "pptx");
  await pptx.writeFile({ fileName, compression: true });
  return fileName;
}
