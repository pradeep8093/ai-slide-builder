import { create } from "zustand";
import { requestAiEdit } from "../ai/client";
import { AiRequestError } from "../ai/errors";
import { createId } from "../ids";
import { useEditorStore } from "./editorStore";

export const MAX_CHAT_MESSAGES = 200;
export const MAX_PROMPT_CHARS = 2000;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  status: "ok" | "error" | "stopped";
  /** Human-readable list of what the AI changed (assistant messages only). */
  changes?: string[];
  skipped?: { op: string; reason: string }[];
}

interface ChatState {
  messages: ChatMessage[];
  pending: boolean;
  loadMessages: (messages: ChatMessage[]) => void;
  send: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
  clear: () => void;
  /** Cancels any request silently and forgets the conversation (used when switching presentations). */
  reset: () => void;
}

let controller: AbortController | null = null;

function cap(messages: ChatMessage[]): ChatMessage[] {
  return messages.length > MAX_CHAT_MESSAGES ? messages.slice(messages.length - MAX_CHAT_MESSAGES) : messages;
}

export const useChatStore = create<ChatState>((set, get) => {
  const run = async () => {
    const editor = useEditorStore.getState();
    const deckId = editor.deck.id;
    controller?.abort();
    const current = new AbortController();
    controller = current;
    set({ pending: true });

    try {
      const result = await requestAiEdit({ conversation: get().messages, deck: editor.deck, selectedSlideId: editor.selectedSlideId }, current.signal);
      if (current.signal.aborted) throw new AiRequestError("aborted", "Stopped.");
      // Never apply an answer to a different presentation than the one it was asked about.
      if (useEditorStore.getState().deck.id !== deckId) throw new AiRequestError("aborted", "Stopped.");
      // Apply against the deck as it is *now*; edits made while waiting are kept.
      const report = useEditorStore.getState().applyAiOperations(result.operations, result.refs);
      const reply = result.reply.trim() || (report.applied > 0 ? "Done." : "I couldn't make that change.");
      const message: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: reply,
        createdAt: Date.now(),
        status: "ok",
        changes: report.changes,
        skipped: report.skipped,
      };
      set((s) => ({ messages: cap([...s.messages, message]) }));
    } catch (error) {
      const stopped = error instanceof AiRequestError && error.code === "aborted";
      if (stopped && controller !== current) return; // superseded by clear()/reset()/a new request
      const message: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: stopped ? "Stopped." : error instanceof Error ? error.message : "Something went wrong.",
        createdAt: Date.now(),
        status: stopped ? "stopped" : "error",
      };
      set((s) => ({ messages: cap([...s.messages, message]) }));
    } finally {
      if (controller === current) {
        controller = null;
        set({ pending: false });
      }
    }
  };

  return {
    messages: [],
    pending: false,

    loadMessages: (messages) => set({ messages: cap(messages) }),

    send: async (text) => {
      const content = text.trim().slice(0, MAX_PROMPT_CHARS);
      if (!content || get().pending) return;
      const message: ChatMessage = { id: createId(), role: "user", content, createdAt: Date.now(), status: "ok" };
      set((s) => ({ messages: cap([...s.messages, message]) }));
      await run();
    },

    retry: async () => {
      const { messages, pending } = get();
      const last = messages[messages.length - 1];
      if (pending || !last || last.role !== "assistant" || last.status === "ok") return;
      if (!messages.some((m) => m.role === "user")) return;
      set({ messages: messages.slice(0, -1) });
      await run();
    },

    stop: () => {
      controller?.abort();
    },

    clear: () => {
      const active = controller;
      controller = null;
      active?.abort();
      set({ messages: [], pending: false });
    },

    reset: () => {
      get().clear();
    },
  };
});
