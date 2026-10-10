import { SLIDE_HEIGHT, SLIDE_WIDTH } from "../constants";
import type { Deck, Slide } from "../schema";
import { exportFileName, UNTITLED } from "./filename";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

/**
 * A self-contained web page with every slide one below the other. `slideMarkup` is the static HTML
 * of each slide rendered at 1280×720; a small script scales the slides to the page width.
 */
export function buildHtmlDocument(title: string, slideMarkup: string[]): string {
  const safeTitle = escapeHtml(title.trim() || UNTITLED);
  const count = slideMarkup.length;
  const sections = slideMarkup
    .map(
      (markup, i) => `<section class="frame" aria-label="Slide ${i + 1} of ${count}">
  <div class="viewport"><div class="slide">${markup}</div></div>
  <p class="number">${i + 1} / ${count}</p>
</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="AI Slide Builder">
<title>${safeTitle}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; background: #f5f5f5; color: #171717; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  header { max-width: ${SLIDE_WIDTH}px; margin: 0 auto; padding: 32px 16px 8px; }
  h1 { margin: 0; font-size: 22px; font-weight: 600; }
  header p { margin: 4px 0 0; font-size: 13px; color: #737373; }
  main { max-width: ${SLIDE_WIDTH}px; margin: 0 auto; padding: 16px 16px 48px; }
  .frame { margin: 0 0 28px; }
  .viewport { position: relative; width: 100%; aspect-ratio: ${SLIDE_WIDTH} / ${SLIDE_HEIGHT}; overflow: hidden; border-radius: 6px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08); }
  .slide { position: absolute; left: 0; top: 0; width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; transform-origin: top left; transform: scale(var(--scale, 1)); }
  .number { margin: 8px 0 0; font-size: 12px; color: #a3a3a3; text-align: center; font-variant-numeric: tabular-nums; }
  @media print {
    @page { size: ${SLIDE_WIDTH}px ${SLIDE_HEIGHT}px; margin: 0; }
    html, body { background: #fff; }
    header, .number { display: none; }
    main { max-width: none; padding: 0; }
    .frame { margin: 0; break-after: page; }
    .viewport { width: ${SLIDE_WIDTH}px; border-radius: 0; box-shadow: none; }
    .slide { transform: none; }
  }
</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
  <p>${count} slide${count === 1 ? "" : "s"}</p>
</header>
<main>
${sections}
</main>
<script>
(function () {
  function fit() {
    var frames = document.querySelectorAll(".viewport");
    for (var i = 0; i < frames.length; i++) {
      frames[i].style.setProperty("--scale", String(frames[i].clientWidth / ${SLIDE_WIDTH}));
    }
  }
  fit();
  window.addEventListener("resize", fit);
})();
</script>
</body>
</html>
`;
}

export interface HtmlExportOptions {
  /** Static markup of one slide rendered at full size. */
  renderSlide: (slide: Slide) => Promise<string>;
  /** Saves the file (injectable for tests). */
  download: (blob: Blob, fileName: string) => void;
}

export async function exportHtml(deck: Deck, options: HtmlExportOptions): Promise<string> {
  if (deck.slides.length === 0) throw new Error("Add at least one slide before exporting.");
  const markup: string[] = [];
  for (const slide of deck.slides) markup.push(await options.renderSlide(slide));
  const fileName = exportFileName(deck.title, "html");
  options.download(new Blob([buildHtmlDocument(deck.title, markup)], { type: "text/html;charset=utf-8" }), fileName);
  return fileName;
}

/** Triggers a browser download of a blob. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
