"use client";

import { useEffect } from "react";
import { plainTextForElements, plainTextForSlides, tableFromText, textElementFromText } from "@/lib/clipboard";
import { createImageElement } from "@/lib/factory";
import { importImageFile } from "@/lib/image";
import { isTypingTarget } from "@/lib/platform";
import { CLIPBOARD_MIME, readClipboard, writeClipboard, type ClipboardEntry } from "@/lib/store/clipboardStore";
import { LOCKED_MESSAGE, selectSelectedElements, useEditorStore } from "@/lib/store/editorStore";
import { toast } from "@/lib/store/toastStore";
import { looksTabular } from "@/lib/tabular";

const NO_SLIDE = "Add a slide first, then paste.";

/** True when the user has text selected somewhere on the page (then copy must stay native). */
function hasTextSelection(): boolean {
  const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

/** The slide thumbnail that has keyboard focus, if any (copy/paste then works on slides). */
function focusedSlideId(): string | null {
  const active = document.activeElement;
  const thumb = active instanceof HTMLElement ? active.closest<HTMLElement>("[data-slide-thumb]") : null;
  return thumb?.dataset.slideThumb ?? null;
}

/** Best effort: puts plain text on the system clipboard when the copy didn't come from a copy event. */
function writeSystemText(text: string) {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    // Clipboard API unavailable (insecure context, old browser): the in-app clipboard still works.
  }
}

/** Copies the selected elements. Returns the clipboard entry, or null when nothing is selected. */
export function copySelection(): ClipboardEntry | null {
  const elements = selectSelectedElements(useEditorStore.getState());
  if (elements.length === 0) return null;
  return writeClipboard({ kind: "elements", elements }, plainTextForElements(elements));
}

/** Copies the selected elements and removes them. Locked elements can't be cut. */
export function cutSelection(): ClipboardEntry | null {
  const state = useEditorStore.getState();
  const elements = selectSelectedElements(state);
  if (elements.length === 0 || !state.selectedSlideId) return null;
  if (elements.some((e) => e.locked)) {
    toast.error(LOCKED_MESSAGE);
    return null;
  }
  const entry = copySelection();
  state.deleteElements(state.selectedSlideId, elements.map((e) => e.id));
  return entry;
}

/** Copies whole slides (with their notes). */
export function copySlides(slideIds: string[]): ClipboardEntry | null {
  const wanted = new Set(slideIds);
  const slides = useEditorStore.getState().deck.slides.filter((s) => wanted.has(s.id));
  if (slides.length === 0) return null;
  return writeClipboard({ kind: "slides", slides }, plainTextForSlides(slides));
}

/** Pastes something copied in this app: elements onto the current slide, slides after it. */
export function pasteEntry(entry: ClipboardEntry, slideIndex?: number): boolean {
  const state = useEditorStore.getState();
  if (entry.payload.kind === "slides") {
    return state.insertSlides(entry.payload.slides, slideIndex).length > 0;
  }
  if (!state.selectedSlideId) {
    toast.error(NO_SLIDE);
    return false;
  }
  return state.addElements(state.selectedSlideId, entry.payload.elements);
}

/** Paste from a menu: the most recent copy made in this app (any tab). */
export function pasteFromApp(slideIndex?: number): boolean {
  const entry = readClipboard();
  if (!entry) {
    toast.info("Nothing to paste yet. Copy elements or slides first.");
    return false;
  }
  return pasteEntry(entry, slideIndex);
}

/**
 * Pastes content from other apps: an image file becomes an image, spreadsheet cells
 * (tab-separated) become a table, any other text becomes a text box.
 */
export async function pasteExternal(data: { files: File[]; text: string }): Promise<boolean> {
  if (data.files.length === 0 && !data.text.trim()) return false;
  const state = useEditorStore.getState();
  const slideId = state.selectedSlideId;
  if (!slideId) {
    toast.error(NO_SLIDE);
    return false;
  }
  const image = data.files.find((f) => f.type.startsWith("image/"));
  if (image) {
    try {
      const imported = await importImageFile(image);
      return useEditorStore.getState().addElement(slideId, createImageElement(imported.src, imported.width, imported.height));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The image couldn't be pasted.");
      return false;
    }
  }
  if (data.files.length > 0 && !data.text.trim()) {
    toast.error("Only images can be pasted onto a slide.");
    return false;
  }
  const text = data.text;
  if (looksTabular(text)) {
    const table = tableFromText(text);
    if (table) {
      const added = state.addElement(slideId, table.element);
      if (added && table.truncated) toast.info("The pasted cells were trimmed to fit the table limits.");
      return added;
    }
  }
  return state.addElement(slideId, textElementFromText(text));
}

