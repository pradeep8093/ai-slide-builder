// @vitest-environment node
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { describe, expect, it, vi } from "vitest";
import { CHART_COLORS_DARK, CHART_COLORS_LIGHT } from "../constants";
import { createChartElement, createDeck, createImageElement, createShapeElement, createSlide, createTextElement } from "../factory";
import type { Deck } from "../schema";
import { getTemplates } from "../templates";
import { buildPresentation, exportPptx, inches, points } from "./pptx";

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function fakePresentation() {
  const slides: { background?: unknown; calls: [string, ...unknown[]][] }[] = [];
  const pptx = {
    layout: "",
    title: "",
    addSlide() {
      const slide = {
        background: undefined as unknown,
        calls: [] as [string, ...unknown[]][],
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

describe("unit conversion", () => {
  it("maps 96 px to 1 inch and px to points", () => {
    expect(inches(1280)).toBeCloseTo(13.3333, 3);
    expect(inches(96)).toBe(1);
    expect(points(32)).toBe(24);
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
    expect(barOpts).toMatchObject({ showTitle: true, title: "Revenue", showLegend: true, chartColors: CHART_COLORS_LIGHT.map((c) => c.slice(1).toUpperCase()) });
    const [, pieType, pieData, pieOpts] = slides[1].calls[0] as [string, string, { labels: string[] }[], Record<string, unknown>];
    expect(pieType).toBe("pie");
    expect(pieData[0].labels).toHaveLength(8);
    expect(pieData[0].labels.at(-1)).toBe("Other");
    expect(pieOpts).toMatchObject({ showTitle: false, chartColors: CHART_COLORS_DARK.map((c) => c.slice(1).toUpperCase()) });
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

describe("exportPptx", () => {
  it("refuses to export an empty deck", async () => {
    await expect(exportPptx(deckOf())).rejects.toThrow(/at least one slide/);
  });

  it("writes the file named after the title", async () => {
    const writeFile = vi.spyOn(PptxGenJS.prototype, "writeFile").mockResolvedValue("ok");
    const name = await exportPptx({ ...deckOf(createSlide()), title: "Board: Q3" });
    expect(name).toBe("Board Q3.pptx");
    expect(writeFile).toHaveBeenCalledWith({ fileName: "Board Q3.pptx", compression: true });
  });
});
