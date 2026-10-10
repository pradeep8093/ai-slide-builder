import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeck, createSlide } from "../factory";
import type { Slide } from "../schema";
import { buildHtmlDocument, downloadBlob, escapeHtml, exportHtml } from "./html";

function parse(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

async function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("escapeHtml", () => {
  it("escapes the characters that are special in HTML text and attributes", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
  });

  it("leaves ordinary text alone and escapes existing entities again", () => {
    expect(escapeHtml("Quarterly review 2026 — ✓")).toBe("Quarterly review 2026 — ✓");
    expect(escapeHtml("")).toBe("");
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("buildHtmlDocument", () => {
  it("escapes the title in the page title and heading", () => {
    const html = buildHtmlDocument(`  Q3 <script>alert("x")</script> & more  `, ["<p>one</p>"]);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("<title>Q3 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more</title>");
    const doc = parse(html);
    expect(doc.title).toBe(`Q3 <script>alert("x")</script> & more`);
    expect(doc.querySelector("h1")?.textContent).toBe(`Q3 <script>alert("x")</script> & more`);
  });

  it("falls back to 'Untitled presentation' for an empty title", () => {
    const doc = parse(buildHtmlDocument("   ", ["<p>one</p>"]));
    expect(doc.title).toBe("Untitled presentation");
    expect(doc.querySelector("h1")?.textContent).toBe("Untitled presentation");
  });

  it("renders one numbered section per slide with the slide markup inside", () => {
    const doc = parse(buildHtmlDocument("Deck", ['<div id="a">First</div>', '<div id="b">Second</div>', '<div id="c">Third</div>']));
    const sections = Array.from(doc.querySelectorAll("main > section.frame"));
    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["Slide 1 of 3", "Slide 2 of 3", "Slide 3 of 3"]);
    expect(sections.map((s) => s.querySelector(".number")?.textContent)).toEqual(["1 / 3", "2 / 3", "3 / 3"]);
    expect(sections.map((s) => s.querySelector(".viewport > .slide > div")?.textContent)).toEqual(["First", "Second", "Third"]);
    expect(sections[1].querySelector("#b")).not.toBeNull();
  });

  it("says how many slides there are, singular or plural", () => {
    expect(parse(buildHtmlDocument("Deck", ["<p>a</p>"])).querySelector("header p")?.textContent).toBe("1 slide");
    expect(parse(buildHtmlDocument("Deck", ["<p>a</p>", "<p>b</p>"])).querySelector("header p")?.textContent).toBe("2 slides");
    const empty = parse(buildHtmlDocument("Deck", []));
    expect(empty.querySelector("header p")?.textContent).toBe("0 slides");
    expect(empty.querySelectorAll("section")).toHaveLength(0);
  });

  it("is a standalone document with print styles that put one slide on each page", () => {
    const html = buildHtmlDocument("Deck", ["<p>a</p>"]);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    const doc = parse(html);
    expect(doc.documentElement.lang).toBe("en");
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(doc.querySelector('link[rel="stylesheet"], script[src]')).toBeNull();
    const css = doc.querySelector("style")?.textContent ?? "";
    expect(css).toContain("aspect-ratio: 1280 / 720");
    expect(css).toMatch(/@media print \{[\s\S]*@page \{ size: 1280px 720px; margin: 0; \}[\s\S]*break-after: page;[\s\S]*\.slide \{ transform: none; \}/);
  });

  it("includes a script that scales every slide to the width of its frame, also on resize", () => {
    const doc = parse(buildHtmlDocument("Deck", ["<p>a</p>", "<p>b</p>"]));
    const script = doc.querySelector("script")?.textContent ?? "";
    expect(script).toContain("--scale");

    // Run the script against the rendered slides with a known frame width.
    const host = document.createElement("div");
    host.innerHTML = doc.body.querySelector("main")!.innerHTML;
    document.body.appendChild(host);
    let width = 640;
    const viewports = Array.from(host.querySelectorAll<HTMLElement>(".viewport"));
    for (const viewport of viewports) Object.defineProperty(viewport, "clientWidth", { configurable: true, get: () => width });
    const addListener = vi.spyOn(window, "addEventListener");
    try {
      new Function(script)();
      expect(viewports.map((v) => v.style.getPropertyValue("--scale"))).toEqual(["0.5", "0.5"]);
      width = 320;
      window.dispatchEvent(new Event("resize"));
      expect(viewports.map((v) => v.style.getPropertyValue("--scale"))).toEqual(["0.25", "0.25"]);
    } finally {
      for (const [type, listener] of addListener.mock.calls) if (type === "resize") window.removeEventListener(type, listener as EventListener);
      host.remove();
    }
  });
});

describe("exportHtml", () => {
  it("refuses to export an empty deck", async () => {
    const renderSlide = vi.fn();
    const download = vi.fn();
    await expect(exportHtml(createDeck("Empty"), { renderSlide, download })).rejects.toThrow(/at least one slide/);
    expect(renderSlide).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("renders every slide in order and downloads one HTML page named after the deck", async () => {
    const slides = [createSlide("#111111"), createSlide("#222222"), createSlide("#333333")];
    const deck = { ...createDeck("Board: Q3 <final>"), slides };
    const order: string[] = [];
    const renderSlide = vi.fn(async (slide: Slide) => {
      // Slower first slide: the output must still be in slide order.
      if (slide === slides[0]) await new Promise((r) => setTimeout(r, 5));
      order.push(slide.id);
      return `<div class="rendered">${slide.background}</div>`;
    });
    const download = vi.fn();
    await expect(exportHtml(deck, { renderSlide, download })).resolves.toBe("Board Q3 final.html");
    expect(order).toEqual(slides.map((s) => s.id));
    expect(renderSlide.mock.calls.map(([s]) => s)).toEqual(slides);
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, fileName] = download.mock.calls[0] as [Blob, string];
    expect(fileName).toBe("Board Q3 final.html");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/html;charset=utf-8");
    const doc = parse(await blobText(blob));
    expect(doc.title).toBe("Board: Q3 <final>");
    expect(Array.from(doc.querySelectorAll(".rendered")).map((n) => n.textContent)).toEqual(["#111111", "#222222", "#333333"]);
    expect(doc.querySelector("header p")?.textContent).toBe("3 slides");
  });

  it("does not download anything when a slide fails to render", async () => {
    const download = vi.fn();
    const deck = { ...createDeck("Deck"), slides: [createSlide(), createSlide()] };
    const renderSlide = vi.fn().mockResolvedValueOnce("<p>ok</p>").mockRejectedValueOnce(new Error("render failed"));
    await expect(exportHtml(deck, { renderSlide, download })).rejects.toThrow("render failed");
    expect(download).not.toHaveBeenCalled();
  });
});

describe("downloadBlob", () => {
  const createObjectURL = vi.fn(() => "blob:fake-url");
  const revokeObjectURL = vi.fn();
  const originals = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    vi.useRealTimers();
    URL.createObjectURL = originals.create;
    URL.revokeObjectURL = originals.revoke;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it("clicks a temporary download link and releases the blob URL a moment later", () => {
    const clicked: { href: string; download: string; rel: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, rel: this.rel, attached: document.body.contains(this) });
    });
    const blob = new Blob(["<p>hi</p>"], { type: "text/html" });
    const before = document.body.childElementCount;

    downloadBlob(blob, "Deck.html");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: "blob:fake-url", download: "Deck.html", rel: "noopener", attached: true }]);
    expect(document.body.childElementCount).toBe(before);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});
