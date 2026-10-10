"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAutoSaver,
  createTabSync,
  loadChat,
  loadDeckById,
  saveChat,
  saveDeck,
  StorageFullError,
  type LoadDeckResult,
  type TabMessage,
} from "@/lib/persistence";
import type { Deck } from "@/lib/schema";
import { useChatStore, type ChatMessage } from "@/lib/store/chatStore";
import { useEditorStore } from "@/lib/store/editorStore";
import { toast } from "@/lib/store/toastStore";

export const SAVE_DELAY_MS = 400;

export type SessionStatus = "loading" | "ready" | "missing" | "corrupt";

function announce(result: LoadDeckResult) {
  if (result.status === "recovered") {
    toast.error(`Part of this presentation couldn't be read (${result.dropped} item${result.dropped === 1 ? "" : "s"} removed). A backup of the original was kept.`);
  }
  if (!result.persistent) {
    toast.error("This browser is blocking local storage, so your changes won't be kept after you close the tab. Export your work before leaving.");
  }
}

interface Savers {
  deck: ReturnType<typeof createAutoSaver<Deck>>;
  chat: ReturnType<typeof createAutoSaver<ChatMessage[]>>;
  sync: ReturnType<typeof createTabSync>;
}

/**
 * Opens one presentation: loads it and its chat from IndexedDB, autosaves every change, and
 * listens for other tabs saving or deleting the same presentation.
 */
export function useDeckSession(deckId: string, options: { onDeletedElsewhere: () => void }) {
  // Status is stored per deck id, so a different id reads as "loading" until it has been opened.
  const [loaded, setLoaded] = useState<{ deckId: string; status: SessionStatus } | null>(null);
  const status: SessionStatus = loaded?.deckId === deckId ? loaded.status : "loading";
  const setStatus = useCallback((next: SessionStatus) => setLoaded({ deckId, status: next }), [deckId]);
  const [externalChange, setExternalChange] = useState(false);
  const savers = useRef<Savers | null>(null);
  const onDeletedRef = useRef(options.onDeletedElsewhere);
  useEffect(() => {
    onDeletedRef.current = options.onDeletedElsewhere;
  });

  useEffect(() => {
    let cancelled = false;
    let discarded = false;
    let persistent = true;
    let failing = false;

    const onTabMessage = (message: TabMessage) => {
      if (message.type === "deck-saved" && message.deckId === deckId) setExternalChange(true);
      if (message.type === "deck-deleted" && message.deckId === deckId) {
        discard();
        onDeletedRef.current();
      }
    };
    const sync = createTabSync(onTabMessage);
    const deck = createAutoSaver<Deck>({
      delay: SAVE_DELAY_MS,
      save: async (value) => {
        await saveDeck(value);
        sync.post({ type: "deck-saved", deckId: value.id, updatedAt: value.updatedAt });
      },
      onStatus: (saveStatus, error) => {
        if (!persistent) return;
        useEditorStore.getState().setSaveStatus(saveStatus);
        // Warn once per run of failures; "saving" in between doesn't count as recovering.
        if (saveStatus === "error" && !failing) {
          toast.error(error instanceof StorageFullError ? error.message : "Your latest changes couldn't be saved in this browser.");
        }
        if (saveStatus === "error") failing = true;
        if (saveStatus === "saved") failing = false;
      },
    });
    const chat = createAutoSaver<ChatMessage[]>({ delay: SAVE_DELAY_MS, save: (messages) => saveChat(deckId, messages) });
    savers.current = { deck, chat, sync };

    const discard = () => {
      discarded = true;
      deck.discard();
      chat.discard();
    };

    let unsubscribeDeck: (() => void) | undefined;
    let unsubscribeChat: (() => void) | undefined;
    useChatStore.getState().reset();

    void (async () => {
      const [result, messages] = await Promise.all([loadDeckById(deckId), loadChat(deckId)]);
      if (cancelled) return;
      if (result.status === "missing" || result.status === "corrupt") {
        setStatus(result.status);
        return;
      }
      persistent = result.persistent;
      useEditorStore.getState().loadDeck(result.deck);
      useChatStore.getState().loadMessages(messages);
      useEditorStore.getState().setSaveStatus(persistent ? "saved" : "unavailable");
      announce(result);
      unsubscribeDeck = useEditorStore.subscribe((state, previous) => {
        if (state.deck !== previous.deck && state.deck.id === deckId) deck.schedule(state.deck);
      });
      unsubscribeChat = useChatStore.subscribe((state, previous) => {
        if (state.messages !== previous.messages) chat.schedule(state.messages);
      });
      setStatus("ready");
    })();

    const flush = () => {
      if (discarded) return;
      void deck.flush();
      void chat.flush();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      unsubscribeDeck?.();
      unsubscribeChat?.();
      flush();
      deck.dispose();
      chat.dispose();
      sync.close();
      savers.current = null;
      useChatStore.getState().reset();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [deckId, setStatus]);

  /** Replaces this tab's copy with the latest saved one (after another tab changed it). */
  const reload = useCallback(async () => {
    const result = await loadDeckById(deckId);
    if (result.status === "ok" || result.status === "recovered") {
      useEditorStore.getState().loadDeck(result.deck);
      announce(result);
    }
    setExternalChange(false);
  }, [deckId]);

  const dismissExternalChange = useCallback(() => setExternalChange(false), []);

  /** Stops autosaving without writing pending changes (the presentation is being deleted). */
  const discard = useCallback(() => {
    savers.current?.deck.discard();
    savers.current?.chat.discard();
  }, []);

  /** Writes pending changes now. */
  const flush = useCallback(async () => {
    await savers.current?.deck.flush();
    await savers.current?.chat.flush();
  }, []);

  const post = useCallback((message: Parameters<Savers["sync"]["post"]>[0]) => savers.current?.sync.post(message), []);

  return { status, externalChange, reload, dismissExternalChange, discard, flush, post };
}
