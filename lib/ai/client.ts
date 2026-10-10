import type { Deck } from "../schema";
import type { AiRefs } from "./apply";
import { buildConversationContext, type ConversationMessage } from "./context";
import { aiErrorMessage, AiRequestError, type AiErrorBody } from "./errors";
import { serializeDeckForAi } from "./prompt";
import { aiResponseSchema, type AiOperation } from "./schema";

export type { ChatTurn } from "./context";

export interface AiEditResult {
  reply: string;
  operations: AiOperation[];
  refs: AiRefs;
}

export const AI_ENDPOINT = "/api/ai";

/** Sends the (budgeted) conversation and an image-free snapshot of the deck to the app's AI route. */
export async function requestAiEdit(
  input: { conversation: ConversationMessage[]; deck: Deck; selectedSlideId: string | null },
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AiEditResult> {
  const { context, refs } = serializeDeckForAi(input.deck, input.selectedSlideId);
  const { turns, digest } = buildConversationContext(input.conversation);

  let response: Response;
  try {
    response = await fetchImpl(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: turns, digest, deck: context }),
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
    // An error page that isn't JSON (e.g. a proxy's 504) is reported by its status.
    if (!response.ok) throw new AiRequestError("upstream_error", aiErrorMessage("upstream_error", { status: response.status }));
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
