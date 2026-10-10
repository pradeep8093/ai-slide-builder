import { z } from "zod";
import { createId } from "../ids";
import { slideElementSchema, slideSchema, type Slide, type SlideElement } from "../schema";

export type ClipboardPayload = { kind: "elements"; elements: SlideElement[] } | { kind: "slides"; slides: Slide[] };

export interface ClipboardEntry {
  payload: ClipboardPayload;
  /** Identifies this copy; written to the system clipboard so a paste can tell it came from us. */
  token: string;
  /** The plain text placed on the system clipboard alongside the token. */
  plainText: string;
  at: number;
}

/** Custom clipboard type carrying the copy token (supported by Chromium, Firefox and Safari for DataTransfer). */
export const CLIPBOARD_MIME = "application/x-ai-slide-builder";
export const CLIPBOARD_STORAGE_KEY = "ai-slide-builder:clipboard";

const entrySchema = z.object({
  payload: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("elements"), elements: z.array(slideElementSchema).min(1) }),
    z.object({ kind: z.literal("slides"), slides: z.array(slideSchema).min(1) }),
  ]),
  token: z.string(),
  plainText: z.string(),
  at: z.number(),
});

let memory: ClipboardEntry | null = null;

function readStorage(): ClipboardEntry | null {
  try {
    const raw = window.localStorage.getItem(CLIPBOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = entrySchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as ClipboardEntry) : null;
  } catch {
    return null;
  }
}

/**
 * Stores copied elements or slides. Kept in memory and mirrored to localStorage (when it fits) so a
 * copy in one tab or presentation can be pasted into another.
 */
export function writeClipboard(payload: ClipboardPayload, plainText: string): ClipboardEntry {
  const entry: ClipboardEntry = { payload: structuredClone(payload), token: createId(), plainText, at: Date.now() };
  memory = entry;
  try {
    window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Too big for localStorage (e.g. large images) or storage blocked: the in-memory copy still works in this tab.
    try {
      window.localStorage.removeItem(CLIPBOARD_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  return entry;
}

/** The most recent copy, from this tab or another one. */
export function readClipboard(): ClipboardEntry | null {
  const stored = readStorage();
  if (stored && (!memory || stored.at > memory.at)) return stored;
  return memory;
}

export function clearClipboardForTests() {
  memory = null;
  try {
    window.localStorage.removeItem(CLIPBOARD_STORAGE_KEY);
  } catch {
    // ignore
  }
}
