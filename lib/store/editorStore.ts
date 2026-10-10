import { create } from "zustand";
import { current, produce, type Draft } from "immer";
import { HISTORY_LIMIT, MAX_ELEMENTS_PER_SLIDE, MAX_NOTES_LENGTH, MAX_SLIDES, MAX_TITLE_LENGTH } from "../constants";
import { normalizeColor } from "../color";
import { cascadeGroup, cascadePosition, cloneElements, cloneSlide, createDeck, createSlide } from "../factory";
import { createId } from "../ids";
import { applyElementPatch, elementsEqual, isGeometryKey, sanitizeElement } from "../sanitize";
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

/** Elements and slides the AI just changed, briefly highlighted in the editor. */
export interface AiHighlight {
  slideIds: string[];
  elementIds: string[];
  /** Changes on every AI update so the highlight animation restarts. */
  token: string;
}

export interface EditorState {
  deck: Deck;
  hydrated: boolean;
  saveStatus: SaveStatus;
  selectedSlideId: string | null;
  /** Selected elements on the selected slide (groups are always selected as a whole). */
  selectedElementIds: string[];
  editingElementId: string | null;
  /** Select all text when the editor opens (freshly inserted text boxes). */
  editingSelectAll: boolean;
  past: Deck[];
  future: Deck[];
  /** Deck as it was when the current pointer/typing gesture started (null = no gesture). */
  gestureBase: Deck | null;
  lastCommit: { key: string; at: number } | null;
  aiHighlight: AiHighlight | null;

  loadDeck: (deck: Deck) => void;
  setHydrated: () => void;
  setSaveStatus: (status: SaveStatus) => void;

  setTitle: (title: string) => void;
  /** Inserts a blank slide at `index` (default: after the selected slide) and selects it. */
  addSlide: (index?: number) => string | null;
  /** Inserts copies of slides at `index` (default: after the selected slide) and selects the first. */
  insertSlides: (slides: Slide[], index?: number) => string[];
  duplicateSlide: (slideId: string) => string | null;
  deleteSlide: (slideId: string) => void;
  moveSlide: (slideId: string, toIndex: number) => void;
  selectSlide: (slideId: string | null) => void;
  setSlideBackground: (slideId: string, color: string) => void;
  setSlideNotes: (slideId: string, notes: string) => void;

  addElement: (slideId: string, element: SlideElement) => boolean;
  /** Adds copies of several elements, keeping their arrangement, and selects them. */
  addElements: (slideId: string, elements: SlideElement[]) => boolean;
  updateElement: (slideId: string, elementId: string, patch: ElementPatch, options?: CommitOptions) => void;
  updateElementLive: (slideId: string, elementId: string, patch: ElementPatch) => void;
  updateElementsLive: (slideId: string, patches: Record<string, ElementPatch>) => void;
  beginGesture: () => void;
  endGesture: () => void;
  deleteElement: (slideId: string, elementId: string) => void;
  /** Deletes the unlocked elements among `ids`; returns how many were deleted. */
  deleteElements: (slideId: string, ids: string[]) => number;
  duplicateElement: (slideId: string, elementId: string) => void;
  duplicateElements: (slideId: string, ids: string[]) => void;
  reorderElement: (slideId: string, elementId: string, direction: LayerDirection) => void;
  reorderElements: (slideId: string, ids: string[], direction: LayerDirection) => void;
  /** Moves elements by (dx, dy); refuses (returns false) if any of them is locked. */
  nudgeElements: (slideId: string, ids: string[], dx: number, dy: number) => boolean;
  groupElements: (slideId: string, ids: string[]) => boolean;
  ungroupElements: (slideId: string, ids: string[]) => boolean;
  setElementsLocked: (slideId: string, ids: string[], locked: boolean) => void;

  selectElement: (elementId: string | null) => void;
  toggleElementSelection: (elementId: string) => void;
  selectElements: (elementIds: string[], options?: { add?: boolean }) => void;
  selectAllElements: () => void;
  setEditing: (elementId: string | null, selectAll?: boolean) => void;

