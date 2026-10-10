// @vitest-environment node
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { describe, expect, it, vi } from "vitest";
import { CHART_COLORS_DARK, CHART_COLORS_LIGHT } from "../constants";
import {
  createChartElement,
  createDeck,
  createImageElement,
  createShapeElement,
  createSlide,
  createTableElement,
  createTextElement,
} from "../factory";
import type { ChartElement, Deck, ImageCrop, TableElement } from "../schema";
import { getTemplates } from "../templates";
import { buildPresentation, chartData, exportPptx, inches, points, prepareImages } from "./pptx";

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const CROPPED_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const CROPPED_PNG = `data:image/png;base64,${CROPPED_PNG_BASE64}`;
const LIGHT = CHART_COLORS_LIGHT.map((c) => c.slice(1).toUpperCase());
const DARK = CHART_COLORS_DARK.map((c) => c.slice(1).toUpperCase());

type Call = [string, ...unknown[]];
type Options = Record<string, unknown>;

function fakePresentation() {
  const slides: { background?: unknown; calls: Call[] }[] = [];
  const pptx = {
    layout: "",
    title: "",
    addSlide() {
      const slide = {
        background: undefined as unknown,
        calls: [] as Call[],
        addText(...args: unknown[]) {
          slide.calls.push(["text", ...args]);
        },
        addShape(...args: unknown[]) {
          slide.calls.push(["shape", ...args]);
        },
        addImage(...args: unknown[]) {
          slide.calls.push(["image", ...args]);
        },
        addChart(...args: unknown[]) {
          slide.calls.push(["chart", ...args]);
        },
        addTable(...args: unknown[]) {
          slide.calls.push(["table", ...args]);
        },
        addNotes(...args: unknown[]) {
          slide.calls.push(["notes", ...args]);
        },
      };
      slides.push(slide);
      return slide;
    },
  };
  return { pptx: pptx as unknown as PptxGenJS, slides };
}

function deckOf(...slides: Deck["slides"]): Deck {
  return { ...createDeck("Export me"), slides };
}

/** Builds a one-slide deck with the chart and returns the addChart arguments. */
function exportChart(chart: ChartElement, background = "#ffffff") {
  const { pptx, slides } = fakePresentation();
  buildPresentation(pptx, deckOf({ ...createSlide(background), elements: [chart] }));
  const call = slides[0].calls.find((c) => c[0] === "chart");
  if (!call) throw new Error("no chart was added");
  const [, type, data, opts] = call as [string, unknown, unknown, Options];
  return { type, data, opts };
}

type CellRun = { text: string; options: Options };

function exportTable(table: TableElement) {
  const { pptx, slides } = fakePresentation();
  buildPresentation(pptx, deckOf({ ...createSlide(), elements: [table] }));
  const call = slides[0].calls.find((c) => c[0] === "table");
  if (!call) return null;
  const [, rows, opts] = call as [string, CellRun[][], Options];
  return { rows, opts };
}

const twoSeries = [
  { name: "A", values: [1, 2, 3, 4] },
  { name: "B", values: [4, 3, 2, 1] },
];
const threeSeries = [...twoSeries, { name: "C", values: [10, 20, 30, 40] }];

describe("unit conversion", () => {
  it("maps 96 px to 1 inch and px to points", () => {
    expect(inches(1280)).toBeCloseTo(13.3333, 3);
    expect(inches(96)).toBe(1);
    expect(points(32)).toBe(24);
  });
});

