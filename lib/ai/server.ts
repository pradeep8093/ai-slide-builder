import { z } from "zod";
import { aiErrorMessage, AiRequestError, type AiErrorCode } from "./errors";
import { buildSystemPrompt, type AiDeckContext } from "./prompt";
import { aiResponseSchema, buildResponseJsonSchema, type AiResponse } from "./schema";

export const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_MODEL = "openai/gpt-oss-120b";
export const REQUEST_TIMEOUT_MS = 90_000;
export const MAX_BODY_CHARS = 400_000;
export const MAX_HISTORY = 12;
export const MAX_MESSAGE_CHARS = 8_000;

const elementViewSchema = z.looseObject({ id: z.string(), type: z.string() });
export const deckContextSchema = z.strictObject({
  title: z.string(),
  slideCount: z.number().int().min(0),
  selectedSlide: z.string().nullable(),
  slides: z.array(
    z.strictObject({
      id: z.string(),
      number: z.number().int(),
      background: z.string().optional(),
      elements: z.array(elementViewSchema).optional(),
      elementsOmitted: z.boolean().optional(),
      summary: z.string().optional(),
    }),
  ),
});

export const chatRequestSchema = z.strictObject({
  messages: z
    .array(z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(MAX_MESSAGE_CHARS) }))
    .min(1)
    .max(50)
    .refine((m) => m.length > 0 && m[m.length - 1].role === "user", "The last message must come from the user"),
  deck: deckContextSchema,
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function readLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig {
  const apiKey = env.LLM_API_KEY?.trim() ?? "";
  if (!apiKey) throw new AiRequestError("missing_api_key", aiErrorMessage("missing_api_key"));
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: env.LLM_MODEL?.trim() || DEFAULT_MODEL,
  };
}

/**
 * Spots the most common setup mistake: a key from one provider used with another provider's URL
 * (Groq keys start with "gsk_", xAI keys with "xai-").
 */
export function keyProviderHint(config: Pick<LlmConfig, "apiKey" | "baseUrl">): string | undefined {
  const host = (() => {
    try {
      return new URL(config.baseUrl).hostname;
    } catch {
      return "";
    }
  })();
  if (host.endsWith("groq.com") && config.apiKey.startsWith("xai-")) {
    return "LLM_API_KEY looks like an xAI key, but LLM_BASE_URL points to Groq. Use https://api.x.ai/v1 with a Grok model, or a Groq key.";
  }
  if (host.endsWith("x.ai") && config.apiKey.startsWith("gsk_")) {
    return "LLM_API_KEY looks like a Groq key, but LLM_BASE_URL points to xAI. Use https://api.groq.com/openai/v1, or an xAI key.";
  }
  return undefined;
}

function fail(code: AiErrorCode, details?: Parameters<typeof aiErrorMessage>[1]): never {
  throw new AiRequestError(code, aiErrorMessage(code, details), details?.retryAfterSeconds);
}

async function providerMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string };
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error.message === "string") return body.error.message;
  } catch {
    // Non-JSON error body; the status code is enough.
  }
  return undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/**
 * Calls an OpenAI-compatible chat completions endpoint (Groq by default) with strict structured
 * output, then validates the answer again with zod before returning it.
 */
export async function generateDeckEdit(
  request: ChatRequest,
  config: LlmConfig,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<AiResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const history = request.messages.slice(-MAX_HISTORY);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "system", content: buildSystemPrompt(request.deck as AiDeckContext) }, ...history],
        response_format: {
          type: "json_schema",
          json_schema: { name: "deck_edit", strict: true, schema: buildResponseJsonSchema() },
        },
        temperature: 0.4,
        max_completion_tokens: 16_384,
      }),
      signal,
    });
  } catch (error) {
    if (timeout.aborted) fail("timeout");
    if (options.signal?.aborted) fail("aborted");
    void error;
    fail("network_error");
  }

  if (!response.ok) {
    const message = await providerMessage(response);
    if (response.status === 401) fail("auth_failed", { providerMessage: message, hint: keyProviderHint(config) });
    if (response.status === 403) fail("forbidden", { providerMessage: message });
    if (response.status === 429) fail("rate_limited", { retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")) });
    fail("upstream_error", { status: response.status, providerMessage: message });
  }

  let payload: { choices?: { finish_reason?: string; message?: { content?: unknown } }[] };
  try {
    payload = await response.json();
  } catch {
    fail("invalid_output");
  }

  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") fail("output_truncated");
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) fail("invalid_output");

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    fail("invalid_output");
  }
  const parsed = aiResponseSchema.safeParse(json);
  if (!parsed.success) fail("invalid_output");
  return parsed.data;
}
