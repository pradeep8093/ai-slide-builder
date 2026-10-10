// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AiRequestError } from "./errors";
import { chatRequestSchema, DEFAULT_BASE_URL, DEFAULT_MODEL, generateDeckEdit, keyProviderHint, MAX_HISTORY, readLlmConfig, type ChatRequest } from "./server";

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

describe("readLlmConfig", () => {
  it("requires an API key", () => {
    expect(() => readLlmConfig({})).toThrow(AiRequestError);
    expect(() => readLlmConfig({ LLM_API_KEY: "   " })).toThrow(/LLM_API_KEY/);
  });
  it("defaults to Groq and gpt-oss-120b and trims trailing slashes", () => {
    expect(readLlmConfig({ LLM_API_KEY: "k" })).toEqual({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL });
    expect(readLlmConfig({ LLM_API_KEY: "k", LLM_BASE_URL: "https://x.test/v1//", LLM_MODEL: "other" })).toEqual({
      apiKey: "k",
      baseUrl: "https://x.test/v1",
      model: "other",
    });
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
});

describe("generateDeckEdit", () => {
  it("sends a strict structured-output request with the system prompt and recent history", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion({ reply: "Done", operations: [] }));
    const many = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));
    const result = await generateDeckEdit({ ...request, messages: [...many, { role: "user", content: "last" }] }, config, { fetchImpl });
    expect(result).toEqual({ reply: "Done", operations: [] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer secret");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("m");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("CURRENT DECK");
    expect(body.messages).toHaveLength(MAX_HISTORY + 1);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "last" });
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
    await expect(generateDeckEdit(request, config, { fetchImpl: forbidden })).rejects.toThrow(/refused the request \(403\).*does not have access to this model/);
  });

  it("points out a key from the wrong provider", async () => {
    const unauthorized = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const groqWithXaiKey = { baseUrl: "https://api.groq.com/openai/v1", apiKey: "xai-123", model: "m" };
    await expect(generateDeckEdit(request, groqWithXaiKey, { fetchImpl: unauthorized })).rejects.toThrow(/looks like an xAI key, but LLM_BASE_URL points to Groq/);
  });

  it("passes on the retry-after delay and the provider's message", async () => {
    const limited = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "retry-after": "7" } }));
    await expect(generateDeckEdit(request, config, { fetchImpl: limited })).rejects.toMatchObject({ retryAfterSeconds: 7 });
    const dated = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "retry-after": new Date(Date.now() + 5000).toUTCString() } }));
    const err = await generateDeckEdit(request, config, { fetchImpl: dated }).catch((e) => e);
    expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(4);
    const bad = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "model `x` not found" }), { status: 404 }));
    await expect(generateDeckEdit(request, config, { fetchImpl: bad })).rejects.toThrow("model `x` not found");
    const html = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(generateDeckEdit(request, config, { fetchImpl: html })).rejects.toThrow("(502).");
  });

  it("rejects truncated, empty, non-JSON or off-schema output", async () => {
    const cases = [
      completion({ reply: "x", operations: [] }, "length"),
      completion(""),
      completion("not json"),
      completion({ reply: "x", operations: [{ op: "explode" }] }),
      new Response("not json at all", { status: 200 }),
    ];
    const codes = [];
    for (const response of cases) codes.push(await codeOf(generateDeckEdit(request, config, { fetchImpl: vi.fn().mockResolvedValue(response) })));
    expect(codes).toEqual(["output_truncated", "invalid_output", "invalid_output", "invalid_output", "invalid_output"]);
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