describe("chartData", () => {
  it("gives pie and doughnut charts the slices of the first series as labels and values", () => {
    const pie = createChartElement("pie", { categories: ["a", "b", "c"], series: [{ name: "Share", values: [5, -2, 3] }, { name: "Ignored", values: [9, 9, 9] }] });
    expect(chartData(pie)).toEqual([{ name: "Share", labels: ["a", "b", "c"], values: [5, 0, 3] }]);
    const doughnut = createChartElement("doughnut", { categories: ["x", "y"], series: [{ name: "Mix", values: [1, 2] }] });
    expect(chartData(doughnut)).toEqual([{ name: "Mix", labels: ["x", "y"], values: [1, 2] }]);
  });

  it("names a radial chart without series 'Series 1'", () => {
    const pie = createChartElement("pie", { categories: ["a"], series: [] });
    expect(chartData(pie)).toEqual([{ name: "Series 1", labels: ["a"], values: [0] }]);
  });

  it("folds extra pie slices into 'Other'", () => {
    const categories = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const pie = createChartElement("pie", { categories, series: [{ name: "s", values: categories.map((_, i) => i + 1) }] });
    const [row] = chartData(pie) as { labels: string[]; values: number[] }[];
    expect(row.labels).toHaveLength(8);
    expect(row.labels.at(-1)).toBe("Other");
    expect(row.values.at(-1)).toBe(1 + 2 + 3);
  });

  it("puts the X values first for scatter charts and drops rows whose X isn't a number", () => {
    const scatter = createChartElement("scatter", {
      categories: ["1", "n/a", "2,500", "", "-3.5"],
      series: [
        { name: "Y1", values: [10, 20, 30, 40, 50] },
        { name: "Y2", values: [1, 2, 3, 4, 5] },
      ],
    });
    expect(chartData(scatter)).toEqual([
      { name: "X", values: [1, 2500, -3.5] },
      { name: "Y1", values: [10, 30, 50] },
      { name: "Y2", values: [1, 3, 5] },
    ]);
  });

  it("returns only the X entry with no values when no X is a number", () => {
    const scatter = createChartElement("scatter", { categories: ["a", "b"], series: [{ name: "Y", values: [1, 2] }] });
    expect(chartData(scatter)).toEqual([
      { name: "X", values: [] },
      { name: "Y", values: [] },
    ]);
  });

  it.each(["bar", "line", "area"] as const)("maps every series of a %s chart with the categories as labels", (kind) => {
    const chart = createChartElement(kind, { series: twoSeries });
    expect(chartData(chart)).toEqual([
      { name: "A", labels: ["Q1", "Q2", "Q3", "Q4"], values: [1, 2, 3, 4] },
      { name: "B", labels: ["Q1", "Q2", "Q3", "Q4"], values: [4, 3, 2, 1] },
    ]);
  });
});

