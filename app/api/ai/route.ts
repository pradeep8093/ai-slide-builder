import { aiErrorMessage, AiRequestError, type AiErrorBody, type AiErrorCode } from "@/lib/ai/errors";
import { chatRequestSchema, generateDeckEdit, MAX_BODY_CHARS, readLlmConfig } from "@/lib/ai/server";

const STATUS: Record<AiErrorCode, number> = {
  missing_api_key: 500,
  invalid_request: 400,
  payload_too_large: 413,
  auth_failed: 502,
  forbidden: 502,
  rate_limited: 429,
  timeout: 504,
  invalid_output: 502,
  output_truncated: 502,
  upstream_error: 502,
  network_error: 502,
  server_unreachable: 502,
  aborted: 499,
};

function errorResponse(code: AiErrorCode, message = aiErrorMessage(code), retryAfterSeconds?: number) {
  const body: AiErrorBody = { error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } };
  return Response.json(body, { status: STATUS[code] });
}

/**
 * Proxies a chat turn to the LLM so the API key never reaches the browser.
 * Nothing is stored server-side: the deck lives in the user's browser and is sent with each request.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return errorResponse("payload_too_large");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse("invalid_request", "The request body must be JSON.");
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return errorResponse("invalid_request", `Invalid request: ${issue.path.join(".") || "body"} – ${issue.message}`);
  }

  try {
    const config = readLlmConfig();
    const result = await generateDeckEdit(parsed.data, config, { signal: request.signal });
    return Response.json(result);
  } catch (error) {
    if (error instanceof AiRequestError) return errorResponse(error.code, error.message, error.retryAfterSeconds);
    console.error("[api/ai] unexpected error", error);
    return errorResponse("upstream_error", "Something went wrong while talking to the AI service.");
  }
}
