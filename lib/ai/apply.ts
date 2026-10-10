import { current, produce, type Draft } from "immer";
import { MAX_ELEMENTS_PER_SLIDE, MAX_NOTES_LENGTH, MAX_SLIDES, MAX_TITLE_LENGTH } from "../constants";
import { normalizeColor } from "../color";
import { createChartElement, createShapeElement, createSlide, createTableElement, createTextElement } from "../factory";
import { applyElementPatch, elementsEqual, sanitizeElement } from "../sanitize";
import type { Deck, ElementPatch, Slide, SlideElement } from "../schema";
import type { AiElementChanges, AiElementSpec, AiOperation } from "./schema";

export type { AiOperation } from "./schema";

/** Maps the short references the model sees (S1, E3…) back to real ids. */
export interface AiRefs {
  slides: Record<string, string>;
  elements: Record<string, { slideId: string; elementId: string }>;
}

export interface ApplyReport {
  applied: number;
  changes: string[];
  skipped: { op: string; reason: string }[];
  /** Slides and elements that were added or changed (for the highlight in the editor). */
  touchedSlideIds: string[];
  touchedElementIds: string[];
}

export const MAX_OPERATIONS = 300;

class SkipError extends Error {}

const EMPTY_REFS: AiRefs = { slides: {}, elements: {} };

/** "none" means transparent / no border; null means "use the default". */
function colorOrNone(value: string | null, fallback: string | null): string | null {
  if (value === null) return fallback;
  if (value.trim().toLowerCase() === "none" || value.trim().toLowerCase() === "transparent") return null;
  return normalizeColor(value) ?? fallback;
}

function present<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

export function elementFromSpec(spec: AiElementSpec): SlideElement {
  const geometry = { x: spec.x, y: spec.y, width: spec.width, height: spec.height };
  switch (spec.type) {
    case "text": {
      const base = createTextElement();
      return applyElementPatch(base, {
        ...geometry,
        text: spec.text,
        fontSize: present(spec.fontSize),
        fontFamily: present(spec.fontFamily),
        color: present(spec.color) ?? undefined,
        bold: present(spec.bold),
        italic: present(spec.italic),
        underline: present(spec.underline),
        align: present(spec.align),
      });
    }
    case "shape": {
      const base = createShapeElement(spec.shape);
      return applyElementPatch(base, {
        ...geometry,
        fill: colorOrNone(spec.fill, base.fill),
        stroke: colorOrNone(spec.stroke, base.stroke),
        strokeWidth: present(spec.strokeWidth),
      });
    }
    case "chart": {
      const base = createChartElement(spec.chartType);
      return applyElementPatch(base, {
        ...geometry,
        title: spec.title ?? "",
        categories: spec.categories,
        series: spec.series,
        showLegend: present(spec.showLegend),
        stacked: present(spec.stacked),
        showValues: present(spec.showValues),
        dualAxis: present(spec.dualAxis),
      });
    }
    case "table": {
      const base = createTableElement();
      return applyElementPatch(base, {
        ...geometry,
        rows: spec.rows.length > 0 ? spec.rows : base.rows,
        headerRow: present(spec.headerRow),
        fontSize: present(spec.fontSize),
      });
    }
  }
}

function changesToPatch(changes: AiElementChanges, element: SlideElement): ElementPatch {
  const patch: ElementPatch = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) continue;
    if (key === "fill" || key === "stroke" || key === "headerFill" || key === "borderColor") {
      const existing = (element as unknown as Record<string, string | null | undefined>)[key] ?? null;
      (patch as Record<string, unknown>)[key] = colorOrNone(value as string, existing);
    } else {
      (patch as Record<string, unknown>)[key] = value;
    }
  }
  return patch;
}

function describe(element: SlideElement): string {
  switch (element.type) {
    case "text":
      return "text";
    case "shape":
      return element.shape.replace("-", " ");
    case "image":
      return "image";
    case "chart":
      return `${element.chartType} chart`;
    case "table":
      return "table";
  }
}

/**
 * Applies model-proposed operations to a deck, in order. Each operation is validated against
 * the *current* deck; invalid ones (unknown ids, locked elements, limits reached) are skipped and
 * reported instead of aborting the whole batch. The input deck is never mutated.
 */