describe("buildPresentation", () => {
  it("uses the wide layout and the deck title", () => {
    const { pptx } = fakePresentation();
    buildPresentation(pptx, { ...deckOf(), title: "  " });
    expect(pptx.layout).toBe("LAYOUT_WIDE");
    expect(pptx.title).toBe("Untitled presentation");
  });

  it("maps text with fonts, sizes, colors and alignment and skips empty text", () => {
    const text = createTextElement({ x: 96, y: 192, width: 960, height: 96, text: "Hello", fontSize: 40, bold: true, underline: true, align: "center", color: "#ff0000" });
    const { pptx, slides } = fakePresentation();
    buildPresentation(pptx, deckOf({ ...createSlide("#112233"), elements: [text, createTextElement({ text: "   " })] }));
    expect(slides[0].background).toEqual({ color: "112233" });
    expect(slides[0].calls).toHaveLength(1);
    const [, content, opts] = slides[0].calls[0] as [string, string, Record<string, unknown>];
    expect(content).toBe("Hello");
    expect(opts).toMatchObject({ x: 1, y: 2, w: 10, h: 1, fontSize: 30, color: "FF0000", bold: true, align: "center", underline: { style: "sng" }, margin: 0 });
  });

  it("maps shapes, including lines and missing fills/borders", () => {
    const { pptx, slides } = fakePresentation();
    const line = createShapeElement("line", { x: 0, y: 100, width: 960, height: 24, strokeWidth: 4, stroke: "#000000" });
    const rect = createShapeElement("rounded-rectangle", { fill: null, stroke: "#00ff00", strokeWidth: 2 });
    const arrow = createShapeElement("arrow", { stroke: null, strokeWidth: 0 });
    buildPresentation(pptx, deckOf({ ...createSlide(), elements: [line, rect, arrow] }));
    const [l, r, a] = slides[0].calls as [string, string, Record<string, unknown>][];
    expect(l[1]).toBe("line");
    expect(l[2]).toMatchObject({ y: inches(112), h: 0, line: { color: "000000", width: 3 } });
    expect(r[1]).toBe("roundRect");
    expect(r[2]).toMatchObject({ fill: { type: "none" }, line: { color: "00FF00", width: 1.5 } });
    expect(a[1]).toBe("rightArrow");
    expect(a[2]).toMatchObject({ line: { type: "none" } });
  });

  it("embeds images with alt text", () => {
    const { pptx, slides } = fakePresentation();
    buildPresentation(pptx, deckOf({ ...createSlide(), elements: [createImageElement(PNG_1PX, 10, 10, "Logo")] }));
    expect(slides[0].calls[0][1]).toMatchObject({ data: PNG_1PX, altText: "Logo" });
  });

  it("uses the prepared cropped pixels for cropped images and the original for the others", () => {
    const cropped = { ...createImageElement(PNG_1PX, 10, 10, "Cropped"), crop: { x: 0.25, y: 0, width: 0.5, height: 1 } };
    const plain = createImageElement(PNG_1PX, 10, 10, "");
    const { pptx, slides } = fakePresentation();
    buildPresentation(pptx, deckOf({ ...createSlide(), elements: [cropped, plain] }), new Map([[cropped.id, CROPPED_PNG]]));
    const [first, second] = slides[0].calls.map((c) => c[1] as Options);
    expect(first).toMatchObject({ data: CROPPED_PNG, altText: "Cropped", objectName: cropped.id, x: inches(cropped.x), w: inches(cropped.width) });
    expect(second).toMatchObject({ data: PNG_1PX, objectName: plain.id });
    // Empty alt text is left out rather than written as "".
    expect(second.altText).toBeUndefined();
  });

  it("maps charts to native charts using the palette for the background", () => {
    const { pptx, slides } = fakePresentation();
    const bar = createChartElement("bar", { title: "Revenue", series: [{ name: "A", values: [1, 2, 3, 4] }, { name: "B", values: [4, 3, 2, 1] }] });
    const categories = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const pie = createChartElement("pie", { categories, series: [{ name: "Share", values: categories.map((_, i) => i + 1) }] });
    buildPresentation(pptx, deckOf({ ...createSlide(), elements: [bar] }, { ...createSlide("#000000"), elements: [pie] }));
    const [, barType, barData, barOpts] = slides[0].calls[0] as [string, string, { name: string; labels: string[]; values: number[] }[], Record<string, unknown>];
    expect(barType).toBe("bar");
    expect(barData).toEqual([
      { name: "A", labels: ["Q1", "Q2", "Q3", "Q4"], values: [1, 2, 3, 4] },
      { name: "B", labels: ["Q1", "Q2", "Q3", "Q4"], values: [4, 3, 2, 1] },
    ]);
    expect(barOpts).toMatchObject({ showTitle: true, title: "Revenue", showLegend: true, chartColors: LIGHT });
    const [, pieType, pieData, pieOpts] = slides[1].calls[0] as [string, string, { labels: string[] }[], Record<string, unknown>];
    expect(pieType).toBe("pie");
    expect(pieData[0].labels).toHaveLength(8);
    expect(pieData[0].labels.at(-1)).toBe("Other");
    expect(pieOpts).toMatchObject({ showTitle: false, chartColors: DARK });
  });

  it("produces a valid .pptx file for every template", async () => {
    for (const template of getTemplates()) {
      const deck = deckOf(...template.slides);
      const extra = { ...createSlide(), elements: [createImageElement(PNG_1PX, 100, 100, "dot"), createChartElement("area")] };
      const pptx = buildPresentation(new PptxGenJS(), { ...deck, slides: [...deck.slides, extra] });
      const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
      const zip = await JSZip.loadAsync(buffer);
      const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
      expect(slideFiles).toHaveLength(template.slides.length + 1);
      const first = await zip.file("ppt/slides/slide1.xml")!.async("string");
      const firstText = template.slides[0].elements.find((e) => e.type === "text");
      if (firstText?.type === "text") expect(first).toContain(firstText.text.replace(/&/g, "&amp;").split("\n")[0]);
      expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/charts/"))).toBe(true);
      expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/media/"))).toBe(true);
    }
  });
});

