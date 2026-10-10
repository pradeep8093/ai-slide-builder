import { FONT_FAMILIES, SLIDE_HEIGHT, SLIDE_WIDTH } from "../constants";
import type { Deck, SlideElement } from "../schema";
import type { AiRefs } from "./apply";

export const MAX_DECK_CONTEXT_CHARS = 60_000;

type AiElementView = Record<string, unknown> & { id: string; type: string };

export interface AiSlideView {
  id: string;
  number: number;
  background?: string;
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

function elementView(element: SlideElement, ref: string, level: "full" | "brief"): AiElementView {
  const box = { id: ref, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height };
  switch (element.type) {
    case "text": {
      const { text, fontSize, fontFamily, color, bold, italic, underline, align } = element;
      return { ...box, text: level === "full" ? text : truncate(text, 160), fontSize, fontFamily, color, bold, italic, underline, align };
    }
    case "shape":
      return { ...box, shape: element.shape, fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth };
    case "image":
      return { ...box, alt: element.alt };
    case "chart": {
      const base = { ...box, chartType: element.chartType, title: element.title, showLegend: element.showLegend };
      return level === "full"
        ? { ...base, categories: element.categories, series: element.series }
        : { ...base, dataOmitted: true };
    }
  }
}

function firstText(slideElements: SlideElement[]): string {
  const text = slideElements.find((e) => e.type === "text" && e.text.trim());
  return text && text.type === "text" ? truncate(text.text.replace(/\s+/g, " ").trim(), 80) : "";
}

/**
 * Builds the compact, image-free view of the deck the model sees, plus a table mapping the short
 * references it uses (S1, E1…) back to real ids. Large decks are abbreviated step by step so the
 * request stays within budget; the selected slide is always sent in full.
 */
export function serializeDeckForAi(
  deck: Deck,
  selectedSlideId: string | null,
  maxChars: number = MAX_DECK_CONTEXT_CHARS,
): { context: AiDeckContext; refs: AiRefs } {
  const refs: AiRefs = { slides: {}, elements: {} };
  let elementCounter = 0;
  const slideRefs = deck.slides.map((slide, index) => {
    const ref = `S${index + 1}`;
    refs.slides[ref] = slide.id;
    const elementRefs = slide.elements.map((element) => {
      elementCounter += 1;
      const elementRef = `E${elementCounter}`;
      refs.elements[elementRef] = { slideId: slide.id, elementId: element.id };
      return elementRef;
    });
    return { ref, elementRefs };
  });

  const selectedIndex = deck.slides.findIndex((s) => s.id === selectedSlideId);
  const build = (level: 0 | 1 | 2 | 3): AiDeckContext => ({
    title: deck.title,
    slideCount: deck.slides.length,
    selectedSlide: selectedIndex === -1 ? null : slideRefs[selectedIndex].ref,
    slides: deck.slides.map((slide, index) => {
      const { ref, elementRefs } = slideRefs[index];
      const isSelected = index === selectedIndex;
      if (level >= 2 && !isSelected) {
        return { id: ref, number: index + 1, elementsOmitted: true, summary: firstText(slide.elements) };
      }
      const detail = level === 0 || (isSelected && level < 3) ? "full" : "brief";
      return {
        id: ref,
        number: index + 1,
        background: slide.background,
        elements: slide.elements.map((element, ei) => elementView(element, elementRefs[ei], detail)),
      };
    }),
  });

  let context = build(0);
  for (const level of [1, 2, 3] as const) {
    if (JSON.stringify(context).length <= maxChars) break;
    context = build(level);
  }
  return { context, refs };
}

export function buildSystemPrompt(context: AiDeckContext): string {
  return `You are the AI editing assistant inside a slide editor. You change the user's deck by returning operations, and you explain what you did in "reply".

CANVAS
- Every slide is ${SLIDE_WIDTH} x ${SLIDE_HEIGHT} px. (0,0) is the top-left corner; x grows to the right, y grows downward.
- Elements are absolutely positioned boxes {x, y, width, height}. Keep them fully inside the slide.
- Keep at least 64 px between text and the slide edges. Don't let text boxes overlap each other.
- Elements later in a slide's list are drawn on top of earlier ones.

ELEMENTS
- text: plain text only (no markdown/HTML). Use "\\n" for line breaks and start bullet lines with "• ". fontSize is in px: titles 44-60, subtitles 24-32, body 20-28, never below 14. fontFamily is one of: ${FONT_FAMILIES.join(", ")}. Make the box tall enough for the text: roughly fontSize x 1.3 x number of lines.
- shape: rectangle, rounded-rectangle, ellipse, triangle, arrow (block arrow pointing right) or line (horizontal line through the middle of its box; its color is the stroke). fill and stroke are "#rrggbb" or "none"; null means the default. strokeWidth is in px.
- chart: bar, line, area or pie. "categories" are the labels; "series" is a list of {name, values} with exactly one number per category. Pie charts only use the first series. At most 24 categories and 8 series.
- image: only the user can add images. You may move, resize, change alt text of, or delete existing images.
- Colors are always "#rrggbb". Choose text colors that contrast with the slide background.

REFERENCES
- Slides are referenced by ids like "S2" and elements by ids like "E7", exactly as they appear in CURRENT DECK. Never make up ids. New slides and elements don't need ids.
- Positions are 1-based slide numbers. add_slide with position null appends at the end. Operations run in order, so positions refer to the deck as it is after the earlier operations.
- Slides marked "elementsOmitted" were abbreviated to save space; you can still move or delete them, but don't guess their element ids.

OPERATIONS
- set_title: rename the presentation.
- add_slide: create a complete slide in one operation, including all of its elements.
- delete_slide, move_slide, set_slide_background.
- add_element: add one element to an existing slide.
- update_element: every key of "changes" must be present; use null for everything you are not changing.
- delete_element.

BEHAVIOUR
- Do what the user asked and nothing more. "This slide" or "the current slide" means selectedSlide.
- When building a deck on an empty deck, also set the title and keep a consistent style (same background, fonts and title position on every slide).
- Never invent facts, statistics, names, quotes or numbers about real people, companies or events. When content needs specifics you don't have, use clear placeholders such as "[Company name]" or "[Add metric]". Chart values you make up must be described as placeholder values in your reply.
- If the request is unclear or impossible (for example adding a photo), return an empty operations list and explain or ask one short question in "reply".
- "reply" is 1-3 short plain-text sentences summarising what you changed, or your question.

CURRENT DECK
${JSON.stringify(context)}`;
}
