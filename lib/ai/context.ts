/**
 * Decides what part of a long conversation is sent to the model. Recent turns go word for word
 * within a token budget; anything older is condensed (without extra AI calls) into a short digest
 * of what the user asked and what changed, so the model keeps the thread without the full text.
 */

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  status?: "ok" | "error" | "stopped";
  /** Human-readable list of changes the AI applied (assistant messages). */
  changes?: string[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Rough token estimate (≈ 4 characters per token for English text and JSON). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const HISTORY_TOKEN_BUDGET = 8_000;
export const DIGEST_TOKEN_BUDGET = 1_500;
export const MAX_VERBATIM_TURNS = 20;
export const MAX_TURN_CHARS = 4_000;
const DIGEST_LINE_CHARS = 160;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function digestLine(message: ConversationMessage): string | null {
  if (message.role === "user") return `- User asked: ${clip(message.content, DIGEST_LINE_CHARS)}`;
  const changes = message.changes ?? [];
  if (changes.length === 0) return `- Assistant replied: ${clip(message.content, DIGEST_LINE_CHARS)}`;
  const shown = changes.slice(0, 4).join("; ");
  const more = changes.length > 4 ? ` (+${changes.length - 4} more)` : "";
  return `- Assistant changed: ${clip(shown, DIGEST_LINE_CHARS)}${more}`;
}

export interface ConversationContext {
  /** Recent turns sent verbatim; always starts with a user turn and ends with the latest user turn. */
  turns: ChatTurn[];
  /** Condensed summary of older turns, or null when everything fit. */
  digest: string | null;
  /** How many older messages were condensed into the digest. */
  condensedCount: number;
}

/**
 * Splits the conversation into verbatim recent turns and a digest of older ones.
 * Failed or stopped exchanges are left out entirely so they can't confuse the model.
 */
export function buildConversationContext(
  messages: ConversationMessage[],
  budgets: { history?: number; digest?: number } = {},
): ConversationContext {
  const historyBudget = budgets.history ?? HISTORY_TOKEN_BUDGET;
  const digestBudget = budgets.digest ?? DIGEST_TOKEN_BUDGET;
  const usable = messages.filter((m) => (m.status ?? "ok") === "ok" && m.content.trim());

  // Walk back from the newest message, keeping turns while they fit (the newest always fits, clipped).
  let used = 0;
  let start = usable.length;
  for (let i = usable.length - 1; i >= 0; i -= 1) {
    const content = usable[i].content.slice(0, MAX_TURN_CHARS);
    const cost = estimateTokens(content);
    const isNewest = i === usable.length - 1;
    if (!isNewest && (used + cost > historyBudget || usable.length - i > MAX_VERBATIM_TURNS)) break;
    used += cost;
    start = i;
  }
  // The model expects the conversation to start with the user.
  while (start < usable.length && usable[start].role !== "user") start += 1;

  const turns = usable.slice(start).map((m) => ({ role: m.role, content: m.content.slice(0, MAX_TURN_CHARS) }));
  const older = usable.slice(0, start);
  if (older.length === 0) return { turns, digest: null, condensedCount: 0 };

  // Keep the most recent digest lines that fit; note how many earlier ones were dropped.
  const lines: string[] = [];
  let digestUsed = 0;
  let dropped = 0;
  for (let i = older.length - 1; i >= 0; i -= 1) {
    const line = digestLine(older[i]);
    if (!line) continue;
    const cost = estimateTokens(line);
    if (digestUsed + cost > digestBudget) {
      dropped = i + 1;
      break;
    }
    digestUsed += cost;
    lines.unshift(line);
  }
  if (dropped > 0) lines.unshift(`- (${dropped} earlier message${dropped === 1 ? "" : "s"} not shown)`);
  return { turns, digest: lines.join("\n"), condensedCount: older.length };
}