describe("chart options", () => {
  it("draws doughnuts with a 50% hole and no outside label position", () => {
    const { type, opts } = exportChart(createChartElement("doughnut", { showValues: true }), "#112233");
    expect(type).toBe("doughnut");
    expect(opts).toMatchObject({ holeSize: 50, chartColors: DARK, dataBorder: { pt: 1.5, color: "112233" }, showValue: true, showLegend: true });
    expect(opts).not.toHaveProperty("dataLabelPosition");
  });

  it("labels pie slices outside the slice and has no hole", () => {
    const { type, opts } = exportChart(createChartElement("pie"));
    expect(type).toBe("pie");
    expect(opts).toMatchObject({ dataLabelPosition: "outEnd", chartColors: LIGHT, dataBorder: { pt: 1.5, color: "FFFFFF" } });
    expect(opts).not.toHaveProperty("holeSize");
  });

  it("draws scatter charts as markers without lines, X values first", () => {
    const scatter = createChartElement("scatter", { categories: ["1", "x", "3", "4"], series: twoSeries });
    const { type, data, opts } = exportChart(scatter);
    expect(type).toBe("scatter");
    expect(data).toEqual([
      { name: "X", values: [1, 3, 4] },
      { name: "A", values: [1, 3, 4] },
      { name: "B", values: [4, 2, 1] },
    ]);
    expect(opts).toMatchObject({ lineSize: 0, lineDataSymbol: "circle", dataLabelPosition: "t", chartColors: LIGHT, showLegend: true });
  });

  it("stacks bar charts with two or more series and centers their labels", () => {
    const { type, opts } = exportChart(createChartElement("bar", { series: twoSeries, stacked: true }));
    expect(type).toBe("bar");
    expect(opts).toMatchObject({ barGrouping: "stacked", barDir: "col", dataLabelPosition: "ctr" });
  });

  it("does not stack a single-series bar chart or a line chart", () => {
    expect(exportChart(createChartElement("bar", { stacked: true })).opts).toMatchObject({ barGrouping: "clustered", dataLabelPosition: "outEnd" });
    expect(exportChart(createChartElement("line", { series: twoSeries, stacked: true })).opts).toMatchObject({ barGrouping: "clustered", dataLabelPosition: "t" });
  });

  it("gives a single-series bar chart one color so every bar matches", () => {
    const { opts } = exportChart(createChartElement("bar"));
    expect(opts.chartColors).toEqual([LIGHT[0]]);
    expect(opts.showLegend).toBe(false);
  });

  it("uses the whole palette for multi-series charts and translucent fills for area charts", () => {
    expect(exportChart(createChartElement("line", { series: twoSeries })).opts).toMatchObject({ chartColors: LIGHT, chartColorsOpacity: undefined });
    expect(exportChart(createChartElement("area", { series: twoSeries })).opts).toMatchObject({ chartColors: LIGHT, chartColorsOpacity: 35 });
  });

  it("shows values only when the chart asks for them", () => {
    expect(exportChart(createChartElement("bar", { showValues: true })).opts.showValue).toBe(true);
    expect(exportChart(createChartElement("bar")).opts.showValue).toBe(false);
    expect(exportChart(createChartElement("pie", { showValues: false })).opts.showValue).toBe(false);
    expect(exportChart(createChartElement("scatter", { showValues: true })).opts.showValue).toBe(true);
  });

  it("hides the legend when the chart turns it off", () => {
    expect(exportChart(createChartElement("pie", { showLegend: false })).opts.showLegend).toBe(false);
    expect(exportChart(createChartElement("bar", { series: twoSeries, showLegend: false })).opts.showLegend).toBe(false);
  });

  it("puts the last series of a dual-axis bar chart on secondary axes as a line", () => {
    const chart = createChartElement("bar", { series: threeSeries, dualAxis: true, title: "Mix", showValues: true });
    const { type, data, opts } = exportChart(chart);
    expect(data).toBeNull();
    const multi = type as PptxGenJS.IChartMulti[];
    expect(Array.isArray(multi)).toBe(true);
    expect(multi).toHaveLength(2);
    const [primary, secondary] = multi;
    expect(primary.type).toBe("bar");
    expect(primary.data.map((d) => d.name)).toEqual(["A", "B"]);
    expect(primary.options).toMatchObject({ chartColors: LIGHT.slice(0, 2), barDir: "col", barGrouping: "clustered" });
    expect(primary.options.secondaryValAxis).toBeUndefined();
    expect(secondary.type).toBe("line");
    expect(secondary.data).toEqual([{ name: "C", labels: ["Q1", "Q2", "Q3", "Q4"], values: [10, 20, 30, 40] }]);
    expect(secondary.options).toMatchObject({ chartColors: [LIGHT[2]], secondaryValAxis: true, secondaryCatAxis: true });
    expect(opts).toMatchObject({ showTitle: true, title: "Mix", showValue: true, showLegend: true, x: inches(chart.x), w: inches(chart.width) });
    const valAxes = opts.valAxes as Options[];
    const catAxes = opts.catAxes as Options[];
    expect(valAxes).toHaveLength(2);
    expect(valAxes[0]).toMatchObject({ valGridLine: { style: "solid" } });
    expect(valAxes[1]).toMatchObject({ valGridLine: { style: "none" } });
    expect(catAxes).toHaveLength(2);
    expect(catAxes[1]).toEqual({ catAxisHidden: true });
  });

  it("keeps a dual-axis line chart's primary series as lines", () => {
    const { type } = exportChart(createChartElement("line", { series: twoSeries, dualAxis: true }));
    const [primary, secondary] = type as PptxGenJS.IChartMulti[];
    expect(primary.type).toBe("line");
    expect(primary.data.map((d) => d.name)).toEqual(["A"]);
    expect(primary.options.chartColors).toEqual([LIGHT[0]]);
    expect(secondary.data.map((d) => d.name)).toEqual(["B"]);
    expect(secondary.options.chartColors).toEqual([LIGHT[1]]);
  });

  it("stacks the primary bars of a dual-axis chart only when two or more remain", () => {
    const three = exportChart(createChartElement("bar", { series: threeSeries, dualAxis: true, stacked: true }));
    expect((three.type as PptxGenJS.IChartMulti[])[0].options.barGrouping).toBe("stacked");
    const two = exportChart(createChartElement("bar", { series: twoSeries, dualAxis: true, stacked: true }));
    expect((two.type as PptxGenJS.IChartMulti[])[0].options.barGrouping).toBe("clustered");
  });

  it("ignores the dual-axis option where it doesn't apply", () => {
    expect(exportChart(createChartElement("bar", { dualAxis: true })).type).toBe("bar");
    expect(exportChart(createChartElement("area", { series: twoSeries, dualAxis: true })).type).toBe("area");
    expect(exportChart(createChartElement("pie", { series: twoSeries, dualAxis: true })).type).toBe("pie");
  });
});

