"use client";

import { useEffect } from "react";
import { isTypingTarget } from "@/lib/platform";
import { selectSelectedElements, useEditorStore } from "@/lib/store/editorStore";

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/** Arrow keys move the selection by this many slide pixels; with Shift by the larger step. */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

/**
 * Editor keyboard shortcuts: undo/redo, select all, group/ungroup, delete, duplicate, nudge with
 * arrows, Enter to edit text and Escape to deselect. Ignored while typing in any field.
 * (Copy, cut and paste live in useClipboard.)
 */
export function useEditorShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const state = useEditorStore.getState();
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        state.redo();
        return;
      }

      const slideId = state.selectedSlideId;
      if (!slideId) return;
      // Slide thumbnails have their own keys (arrows move between slides, Delete removes the slide).
      const onThumb = event.target instanceof HTMLElement && event.target.closest("[data-slide-thumb]");
      if (onThumb) return;

      if (mod && key === "a") {
        event.preventDefault();
        state.selectAllElements();
        return;
      }

      const elements = selectSelectedElements(state);
      if (elements.length === 0) return;
      const ids = elements.map((e) => e.id);

      if (mod && key === "g") {
        event.preventDefault();
        if (event.shiftKey) state.ungroupElements(slideId, ids);
        else state.groupElements(slideId, ids);
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        state.duplicateElements(slideId, ids);
        return;
      }
      if (mod || event.altKey) return;

      const onButton = event.target instanceof HTMLElement && event.target.closest("button, a, [role='menuitem']");
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.deleteElements(slideId, ids);
      } else if (event.key === "Escape") {
        state.selectElement(null);
      } else if (event.key === "Enter" && !onButton && elements.length === 1 && elements[0].type === "text") {
        event.preventDefault();
        state.setEditing(elements[0].id);
      } else if (ARROWS[event.key]) {
        event.preventDefault();
        const [dx, dy] = ARROWS[event.key];
        const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
        state.nudgeElements(slideId, ids, dx * step, dy * step);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