export function applyOperations(
  deck: Deck,
  operations: AiOperation[],
  _selectedSlideId: string | null,
  refs: AiRefs = EMPTY_REFS,
): { deck: Deck; report: ApplyReport; focusSlideId: string | null } {
  const report: ApplyReport = { applied: 0, changes: [], skipped: [], touchedSlideIds: [], touchedElementIds: [] };
  const touchedSlides = new Set<string>();
  const touchedElements = new Set<string>();
  let focusSlideId: string | null = null;

  const list = operations.slice(0, MAX_OPERATIONS);
  if (operations.length > MAX_OPERATIONS) {
    report.skipped.push({ op: "batch", reason: `Only the first ${MAX_OPERATIONS} changes were applied.` });
  }

  const next = produce(deck, (draft) => {
    const slideIndex = (ref: string) => {
      const id = refs.slides[ref] ?? ref;
      const index = draft.slides.findIndex((s) => s.id === id);
      if (index === -1) throw new SkipError(`slide ${ref} wasn't found`);
      return index;
    };
    const locateElement = (ref: string) => {
      const mapped = refs.elements[ref];
      const elementId = mapped?.elementId ?? ref;
      for (let si = 0; si < draft.slides.length; si += 1) {
        const ei = draft.slides[si].elements.findIndex((e) => e.id === elementId);
        if (ei !== -1) {
          if (draft.slides[si].elements[ei].locked) throw new SkipError(`element ${ref} is locked`);
          return { slide: draft.slides[si], index: ei, slideNumber: si + 1 };
        }
      }
      throw new SkipError(`element ${ref} wasn't found`);
    };
    const pushElement = (slide: Draft<Slide>, element: SlideElement) => {
      if (slide.elements.length >= MAX_ELEMENTS_PER_SLIDE) {
        throw new SkipError(`a slide can have at most ${MAX_ELEMENTS_PER_SLIDE} elements`);
      }
      slide.elements.push(sanitizeElement(element));
    };

    for (const op of list) {
      try {
        switch (op.op) {
          case "set_title": {
            const title = op.title.trim().slice(0, MAX_TITLE_LENGTH);
            if (title === draft.title) throw new SkipError("title unchanged");
            draft.title = title;
            report.changes.push(`Renamed the deck to “${title || "Untitled"}”`);
            break;
          }
          case "add_slide": {
            if (draft.slides.length >= MAX_SLIDES) throw new SkipError(`a deck can have at most ${MAX_SLIDES} slides`);
            const slide = createSlide(normalizeColor(op.background ?? "") ?? "#ffffff", (op.notes ?? "").slice(0, MAX_NOTES_LENGTH));
            const elements = op.elements.slice(0, MAX_ELEMENTS_PER_SLIDE).map((spec) => sanitizeElement(elementFromSpec(spec)));
            const index =
              op.position === null ? draft.slides.length : Math.max(0, Math.min(draft.slides.length, Math.trunc(op.position) - 1));
            draft.slides.splice(index, 0, { ...slide, elements });
            focusSlideId = slide.id;
            touchedSlides.add(slide.id);
            for (const el of elements) touchedElements.add(el.id);
            report.changes.push(`Added slide ${index + 1}`);
            break;
          }
          case "delete_slide": {
            const index = slideIndex(op.slideId);
            if (draft.slides[index].elements.some((e) => e.locked)) throw new SkipError(`slide ${op.slideId} has locked elements`);
            draft.slides.splice(index, 1);
            report.changes.push(`Deleted slide ${index + 1}`);
            break;
          }
          case "move_slide": {
            const from = slideIndex(op.slideId);
            const to = Math.max(0, Math.min(draft.slides.length - 1, Math.trunc(op.position) - 1));
            if (from === to) throw new SkipError("slide already at that position");
            const [moved] = draft.slides.splice(from, 1);
            draft.slides.splice(to, 0, moved);
            focusSlideId = moved.id;
            touchedSlides.add(moved.id);
            report.changes.push(`Moved slide ${from + 1} to position ${to + 1}`);
            break;
          }
          case "set_slide_background": {
            const index = slideIndex(op.slideId);
            const color = normalizeColor(op.background);
            if (!color) throw new SkipError(`“${op.background}” is not a valid color`);
            draft.slides[index].background = color;
            focusSlideId = draft.slides[index].id;
            touchedSlides.add(draft.slides[index].id);
            report.changes.push(`Changed the background of slide ${index + 1}`);
            break;
          }
          case "set_slide_notes": {
            const index = slideIndex(op.slideId);
            const notes = op.notes.slice(0, MAX_NOTES_LENGTH);
            if (draft.slides[index].notes === notes) throw new SkipError("notes unchanged");
            draft.slides[index].notes = notes;
            focusSlideId = draft.slides[index].id;
            touchedSlides.add(draft.slides[index].id);
            report.changes.push(`Updated the speaker notes of slide ${index + 1}`);
            break;
          }
          case "add_element": {
            const index = slideIndex(op.slideId);
            const element = elementFromSpec(op.element);
            pushElement(draft.slides[index], element);
            focusSlideId = draft.slides[index].id;
            touchedSlides.add(draft.slides[index].id);
            touchedElements.add(element.id);
            report.changes.push(`Added ${describe(element)} to slide ${index + 1}`);
            break;
          }
          case "update_element": {
            const { slide, index, slideNumber } = locateElement(op.elementId);
            const plain = current(slide.elements[index]) as SlideElement;
            const updated = applyElementPatch(plain, changesToPatch(op.changes, plain));
            if (elementsEqual(updated, plain)) throw new SkipError("nothing to change");
            slide.elements[index] = updated;
            focusSlideId = slide.id;
            touchedSlides.add(slide.id);
            touchedElements.add(updated.id);
            report.changes.push(`Updated ${describe(updated)} on slide ${slideNumber}`);
            break;
          }
          case "delete_element": {
            const { slide, index, slideNumber } = locateElement(op.elementId);
            const [removed] = slide.elements.splice(index, 1);
            focusSlideId = slide.id;
            touchedSlides.add(slide.id);
            report.changes.push(`Removed ${describe(removed as SlideElement)} from slide ${slideNumber}`);
            break;
          }
        }
        report.applied += 1;
      } catch (error) {
        if (!(error instanceof SkipError)) throw error;
        report.skipped.push({ op: op.op, reason: error.message });
      }
    }
  });

  // Only report things that still exist (a later operation may have deleted them).
  const slideIds = new Set(next.slides.map((s) => s.id));
  const elementIds = new Set(next.slides.flatMap((s) => s.elements.map((e) => e.id)));
  report.touchedSlideIds = [...touchedSlides].filter((id) => slideIds.has(id));
  report.touchedElementIds = [...touchedElements].filter((id) => elementIds.has(id));
  return { deck: next, report, focusSlideId: focusSlideId && slideIds.has(focusSlideId) ? focusSlideId : null };
}