describe("tables", () => {
  it("maps cells with a bold, filled header row, borders and margins", () => {
    const table = createTableElement({
      x: 96,
      y: 96,
      width: 960,
      height: 300,
      rows: [
        ["Name", "Score"],
        ["Ada", "10"],
        ["Bo", "8"],
      ],
      headerFill: "#eef2ff",
      borderColor: "#d1d5db",
      color: "#1f2937",
      fontSize: 20,
      fontFamily: "Georgia",
    });
    const result = exportTable(table)!;
    expect(result.rows.map((r) => r.map((c) => c.text))).toEqual([
      ["Name", "Score"],
      ["Ada", "10"],
      ["Bo", "8"],
    ]);
    const border = { type: "solid", color: "D1D5DB", pt: points(1.5) };
    const margin = [inches(5), inches(9), inches(5), inches(9)];
    expect(result.rows[0][0].options).toEqual({ bold: true, color: "1F2937", fill: { color: "EEF2FF" }, border: [border, border, border, border], margin, valign: "middle" });
    expect(result.rows[1][1].options).toEqual({ bold: false, color: "1F2937", fill: undefined, border: [border, border, border, border], margin, valign: "middle" });
    expect(result.opts).toEqual({ x: 1, y: 1, w: 10, h: inches(300), colW: 5, rowH: inches(100), fontFace: "Georgia", fontSize: 15, autoPage: false, objectName: table.id });
  });

  it("uses white header text on a dark header fill", () => {
    const result = exportTable(createTableElement({ headerFill: "#1e3a8a", color: "#333333" }))!;
    expect(result.rows[0][0].options).toMatchObject({ bold: true, color: "FFFFFF", fill: { color: "1E3A8A" } });
    expect(result.rows[1][0].options).toMatchObject({ bold: false, color: "333333" });
  });

  it("writes no borders when the table has no border color", () => {
    const result = exportTable(createTableElement({ borderColor: null }))!;
    expect(result.rows[0][0].options.border).toEqual([{ type: "none" }, { type: "none" }, { type: "none" }, { type: "none" }]);
  });

  it("styles no header without a header row, and no fill without a header fill", () => {
    const plain = exportTable(createTableElement({ headerRow: false, headerFill: "#000000", color: "#123456" }))!;
    expect(plain.rows[0][0].options).toMatchObject({ bold: false, color: "123456", fill: undefined });
    const unfilled = exportTable(createTableElement({ headerFill: null, color: "#123456" }))!;
    expect(unfilled.rows[0][0].options).toMatchObject({ bold: true, color: "123456", fill: undefined });
  });

  it("skips a table without cells", () => {
    expect(exportTable(createTableElement({ rows: [] }))).toBeNull();
    expect(exportTable(createTableElement({ rows: [[]] }))).toBeNull();
  });
});

