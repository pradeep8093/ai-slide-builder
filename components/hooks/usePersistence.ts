"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createAutoSaver, createTabSync, loadChat, loadDeck, saveChat, saveDeck, StorageFullError, type LoadDeckResult } from "@/lib/persistence";
import type { Deck } from "@/lib/schema";
import { useChatStore, type ChatMessage } from "@/lib/store/chatStore";
import { useEditorStore } from "@/lib/store/editorStore";
import { toast } from "@/lib/store/toastStore";

export const SAVE_DELAY_MS = 400;

function announceLoad(result: LoadDeckResult) {
  switch (result.status) {
    case "unavailable":
      toast.error("This browser is blocking local storage, so your changes can't be saved. Export your work before closing the tab.");
      break;
    case "corrupt":
      toast.error("Your saved presentation couldn't be read, so a new one was started. A backup of the old data was kept.");
      break;
    case "recovered":
      toast.error(`Part of your saved presentation couldn't be read (${result.dropped} item${result.dropped === 1 ? "" : "s"} removed).`);
      break;
  }
}

/**
 * Loads the deck and chat from IndexedDB, autosaves every change, and watches for saves from
 * other tabs. Everything stays in the browser; nothing is sent to a server.
 */
export function usePersistence() {
  const [externalChange, setExternalChange] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let lastStatus: string | null = null;
    const editor = useEditorStore.getState();
    const sync = createTabSync(() => {
      if (mounted.current) setExternalChange(true);
    });

    const deckSaver = createAutoSaver<Deck>({
      delay: SAVE_DELAY_MS,
      save: async (deck) => {
        await saveDeck(deck);
        sync.notifySaved(deck.updatedAt);
      },
      onStatus: (status, error) => {
        useEditorStore.getState().setSaveStatus(status);
        if (status === "error" && lastStatus !== "error") {
          toast.error(error instanceof StorageFullError ? error.message : "Your latest changes couldn't be saved in this browser.");
        }
        lastStatus = status;
      },
    });
    const chatSaver = createAutoSaver<ChatMessage[]>({ delay: SAVE_DELAY_MS, save: saveChat });

    let unsubscribeDeck: (() => void) | undefined;
    let unsubscribeChat: (() => void) | undefined;

    void (async () => {
      const [result, messages] = await Promise.all([loadDeck(), loadChat()]);
      if (cancelled) return;
      editor.loadDeck(result.deck);
      useChatStore.getState().loadMessages(messages);
      announceLoad(result);
      const unavailable = result.status === "unavailable";
      useEditorStore.getState().setSaveStatus(unavailable ? "unavailable" : result.status === "ok" ? "saved" : "idle");
      if (unavailable) return;
      unsubscribeDeck = useEditorStore.subscribe((state, previous) => {
        if (state.deck !== previous.deck) deckSaver.schedule(state.deck);
      });
      unsubscribeChat = useChatStore.subscribe((state, previous) => {
        if (state.messages !== previous.messages) chatSaver.schedule(state.messages);
      });
    })();

    const flush = () => {
      void deckSaver.flush();
      void chatSaver.flush();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      mounted.current = false;
      unsubscribeDeck?.();
      unsubscribeChat?.();
      flush();
      deckSaver.dispose();
      chatSaver.dispose();
      sync.close();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  /** Replaces this tab's deck with the latest saved one (after another tab changed it). */
  const reload = useCallback(async () => {
    const result = await loadDeck();
    useEditorStore.getState().loadDeck(result.deck);
    announceLoad(result);
    setExternalChange(false);
  }, []);

  const dismissExternalChange = useCallback(() => setExternalChange(false), []);

  return { externalChange, reload, dismissExternalChange };
}
