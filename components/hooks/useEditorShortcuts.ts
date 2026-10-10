"use client";

import { useEffect } from "react";
import { isTypingTarget } from "@/lib/platform";
import { useEditorStore } from "@/lib/store/editorStore";

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/** True when the user has text selected somewhere on the page (then ⌘C/⌘V must stay native). */
function hasTextSelection(): boolean {
  const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

/**
 * Editor keyboard shortcuts: undo/redo, delete, duplicate, copy/paste, nudge with arrows,
 * Enter to edit text and Escape to deselect. Ignored while typing in any field.
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
      if (mod && key === "v") {
        if (state.clipboard && !hasTextSelection()) {
          event.preventDefault();
          state.pasteElement();
        }
        return;
      }

      const elementId = state.selectedElementId;
      const element = state.deck.slides.find((s) => s.id === slideId)?.elements.find((e) => e.id === elementId);
      if (!elementId || !element) return;

      if (mod && key === "c") {
        if (!hasTextSelection()) {
          event.preventDefault();
          state.copyElement(slideId, elementId);
        }
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        state.duplicateElement(slideId, elementId);
        return;
      }
      if (mod || event.altKey) return;

      const onButton = event.target instanceof HTMLElement && event.target.closest("button, a, [role='menuitem']");
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.deleteElement(slideId, elementId);
      } else if (event.key === "Escape") {
        state.selectElement(null);
      } else if (event.key === "Enter" && !onButton && element.type === "text") {
        event.preventDefault();
        state.setEditing(element.id);
      } else if (ARROWS[event.key]) {
        event.preventDefault();
        const [dx, dy] = ARROWS[event.key];
        const step = event.shiftKey ? 10 : 1;
        state.updateElement(slideId, elementId, { x: element.x + dx * step, y: element.y + dy * step }, { coalesceKey: `nudge:${elementId}` });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
