import { create } from "zustand";
import { current, produce, type Draft } from "immer";
import { HISTORY_LIMIT, MAX_ELEMENTS_PER_SLIDE, MAX_SLIDES, MAX_TITLE_LENGTH } from "../constants";
import { normalizeColor } from "../color";
import { cascadePosition, cloneElement, cloneSlide, createDeck, createSlide } from "../factory";
import { applyElementPatch, elementsEqual, sanitizeElement } from "../sanitize";
import type { Deck, ElementPatch, Slide, SlideElement } from "../schema";
import type { Template } from "../templates";
import { applyOperations, type AiOperation, type AiRefs, type ApplyReport } from "../ai/apply";
import { toast } from "./toastStore";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "unavailable";
export type LayerDirection = "forward" | "backward" | "front" | "back";

interface CommitOptions {
  /** Consecutive commits with the same key within COALESCE_MS become one undo step (color drags, nudges). */
  coalesceKey?: string;
}

export interface EditorState {
  deck: Deck;
  hydrated: boolean;
  saveStatus: SaveStatus;
  selectedSlideId: string | null;
  selectedElementId: string | null;
  editingElementId: string | null;
  /** Select all text when the editor opens (freshly inserted text boxes). */
  editingSelectAll: boolean;
  past: Deck[];
  future: Deck[];
  /** Deck as it was when the current pointer/typing gesture started (null = no gesture). */
  gestureBase: Deck | null;
  clipboard: SlideElement | null;
  lastCommit: { key: string; at: number } | null;

  loadDeck: (deck: Deck) => void;
  setHydrated: () => void;
  setSaveStatus: (status: SaveStatus) => void;

  setTitle: (title: string) => void;
  addSlide: () => string | null;
  duplicateSlide: (slideId: string) => string | null;
  deleteSlide: (slideId: string) => void;
  moveSlide: (slideId: string, toIndex: number) => void;
  selectSlide: (slideId: string | null) => void;
  setSlideBackground: (slideId: string, color: string) => void;

  addElement: (slideId: string, element: SlideElement) => boolean;
  updateElement: (slideId: string, elementId: string, patch: ElementPatch, options?: CommitOptions) => void;
  updateElementLive: (slideId: string, elementId: string, patch: ElementPatch) => void;
  beginGesture: () => void;
  endGesture: () => void;
  deleteElement: (slideId: string, elementId: string) => void;
  duplicateElement: (slideId: string, elementId: string) => void;
  reorderElement: (slideId: string, elementId: string, direction: LayerDirection) => void;
  selectElement: (elementId: string | null) => void;
  setEditing: (elementId: string | null, selectAll?: boolean) => void;
  copyElement: (slideId: string, elementId: string) => void;
  pasteElement: () => boolean;

  applyTemplate: (template: Template) => void;
  applyAiOperations: (operations: AiOperation[], refs?: AiRefs) => ApplyReport;

  undo: () => void;
  redo: () => void;
}

export const COALESCE_MS = 1000;

export function getInitialEditorState() {
  return {
    deck: createDeck(),
    hydrated: false,
    saveStatus: "idle" as SaveStatus,
    selectedSlideId: null as string | null,
    selectedElementId: null as string | null,
    editingElementId: null as string | null,
    editingSelectAll: false,
    past: [] as Deck[],
    future: [] as Deck[],
    gestureBase: null as Deck | null,
    clipboard: null as SlideElement | null,
    lastCommit: null as { key: string; at: number } | null,
  };
}

