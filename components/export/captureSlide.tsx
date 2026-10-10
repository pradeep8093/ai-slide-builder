"use client";

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import SlideRenderer from "../slide/SlideRenderer";

export const CAPTURE_PIXEL_RATIO = 2;

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** Waits until images are decoded, fonts are ready and the charts have painted. */
async function waitForPaint(host: HTMLElement) {
  const images = Array.from(host.querySelectorAll("img"));
  await Promise.all(images.map((img) => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve())));
  if (document.fonts?.ready) await document.fonts.ready;
  await nextFrame();
  await nextFrame();
}

/** Renders a slide off-screen at full size and returns it as a JPEG data URL (for PDF export). */
export async function captureSlideImage(slide: Slide): Promise<string> {
  const { toJpeg } = await import("html-to-image");
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: `${SLIDE_WIDTH}px`,
    height: `${SLIDE_HEIGHT}px`,
    pointerEvents: "none",
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<SlideRenderer slide={slide} />));
    await waitForPaint(host);
    const node = host.firstElementChild as HTMLElement | null;
    if (!node) throw new Error("Slide could not be rendered.");
    return await toJpeg(node, {
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      pixelRatio: CAPTURE_PIXEL_RATIO,
      quality: 0.92,
      backgroundColor: slide.background,
    });
  } finally {
    root.unmount();
    host.remove();
  }
}
