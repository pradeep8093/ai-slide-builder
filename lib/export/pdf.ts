import type { Deck, Slide } from "../schema";
import { exportFileName, UNTITLED } from "./filename";

/** 1280×720 px at 96 px/in = 13.333×7.5 in = 960×540 pt. */
export const PDF_PAGE_WIDTH = 960;
export const PDF_PAGE_HEIGHT = 540;

/** The subset of jsPDF this module uses (lets tests pass a fake document). */
export interface PdfDocument {
  addPage(format: [number, number], orientation: "landscape"): unknown;
  addImage(data: string, format: "JPEG", x: number, y: number, w: number, h: number, alias?: string, compression?: "FAST"): unknown;
  setProperties(props: { title: string }): unknown;
  save(fileName: string): unknown;
}

export interface PdfExportOptions {
  /** Renders one slide and returns it as a JPEG data URL. */
  captureSlide: (slide: Slide, index: number) => Promise<string>;
  onProgress?: (done: number, total: number) => void;
  createDocument?: () => Promise<PdfDocument>;
}

async function createJsPdf(): Promise<PdfDocument> {
  const { jsPDF } = await import("jspdf");
  return new jsPDF({ orientation: "landscape", unit: "pt", format: [PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT], compress: true }) as unknown as PdfDocument;
}

/** One page per slide; slides are rendered to images so the PDF looks exactly like the editor. */
export async function exportPdf(deck: Deck, options: PdfExportOptions): Promise<string> {
  if (deck.slides.length === 0) throw new Error("Add at least one slide before exporting.");
  const doc = await (options.createDocument ?? createJsPdf)();
  const total = deck.slides.length;
  for (let i = 0; i < total; i += 1) {
    options.onProgress?.(i, total);
    const image = await options.captureSlide(deck.slides[i], i);
    if (i > 0) doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT], "landscape");
    doc.addImage(image, "JPEG", 0, 0, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, `slide-${i + 1}`, "FAST");
  }
  options.onProgress?.(total, total);
  doc.setProperties({ title: deck.title.trim() || UNTITLED });
  const fileName = exportFileName(deck.title, "pdf");
  doc.save(fileName);
  return fileName;
}