  applyTemplate: (template: Template) => void;
  applyAiOperations: (operations: AiOperation[], refs?: AiRefs) => ApplyReport;
  clearAiHighlight: () => void;

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
    selectedElementIds: [] as string[],
    editingElementId: null as string | null,
    editingSelectAll: false,
    past: [] as Deck[],
    future: [] as Deck[],
    gestureBase: null as Deck | null,
    lastCommit: null as { key: string; at: number } | null,
    aiHighlight: null as AiHighlight | null,
  };
}

function pushLimited(stack: Deck[], deck: Deck): Deck[] {
  const next = [...stack, deck];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

function findSlide(deck: Draft<Deck> | Deck, slideId: string) {
  return deck.slides.find((s) => s.id === slideId);
}

/** Adds every member of the groups of the given elements, in slide order. */
export function expandToGroups(slide: Slide | undefined, ids: string[]): string[] {
  if (!slide) return [];
  const wanted = new Set(ids);
  const groups = new Set(slide.elements.filter((e) => wanted.has(e.id) && e.groupId).map((e) => e.groupId));
  return slide.elements.filter((e) => wanted.has(e.id) || (e.groupId && groups.has(e.groupId))).map((e) => e.id);
}

/** Keeps the selection pointing at things that still exist after the deck changed underneath it. */
export function reconcileSelection(deck: Deck, selectedSlideId: string | null, selectedElementIds: string[], previousDeck?: Deck) {
  let slideId = selectedSlideId;
  if (!slideId || !deck.slides.some((s) => s.id === slideId)) {
    const previousIndex = previousDeck && slideId ? previousDeck.slides.findIndex((s) => s.id === slideId) : -1;
    const index = Math.min(Math.max(previousIndex, 0), deck.slides.length - 1);
    slideId = deck.slides[index]?.id ?? null;
  }
  const slide = slideId ? deck.slides.find((s) => s.id === slideId) : undefined;
  const existing = new Set(slide?.elements.map((e) => e.id) ?? []);
  const ids = slideId === selectedSlideId ? selectedElementIds.filter((id) => existing.has(id)) : [];
  return { selectedSlideId: slideId, selectedElementIds: ids };
}

export const LOCKED_MESSAGE = "Locked elements can't be moved or deleted. Unlock them first.";

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

  const replaceDeck = (next: Deck, selection: { selectedSlideId: string | null; selectedElementIds: string[] }) => {
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

  /** Applies a patch to one element inside a draft; locked elements keep their position and size. */
  const patchInDraft = (slide: Draft<Slide>, elementId: string, patch: ElementPatch) => {
    const index = slide.elements.findIndex((e) => e.id === elementId);
    if (index === -1) return;
    const existing = current(slide.elements[index]) as SlideElement;
    const allowed = existing.locked ? (Object.fromEntries(Object.entries(patch).filter(([k]) => !isGeometryKey(k) && k !== "crop")) as ElementPatch) : patch;
    const next = applyElementPatch(existing, allowed);
    if (!elementsEqual(existing, next)) slide.elements[index] = next;
  };

  const slideOf = (slideId: string) => findSlide(get().deck, slideId);

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

    addSlide: (index) => {
      const { deck, selectedSlideId } = get();
      if (deck.slides.length >= MAX_SLIDES) {
        toast.error(`A deck can have at most ${MAX_SLIDES} slides.`);
        return null;
      }
      const currentIndex = deck.slides.findIndex((s) => s.id === selectedSlideId);
      const insertAt = index === undefined ? (currentIndex === -1 ? deck.slides.length : currentIndex + 1) : Math.max(0, Math.min(deck.slides.length, Math.trunc(index)));
      // New slides match the background of the slide they follow (or the selected one).
      const background = (deck.slides[insertAt - 1] ?? deck.slides[currentIndex] ?? deck.slides[0])?.background;
      const slide = createSlide(background);
      commit((d) => {
        d.slides.splice(insertAt, 0, slide);
      });
      set({ selectedSlideId: slide.id, selectedElementIds: [], editingElementId: null });
      return slide.id;
    },

    insertSlides: (slides, index) => {
      const { deck, selectedSlideId } = get();
      if (slides.length === 0) return [];
      if (deck.slides.length + slides.length > MAX_SLIDES) {
        toast.error(`A deck can have at most ${MAX_SLIDES} slides.`);
        return [];
      }
      const currentIndex = deck.slides.findIndex((s) => s.id === selectedSlideId);
      const insertAt = index === undefined ? (currentIndex === -1 ? deck.slides.length : currentIndex + 1) : Math.max(0, Math.min(deck.slides.length, Math.trunc(index)));
      const copies = slides.map((s) => cloneSlide(s));
      commit((d) => {
        d.slides.splice(insertAt, 0, ...copies);
      });
      set({ selectedSlideId: copies[0].id, selectedElementIds: [], editingElementId: null });
      return copies.map((s) => s.id);
    },

    duplicateSlide: (slideId) => {
      const { deck } = get();
      const index = deck.slides.findIndex((s) => s.id === slideId);
      if (index === -1) return null;
      return get().insertSlides([deck.slides[index]], index + 1)[0] ?? null;
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
        set({ selectedSlideId: neighbor?.id ?? null, selectedElementIds: [], editingElementId: null });
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
      set({ selectedSlideId: slideId, selectedElementIds: [], editingElementId: null });
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

    setSlideNotes: (slideId, notes) => {
      commit(
        (d) => {
          const slide = findSlide(d, slideId);
          if (slide && slide.notes !== notes) slide.notes = notes.slice(0, MAX_NOTES_LENGTH);
        },
        { coalesceKey: `notes:${slideId}` },
      );
    },

    addElement: (slideId, element) => {
      const slide = slideOf(slideId);
      if (!slide) return false;
      if (slide.elements.length >= MAX_ELEMENTS_PER_SLIDE) {
        toast.error(`A slide can have at most ${MAX_ELEMENTS_PER_SLIDE} elements.`);
        return false;
      }
      const placed = sanitizeElement(cascadePosition(element, slide.elements));
      commit((d) => {
        findSlide(d, slideId)?.elements.push(placed);
      });
      set({ selectedSlideId: slideId, selectedElementIds: [placed.id], editingElementId: null });
      return true;
    },

    addElements: (slideId, elements) => {
      const slide = slideOf(slideId);
      if (!slide || elements.length === 0) return false;
      if (slide.elements.length + elements.length > MAX_ELEMENTS_PER_SLIDE) {
        toast.error(`A slide can have at most ${MAX_ELEMENTS_PER_SLIDE} elements.`);
        return false;
      }
      const placed = cascadeGroup(cloneElements(elements), slide.elements).map((el) => sanitizeElement(el));
      commit((d) => {
        findSlide(d, slideId)?.elements.push(...placed);
      });
      set({ selectedSlideId: slideId, selectedElementIds: placed.map((e) => e.id), editingElementId: null });
      return true;
    },

    updateElement: (slideId, elementId, patch, options) => {
      commit((d) => {
        const slide = findSlide(d, slideId);
        if (slide) patchInDraft(slide, elementId, patch);
      }, options);
    },

    updateElementLive: (slideId, elementId, patch) => {
      get().updateElementsLive(slideId, { [elementId]: patch });
    },

    updateElementsLive: (slideId, patches) => {
      const state = get();
      const next = produce(state.deck, (d) => {
        const slide = findSlide(d, slideId);
        if (!slide) return;
        for (const [id, patch] of Object.entries(patches)) patchInDraft(slide, id, patch);
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
      get().deleteElements(slideId, [elementId]);
    },

    deleteElements: (slideId, ids) => {
      const slide = slideOf(slideId);
      if (!slide) return 0;
      const wanted = new Set(ids);
      const targets = slide.elements.filter((e) => wanted.has(e.id));
      const deletable = new Set(targets.filter((e) => !e.locked).map((e) => e.id));
      if (deletable.size < targets.length) toast.error(LOCKED_MESSAGE);
      if (deletable.size === 0) return 0;
      commit((d) => {
        const s = findSlide(d, slideId);
        if (s) s.elements = s.elements.filter((e) => !deletable.has(e.id));
      });
      const { selectedElementIds, editingElementId } = get();
      set({
        selectedElementIds: selectedElementIds.filter((id) => !deletable.has(id)),
        editingElementId: editingElementId && deletable.has(editingElementId) ? null : editingElementId,
      });
      return deletable.size;
    },

    duplicateElement: (slideId, elementId) => {
      get().duplicateElements(slideId, [elementId]);
    },

    duplicateElements: (slideId, ids) => {
      const slide = slideOf(slideId);
      if (!slide) return;
      const wanted = new Set(ids);
      const elements = slide.elements.filter((e) => wanted.has(e.id));
      if (elements.length === 0) return;
      get().addElements(slideId, elements);
    },

    reorderElement: (slideId, elementId, direction) => {
      get().reorderElements(slideId, [elementId], direction);
    },

    reorderElements: (slideId, ids, direction) => {
      commit((d) => {
        const slide = findSlide(d, slideId);
        if (!slide) return;
        const wanted = new Set(ids);
        const list = current(slide.elements) as SlideElement[];
        if (!list.some((e) => wanted.has(e.id))) return;
        let order = [...list];
        if (direction === "front") order = [...list.filter((e) => !wanted.has(e.id)), ...list.filter((e) => wanted.has(e.id))];
        else if (direction === "back") order = [...list.filter((e) => wanted.has(e.id)), ...list.filter((e) => !wanted.has(e.id))];
        else if (direction === "forward") {
          for (let i = order.length - 2; i >= 0; i -= 1) {
            if (wanted.has(order[i].id) && !wanted.has(order[i + 1].id)) [order[i], order[i + 1]] = [order[i + 1], order[i]];
          }
        } else {
          for (let i = 1; i < order.length; i += 1) {
            if (wanted.has(order[i].id) && !wanted.has(order[i - 1].id)) [order[i], order[i - 1]] = [order[i - 1], order[i]];
          }
        }
        if (order.every((e, i) => e.id === list[i].id)) return;
        slide.elements = order;
      });
    },

    nudgeElements: (slideId, ids, dx, dy) => {
      const slide = slideOf(slideId);
      if (!slide) return false;
      const wanted = new Set(ids);
      const targets = slide.elements.filter((e) => wanted.has(e.id));
      if (targets.length === 0) return false;
      if (targets.some((e) => e.locked)) {
        toast.error(LOCKED_MESSAGE);
        return false;
      }
      commit(
        (d) => {
          const s = findSlide(d, slideId);
          if (!s) return;
          for (const el of targets) patchInDraft(s, el.id, { x: el.x + dx, y: el.y + dy });
        },
        { coalesceKey: `nudge:${[...wanted].sort().join(",")}` },
      );
      return true;
    },

    groupElements: (slideId, ids) => {
      const slide = slideOf(slideId);
      const members = expandToGroups(slide, ids);
      if (members.length < 2) return false;
      const groupId = createId();
      const changed = commit((d) => {
        const s = findSlide(d, slideId);
        if (!s) return;
        for (const el of s.elements) if (members.includes(el.id)) el.groupId = groupId;
      });
      if (changed) set({ selectedElementIds: members });
      return changed;
    },

    ungroupElements: (slideId, ids) => {
      const slide = slideOf(slideId);
      const members = new Set(expandToGroups(slide, ids));
      return commit((d) => {
        const s = findSlide(d, slideId);
        if (!s) return;
        for (const el of s.elements) if (members.has(el.id) && el.groupId) delete el.groupId;
      });
    },

    setElementsLocked: (slideId, ids, locked) => {
      const members = new Set(expandToGroups(slideOf(slideId), ids));
      commit((d) => {
        const s = findSlide(d, slideId);
        if (!s) return;
        for (const el of s.elements) {
          if (!members.has(el.id)) continue;
          if (locked && !el.locked) el.locked = true;
          if (!locked && el.locked) delete el.locked;
        }
      });
    },

    selectElement: (elementId) => {
      const { editingElementId, selectedSlideId } = get();
      const ids = elementId && selectedSlideId ? expandToGroups(slideOf(selectedSlideId), [elementId]) : [];
      set({ selectedElementIds: ids, editingElementId: elementId && editingElementId === elementId ? editingElementId : null });
    },

    toggleElementSelection: (elementId) => {
      const { selectedElementIds, selectedSlideId } = get();
      if (!selectedSlideId) return;
      const members = expandToGroups(slideOf(selectedSlideId), [elementId]);
      const isSelected = members.every((id) => selectedElementIds.includes(id));
      const next = isSelected ? selectedElementIds.filter((id) => !members.includes(id)) : [...selectedElementIds, ...members.filter((id) => !selectedElementIds.includes(id))];
      set({ selectedElementIds: next, editingElementId: null });
    },

    selectElements: (elementIds, options = {}) => {
      const { selectedElementIds, selectedSlideId } = get();
      if (!selectedSlideId) return;
      const ids = expandToGroups(slideOf(selectedSlideId), options.add ? [...selectedElementIds, ...elementIds] : elementIds);
      set({ selectedElementIds: ids, editingElementId: null });
    },

    selectAllElements: () => {
      const { selectedSlideId } = get();
      const slide = selectedSlideId ? slideOf(selectedSlideId) : undefined;
      set({ selectedElementIds: slide?.elements.map((e) => e.id) ?? [], editingElementId: null });
    },

    setEditing: (elementId, selectAll = false) => {
      set(
        elementId
          ? { editingElementId: elementId, selectedElementIds: [elementId], editingSelectAll: selectAll }
          : { editingElementId: null, editingSelectAll: false },
      );
    },

    applyTemplate: (template) => {
      const slides: Slide[] = template.slides.map((s) => cloneSlide(s));
      const { deck } = get();
      replaceDeck({ ...deck, title: template.name.slice(0, MAX_TITLE_LENGTH), slides }, { selectedSlideId: slides[0]?.id ?? null, selectedElementIds: [] });
    },

    applyAiOperations: (operations, refs) => {
      get().endGesture();
      const state = get();
      const result = applyOperations(state.deck, operations, state.selectedSlideId, refs);
      if (result.report.applied === 0) return result.report;
      const selection = reconcileSelection(result.deck, result.focusSlideId ?? state.selectedSlideId, state.selectedElementIds, state.deck);
      replaceDeck(result.deck, selection);
      set({ aiHighlight: { slideIds: result.report.touchedSlideIds, elementIds: result.report.touchedElementIds, token: createId() } });
      return result.report;
    },

    clearAiHighlight: () => set({ aiHighlight: null }),

    undo: () => {
      get().endGesture();
      const { past, deck, future, selectedSlideId, selectedElementIds } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({
        deck: previous,
        past: past.slice(0, -1),
        future: [deck, ...future].slice(0, HISTORY_LIMIT),
        editingElementId: null,
        lastCommit: null,
        ...reconcileSelection(previous, selectedSlideId, selectedElementIds, deck),
      });
    },

    redo: () => {
      get().endGesture();
      const { past, deck, future, selectedSlideId, selectedElementIds } = get();
      const next = future[0];
      if (!next) return;
      set({
        deck: next,
        past: pushLimited(past, deck),
        future: future.slice(1),
        editingElementId: null,
        lastCommit: null,
        ...reconcileSelection(next, selectedSlideId, selectedElementIds, deck),
      });
    },
  };
});

/** The currently selected slide. */
export function selectCurrentSlide(state: EditorState): Slide | null {
  return state.deck.slides.find((s) => s.id === state.selectedSlideId) ?? null;
}

/** All selected elements, in slide (stacking) order. */
export function selectSelectedElements(state: EditorState): SlideElement[] {
  const slide = selectCurrentSlide(state);
  if (!slide || state.selectedElementIds.length === 0) return [];
  const ids = new Set(state.selectedElementIds);
  return slide.elements.filter((e) => ids.has(e.id));
}

/** The selected element when exactly one is selected (its formatting is shown in the toolbar). */
export function selectCurrentElement(state: EditorState): SlideElement | null {
  if (state.selectedElementIds.length !== 1) return null;
  const slide = selectCurrentSlide(state);
  return slide?.elements.find((e) => e.id === state.selectedElementIds[0]) ?? null;
}