describe("speaker notes", () => {
  it("adds notes only to slides that have them", () => {
    const { pptx, slides } = fakePresentation();
    buildPresentation(pptx, deckOf(createSlide("#ffffff", "Say hello\nthen wave"), createSlide("#ffffff", "   \n"), createSlide()));
    expect(slides[0].calls).toEqual([["notes", "Say hello\nthen wave"]]);
    expect(slides[1].calls).toEqual([]);
    expect(slides[2].calls).toEqual([]);
  });
});

describe("prepareImages", () => {
  const crop: ImageCrop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };

  it("crops only the cropped images, across slides", async () => {
    const plain = createImageElement(PNG_1PX, 10, 10);
    const croppedA = { ...createImageElement(PNG_1PX, 10, 10), crop };
    const croppedB = { ...createImageElement(CROPPED_PNG, 10, 10), crop: { x: 0, y: 0, width: 1, height: 0.5 } };
    const cropImage = vi.fn(async (src: string, c: ImageCrop) => `cropped:${src.length}:${c.height}`);
    const deck = deckOf({ ...createSlide(), elements: [plain, croppedA, createTextElement()] }, { ...createSlide(), elements: [croppedB] });
    const sources = await prepareImages(deck, cropImage);
    expect(cropImage).toHaveBeenCalledTimes(2);
    expect(cropImage).toHaveBeenNthCalledWith(1, PNG_1PX, crop);
    expect(cropImage).toHaveBeenNthCalledWith(2, CROPPED_PNG, croppedB.crop);
    expect([...sources.entries()]).toEqual([
      [croppedA.id, `cropped:${PNG_1PX.length}:0.6`],
      [croppedB.id, `cropped:${CROPPED_PNG.length}:0.5`],
    ]);
  });

  it("does nothing for decks without cropped images", async () => {
    const cropImage = vi.fn(async () => "never");
    const sources = await prepareImages(deckOf({ ...createSlide(), elements: [createImageElement(PNG_1PX, 10, 10)] }), cropImage);
    expect(cropImage).not.toHaveBeenCalled();
    expect(sources.size).toBe(0);
  });

  it("fails when cropping fails", async () => {
    const deck = deckOf({ ...createSlide(), elements: [{ ...createImageElement(PNG_1PX, 10, 10), crop }] });
    await expect(prepareImages(deck, () => Promise.reject(new Error("no canvas")))).rejects.toThrow("no canvas");
  });
});

