import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDeck, seedDeck } from "@/test/utils";
import { createSlide } from "../factory";
import { MAX_CHAT_MESSAGES, MAX_PROMPT_CHARS, toHistory, useChatStore, type ChatMessage } from "./chatStore";

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function chat() {
  return useChatStore.getState();
}

afterEach(() => vi.unstubAllGlobals());

describe("chatStore", () => {
  it("sends a message, applies the operations and records the changes", async () => {
    seedDeck([createSlide()]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ reply: "Added a slide.", operations: [{ op: "add_slide", position: null, background: null, elements: [] }] }));
    vi.stubGlobal("fetch", fetchMock);
    await chat().send("  Add a slide  ");
    const messages = chat().messages;
    expect(messages.map((m) => [m.role, m.content, m.status])).toEqual([
      ["user", "Add a slide", "ok"],
      ["assistant", "Added a slide.", "ok"],
    ]);
    expect(messages[1].changes).toEqual(["Added slide 2"]);
    expect(currentDeck().slides).toHaveLength(2);
    expect(chat().pending).toBe(false);
  });

  it("ignores empty messages and messages while a request is pending", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await chat().send("   ");
    useChatStore.setState({ pending: true });
    await chat().send("hello");
    expect(chat().messages).toEqual([]);
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

  it("shows errors and retries without duplicating the user message", async () => {
    seedDeck();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "missing_api_key", message: "Add LLM_API_KEY" } }), { status: 500 })));
    await chat().send("Make a deck");
    expect(chat().messages[1]).toMatchObject({ status: "error", content: "Add LLM_API_KEY" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ reply: "Here you go", operations: [] })));
    await chat().retry();
    expect(chat().messages.map((m) => m.content)).toEqual(["Make a deck", "Here you go"]);
    await chat().retry();
    expect(chat().messages).toHaveLength(2);
  });

  it("stops a pending request", async () => {
    seedDeck();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))),
    );
    const sending = chat().send("Slow request");
    await vi.waitFor(() => expect(chat().pending).toBe(true));
    chat().stop();
    await sending;
    expect(chat().messages[1]).toMatchObject({ status: "stopped", content: "Stopped." });
    expect(chat().pending).toBe(false);
  });

  it("clears the conversation and cancels silently", async () => {
    seedDeck();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))),
    );
    const sending = chat().send("Slow request");
    await vi.waitFor(() => expect(chat().pending).toBe(true));
    chat().clear();
    await sending;
    expect(chat().messages).toEqual([]);
    expect(chat().pending).toBe(false);
  });

  it("does not apply a response that arrives after stop", async () => {
    seedDeck();
    let resolve: (r: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    const sending = chat().send("Add a slide");
    await vi.waitFor(() => expect(chat().pending).toBe(true));
    chat().stop();
    resolve(okResponse({ reply: "Added", operations: [{ op: "add_slide", position: null, background: null, elements: [] }] }));
    await sending;
    expect(currentDeck().slides).toHaveLength(1);
    expect(chat().messages[1].status).toBe("stopped");
  });

  it("keeps at most MAX_CHAT_MESSAGES messages", () => {
    const many: ChatMessage[] = Array.from({ length: MAX_CHAT_MESSAGES + 5 }, (_, i) => ({ id: `${i}`, role: "user", content: `${i}`, createdAt: i, status: "ok" }));
    chat().loadMessages(many);
    expect(chat().messages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(chat().messages[0].id).toBe("5");
  });

  it("only sends successful turns as history", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", content: "a", createdAt: 1, status: "ok" },
      { id: "2", role: "assistant", content: "failed", createdAt: 2, status: "error" },
      { id: "3", role: "assistant", content: "b", createdAt: 3, status: "ok" },
    ];
    expect(toHistory(messages)).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
  });
});
