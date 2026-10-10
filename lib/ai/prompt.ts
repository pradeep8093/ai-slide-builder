import { CHART_KINDS, FONT_FAMILIES, MAX_TABLE_COLS, MAX_TABLE_ROWS, SLIDE_HEIGHT, SLIDE_WIDTH } from "../constants";
import type { Deck, Slide, SlideElement } from "../schema";
import type { AiRefs } from "./apply";

/** Default size budget for the deck part of a request (≈ 24k tokens at ~4 characters per token). */
export const MAX_DECK_CONTEXT_CHARS = 96_000;

type AiElementView = Record<string, unknown> & { id: string; type: string };

export interface AiSlideView {
  id: string;
  number: number;
  background?: string;
  notes?: string;
  elements?: AiElementView[];
  /** Present when the slide was abbreviated to fit the context budget. */
  elementsOmitted?: boolean;
  summary?: string;
}

export interface AiDeckContext {
  title: string;
  slideCount: number;
  selectedSlide: string | null;
  slides: AiSlideView[];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

type Detail = "full" | "brief";

function elementView(element: SlideElement, ref: string, detail: Detail, groupRef: string | undefined): AiElementView {
  const box: AiElementView = { id: ref, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height };
  if (element.locked) box.locked = true;
  if (groupRef) box.group = groupRef;
  switch (element.type) {
    case "text": {
      const { text, fontSize, fontFamily, color, bold, italic, underline, align } = element;
      return { ...box, text: detail === "full" ? text : truncate(text, 160), fontSize, fontFamily, color, bold, italic, underline, align };
    }
    case "shape":
      return { ...box, shape: element.shape, fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth };
    case "image":
      return { ...box, alt: element.alt };
    case "chart": {
      const base = {
        ...box,
        chartType: element.chartType,
        title: element.title,
        showLegend: element.showLegend,
        stacked: Boolean(element.stacked),
        showValues: Boolean(element.showValues),
        dualAxis: Boolean(element.dualAxis),
      };
      return detail === "full" ? { ...base, categories: element.categories, series: element.series } : { ...base, dataOmitted: true };
    }
    case "table": {
      const base = { ...box, headerRow: element.headerRow, fontSize: element.fontSize, headerFill: element.headerFill, borderColor: element.borderColor };
      return detail === "full"
        ? { ...base, rows: element.rows }
        : { ...base, rows: element.rows.slice(0, 2).map((r) => r.map((c) => truncate(c, 40))), rowsOmitted: Math.max(0, element.rows.length - 2) };
    }
  }
}

function firstText(elements: SlideElement[]): string {
  const text = elements.find((e) => e.type === "text" && e.text.trim());
  return text && text.type === "text" ? truncate(text.text.replace(/\s+/g, " ").trim(), 80) : "";
}

/** One-line description of an abbreviated slide: its first text plus what it contains. */
export function summarizeSlide(slide: Slide): string {
  const counts = new Map<string, number>();
  for (const el of slide.elements) {
    const kind = el.type === "shape" ? "shape" : el.type;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const contents = [...counts.entries()].map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`).join(", ");
  const title = firstText(slide.elements);
  if (!title && !contents) return "empty slide";
  return [title && `“${title}”`, contents].filter(Boolean).join(" — ");
}

/**
 * Builds the compact, image-free view of the deck the model sees, plus a table mapping the short
 * references it uses (S1, E1…) back to real ids. Large decks are abbreviated step by step so the
 * request stays within budget; the selected slide is always kept in the most detail that fits.
 */
export function serializeDeckForAi(
  deck: Deck,
  selectedSlideId: string | null,
  maxChars: number = MAX_DECK_CONTEXT_CHARS,
): { context: AiDeckContext; refs: AiRefs } {
  const refs: AiRefs = { slides: {}, elements: {} };
  const groupRefs = new Map<string, string>();
  let elementCounter = 0;
  const slideRefs = deck.slides.map((slide, index) => {
    const ref = `S${index + 1}`;
    refs.slides[ref] = slide.id;
    const elementRefs = slide.elements.map((element) => {
      elementCounter += 1;
      const elementRef = `E${elementCounter}`;
      refs.elements[elementRef] = { slideId: slide.id, elementId: element.id };
      if (element.groupId && !groupRefs.has(element.groupId)) groupRefs.set(element.groupId, `G${groupRefs.size + 1}`);
      return elementRef;
    });
    return { ref, elementRefs };
  });

  const selectedIndex = deck.slides.findIndex((s) => s.id === selectedSlideId);
  // Level 0: everything. 1: other slides brief. 2: other slides summarized. 3: selected slide brief too.
  const build = (level: 0 | 1 | 2 | 3): AiDeckContext => ({
    title: deck.title,
    slideCount: deck.slides.length,
    selectedSlide: selectedIndex === -1 ? null : slideRefs[selectedIndex].ref,
    slides: deck.slides.map((slide, index) => {
      const { ref, elementRefs } = slideRefs[index];
      const isSelected = index === selectedIndex;
      if (level >= 2 && !isSelected) {
        return { id: ref, number: index + 1, elementsOmitted: true, summary: summarizeSlide(slide) };
      }
      const detail: Detail = level === 0 || (isSelected && level < 3) ? "full" : "brief";
      const view: AiSlideView = {
        id: ref,
        number: index + 1,
        background: slide.background,
        elements: slide.elements.map((element, ei) => elementView(element, elementRefs[ei], detail, element.groupId ? groupRefs.get(element.groupId) : undefined)),
      };
      if (slide.notes) view.notes = detail === "full" ? slide.notes : truncate(slide.notes, 200);
      return view;
    }),
  });

  let context = build(0);
  for (const level of [1, 2, 3] as const) {
    if (JSON.stringify(context).length <= maxChars) break;
    context = build(level);
  }
  return { context, refs };
}

export function buildSystemPrompt(context: AiDeckContext, digest?: string | null): string {
  const earlier = digest?.trim()
    ? `

EARLIER IN THIS CONVERSATION (condensed; older messages are not shown in full)
${digest.trim()}`
    : "";
  return `You are the AI editing assistant inside a slide editor. You change the user's deck by returning operations, and you explain what you did in "reply".

CANVAS
- Every slide is ${SLIDE_WIDTH} x ${SLIDE_HEIGHT} px. (0,0) is the top-left corner; x grows to the right, y grows downward.
- Elements are absolutely positioned boxes {x, y, width, height}. Keep them fully inside the slide.
- Keep at least 64 px between text and the slide edges. Don't let text boxes overlap each other.
- Elements later in a slide's list are drawn on top of earlier ones.

ELEMENTS
- text: plain text only (no markdown/HTML). Use "\\n" for line breaks and start bullet lines with "• ". fontSize is in px: titles 44-60, subtitles 24-32, body 20-28, never below 14. fontFamily is one of: ${FONT_FAMILIES.join(", ")}. Make the box tall enough for the text: roughly fontSize x 1.3 x number of lines.
- shape: rectangle, rounded-rectangle, ellipse, triangle, arrow (block arrow pointing right) or line (horizontal line through the middle of its box; its color is the stroke). fill and stroke are "#rrggbb" or "none"; null means the default. strokeWidth is in px.
- chart: chartType is one of ${CHART_KINDS.join(", ")}. "categories" are the labels (for scatter: the X values, which must be numbers written as strings); "series" is a list of {name, values} with exactly one number per category. Pie and doughnut charts only use the first series. At most 24 categories and 8 series. stacked (bar charts with 2+ series), showValues (value labels) and dualAxis (bar/line charts with 2+ series: the last series gets its own axis on the right) are true/false; null keeps the default (off).
- table: "rows" is a list of rows, each a list of cell texts; every row has the same number of cells (at most ${MAX_TABLE_ROWS} rows and ${MAX_TABLE_COLS} columns). headerRow styles the first row as a header. Height is split evenly between rows, so allow about fontSize x 2 px per row.
- image: only the user can add images. You may move, resize, change alt text of, or delete existing images.
- Colors are always "#rrggbb". Choose text colors that contrast with the slide background.
- Elements with "locked": true are protected: never update, move or delete them, and don't delete slides that contain them.
- Elements with the same "group" value belong together; if you move one, move the others by the same amount.
- Each slide can have speaker "notes" (plain text the presenter reads; the audience doesn't see them).

REFERENCES
- Slides are referenced by ids like "S2" and elements by ids like "E7", exactly as they appear in CURRENT DECK. Never make up ids. New slides and elements don't need ids.
- Positions are 1-based slide numbers. add_slide with position null appends at the end. Operations run in order, so positions refer to the deck as it is after the earlier operations.
- Slides marked "elementsOmitted" were abbreviated to save space; you can still move or delete them, but don't guess their element ids. Charts marked "dataOmitted" and tables with "rowsOmitted" were shortened the same way: don't rewrite their data unless asked.

OPERATIONS
- set_title: rename the presentation.
- add_slide: create a complete slide in one operation, including all of its elements and its notes (null for none).
- delete_slide, move_slide, set_slide_background, set_slide_notes.
- add_element: add one element to an existing slide.
- update_element: every key of "changes" must be present; use null for everything you are not changing.
- delete_element.

BEHAVIOUR
- Do what the user asked and nothing more. "This slide" or "the current slide" means selectedSlide.
- When building a deck on an empty deck, also set the title and keep a consistent style (same background, fonts and title position on every slide).
- Never invent facts, statistics, names, quotes or numbers about real people, companies or events. When content needs specifics you don't have, use clear placeholders such as "[Company name]" or "[Add metric]". Chart and table values you make up must be described as placeholder values in your reply.
- If the request is unclear or impossible (for example adding a photo), return an empty operations list and explain or ask one short question in "reply".
- "reply" is 1-3 short plain-text sentences summarising what you changed, or your question.${earlier}

CURRENT DECK
${JSON.stringify(context)}`;
}
