import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { currentDeck, editor, seedDeck } from "@/test/utils";
import { AI_ENDPOINT } from "../ai/client";
import type { AiOperation } from "../ai/schema";
import { createSlide } from "../factory";
import { MAX_CHAT_MESSAGES, MAX_PROMPT_CHARS, useChatStore, type ChatMessage } from "./chatStore";
import { useEditorStore } from "./editorStore";

const ADD_SLIDE: AiOperation = { op: "add_slide", position: null, background: null, notes: null, elements: [] };

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function chat() {
  return useChatStore.getState();
}

function msg(id: string, role: ChatMessage["role"], status: ChatMessage["status"] = "ok"): ChatMessage {
  return { id, role, content: `${role} ${id}`, createdAt: Number(id) || 0, status };
}

/** A fetch that never answers until its request is aborted. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
  );
}

/** A fetch whose answer the test releases manually (it ignores aborts, like a response already on the wire). */
function deferredFetch() {
  let resolve: (r: Response) => void = () => undefined;
  const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
  return { fetchMock, respond: (body: unknown) => resolve(okResponse(body)) };
}

interface SentBody {
  messages: { role: string; content: string }[];
  digest: string | null;
  deck: { title: string; slideCount: number; selectedSlide: string | null };
}

/** The JSON body of the n-th request sent to the AI route. */
function sentBody(fetchMock: Mock, n = 0): SentBody {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  expect(url).toBe(AI_ENDPOINT);
  return JSON.parse(init.body as string) as SentBody;
}

afterEach(() => vi.unstubAllGlobals());

describe("sending", () => {
  it("sends a message, applies the operations and records the changes", async () => {
    seedDeck([createSlide()]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ reply: "Added a slide.", operations: [ADD_SLIDE] })));
    await chat().send("  Add a slide  ");
    const messages = chat().messages;
    expect(messages.map((m) => [m.role, m.content, m.status])).toEqual([
      ["user", "Add a slide", "ok"],
      ["assistant", "Added a slide.", "ok"],
    ]);
    expect(messages[1].changes).toEqual(["Added slide 2"]);
    expect(messages[1].skipped).toEqual([]);
    expect(currentDeck().slides).toHaveLength(2);
    expect(chat().pending).toBe(false);
  });

  it("sends the whole conversation (older turns as a digest), the deck and the selected slide", async () => {
    const deck = seedDeck([createSlide(), createSlide()], "Roadmap");
    editor().selectSlide(deck.slides[1].id);
    const history = Array.from({ length: 30 }, (_, i) => msg(`${i + 1}`, i % 2 === 0 ? "user" : "assistant"));
    history[29] = { ...history[29], content: "This failed", status: "error" };
    chat().loadMessages(history);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ reply: "ok", operations: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await chat().send("Next");
    const body = sentBody(fetchMock);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Next" });
    expect(body.messages[0].role).toBe("user");
    // Even the oldest message reaches the request, condensed into the digest.
    expect(body.digest).toContain("User asked: user 1");
    expect(JSON.stringify(body)).not.toContain("This failed");
    expect(body.deck).toMatchObject({ title: "Roadmap", slideCount: 2, selectedSlide: "S2" });
  });

  it("ignores empty messages and messages while a request is pending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await chat().send("   ");
    useChatStore.setState({ pending: true });
    await chat().send("hello");
    expect(chat().messages).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates very long prompts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ reply: "ok", operations: [] })));
    seedDeck();
    await chat().send("a".repeat(MAX_PROMPT_CHARS + 100));
    expect(chat().messages[0].content).toHaveLength(MAX_PROMPT_CHARS);
  });

  it("uses a fallback reply when the model returns none", async () => {
    seedDeck();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ reply: " ", operations: [] })));
    await chat().send("do nothing");
    expect(chat().messages[1].content).toBe("I couldn't make that change.");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ reply: "", operations: [{ op: "set_title", title: "Hi" }] })));
    await chat().send("rename");
    expect(chat().messages[3].content).toBe("Done.");
  });

  it("applies the answer to the deck as it is now, keeping edits made while waiting", async () => {
    seedDeck([createSlide()]);
    const { fetchMock, respond } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const sending = chat().send("Add a slide");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    editor().setTitle("Typed while waiting");
    respond({ reply: "Added", operations: [ADD_SLIDE] });
    await sending;
    expect(currentDeck().title).toBe("Typed while waiting");
    expect(currentDeck().slides).toHaveLength(2);
  });

  it("records skipped operations", async () => {
    seedDeck([createSlide()]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ reply: "Tried", operations: [{ op: "delete_slide", slideId: "S9" }] })));
    await chat().send("Delete slide 9");
    expect(chat().messages[1]).toMatchObject({ status: "ok", changes: [], skipped: [{ op: "delete_slide", reason: expect.stringContaining("S9") }] });
  });

  it("keeps at most MAX_CHAT_MESSAGES messages", async () => {
    const many: ChatMessage[] = Array.from({ length: MAX_CHAT_MESSAGES + 5 }, (_, i) => ({ id: `${i}`, role: "user", content: `${i}`, createdAt: i, status: "ok" }));
    chat().loadMessages(many);
    expect(chat().messages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(chat().messages[0].id).toBe("5");

    seedDeck();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ reply: "Sure", operations: [] })));
    await chat().send("One more");
    const messages = chat().messages;
    expect(messages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(messages[0].id).toBe("7");
    expect(messages.slice(-2).map((m) => m.content)).toEqual(["One more", "Sure"]);
  });
});

