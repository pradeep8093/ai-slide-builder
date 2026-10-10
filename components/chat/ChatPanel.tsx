"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Check, RotateCcw, Sparkles, Square, Trash2 } from "lucide-react";
import { MAX_PROMPT_CHARS, useChatStore, type ChatMessage } from "@/lib/store/chatStore";
import { useEditorStore } from "@/lib/store/editorStore";

export const EMPTY_DECK_SUGGESTIONS = [
  "Create a 5-slide pitch deck for a new mobile app",
  "Make a project kickoff deck with goals, scope, timeline and team",
  "Build a 4-slide lesson introducing the water cycle",
];

export const DECK_SUGGESTIONS = [
  "Tighten the wording on this slide",
  "Add a summary slide at the end",
  "Make all slide titles the same size and position",
  "Give this slide a dark background with light text",
];

const MAX_VISIBLE_CHANGES = 6;

function MessageBubble({ message, canRetry, onRetry }: { message: ChatMessage; canRetry: boolean; onRetry: () => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-sm text-white">{message.content}</div>
      </div>
    );
  }
  if (message.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
        <div className="flex gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{message.content}</span>
        </div>
        {canRetry && (
          <button type="button" onClick={onRetry} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline">
            <RotateCcw size={12} aria-hidden />
            Retry
          </button>
        )}
      </div>
    );
  }
  if (message.status === "stopped") {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span>Stopped.</span>
        {canRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium text-neutral-600 hover:underline">
            <RotateCcw size={12} aria-hidden />
            Retry
          </button>
        )}
      </div>
    );
  }
  const changes = message.changes ?? [];
  const skipped = message.skipped ?? [];
  return (
    <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-neutral-100 px-3.5 py-2.5 text-sm text-neutral-800">
      <p className="whitespace-pre-wrap">{message.content}</p>
      {changes.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-neutral-200 pt-2 text-xs text-neutral-600" aria-label="Changes">
          {changes.slice(0, MAX_VISIBLE_CHANGES).map((change, i) => (
            <li key={i} className="flex gap-1.5">
              <Check size={13} className="mt-px shrink-0 text-emerald-600" aria-hidden />
              {change}
            </li>
          ))}
          {changes.length > MAX_VISIBLE_CHANGES && <li className="pl-5">and {changes.length - MAX_VISIBLE_CHANGES} more</li>}
        </ul>
      )}
      {skipped.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          Skipped {skipped.length} change{skipped.length === 1 ? "" : "s"}: {skipped.map((s) => s.reason).filter((r, i, all) => all.indexOf(r) === i).join("; ")}
        </p>
      )}
    </div>
  );
}

export default function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const pending = useChatStore((s) => s.pending);
  const hasSlides = useEditorStore((s) => s.deck.slides.length > 0);
  const { send, stop, clear, retry } = useChatStore.getState();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, pending]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft]);

  const submit = (text: string) => {
    if (!text.trim() || pending) return;
    setDraft("");
    void send(text);
  };

  const suggestions = hasSlides ? DECK_SUGGESTIONS : EMPTY_DECK_SUGGESTIONS;
  const last = messages[messages.length - 1];
  const nearLimit = draft.length > MAX_PROMPT_CHARS * 0.8;

  return (
    <aside aria-label="AI assistant" className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-white">
      <div className="flex h-10 shrink-0 items-center justify-between px-4">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <Sparkles size={14} className="text-indigo-500" aria-hidden />
          AI assistant
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={messages.length === 0 && !pending}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:invisible"
        >
          <Trash2 size={12} aria-hidden />
          Clear
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-2" aria-live="polite" data-testid="chat-messages">
        {messages.length === 0 && !pending && (
          <div className="pt-2">
            <p className="text-sm leading-6 text-neutral-500">
              {hasSlides ? "Ask me to edit your slides. I can change text, layout, colors and charts." : "Describe the presentation you need and I'll draft the slides."}
            </p>
            <div className="mt-4 flex flex-col gap-2" aria-label="Suggestions">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => submit(suggestion)}
                  className="rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-700 hover:border-indigo-300 hover:bg-indigo-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} canRetry={message === last && !pending} onRetry={() => void retry()} />
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-sm text-neutral-500" role="status">
            <span className="flex gap-1" aria-hidden>
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" />
            </span>
            Thinking…
          </div>
        )}
      </div>

      <form
        className="shrink-0 border-t border-neutral-200 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-neutral-200 px-3 py-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/15">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={MAX_PROMPT_CHARS}
            aria-label="Message the AI assistant"
            placeholder={hasSlides ? "Ask AI to edit your slides…" : "Describe the slides you need…"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit(draft);
              }
            }}
            className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm leading-6 text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
          />
          {pending ? (
            <button type="button" onClick={stop} aria-label="Stop" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-white hover:bg-neutral-700">
              <Square size={12} fill="currentColor" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-neutral-200 disabled:text-neutral-400"
            >
              <ArrowUp size={16} aria-hidden />
            </button>
          )}
        </div>
        <div className="mt-1.5 flex justify-between px-1 text-[11px] text-neutral-400">
          <span>Enter to send · Shift+Enter for a new line</span>
          {nearLimit && (
            <span className={draft.length >= MAX_PROMPT_CHARS ? "text-red-600" : ""}>
              {draft.length}/{MAX_PROMPT_CHARS}
            </span>
          )}
        </div>
      </form>
    </aside>
  );
}
