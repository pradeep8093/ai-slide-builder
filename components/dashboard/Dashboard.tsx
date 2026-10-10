"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, MoreHorizontal, Pencil, Plus, Presentation, Trash2 } from "lucide-react";
import { MAX_TITLE_LENGTH } from "@/lib/constants";
import { createDeckRecord, createTabSync, deleteDeckRecord, duplicateDeckRecord, listDecks, loadDeckById, renameDeckRecord, type DeckSummary } from "@/lib/persistence";
import { toast } from "@/lib/store/toastStore";
import FitSlide from "../slide/FitSlide";
import MenuButton from "../ui/MenuButton";
import Modal from "../ui/Modal";

const UNTITLED = "Untitled presentation";

/** "just now", "5 minutes ago", "yesterday", "3 days ago"… */
export function formatEdited(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

type DialogState = { kind: "rename"; deck: DeckSummary; value: string } | { kind: "delete"; deck: DeckSummary } | null;

interface DashboardProps {
  onOpen: (deckId: string) => void;
}

/** Home screen: every presentation saved in this browser. */
export default function Dashboard({ onOpen }: DashboardProps) {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await listDecks();
    setDecks(result.decks);
    setPersistent(result.persistent);
  }, []);

  useEffect(() => {
    // Initial load; setState happens after the async read resolves.
    void refresh(); // eslint-disable-line react-hooks/set-state-in-effect
    const sync = createTabSync(() => void refresh());
    return () => sync.close();
  }, [refresh]);

  const announce = () => {
    const sync = createTabSync(() => undefined);
    sync.post({ type: "decks-changed" });
    sync.close();
  };

  const run = async (action: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error && error.name === "StorageFullError" ? error.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const deck = await createDeckRecord();
      announce();
      onOpen(deck.id);
    }, "The presentation couldn't be created.");

  const duplicate = (summary: DeckSummary) =>
    run(async () => {
      const loaded = await loadDeckById(summary.id);
      if (loaded.status !== "ok" && loaded.status !== "recovered") throw new Error("missing");
      const copy = await duplicateDeckRecord(loaded.deck);
      announce();
      await refresh();
      toast.success(`Created “${copy.title}”.`);
    }, "The presentation couldn't be duplicated.");

  const rename = (summary: DeckSummary, title: string) =>
    run(async () => {
      await renameDeckRecord(summary.id, title);
      announce();
      setDialog(null);
      await refresh();
    }, "The presentation couldn't be renamed.");

  const remove = (summary: DeckSummary) =>
    run(async () => {
      await deleteDeckRecord(summary.id);
      const sync = createTabSync(() => undefined);
      sync.post({ type: "deck-deleted", deckId: summary.id });
      sync.post({ type: "decks-changed" });
      sync.close();
      setDialog(null);
      await refresh();
      toast.success(`Deleted “${summary.title || UNTITLED}”.`);
    }, "The presentation couldn't be deleted.");

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="flex h-14 items-center gap-3 border-b border-neutral-200 bg-white px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white" aria-hidden>
          <Presentation size={18} />
        </div>
        <h1 className="text-[15px] font-semibold">Presentations</h1>
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Plus size={16} aria-hidden />
          New presentation
        </button>
      </header>

      {!persistent && (
        <div role="alert" className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          This browser is blocking local storage. You can still make presentations, but they will disappear when you close the tab.
        </div>
      )}

      <main className="mx-auto max-w-6xl px-6 py-8">
        {decks === null ? (
          <p role="status" className="text-sm text-neutral-500">
            Loading presentations…
          </p>
        ) : decks.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center">
            <h2 className="text-lg font-semibold">No presentations yet</h2>
            <p className="mt-2 text-sm text-neutral-500">Create one to get started. Everything is saved in this browser.</p>
            <button
              type="button"
              onClick={() => void create()}
              className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <Plus size={16} aria-hidden />
              New presentation
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5" aria-label="Presentations">
            {decks.map((deck) => {
              const title = deck.title.trim() || UNTITLED;
              return (
                <li key={deck.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onOpen(deck.id)}
                    aria-label={`Open ${title}`}
                    className="block w-full rounded-xl border border-neutral-200 bg-white p-2 text-left hover:border-indigo-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                  >
                    <div className="overflow-hidden rounded-lg border border-neutral-100 bg-white">
                      {deck.firstSlide ? (
                        <FitSlide slide={deck.firstSlide} />
                      ) : (
                        <div className="flex aspect-video items-center justify-center text-xs text-neutral-400">No slides</div>
                      )}
                    </div>
                    <div className="px-1 pb-1 pt-2.5">
                      <div className="truncate pr-8 text-sm font-semibold">{title}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">
                        {deck.slideCount} slide{deck.slideCount === 1 ? "" : "s"} · Edited {formatEdited(deck.updatedAt)}
                      </div>
                    </div>
                  </button>
                  <div className="absolute bottom-3 right-3">
                    <MenuButton
                      label={`${title} actions`}
                      align="end"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                      items={[
                        { id: "rename", label: "Rename", icon: <Pencil size={14} />, onSelect: () => setDialog({ kind: "rename", deck, value: deck.title }) },
                        { id: "duplicate", label: "Duplicate", icon: <Copy size={14} />, onSelect: () => void duplicate(deck) },
                        { id: "delete", label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDialog({ kind: "delete", deck }) },
                      ]}
                    >
                      <MoreHorizontal size={16} aria-hidden />
                    </MenuButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {dialog?.kind === "rename" && (
        <Modal
          title="Rename presentation"
          width={440}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                Cancel
              </button>
              <button
                type="submit"
                form="rename-form"
                disabled={busy}
                className="h-9 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Rename
              </button>
            </>
          }
        >
          <form
            id="rename-form"
            onSubmit={(event) => {
              event.preventDefault();
              void rename(dialog.deck, dialog.value);
            }}
          >
            <label className="block text-sm font-medium text-neutral-700">
              Title
              <input
                type="text"
                data-autofocus
                value={dialog.value}
                maxLength={MAX_TITLE_LENGTH}
                placeholder={UNTITLED}
                onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-neutral-200 px-2 text-sm font-normal focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>
          </form>
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal
          title="Delete presentation?"
          width={440}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                Cancel
              </button>
              <button
                type="button"
                data-autofocus
                disabled={busy}
                onClick={() => void remove(dialog.deck)}
                className="h-9 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          }
        >
          <p className="text-sm leading-6 text-neutral-600">
            “{dialog.deck.title.trim() || UNTITLED}” and its AI chat history will be permanently deleted from this browser. This can&apos;t be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}