function pushLimited(stack: Deck[], deck: Deck): Deck[] {
  const next = [...stack, deck];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

function findSlide(deck: Draft<Deck> | Deck, slideId: string) {
  return deck.slides.find((s) => s.id === slideId);
}

/** Keeps the selection pointing at things that still exist after the deck changed underneath it. */
export function reconcileSelection(
  deck: Deck,
  selectedSlideId: string | null,
  selectedElementId: string | null,
  previousDeck?: Deck,
) {
  let slideId = selectedSlideId;
  if (!slideId || !deck.slides.some((s) => s.id === slideId)) {
    const previousIndex = previousDeck && slideId ? previousDeck.slides.findIndex((s) => s.id === slideId) : -1;
    const index = Math.min(Math.max(previousIndex, 0), deck.slides.length - 1);
    slideId = deck.slides[index]?.id ?? null;
  }
  const slide = slideId ? deck.slides.find((s) => s.id === slideId) : undefined;
  const elementId = slide && selectedElementId && slide.elements.some((e) => e.id === selectedElementId) ? selectedElementId : null;
  return { selectedSlideId: slideId, selectedElementId: elementId };
}

export const useEditorStore = create<EditorState>((set, get) => {
  /**
   * The single entry point for undoable changes. Produces the next deck from a recipe,
   * records the previous deck in history and clears the redo stack. No-op recipes record nothing.
   */
  const commit = (recipe: (draft: Draft<Deck>) => void, options: CommitOptions = {}): boolean => {
    const state = get();
    const next = produce(state.deck, recipe);
    if (next === state.deck) return false;

    const now = Date.now();
    const coalesce =
      options.coalesceKey !== undefined &&
      state.lastCommit?.key === options.coalesceKey &&
      now - state.lastCommit.at < COALESCE_MS &&
      state.past.length > 0 &&
      !state.gestureBase;

    const base = state.gestureBase ?? state.deck;
    const stamped: Deck = { ...next, updatedAt: now };
    set({
      deck: stamped,
      past: coalesce ? state.past : pushLimited(state.past, base),
      future: [],
      // If a gesture is still running, it continues from the committed deck.
      gestureBase: state.gestureBase ? stamped : null,
      lastCommit: options.coalesceKey ? { key: options.coalesceKey, at: now } : null,
    });
    return true;
  };

  const replaceDeck = (next: Deck, selection: { selectedSlideId: string | null; selectedElementId: string | null }) => {
    const state = get();
    set({
      deck: { ...next, updatedAt: Date.now() },
      past: pushLimited(state.past, state.gestureBase ?? state.deck),
      future: [],
      gestureBase: null,
      lastCommit: null,
      editingElementId: null,
      ...selection,
    });
  };

  return {
    ...getInitialEditorState(),

    loadDeck: (deck) => {
      set({
        ...getInitialEditorState(),
        deck,
        hydrated: true,
        saveStatus: get().saveStatus,
        selectedSlideId: deck.slides[0]?.id ?? null,
      });
    },

    setHydrated: () => set({ hydrated: true }),
    setSaveStatus: (saveStatus) => set({ saveStatus }),

    setTitle: (title) => {
      commit(
        (d) => {
          d.title = title.slice(0, MAX_TITLE_LENGTH);
        },
        { coalesceKey: "title" },
      );
    },

    addSlide: () => {
      const { deck, selectedSlideId } = get();
      if (deck.slides.length >= MAX_SLIDES) {
        toast.error(`A deck can have at most ${MAX_SLIDES} slides.`);
        return null;
      }
      const currentIndex = deck.slides.findIndex((s) => s.id === selectedSlideId);
      const insertAt = currentIndex === -1 ? deck.slides.length : currentIndex + 1;
      const background = deck.slides[currentIndex]?.background;
      const slide = createSlide(background);
      commit((d) => {
        d.slides.splice(insertAt, 0, slide);
      });
      set({ selectedSlideId: slide.id, selectedElementId: null, editingElementId: null });
      return slide.id;
    },

    duplicateSlide: (slideId) => {
      const { deck } = get();
      const index = deck.slides.findIndex((s) => s.id === slideId);
      if (index === -1) return null;
      if (deck.slides.length >= MAX_SLIDES) {
        toast.error(`A deck can have at most ${MAX_SLIDES} slides.`);
        return null;
      }
      const copy = cloneSlide(deck.slides[index]);
      commit((d) => {
        d.slides.splice(index + 1, 0, copy);
      });
      set({ selectedSlideId: copy.id, selectedElementId: null, editingElementId: null });
      return copy.id;
    },

    deleteSlide: (slideId) => {
      const { deck, selectedSlideId } = get();
      const index = deck.slides.findIndex((s) => s.id === slideId);
      if (index === -1) return;
      commit((d) => {
        d.slides.splice(index, 1);
      });
      const remaining = get().deck.slides;
      if (selectedSlideId === slideId || !remaining.some((s) => s.id === selectedSlideId)) {
        const neighbor = remaining[Math.min(index, remaining.length - 1)];
        set({ selectedSlideId: neighbor?.id ?? null, selectedElementId: null, editingElementId: null });
      }
    },

    moveSlide: (slideId, toIndex) => {
      const { deck } = get();
      const from = deck.slides.findIndex((s) => s.id === slideId);
      if (from === -1) return;
      const to = Math.max(0, Math.min(deck.slides.length - 1, Math.trunc(toIndex)));
      if (from === to) return;
      commit((d) => {
        const [moved] = d.slides.splice(from, 1);
        d.slides.splice(to, 0, moved);
      });
    },

    selectSlide: (slideId) => {
      const exists = slideId === null || get().deck.slides.some((s) => s.id === slideId);
      if (!exists) return;
      get().endGesture();
      set({ selectedSlideId: slideId, selectedElementId: null, editingElementId: null });
    },

    setSlideBackground: (slideId, color) => {
      const normalized = normalizeColor(color);
      if (!normalized) return;
      commit(
        (d) => {
          const slide = findSlide(d, slideId);
          if (slide) slide.background = normalized;
        },
        { coalesceKey: `bg:${slideId}` },
      );
    },

    addElement: (slideId, element) => {
      const slide = findSlide(get().deck, slideId);
      if (!slide) return false;
      if (slide.elements.length >= MAX_ELEMENTS_PER_SLIDE) {
        toast.error(`A slide can have at most ${MAX_ELEMENTS_PER_SLIDE} elements.`);
        return false;
      }
      const placed = sanitizeElement(cascadePosition(element, slide.elements));
      commit((d) => {
        findSlide(d, slideId)?.elements.push(placed);
      });
      set({ selectedSlideId: slideId, selectedElementId: placed.id, editingElementId: null });
      return true;
    },

    updateElement: (slideId, elementId, patch, options) => {
      commit((d) => {
        const slide = findSlide(d, slideId);
        const index = slide?.elements.findIndex((e) => e.id === elementId) ?? -1;
        if (!slide || index === -1) return;
        const existing = current(slide.elements[index]) as SlideElement;
        const next = applyElementPatch(existing, patch);
        if (!elementsEqual(existing, next)) slide.elements[index] = next;
      }, options);
    },

    updateElementLive: (slideId, elementId, patch) => {
      const state = get();
      const next = produce(state.deck, (d) => {
        const slide = findSlide(d, slideId);
        const index = slide?.elements.findIndex((e) => e.id === elementId) ?? -1;
        if (!slide || index === -1) return;
        const existing = current(slide.elements[index]) as SlideElement;
        const next = applyElementPatch(existing, patch);
        if (!elementsEqual(existing, next)) slide.elements[index] = next;
      });
      if (next === state.deck) return;
      set({ deck: next, gestureBase: state.gestureBase ?? state.deck });
    },

    beginGesture: () => {
      if (!get().gestureBase) set({ gestureBase: get().deck });
    },

    endGesture: () => {
      const { gestureBase, deck, past } = get();
      if (!gestureBase) return;
      if (gestureBase === deck) {
        set({ gestureBase: null });
        return;
      }
      set({
        gestureBase: null,
        deck: { ...deck, updatedAt: Date.now() },
        past: pushLimited(past, gestureBase),
        future: [],
        lastCommit: null,
      });
    },

    deleteElement: (slideId, elementId) => {
      commit((d) => {
        const slide = findSlide(d, slideId);
        if (!slide) return;
        const index = slide.elements.findIndex((e) => e.id === elementId);
        if (index !== -1) slide.elements.splice(index, 1);
      });
      const { selectedElementId, editingElementId } = get();
      set({
        selectedElementId: selectedElementId === elementId ? null : selectedElementId,
        editingElementId: editingElementId === elementId ? null : editingElementId,
      });
    },

    duplicateElement: (slideId, elementId) => {
      const slide = findSlide(get().deck, slideId);
      const element = slide?.elements.find((e) => e.id === elementId);
      if (!slide || !element) return;
      get().addElement(slideId, cloneElement(element));
    },

    reorderElement: (slideId, elementId, direction) => {
      commit((d) => {
        const slide = findSlide(d, slideId);
        if (!slide) return;
        const from = slide.elements.findIndex((e) => e.id === elementId);
        if (from === -1) return;
        const last = slide.elements.length - 1;
        const to =
          direction === "front" ? last : direction === "back" ? 0 : direction === "forward" ? Math.min(last, from + 1) : Math.max(0, from - 1);
        if (to === from) return;
        const [moved] = slide.elements.splice(from, 1);
        slide.elements.splice(to, 0, moved);
      });
    },

    selectElement: (elementId) => {
      const { editingElementId } = get();
      set({ selectedElementId: elementId, editingElementId: editingElementId === elementId ? editingElementId : null });
    },

    setEditing: (elementId, selectAll = false) => {
      set(
        elementId
          ? { editingElementId: elementId, selectedElementId: elementId, editingSelectAll: selectAll }
          : { editingElementId: null, editingSelectAll: false },
      );
    },

    copyElement: (slideId, elementId) => {
      const element = findSlide(get().deck, slideId)?.elements.find((e) => e.id === elementId);
      if (element) set({ clipboard: structuredClone(element) });
    },

    pasteElement: () => {
      const { clipboard, selectedSlideId } = get();
      if (!clipboard || !selectedSlideId) return false;
      return get().addElement(selectedSlideId, cloneElement(clipboard));
    },

    applyTemplate: (template) => {
      const slides: Slide[] = template.slides.map((s) => cloneSlide(s));
      const { deck } = get();
      replaceDeck(
        { ...deck, title: template.name.slice(0, MAX_TITLE_LENGTH), slides },
        { selectedSlideId: slides[0]?.id ?? null, selectedElementId: null },
      );
    },

    applyAiOperations: (operations, refs) => {
      get().endGesture();
      const state = get();
      const result = applyOperations(state.deck, operations, state.selectedSlideId, refs);
      if (result.report.applied === 0) return result.report;
      const selection = reconcileSelection(result.deck, result.focusSlideId ?? state.selectedSlideId, state.selectedElementId, state.deck);
      replaceDeck(result.deck, selection);
      return result.report;
    },

    undo: () => {
      get().endGesture();
      const { past, deck, future, selectedSlideId, selectedElementId } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({
        deck: previous,
        past: past.slice(0, -1),
        future: [deck, ...future].slice(0, HISTORY_LIMIT),
        editingElementId: null,
        lastCommit: null,
        ...reconcileSelection(previous, selectedSlideId, selectedElementId, deck),
      });
    },

    redo: () => {
      get().endGesture();
      const { past, deck, future, selectedSlideId, selectedElementId } = get();
      const next = future[0];
      if (!next) return;
      set({
        deck: next,
        past: pushLimited(past, deck),
        future: future.slice(1),
        editingElementId: null,
        lastCommit: null,
        ...reconcileSelection(next, selectedSlideId, selectedElementId, deck),
      });
    },
  };
});

/** Convenience selector for the currently selected slide. */
export function selectCurrentSlide(state: EditorState): Slide | null {
  return state.deck.slides.find((s) => s.id === state.selectedSlideId) ?? null;
}

export function selectCurrentElement(state: EditorState): SlideElement | null {
  const slide = selectCurrentSlide(state);
  return slide?.elements.find((e) => e.id === state.selectedElementId) ?? null;
}
