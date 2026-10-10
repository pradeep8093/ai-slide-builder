import { describe, expect, it, vi } from "vitest";
import { createDeck, createImageElement, createSlide } from "../factory";
import { AiRequestError } from "./errors";
import { AI_ENDPOINT, HISTORY_TURNS, MAX_TURN_CHARS, requestAiEdit } from "./client";

const deck = { ...createDeck("D"), slides: [{ ...createSlide(), elements: [createImageElement("data:image/png;base64,PIXELS", 10, 10)] }] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("requestAiEdit", () => {
  it("posts trimmed history and an image-free deck, and returns refs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ reply: "ok", operations: [] }));
    const history = [
      { role: "assistant" as const, content: "Earlier answer" },
      ...Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` })),
      { role: "user" as const, content: "x".repeat(MAX_TURN_CHARS + 50) },
      { role: "user" as const, content: "   " },
    ];
    const result = await requestAiEdit({ history, deck, selectedSlideId: deck.slides[0].id }, undefined, fetchImpl);
    expect(result.reply).toBe("ok");
    expect(result.refs.slides.S1).toBe(deck.slides[0].id);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(AI_ENDPOINT);
    const body = JSON.parse(init.body);
    expect(body.messages.length).toBeLessThanOrEqual(HISTORY_TURNS);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages.at(-1).content).toHaveLength(MAX_TURN_CHARS);
    expect(init.body).not.toContain("PIXELS");
  });

  it("surfaces server error codes and messages", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: { code: "rate_limited", message: "Busy", retryAfterSeconds: 3 } }, 429));
    await expect(requestAiEdit({ history: [{ role: "user", content: "hi" }], deck, selectedSlideId: null }, undefined, fetchImpl)).rejects.toMatchObject({
      code: "rate_limited",
      message: "Busy",
      retryAfterSeconds: 3,
    });
  });

  it("handles unexpected error bodies and invalid success bodies", async () => {
    const args = { history: [{ role: "user" as const, content: "hi" }], deck, selectedSlideId: null };
    await expect(requestAiEdit(args, undefined, vi.fn().mockResolvedValue(json({ nope: 1 }, 500)))).rejects.toMatchObject({ code: "upstream_error" });
    await expect(requestAiEdit(args, undefined, vi.fn().mockResolvedValue(json({ reply: 1 })))).rejects.toMatchObject({ code: "invalid_output" });
    await expect(requestAiEdit(args, undefined, vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })))).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("distinguishes aborts from an unreachable server", async () => {
    const args = { history: [{ role: "user" as const, content: "hi" }], deck, selectedSlideId: null };
    await expect(requestAiEdit(args, undefined, vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))).rejects.toMatchObject({
      code: "server_unreachable",
    });
    const controller = new AbortController();
    controller.abort();
    const err = await requestAiEdit(args, controller.signal, vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"))).catch((e) => e);
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe("aborted");
    const bodyAbort = await requestAiEdit(
      args,
      controller.signal,
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new DOMException("Aborted", "AbortError")) } as unknown as Response),
    ).catch((e) => e);
    expect(bodyAbort.code).toBe("aborted");
  });
});