/**
 * Finds which in-app copy a paste refers to: by the token we put on the clipboard, or — when a browser
 * dropped our custom type — by matching the plain text. An empty system clipboard falls back to our copy.
 */
export function matchInternalEntry(data: { token: string; text: string; hasFiles: boolean }): ClipboardEntry | null {
  const entry = readClipboard();
  if (!entry) return null;
  if (data.token) return data.token === entry.token ? entry : null;
  if (data.hasFiles) return null;
  if (data.text && entry.plainText && data.text === entry.plainText) return entry;
  if (!data.text.trim()) return entry;
  return null;
}

/** Marks the hidden field that briefly takes focus during ⌘C / ⌘X / ⌘V (see useClipboard). */
export const CLIPBOARD_CATCHER_ATTR = "data-clipboard-catcher";
/** How long the hidden field may keep focus if the browser never sends the clipboard event. */
export const CATCHER_RELEASE_MS = 1000;

function isCatcher(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.hasAttribute(CLIPBOARD_CATCHER_ATTR);
}

/**
 * Wires the system copy / cut / paste events to the editor. Native behavior is kept while typing in a
 * field or when page text is selected.
 *
 * Browsers only fire clipboard events reliably when an editable field has focus, and on macOS the
 * event for ⌘C / ⌘V arrives asynchronously from the app menu. So on the shortcut's keydown a hidden
 * text field takes focus (with a selection, so Copy and Cut are enabled); the clipboard event that
 * follows is handled exactly once, and focus goes back where it was.
 */
export function useClipboard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const catcher = document.createElement("textarea");
    catcher.setAttribute(CLIPBOARD_CATCHER_ATTR, "");
    catcher.setAttribute("aria-hidden", "true");
    catcher.tabIndex = -1;
    Object.assign(catcher.style, { position: "fixed", left: "-10000px", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
    document.body.appendChild(catcher);

    /** What the shortcut was aimed at, captured before focus moved to the hidden field. */
    let pending: { slideId: string | null; restore: HTMLElement | null; timer: number } | null = null;

    const release = () => {
      if (!pending) return;
      window.clearTimeout(pending.timer);
      const { restore } = pending;
      pending = null;
      catcher.value = "";
      if (document.activeElement !== catcher) return;
      if (restore && restore.isConnected && restore !== document.body) restore.focus({ preventScroll: true });
      else catcher.blur();
    };

    const onCopyOrCut = (event: ClipboardEvent, cut: boolean) => {
      const fromCatcher = isCatcher(event.target);
      if (!fromCatcher && (isTypingTarget(event.target) || hasTextSelection())) return;
      const slideId = fromCatcher ? (pending?.slideId ?? null) : focusedSlideId();
      release();
      let entry: ClipboardEntry | null = null;
      if (slideId) {
        entry = copySlides([slideId]);
        if (entry && cut) useEditorStore.getState().deleteSlide(slideId);
      } else {
        entry = cut ? cutSelection() : copySelection();
      }
      // Nothing of ours to copy: never let the hidden field's placeholder text reach the clipboard.
      if (!entry) {
        if (fromCatcher) event.preventDefault();
        return;
      }
      event.preventDefault();
      event.clipboardData?.setData("text/plain", entry.plainText);
      event.clipboardData?.setData(CLIPBOARD_MIME, entry.token);
    };
    const onCopy = (event: ClipboardEvent) => onCopyOrCut(event, false);
    const onCut = (event: ClipboardEvent) => onCopyOrCut(event, true);

    const onPaste = (event: ClipboardEvent) => {
      const fromCatcher = isCatcher(event.target);
      if (!fromCatcher && isTypingTarget(event.target)) return;
      release();
      const data = event.clipboardData;
      const files = Array.from(data?.files ?? []);
      const text = data?.getData("text/plain") ?? "";
      const token = data?.getData(CLIPBOARD_MIME) ?? "";
      event.preventDefault();
      const internal = matchInternalEntry({ token, text, hasFiles: files.length > 0 });
      if (internal) pasteEntry(internal);
      else void pasteExternal({ files, text });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "x" && key !== "v") return;
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const slideId = focusedSlideId();
      if (key !== "v") {
        // Copying selected page text stays native; with nothing of ours selected there is nothing to do.
        if (hasTextSelection()) return;
        if (!slideId && selectSelectedElements(useEditorStore.getState()).length === 0) return;
      }
      release();
      const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      catcher.value = " ";
      catcher.focus({ preventScroll: true });
      catcher.select();
      pending = { slideId, restore, timer: window.setTimeout(release, CATCHER_RELEASE_MS) };
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      release();
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKeyDown);
      catcher.remove();
    };
  }, [enabled]);
}

export { writeSystemText };
