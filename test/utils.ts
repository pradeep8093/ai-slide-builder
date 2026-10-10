import { createDeck, createSlide } from "@/lib/factory";
import type { Deck, Slide, SlideElement } from "@/lib/schema";
import { useChatStore } from "@/lib/store/chatStore";
import { getInitialEditorState, useEditorStore } from "@/lib/store/editorStore";
import { useToastStore } from "@/lib/store/toastStore";

export function resetStores() {
  useEditorStore.setState(getInitialEditorState());
  useChatStore.setState({ messages: [], pending: false });
  useToastStore.setState({ toasts: [] });
}

/** Loads a deck into the editor store (as if read from storage) and returns it. */
export function seedDeck(slides: Slide[] = [createSlide()], title = "Test deck"): Deck {
  const deck: Deck = { ...createDeck(title), slides };
  useEditorStore.getState().loadDeck(deck);
  return deck;
}

export function slideWith(...elements: SlideElement[]): Slide {
  return { ...createSlide(), elements };
}

export function editor() {
  return useEditorStore.getState();
}

export function currentDeck(): Deck {
  return useEditorStore.getState().deck;
}

export function toastMessages(): string[] {
  return useToastStore.getState().toasts.map((t) => t.message);
}
