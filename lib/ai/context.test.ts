import { describe, expect, it } from "vitest";
import {
  buildConversationContext,
  DIGEST_TOKEN_BUDGET,
  estimateTokens,
  HISTORY_TOKEN_BUDGET,
  MAX_TURN_CHARS,
  MAX_VERBATIM_TURNS,
  type ConversationMessage,
} from "./context";

function user(content: string, status?: ConversationMessage["status"]): ConversationMessage {
  return { role: "user", content, ...(status ? { status } : {}) };
}

function assistant(content: string, changes?: string[], status?: ConversationMessage["status"]): ConversationMessage {
  return { role: "assistant", content, ...(changes ? { changes } : {}), ...(status ? { status } : {}) };
}

/** Alternating user/assistant messages that start and end with a user message. */
function alternating(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? user(`question ${i}`) : assistant(`answer ${i}`)));
}

describe("estimateTokens", () => {
  it("counts roughly four characters per token, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("x".repeat(4000))).toBe(1000);
  });
});

describe("buildConversationContext", () => {
  it("applies the default history budget when none is given", () => {
    const content = "q".repeat(MAX_TURN_CHARS);
    const fitting = Math.min(MAX_VERBATIM_TURNS, Math.floor(HISTORY_TOKEN_BUDGET / estimateTokens(content)));
    const messages = Array.from({ length: fitting + 3 }, () => user(content));
    const { turns, condensedCount } = buildConversationContext(messages);
    expect(turns).toHaveLength(fitting);
    expect(condensedCount).toBe(3);
  });

  it("returns nothing for an empty conversation", () => {
    expect(buildConversationContext([])).toEqual({ turns: [], digest: null, condensedCount: 0 });
  });

  it("sends a short conversation word for word without a digest", () => {
    const messages = [user("Make a title slide"), assistant("Done.", ["Added slide 1"]), user("Now make it blue\nplease")];
    expect(buildConversationContext(messages)).toEqual({
      turns: [
        { role: "user", content: "Make a title slide" },
        { role: "assistant", content: "Done." },
        { role: "user", content: "Now make it blue\nplease" },
      ],
      digest: null,
      condensedCount: 0,
    });
  });

  it("only uses messages with status ok (a missing status counts as ok) and skips blank ones", () => {
    const messages = [
      user("First"),
      assistant("The AI service is busy", undefined, "error"),
      user("Second", "ok"),
      assistant("Stopped.", undefined, "stopped"),
      assistant("   \n "),
      user("Third"),
    ];
    const { turns, digest, condensedCount } = buildConversationContext(messages);
    expect(turns).toEqual([
      { role: "user", content: "First" },
      { role: "user", content: "Second" },
      { role: "user", content: "Third" },
    ]);
    expect(digest).toBeNull();
    expect(condensedCount).toBe(0);
  });

  it("returns nothing when no message is usable", () => {
    const messages = [user("  "), assistant("Oops", undefined, "error"), assistant("Stopped.", undefined, "stopped")];
    expect(buildConversationContext(messages)).toEqual({ turns: [], digest: null, condensedCount: 0 });
  });

  it("always starts the verbatim turns with a user turn, condensing a leading assistant message", () => {
    const { turns, digest, condensedCount } = buildConversationContext([assistant("Hi! What should we build?"), user("A pitch deck")]);
    expect(turns).toEqual([{ role: "user", content: "A pitch deck" }]);
    expect(digest).toBe("- Assistant replied: Hi! What should we build?");
    expect(condensedCount).toBe(1);
  });

  it("keeps at most MAX_VERBATIM_TURNS recent turns", () => {
    const messages = Array.from({ length: MAX_VERBATIM_TURNS + 5 }, (_, i) => user(`m${i}`));
    const { turns, condensedCount, digest } = buildConversationContext(messages);
    expect(turns).toHaveLength(MAX_VERBATIM_TURNS);
    expect(turns[0].content).toBe("m5");
    expect(turns.at(-1)?.content).toBe(`m${MAX_VERBATIM_TURNS + 4}`);
    expect(condensedCount).toBe(5);
    expect(digest?.split("\n")).toEqual(["- User asked: m0", "- User asked: m1", "- User asked: m2", "- User asked: m3", "- User asked: m4"]);
  });

  it("drops an assistant turn at the start of the window so the turns begin with the user", () => {
    const messages = alternating(MAX_VERBATIM_TURNS + 5);
    const { turns, condensedCount } = buildConversationContext(messages);
    expect(turns.length).toBeLessThanOrEqual(MAX_VERBATIM_TURNS);
    expect(turns[0].role).toBe("user");
    expect(turns.at(-1)).toEqual({ role: "user", content: messages.at(-1)?.content });
    expect(condensedCount + turns.length).toBe(messages.length);
    // Turns alternate, so the window holds one turn less than the maximum.
    expect(turns).toHaveLength(MAX_VERBATIM_TURNS - 1);
  });

  it("stops adding older turns once the history budget is used up", () => {
    // Each message is 20 characters = 5 tokens; a budget of 10 tokens fits the newest two.
    const messages = [user("u1".padEnd(20, ".")), assistant("a1".padEnd(20, ".")), user("u2".padEnd(20, ".")), assistant("a2".padEnd(20, ".")), user("u3".padEnd(20, "."))];
    const { turns, condensedCount } = buildConversationContext(messages, { history: 10 });
    // The newest two are "a2" and "u3", but turns can't start with the assistant.
    expect(turns).toEqual([{ role: "user", content: messages[4].content }]);
    expect(condensedCount).toBe(4);

    const roomier = buildConversationContext(messages, { history: 15 });
    expect(roomier.turns.map((t) => t.content.slice(0, 2))).toEqual(["u2", "a2", "u3"]);
    expect(roomier.condensedCount).toBe(2);
  });

  it("always includes the newest message even when it alone exceeds the budget, clipped to MAX_TURN_CHARS", () => {
    const huge = "z".repeat(MAX_TURN_CHARS * 3);
    const { turns, condensedCount } = buildConversationContext([user("old"), assistant("reply"), user(huge)], { history: 1 });
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toBe("z".repeat(MAX_TURN_CHARS));
    expect(condensedCount).toBe(2);
  });

  it("clips long verbatim turns and charges only the clipped length against the budget", () => {
    const long = "w".repeat(MAX_TURN_CHARS + 1000);
    const perTurn = estimateTokens("w".repeat(MAX_TURN_CHARS));
    // Room for exactly three clipped turns (it would only be two if the full length counted).
    const messages = [user(long), user(long), user(long), user(long)];
    const { turns, condensedCount } = buildConversationContext(messages, { history: perTurn * 3 });
    expect(turns).toHaveLength(3);
    for (const turn of turns) expect(turn.content).toHaveLength(MAX_TURN_CHARS);
    expect(condensedCount).toBe(1);
  });

  it("returns plain role/content turns without statuses or change lists", () => {
    const { turns } = buildConversationContext([user("Go", "ok"), assistant("Done", ["Added slide 1"], "ok"), user("Again")]);
    for (const turn of turns) expect(Object.keys(turn).sort()).toEqual(["content", "role"]);
  });

  describe("digest of older messages", () => {
    it("summarizes user requests and assistant replies, collapsing whitespace", () => {
      const messages = [user("Make   a\n deck about\tcats"), assistant("Which  style\nwould you like?"), user("Latest")];
      const { digest, condensedCount, turns } = buildConversationContext(messages, { history: 1 });
      expect(turns).toEqual([{ role: "user", content: "Latest" }]);
      expect(condensedCount).toBe(2);
      expect(digest).toBe("- User asked: Make a deck about cats\n- Assistant replied: Which style would you like?");
    });

    it("lists what the assistant changed (at most four changes, then a count)", () => {
      const messages = [
        user("Build it"),
        assistant("Done.", ["Added slide 1", "Added slide 2"]),
        assistant("All done.", ["c1", "c2", "c3", "c4", "c5", "c6"]),
        assistant("Nothing to do.", []),
        user("Latest"),
      ];
      const { digest } = buildConversationContext(messages, { history: 1 });
      expect(digest?.split("\n")).toEqual([
        "- User asked: Build it",
        "- Assistant changed: Added slide 1; Added slide 2",
        "- Assistant changed: c1; c2; c3; c4 (+2 more)",
        "- Assistant replied: Nothing to do.",
      ]);
    });

    it("clips long digest lines to 160 characters", () => {
      const long = "a".repeat(500);
      const { digest } = buildConversationContext(
        [user(long), assistant("ok", ["b".repeat(300), "c", "d", "e", "f"]), user("Latest")],
        { history: 1 },
      );
      const [askedLine, changedLine] = digest?.split("\n") ?? [];
      expect(askedLine).toBe(`- User asked: ${"a".repeat(160)}…`);
      expect(changedLine).toBe(`- Assistant changed: ${"b".repeat(160)}… (+1 more)`);
    });

    it("leaves out failed exchanges from the digest too", () => {
      const messages = [user("Old"), assistant("Rate limited", undefined, "error"), assistant("Stopped.", undefined, "stopped"), user("Latest")];
      const { digest, condensedCount } = buildConversationContext(messages, { history: 1 });
      expect(digest).toBe("- User asked: Old");
      expect(condensedCount).toBe(1);
    });

    it("keeps the most recent lines that fit the digest budget and notes how many were left out", () => {
      const messages = ["a0", "a1", "a2", "a3", "a4", "latest"].map((m) => user(m));
      // "- User asked: aN" is 16 characters = 4 tokens, so 8 tokens fit two lines.
      expect(estimateTokens("- User asked: a0")).toBe(4);
      const { digest, condensedCount, turns } = buildConversationContext(messages, { history: 1, digest: 8 });
      expect(turns).toEqual([{ role: "user", content: "latest" }]);
      expect(condensedCount).toBe(5);
      expect(digest).toBe("- (3 earlier messages not shown)\n- User asked: a3\n- User asked: a4");
    });

    it("uses the singular when one earlier message is left out", () => {
      const messages = ["a0", "a1", "a2", "latest"].map((m) => user(m));
      const { digest } = buildConversationContext(messages, { history: 1, digest: 8 });
      expect(digest).toBe("- (1 earlier message not shown)\n- User asked: a1\n- User asked: a2");
    });

    it("still reports the condensed messages when no digest line fits", () => {
      const messages = ["a0", "a1", "latest"].map((m) => user(m));
      const { digest, condensedCount } = buildConversationContext(messages, { history: 1, digest: 0 });
      expect(digest).toBe("- (2 earlier messages not shown)");
      expect(condensedCount).toBe(2);
    });

    it("keeps the digest within the default budget for very long conversations", () => {
      const messages = alternating(201).map((m) => ({ ...m, content: `${m.content} ${"lorem ipsum ".repeat(40)}` }));
      const { turns, digest, condensedCount } = buildConversationContext(messages);
      expect(turns[0].role).toBe("user");
      expect(turns.at(-1)?.content).toBe(messages.at(-1)?.content);
      const verbatimTokens = turns.reduce((sum, t) => sum + estimateTokens(t.content), 0);
      expect(verbatimTokens).toBeLessThanOrEqual(HISTORY_TOKEN_BUDGET);
      expect(condensedCount).toBe(messages.length - turns.length);
      const lines = digest?.split("\n") ?? [];
      expect(lines[0]).toMatch(/^- \(\d+ earlier messages not shown\)$/);
      const shown = lines.slice(1).join("\n");
      expect(lines.slice(1).reduce((sum, line) => sum + estimateTokens(line), 0)).toBeLessThanOrEqual(DIGEST_TOKEN_BUDGET);
      // The most recent condensed message is the last digest line.
      expect(shown.endsWith(`- Assistant replied: ${messages[condensedCount - 1].content.replace(/\s+/g, " ").trim().slice(0, 160)}…`)).toBe(true);
    });
  });
});