describe("errors and retry", () => {
  it("shows errors and retries without duplicating the user message", async () => {
    seedDeck();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "missing_api_key", message: "Add LLM_API_KEY" } }), { status: 500 })));
    await chat().send("Make a deck");
    expect(chat().messages[1]).toMatchObject({ role: "assistant", status: "error", content: "Add LLM_API_KEY" });
    expect(chat().pending).toBe(false);
    const retryFetch = vi.fn().mockResolvedValue(okResponse({ reply: "Here you go", operations: [] }));
    vi.stubGlobal("fetch", retryFetch);
    await chat().retry();
    expect(chat().messages.map((m) => m.content)).toEqual(["Make a deck", "Here you go"]);
    expect(sentBody(retryFetch).messages).toEqual([{ role: "user", content: "Make a deck" }]);
    await chat().retry();
    expect(chat().messages).toHaveLength(2);
    expect(retryFetch).toHaveBeenCalledTimes(1);
  });

  it("shows the server's message for rate limits and a generic one for unexpected failures", async () => {
    seedDeck();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "rate_limited", message: "Busy, try later" } }), { status: 429 })));
    await chat().send("Hi");
    expect(chat().messages[1]).toMatchObject({ status: "error", content: "Busy, try later" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ reply: "ok", operations: [] })));
    const original = useEditorStore.getState().applyAiOperations;
    useEditorStore.setState({
      applyAiOperations: () => {
        throw "not an error object";
      },
    });
    try {
      await chat().send("Again");
    } finally {
      useEditorStore.setState({ applyAiOperations: original });
    }
    expect(chat().messages[3]).toMatchObject({ status: "error", content: "Something went wrong." });
    expect(chat().pending).toBe(false);
  });

  it("retries a stopped request", async () => {
    seedDeck();
    vi.stubGlobal("fetch", hangingFetch());
    const sending = chat().send("Try this");
    await vi.waitFor(() => expect(chat().pending).toBe(true));
    chat().stop();
    await sending;
    expect(chat().messages[1]).toMatchObject({ status: "stopped", content: "Stopped." });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ reply: "Finished", operations: [] })));
    await chat().retry();
    expect(chat().messages.map((m) => [m.content, m.status])).toEqual([
      ["Try this", "ok"],
      ["Finished", "ok"],
    ]);
  });

  it("does nothing when there is nothing to retry", async () => {
    seedDeck();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await chat().retry();
    chat().loadMessages([msg("1", "user")]);
    await chat().retry();
    chat().loadMessages([msg("1", "user"), msg("2", "assistant")]);
    await chat().retry();
    chat().loadMessages([msg("1", "assistant", "error")]);
    await chat().retry();
    expect(chat().messages).toEqual([msg("1", "assistant", "error")]);
    chat().loadMessages([msg("1", "user"), msg("2", "assistant", "error")]);
    useChatStore.setState({ pending: true });
    await chat().retry();
    expect(chat().messages).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("stop, clear and reset", () => {
  it("stops a pending request", async () => {
    seedDeck();
    vi.stubGlobal("fetch", hangingFetch());
    const sending = chat().send("Slow request");
    await vi.waitFor(() => expect(chat().pending).toBe(true));
    chat().stop();
    await sending;
    expect(chat().messages[1]).toMatchObject({ status: "stopped", content: "Stopped." });
    expect(chat().pending).toBe(false);
  });

  it("does nothing when stopping without a pending request", () => {
    chat().loadMessages([msg("1", "user")]);
    chat().stop();
    expect(chat().messages).toEqual([msg("1", "user")]);
    expect(chat().pending).toBe(false);
  });

  it("does not apply a response that arrives after stop", async () => {
    seedDeck();
    const { fetchMock, respond } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const sending = chat().send("Add a slide");
    await vi.waitFor(() => expect(chat().pending).toBe(true));
    chat().stop();
    respond({ reply: "Added", operations: [ADD_SLIDE] });
    await sending;
    expect(currentDeck().slides).toHaveLength(1);
    expect(chat().messages[1].status).toBe("stopped");
  });

  it("clears the conversation and cancels silently", async () => {
    seedDeck();
    vi.stubGlobal("fetch", hangingFetch());
    chat().loadMessages([msg("1", "user"), msg("2", "assistant")]);
    const sending = chat().send("Slow request");
    await vi.waitFor(() => expect(chat().pending).toBe(true));
    chat().clear();
    expect(chat().pending).toBe(false);
    await sending;
    expect(chat().messages).toEqual([]);
    expect(chat().pending).toBe(false);
  });

  it("reset cancels silently and forgets the conversation", async () => {
    seedDeck();
    vi.stubGlobal("fetch", hangingFetch());
    const sending = chat().send("Slow request");
    await vi.waitFor(() => expect(chat().pending).toBe(true));
    chat().reset();
    await sending;
    expect(chat().messages).toEqual([]);
    expect(chat().pending).toBe(false);
  });

  it("a cancelled request doesn't interfere with the next one", async () => {
    seedDeck([createSlide()]);
    vi.stubGlobal("fetch", hangingFetch());
    const first = chat().send("First");
    await vi.waitFor(() => expect(chat().pending).toBe(true));
    chat().clear();
    const { fetchMock, respond } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const second = chat().send("Second");
    await first;
    expect(chat().pending).toBe(true);
    expect(chat().messages.map((m) => m.content)).toEqual(["Second"]);
    respond({ reply: "Done second", operations: [ADD_SLIDE] });
    await second;
    expect(chat().messages.map((m) => m.content)).toEqual(["Second", "Done second"]);
    expect(chat().pending).toBe(false);
    expect(currentDeck().slides).toHaveLength(2);
  });
});

describe("switching presentations", () => {
  it("never applies an answer to a different presentation than the one it was asked about", async () => {
    seedDeck([createSlide()], "First deck");
    const { fetchMock, respond } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const sending = chat().send("Add a slide");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const other = seedDeck([createSlide()], "Second deck");
    respond({ reply: "Added", operations: [ADD_SLIDE] });
    await sending;
    expect(currentDeck().id).toBe(other.id);
    expect(currentDeck().slides).toHaveLength(1);
    expect(editor().past).toEqual([]);
    expect(chat().messages[1]).toMatchObject({ role: "assistant", status: "stopped" });
    expect(chat().pending).toBe(false);
  });

  it("drops the answer silently when the chat was reset for the new presentation", async () => {
    seedDeck([createSlide()], "First deck");
    const { fetchMock, respond } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const sending = chat().send("Add a slide");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    chat().reset();
    seedDeck([createSlide()], "Second deck");
    respond({ reply: "Added", operations: [ADD_SLIDE] });
    await sending;
    expect(currentDeck().slides).toHaveLength(1);
    expect(chat().messages).toEqual([]);
    expect(chat().pending).toBe(false);
  });
});
