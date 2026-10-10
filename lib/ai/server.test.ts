// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createChartElement, createDeck, createImageElement, createShapeElement, createSlide, createTableElement, createTextElement } from "../factory";
import type { Deck } from "../schema";
import { buildConversationContext, type ConversationMessage } from "./context";
import { AiRequestError } from "./errors";
import { serializeDeckForAi } from "./prompt";
import { buildResponseJsonSchema } from "./schema";
import {
  chatRequestSchema,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  generateDeckEdit,
  keyProviderHint,
  MAX_DIGEST_CHARS,
  MAX_HISTORY,
  MAX_MESSAGE_CHARS,
  readLlmConfig,
  type ChatRequest,
} from "./server";

const request: ChatRequest = {
  messages: [{ role: "user", content: "Add a title slide" }],
  deck: { title: "", slideCount: 0, selectedSlide: null, slides: [] },
};
const config = { baseUrl: "https://llm.test/v1", apiKey: "secret", model: "m" };

function completion(content: unknown, finish = "stop") {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof AiRequestError ? error.code : "other";
  }
  return "resolved";
}

function sentBody(fetchImpl: ReturnType<typeof vi.fn>) {
  const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

function richDeck(): Deck {
  const grouped = "group-a";
  return {
    ...createDeck("Plan"),
    slides: [
      {
        ...createSlide("#0f172a", "Welcome everyone"),
        elements: [
          createTextElement({ text: "Title", locked: true }),
          createShapeElement("ellipse", { groupId: grouped }),
          createShapeElement("rectangle", { groupId: grouped }),
          createImageElement("data:image/png;base64,AAAA", 100, 100, "Logo"),
        ],
      },
      { ...createSlide(), elements: [createChartElement("bar", { stacked: true, showValues: true, dualAxis: false }), createTableElement()] },
    ],
  };
}

describe("readLlmConfig", () => {
  it("requires an API key", () => {
    expect(() => readLlmConfig({})).toThrow(AiRequestError);
    expect(() => readLlmConfig({ LLM_API_KEY: "   " })).toThrow(/LLM_API_KEY/);
  });
  it("defaults to Groq and gpt-oss-120b and trims trailing slashes", () => {
    expect(readLlmConfig({ LLM_API_KEY: "k" })).toEqual({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL });
    expect(readLlmConfig({ LLM_API_KEY: " k ", LLM_BASE_URL: "https://x.test/v1//", LLM_MODEL: "other" })).toEqual({
      apiKey: "k",
      baseUrl: "https://x.test/v1",
      model: "other",
    });
    expect(readLlmConfig({ LLM_API_KEY: "k", LLM_BASE_URL: "  ", LLM_MODEL: " " })).toEqual({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL });
  });
});

describe("keyProviderHint", () => {
  it("detects keys used with the other provider's URL", () => {
    expect(keyProviderHint({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "xai-abc" })).toMatch(/xAI key/);
    expect(keyProviderHint({ baseUrl: "https://api.x.ai/v1", apiKey: "gsk_abc" })).toMatch(/Groq key/);
  });
  it("stays quiet when the key matches or the URL is unknown", () => {
    expect(keyProviderHint({ baseUrl: "https://api.x.ai/v1", apiKey: "xai-abc" })).toBeUndefined();
    expect(keyProviderHint({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk_abc" })).toBeUndefined();
    expect(keyProviderHint({ baseUrl: "https://llm.example.com/v1", apiKey: "xai-abc" })).toBeUndefined();
    expect(keyProviderHint({ baseUrl: "not a url", apiKey: "xai-abc" })).toBeUndefined();
  });
});

describe("chatRequestSchema", () => {
  it("requires the last message to be from the user", () => {
    expect(chatRequestSchema.safeParse(request).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...request, messages: [{ role: "assistant", content: "hi" }] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, messages: [] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
  });

  it("limits message count and length", () => {
    const many = Array.from({ length: 51 }, () => ({ role: "user" as const, content: "x" }));
    expect(chatRequestSchema.safeParse({ ...request, messages: many }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, messages: many.slice(1) }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...request, messages: [{ role: "user", content: "" }] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, messages: [{ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS) }] }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...request, messages: [{ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS + 1) }] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, messages: [{ role: "system", content: "x" }] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, messages: [{ role: "user", content: "x", status: "ok" }] }).success).toBe(false);
  });

  it("accepts an optional, nullable digest up to MAX_DIGEST_CHARS", () => {
    expect(chatRequestSchema.safeParse({ ...request, digest: null }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...request, digest: "- User asked: hi" }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...request, digest: "d".repeat(MAX_DIGEST_CHARS) }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...request, digest: "d".repeat(MAX_DIGEST_CHARS + 1) }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, digest: 5 }).success).toBe(false);
  });

  it("accepts slide views with notes, abbreviated slides and loose element views", () => {
    const deck = {
      title: "T",
      slideCount: 2,
      selectedSlide: "S1",
      slides: [
        { id: "S1", number: 1, background: "#ffffff", notes: "Speaker notes", elements: [{ id: "E1", type: "table", rows: [["a"]], locked: true, group: "G1" }] },
        { id: "S2", number: 2, elementsOmitted: true, summary: "empty slide" },
      ],
    };
    expect(chatRequestSchema.safeParse({ ...request, deck }).success).toBe(true);
    // Slide views are strict; element views need an id and a type.
    expect(chatRequestSchema.safeParse({ ...request, deck: { ...deck, slides: [{ ...deck.slides[0], extra: 1 }] } }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, deck: { ...deck, slides: [{ ...deck.slides[0], notes: 3 }] } }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, deck: { ...deck, slides: [{ id: "S1", number: 1, elements: [{ id: "E1" }] }] } }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, deck: { ...deck, slideCount: -1 } }).success).toBe(false);
  });

  it("accepts what the client sends, even for large decks and long conversations", () => {
    const deck = richDeck();
    const conversation: ConversationMessage[] = Array.from({ length: 201 }, (_, i) =>
      i % 2 === 0
        ? { role: "user", content: `request ${i} ${"words ".repeat(700)}` }
        : { role: "assistant", content: `reply ${i}`, status: "ok", changes: Array.from({ length: 6 }, (_, c) => `change ${c} ${"x".repeat(50)}`) },
    );
    const { turns, digest } = buildConversationContext(conversation);
    expect(digest).not.toBeNull();
    for (const selected of [deck.slides[0].id, null]) {
      for (const maxChars of [undefined, 200]) {
        const { context } = serializeDeckForAi(deck, selected, maxChars);
        const parsed = chatRequestSchema.safeParse({ messages: turns, digest, deck: context });
        expect(parsed.success).toBe(true);
      }
    }
  });
});