describe("exportPptx", () => {
  it("refuses to export an empty deck", async () => {
    const cropImage = vi.fn();
    await expect(exportPptx(deckOf(), { cropImage })).rejects.toThrow(/at least one slide/);
    expect(cropImage).not.toHaveBeenCalled();
  });

  it("writes the file named after the title", async () => {
    const writeFile = vi.spyOn(PptxGenJS.prototype, "writeFile").mockResolvedValue("ok");
    const name = await exportPptx({ ...deckOf(createSlide()), title: "Board: Q3" });
    expect(name).toBe("Board Q3.pptx");
    expect(writeFile).toHaveBeenCalledWith({ fileName: "Board Q3.pptx", compression: true });
  });

  it("embeds the pixels produced by the injected cropImage for cropped images", async () => {
    const crop: ImageCrop = { x: 0, y: 0, width: 0.5, height: 0.5 };
    const image = { ...createImageElement(PNG_1PX, 10, 10, "Cropped"), crop };
    const cropImage = vi.fn(async () => CROPPED_PNG);
    let written: Buffer | null = null;
    vi.spyOn(PptxGenJS.prototype, "writeFile").mockImplementation(async function (this: PptxGenJS) {
      written = (await this.write({ outputType: "nodebuffer" })) as Buffer;
      return "ok";
    });
    await expect(exportPptx({ ...deckOf({ ...createSlide(), elements: [image] }), title: "Crops" }, { cropImage })).resolves.toBe("Crops.pptx");
    expect(cropImage).toHaveBeenCalledWith(PNG_1PX, crop);
    const zip = await JSZip.loadAsync(written!);
    const media = Object.keys(zip.files).filter((f) => f.startsWith("ppt/media/") && !zip.files[f].dir);
    expect(media).toHaveLength(1);
    const bytes = await zip.file(media[0])!.async("nodebuffer");
    expect(bytes.equals(Buffer.from(CROPPED_PNG_BASE64, "base64"))).toBe(true);
  });
});

describe("generated .pptx file", () => {
  async function chartXmlFiles(zip: JSZip) {
    const names = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
    return Promise.all(names.map((n) => zip.file(n)!.async("string")));
  }
  const count = (xml: string, needle: string) => xml.split(needle).length - 1;

  it("contains native charts of every kind, a table and speaker notes", async () => {
    const table = createTableElement({
      rows: [
        ["Region", "Sales"],
        ["North & East", "1,200"],
      ],
      headerFill: "#1e3a8a",
    });
    const deck = deckOf(
      { ...createSlide(), elements: [createChartElement("bar", { series: twoSeries, showValues: true }), createChartElement("line"), createChartElement("area")] },
      { ...createSlide("#000000"), elements: [createChartElement("pie"), createChartElement("doughnut")] },
      { ...createSlide(), elements: [createChartElement("scatter", { series: twoSeries })] },
      { ...createSlide(), elements: [createChartElement("bar", { series: threeSeries, stacked: true })] },
      { ...createSlide(), elements: [createChartElement("bar", { series: twoSeries, dualAxis: true })] },
      { ...createSlide("#ffffff", "Mention Q3 & Q4 <growth>"), elements: [table] },
    );
    const pptx = buildPresentation(new PptxGenJS(), deck);
    const zip = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
    const charts = await chartXmlFiles(zip);
    expect(charts).toHaveLength(8);

    for (const tag of ["<c:barChart>", "<c:lineChart>", "<c:areaChart>", "<c:pieChart>", "<c:doughnutChart>", "<c:scatterChart>"]) {
      expect(charts.some((xml) => xml.includes(tag)), tag).toBe(true);
    }
    const doughnut = charts.find((xml) => xml.includes("<c:doughnutChart>"))!;
    expect(doughnut).toContain('<c:holeSize val="50"/>');

    const stacked = charts.filter((xml) => xml.includes('<c:grouping val="stacked"/>'));
    expect(stacked).toHaveLength(1);
    expect(count(stacked[0], "<c:ser>")).toBe(3);

    const dual = charts.filter((xml) => xml.includes("<c:barChart>") && xml.includes("<c:lineChart>"));
    expect(dual).toHaveLength(1);
    expect(count(dual[0], "<c:valAx>")).toBe(2);
    expect(count(dual[0], "<c:catAx>")).toBe(2);

    const tableSlide = await zip.file("ppt/slides/slide6.xml")!.async("string");
    expect(tableSlide).toContain("<a:tbl>");
    expect(tableSlide).toContain("North &amp; East");
    expect(tableSlide).toContain("1,200");

    const notes = await zip.file("ppt/notesSlides/notesSlide6.xml")!.async("string");
    expect(notes).toContain("Mention Q3 &amp; Q4 &lt;growth&gt;");
    const noNotes = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
    expect(noNotes).not.toContain("Mention");
  });
});
