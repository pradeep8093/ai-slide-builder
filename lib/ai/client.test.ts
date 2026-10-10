import { describe, expect, it, vi } from "vitest";
import { createDeck, createImageElement, createSlide, createTableElement, createTextElement } from "../factory";
import type { Deck } from "../schema";
import { AI_ENDPOINT, requestAiEdit } from "./client";
import { buildConversationContext, MAX_TURN_CHARS, type ConversationMessage } from "./context";
import { AiRequestError } from "./errors";
import { serializeDeckForAi } from "./prompt";

const image = { ...createImageElement("data:image/png;base64,PIXELS", 10, 10, "Logo"), crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } };
const deck: Deck = {
  ...createDeck("D"),
  slides: [
    { ...createSlide(), elements: [image, createTextElement({ text: "Hello" })], notes: "Say hi" },
    { ...createSlide(), elements: [createTableElement()] },
  ],
};

const ask: ConversationMessage[] = [{ role: "user", content: "hi" }];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sentBody(fetchImpl: ReturnType<typeof vi.fn>) {
  const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe("requestAiEdit", () => {
  it("posts the budgeted turns, the digest and the deck context, and returns the reply with refs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ reply: "ok", operations: [{ op: "set_title", title: "New" }] }));
    const conversation: ConversationMessage[] = [
      { role: "user", content: "Make a deck" },
      { role: "assistant", content: "Done.", status: "ok", changes: ["Added slide 1"] },
      { role: "user", content: "Rename it" },
    ];
    const controller = new AbortController();
    const result = await requestAiEdit({ conversation, deck, selectedSlideId: deck.slides[1].id }, controller.signal, fetchImpl);

    expect(result.reply).toBe("ok");
    expect(result.operations).toEqual([{ op: "set_title", title: "New" }]);
    expect(result.refs.slides).toEqual({ S1: deck.slides[0].id, S2: deck.slides[1].id });
    expect(result.refs.elements.E1).toEqual({ slideId: deck.slides[0].id, elementId: image.id });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AI_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.signal).toBe(controller.signal);

    const { turns, digest } = buildConversationContext(conversation);
    const { context } = serializeDeckForAi(deck, deck.slides[1].id);
    expect(JSON.parse(init.body as string)).toEqual({ messages: turns, digest, deck: context });
    expect(JSON.parse(init.body as string).deck.selectedSlide).toBe("S2");
  });

  it("sends a null digest when the whole conversation fits", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ reply: "ok", operations: [] }));
    await requestAiEdit({ conversation: ask, deck, selectedSlideId: null }, undefined, fetchImpl);
    const body = sentBody(fetchImpl);
    expect(body.digest).toBeNull();
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.deck.selectedSlide).toBeNull();
  });

  it("condenses long conversations and leaves out failed messages", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ reply: "ok", operations: [] }));
    const conversation: ConversationMessage[] = [
      ...Array.from({ length: 40 }, (_, i): ConversationMessage =>
        i % 2 === 0 ? { role: "user", content: `request ${i}` } : { role: "assistant", content: `reply ${i}`, status: "ok", changes: [`change ${i}`] },
      ),
      { role: "user", content: "x".repeat(MAX_TURN_CHARS + 50) },
      { role: "assistant", content: "The AI service is busy.", status: "error" },
      { role: "user", content: "latest" },
    ];
    await requestAiEdit({ conversation, deck, selectedSlideId: deck.slides[0].id }, undefined, fetchImpl);
    const body = sentBody(fetchImpl);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "latest" });
    expect(body.messages.at(-2).content).toHaveLength(MAX_TURN_CHARS);
    expect(JSON.stringify(body.messages)).not.toContain("The AI service is busy.");
    expect(body.digest).toContain("- User asked: request 0");
    expect(body.digest).toContain("- Assistant changed: change 1");
    expect(body.digest).not.toContain("The AI service is busy.");
  });

  it("never sends image data, but keeps alt text, notes and tables", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ reply: "ok", operations: [] }));
    await requestAiEdit({ conversation: ask, deck, selectedSlideId: null }, undefined, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const raw = init.body as string;
    expect(raw).not.toContain("PIXELS");
    expect(raw).not.toContain("data:image");
    expect(raw).not.toContain('"src"');
    expect(raw).not.toContain('"crop"');
    expect(raw).toContain("Logo");
    expect(raw).toContain("Say hi");
    expect(raw).toContain("Header 1");
  });

  it("surfaces server error codes, messages and retry delays", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: { code: "rate_limited", message: "Busy", retryAfterSeconds: 3 } }, 429));
    const err = await requestAiEdit({ conversation: ask, deck, selectedSlideId: null }, undefined, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err).toMatchObject({ code: "rate_limited", message: "Busy", retryAfterSeconds: 3 });

    const auth = vi.fn().mockResolvedValue(json({ error: { code: "auth_failed", message: "The AI provider rejected the API key." } }, 502));
    await expect(requestAiEdit({ conversation: ask, deck, selectedSlideId: null }, undefined, auth)).rejects.toMatchObject({
      code: "auth_failed",
      message: "The AI provider rejected the API key.",
      retryAfterSeconds: undefined,
    });
  });

  it("falls back to a generic upstream error for unexpected error bodies", async () => {
    const args = { conversation: ask, deck, selectedSlideId: null };
    await expect(requestAiEdit(args, undefined, vi.fn().mockResolvedValue(json({ nope: 1 }, 500)))).rejects.toMatchObject({
      code: "upstream_error",
      message: "The AI service returned an error (500).",
    });
    // An error object without a string code is not trusted either.
    await expect(requestAiEdit(args, undefined, vi.fn().mockResolvedValue(json({ error: { message: "x", code: 7 } }, 400)))).rejects.toMatchObject({
      code: "upstream_error",
      message: "The AI service returned an error (400).",
    });
  });

  it("reports a non-JSON error response as an upstream error with its status", async () => {
    const args = { conversation: ask, deck, selectedSlideId: null };
    const gateway = vi.fn().mockResolvedValue(new Response("<html>Gateway Timeout</html>", { status: 504 }));
    await expect(requestAiEdit(args, undefined, gateway)).rejects.toMatchObject({ code: "upstream_error", message: "The AI service returned an error (504)." });
  });

  it("rejects success responses that are not valid AI output", async () => {
    const args = { conversation: ask, deck, selectedSlideId: null };
    await expect(requestAiEdit(args, undefined, vi.fn().mockResolvedValue(json({ reply: 1 })))).rejects.toMatchObject({ code: "invalid_output" });
    await expect(requestAiEdit(args, undefined, vi.fn().mockResolvedValue(json({ reply: "x", operations: [{ op: "explode" }] })))).rejects.toMatchObject({
      code: "invalid_output",
    });
    await expect(requestAiEdit(args, undefined, vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })))).rejects.toMatchObject({
      code: "invalid_output",
      message: "The AI returned a response the editor couldn't use. Please try again.",
    });
  });

  it("reports an unreachable app server", async () => {
    const args = { conversation: ask, deck, selectedSlideId: null };
    const err = await requestAiEdit(args, undefined, vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))).catch((e) => e);
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err).toMatchObject({ code: "server_unreachable", message: "Couldn't reach the app server. Make sure it's still running." });
  });

  it("distinguishes aborts from an unreachable server", async () => {
    const args = { conversation: ask, deck, selectedSlideId: null };
    // An AbortError is an abort even without a signal.
    await expect(requestAiEdit(args, undefined, vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")))).rejects.toMatchObject({
      code: "aborted",
      message: "Stopped.",
    });

    const controller = new AbortController();
    controller.abort();
    // Any fetch failure after the caller aborted counts as an abort.
    await expect(requestAiEdit(args, controller.signal, vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))).rejects.toMatchObject({
      code: "aborted",
    });
    // Aborting while the body is being read is an abort too.
    const bodyAbort = await requestAiEdit(
      args,
      controller.signal,
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new DOMException("Aborted", "AbortError")) } as unknown as Response),
    ).catch((e) => e);
    expect(bodyAbort).toBeInstanceOf(AiRequestError);
    expect(bodyAbort.code).toBe("aborted");
    // ...but a body that fails to parse without an abort is invalid output.
    const unreadable = await requestAiEdit(
      args,
      new AbortController().signal,
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) } as unknown as Response),
    ).catch((e) => e);
    expect(unreadable.code).toBe("invalid_output");
  });
});