describe("generateDeckEdit", () => {
  it("sends a strict structured-output request with the system prompt and recent history", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion({ reply: "Done", operations: [] }));
    const many = Array.from({ length: MAX_HISTORY + 6 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));
    const result = await generateDeckEdit({ ...request, messages: [...many, { role: "user", content: "last" }] }, config, { fetchImpl });
    expect(result).toEqual({ reply: "Done", operations: [] });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("m");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "deck_edit", strict: true, schema: buildResponseJsonSchema() },
    });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("CURRENT DECK");
    expect(body.messages).toHaveLength(MAX_HISTORY + 1);
    expect(body.messages[1]).toEqual(many[many.length - MAX_HISTORY + 1]);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "last" });
  });

  it("puts the deck context and the digest in the system prompt", async () => {
    const deck = richDeck();
    const { context } = serializeDeckForAi(deck, deck.slides[0].id);
    const fetchImpl = vi.fn().mockResolvedValue(completion({ reply: "Done", operations: [] }));
    await generateDeckEdit({ ...request, deck: context, digest: "  - User asked: make it blue  " }, config, { fetchImpl });
    const system: string = sentBody(fetchImpl).messages[0].content;
    expect(system).toContain("EARLIER IN THIS CONVERSATION");
    expect(system).toContain("\n- User asked: make it blue\n");
    expect(system.indexOf("EARLIER IN THIS CONVERSATION")).toBeLessThan(system.lastIndexOf("CURRENT DECK\n"));
    expect(system).toContain(JSON.stringify(context));
    expect(system).toContain("Welcome everyone");
  });

  it("leaves out the earlier-conversation section without a digest", async () => {
    for (const digest of [undefined, null, "   "]) {
      const fetchImpl = vi.fn().mockResolvedValue(completion({ reply: "Done", operations: [] }));
      await generateDeckEdit({ ...request, digest }, config, { fetchImpl });
      expect(sentBody(fetchImpl).messages[0].content).not.toContain("EARLIER IN THIS CONVERSATION");
    }
  });

  it.each([
    [401, "auth_failed"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [400, "upstream_error"],
    [500, "upstream_error"],
  ])("maps HTTP %s to %s", async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "nope" } }), { status }));
    expect(await codeOf(generateDeckEdit(request, config, { fetchImpl }))).toBe(code);
  });

  it("shows the provider's reason for rejected keys and refused requests", async () => {
    const unauthorized = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Incorrect API key provided: xa***yz." }), { status: 401 }));
    await expect(generateDeckEdit(request, config, { fetchImpl: unauthorized })).rejects.toThrow(
      "The AI provider rejected the API key. Check LLM_API_KEY in .env.local. The provider said: “Incorrect API key provided: xa***yz.”",
    );
    const forbidden = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Your team does not have access to this model." } }), { status: 403 }));
    const err = await generateDeckEdit(request, config, { fetchImpl: forbidden }).catch((e) => e);
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe("forbidden");
    expect(err.message).toMatch(/refused the request \(403\).*does not have access to this model/);
  });

  it("points out a key from the wrong provider, together with the provider's message", async () => {
    const groqWithXaiKey = { baseUrl: "https://api.groq.com/openai/v1", apiKey: "xai-123", model: "m" };
    const unauthorized = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(generateDeckEdit(request, groqWithXaiKey, { fetchImpl: unauthorized })).rejects.toThrow(/looks like an xAI key, but LLM_BASE_URL points to Groq/);

    const withMessage = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 }));
    const err = await generateDeckEdit(request, groqWithXaiKey, { fetchImpl: withMessage }).catch((e) => e);
    expect(err.code).toBe("auth_failed");
    expect(err.message).toBe(
      "The AI provider rejected the API key. LLM_API_KEY looks like an xAI key, but LLM_BASE_URL points to Groq. Use https://api.x.ai/v1 with a Grok model, or a Groq key. The provider said: “Invalid API Key”",
    );
    expect(err.message).not.toContain("Check LLM_API_KEY in .env.local.");
  });

  it("passes on the retry-after delay and the provider's message", async () => {
    const limited = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "retry-after": "7" } }));
    await expect(generateDeckEdit(request, config, { fetchImpl: limited })).rejects.toMatchObject({ retryAfterSeconds: 7 });
    const dated = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "retry-after": new Date(Date.now() + 5000).toUTCString() } }));
    const err = await generateDeckEdit(request, config, { fetchImpl: dated }).catch((e) => e);
    expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(4);
    const noHeader = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(generateDeckEdit(request, config, { fetchImpl: noHeader })).rejects.toMatchObject({ retryAfterSeconds: undefined });
    const bad = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "model `x` not found" }), { status: 404 }));
    await expect(generateDeckEdit(request, config, { fetchImpl: bad })).rejects.toThrow("model `x` not found");
    const html = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(generateDeckEdit(request, config, { fetchImpl: html })).rejects.toThrow("(502).");
  });

  it("returns validated operations, including notes and tables", async () => {
    const answer = {
      reply: "Added notes and a table",
      operations: [
        { op: "set_slide_notes", slideId: "S1", notes: "Say hello" },
        { op: "add_element", slideId: "S1", element: { type: "table", x: 0, y: 0, width: 400, height: 200, rows: [["a", "b"]], headerRow: true, fontSize: null } },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(completion(answer));
    await expect(generateDeckEdit(request, config, { fetchImpl })).resolves.toEqual(answer);
  });

  it("rejects truncated, empty, non-JSON or off-schema output", async () => {
    const cases = [
      completion({ reply: "x", operations: [] }, "length"),
      completion(""),
      completion("not json"),
      completion({ reply: "x", operations: [{ op: "explode" }] }),
      new Response("not json at all", { status: 200 }),
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    ];
    const codes = [];
    for (const response of cases) codes.push(await codeOf(generateDeckEdit(request, config, { fetchImpl: vi.fn().mockResolvedValue(response) })));
    expect(codes).toEqual(["output_truncated", "invalid_output", "invalid_output", "invalid_output", "invalid_output", "invalid_output"]);
  });

  it("reports network failures and caller aborts", async () => {
    expect(await codeOf(generateDeckEdit(request, config, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")) }))).toBe("network_error");
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    expect(await codeOf(generateDeckEdit(request, config, { fetchImpl, signal: controller.signal }))).toBe("aborted");
  });

  it("reports timeouts", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort());
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    expect(await codeOf(generateDeckEdit(request, config, { fetchImpl }))).toBe("timeout");
    spy.mockRestore();
  });
});
