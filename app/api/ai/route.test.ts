// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_CHARS } from "@/lib/ai/server";
import { POST } from "./route";

const validBody = {
  messages: [{ role: "user", content: "Add a slide" }],
  deck: { title: "", slideCount: 0, selectedSlide: null, slides: [] },
};

function post(body: unknown, raw?: string) {
  return POST(new Request("http://localhost/api/ai", { method: "POST", body: raw ?? JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
}

describe("POST /api/ai", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://llm.test/v1";
    process.env.LLM_MODEL = "test-model";
  });
  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  it("returns the model's reply and operations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "Added", operations: [{ op: "set_title", title: "X" }] }) } }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: "Added", operations: [{ op: "set_title", title: "X" }] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://llm.test/v1/chat/completions");
  });

  it("rejects non-JSON and invalid bodies with 400", async () => {
    const bad = await post(null, "{nope");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_request");
    const invalid = await post({ ...validBody, messages: [] });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.message).toMatch(/Invalid request: messages/);
  });

  it("rejects oversized bodies with 413", async () => {
    const res = await post(null, "x".repeat(MAX_BODY_CHARS + 1));
    expect(res.status).toBe(413);
  });

  it("explains a missing API key", async () => {
    delete process.env.LLM_API_KEY;
    const res = await post(validBody);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("missing_api_key");
    expect(body.error.message).toContain("LLM_API_KEY");
  });

  it("forwards rate limits with retry information", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "retry-after": "9" } })));
    const res = await post(validBody);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 9 });
  });

  it("hides unexpected errors behind a generic message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) }));
    const res = await post(validBody);
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("upstream_error");
    expect(spy).toHaveBeenCalled();
  });
});
