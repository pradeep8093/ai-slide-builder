import type { Deck } from "../schema";
import type { AiRefs } from "./apply";
import { aiErrorMessage, AiRequestError, type AiErrorBody } from "./errors";
import { serializeDeckForAi } from "./prompt";
import { aiResponseSchema, type AiOperation } from "./schema";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiEditResult {
  reply: string;
  operations: AiOperation[];
  refs: AiRefs;
}

export const AI_ENDPOINT = "/api/ai";
export const HISTORY_TURNS = 12;
export const MAX_TURN_CHARS = 4_000;

/** Sends the conversation and a snapshot of the deck to the app's AI route. */
export async function requestAiEdit(
  input: { history: ChatTurn[]; deck: Deck; selectedSlideId: string | null },
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AiEditResult> {
  const { context, refs } = serializeDeckForAi(input.deck, input.selectedSlideId);
  const messages = input.history
    .filter((turn) => turn.content.trim())
    .slice(-HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_TURN_CHARS) }));
  // The model only sees assistant replies after the first user message.
  while (messages.length > 0 && messages[0].role === "assistant") messages.shift();

  let response: Response;
  try {
    response = await fetchImpl(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, deck: context }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new AiRequestError("aborted", aiErrorMessage("aborted"));
    }
    throw new AiRequestError("server_unreachable", aiErrorMessage("server_unreachable"));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (signal?.aborted) throw new AiRequestError("aborted", aiErrorMessage("aborted"));
    throw new AiRequestError("invalid_output", aiErrorMessage("invalid_output"));
  }

  if (!response.ok) {
    const error = (body as Partial<AiErrorBody>)?.error;
    if (error && typeof error.message === "string" && typeof error.code === "string") {
      throw new AiRequestError(error.code, error.message, error.retryAfterSeconds);
    }
    throw new AiRequestError("upstream_error", aiErrorMessage("upstream_error", { status: response.status }));
  }

  const parsed = aiResponseSchema.safeParse(body);
  if (!parsed.success) throw new AiRequestError("invalid_output", aiErrorMessage("invalid_output"));
  return { reply: parsed.data.reply, operations: parsed.data.operations, refs };
}
