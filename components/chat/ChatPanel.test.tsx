import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentDeck, editor, seedDeck, slideWith } from "@/test/utils";
import { createSlide, createTextElement } from "@/lib/factory";
import { AI_ENDPOINT } from "@/lib/ai/client";
import { buildConversationContext, MAX_TURN_CHARS } from "@/lib/ai/context";
import type { AiOperation } from "@/lib/ai/schema";
import { MAX_PROMPT_CHARS, useChatStore, type ChatMessage } from "@/lib/store/chatStore";
import ChatPanel, { DECK_SUGGESTIONS, EMPTY_DECK_SUGGESTIONS } from "./ChatPanel";

// Requests go through the real requestAiEdit (lib/ai/client), which posts the budgeted conversation
// to the app's AI route; only the network is stubbed, like the other chat tests do.
const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function reply(text: string, operations: AiOperation[] = []) {
  return json({ reply: text, operations });
}

/** A request that never answers on its own and fails like fetch does once aborted. */
function hangUntilAborted(_url: string, init: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
}

interface SentBody {
  messages: { role: string; content: string }[];
  digest: string | null;
  deck: { selectedSlide: string | null; slideCount: number };
}

function sent(call = 0): SentBody {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  expect(url).toBe(AI_ENDPOINT);
  return JSON.parse(String(init.body)) as SentBody;
}

let nextId = 0;
function message(role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  nextId += 1;
  return { id: `m${nextId}`, role, content, createdAt: nextId, status: "ok", ...extra };
}

function input() {
  return screen.getByRole("textbox", { name: "Message the AI assistant" });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  useChatStore.getState().clear();
  vi.unstubAllGlobals();
});

describe("ChatPanel", () => {
  it("suggests prompts that fit an empty deck", () => {
    seedDeck([]);
    render(<ChatPanel />);
    for (const s of EMPTY_DECK_SUGGESTIONS) expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    for (const s of DECK_SUGGESTIONS) expect(screen.queryByRole("button", { name: s })).not.toBeInTheDocument();
    expect(screen.getByText("Describe the presentation you need and I'll draft the slides.")).toBeInTheDocument();
    expect(input()).toHaveAttribute("placeholder", "Describe the slides you need…");
  });

  it("suggests edits once the deck has slides, including speaker notes", () => {
    seedDeck([createSlide()]);
    render(<ChatPanel />);
    expect(DECK_SUGGESTIONS).toContain("Write speaker notes for every slide");
    for (const s of DECK_SUGGESTIONS) expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    expect(screen.getByText(/I can change text, layout, colors, charts, tables and speaker notes\./)).toBeInTheDocument();
    expect(input()).toHaveAttribute("placeholder", "Ask AI to edit your slides…");
  });

  it("sends a suggestion and shows the reply with the applied changes", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide()]);
    fetchMock.mockResolvedValue(reply("Added a summary slide.", [{ op: "add_slide", position: null, background: null, notes: null, elements: [] }]));
    render(<ChatPanel />);
    await user.click(screen.getByRole("button", { name: DECK_SUGGESTIONS[1] }));
    expect(await screen.findByText("Added a summary slide.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sent();
    expect(body.messages).toEqual([{ role: "user", content: DECK_SUGGESTIONS[1] }]);
    expect(body.digest).toBeNull();
    expect(body.deck).toMatchObject({ slideCount: 1, selectedSlide: "S1" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByText(DECK_SUGGESTIONS[1])).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Changes" })).toHaveTextContent("Added slide 2");
    expect(currentDeck().slides).toHaveLength(2);
    expect(screen.queryByRole("button", { name: DECK_SUGGESTIONS[0] })).not.toBeInTheDocument();
  });

  it("writes speaker notes for every slide from the suggestion", async () => {
    const user = userEvent.setup();
    seedDeck([slideWith(createTextElement({ text: "Intro" })), createSlide()]);
    fetchMock.mockResolvedValue(
      reply("Added speaker notes.", [
        { op: "set_slide_notes", slideId: "S1", notes: "Welcome everyone." },
        { op: "set_slide_notes", slideId: "S2", notes: "Wrap up." },
      ]),
    );
    render(<ChatPanel />);
    await user.click(screen.getByRole("button", { name: "Write speaker notes for every slide" }));
    expect(await screen.findByText("Added speaker notes.")).toBeInTheDocument();
    expect(sent().messages).toEqual([{ role: "user", content: "Write speaker notes for every slide" }]);
    expect(currentDeck().slides.map((s) => s.notes)).toEqual(["Welcome everyone.", "Wrap up."]);
    const changes = screen.getByRole("list", { name: "Changes" });
    expect(changes).toHaveTextContent("Updated the speaker notes of slide 1");
    expect(changes).toHaveTextContent("Updated the speaker notes of slide 2");
  });

  it("sends the earlier conversation with the new message", async () => {
    const user = userEvent.setup();
    const deck = seedDeck([createSlide(), createSlide()]);
    act(() => editor().selectSlide(deck.slides[1].id));
    act(() =>
      useChatStore
        .getState()
        .loadMessages([
          message("user", "First question"),
          message("assistant", "First answer", { changes: ["Added slide 2"] }),
          message("user", "Failed question"),
          message("assistant", "Network down", { status: "error" }),
        ]),
    );
    fetchMock.mockResolvedValue(reply("Second answer"));
    render(<ChatPanel />);
    await user.type(input(), "Second question{Enter}");
    expect(await screen.findByText("Second answer")).toBeInTheDocument();
    const body = sent();
    // Failed replies are left out of what the model sees.
    expect(body.messages).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Failed question" },
      { role: "user", content: "Second question" },
    ]);
    expect(body.digest).toBeNull();
    expect(body.deck.selectedSlide).toBe("S2");
  });

  it("sends with Enter, keeps Shift+Enter for new lines and ignores blank input", async () => {
    const user = userEvent.setup();
    seedDeck();
    fetchMock.mockResolvedValue(reply("ok"));
    render(<ChatPanel />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(input(), "   {Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.clear(input());
    await user.type(input(), "Line one{Shift>}{Enter}{/Shift}Line two");
    expect(input()).toHaveValue("Line one\nLine two");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await screen.findByText("ok");
    expect(input()).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent().messages.at(-1)?.content).toBe("Line one\nLine two");
  });

  it("submits with the send button and trims the message", async () => {
    const user = userEvent.setup();
    seedDeck();
    fetchMock.mockResolvedValue(reply("Sent via button"));
    render(<ChatPanel />);
    await user.type(input(), "  Hi  ");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Sent via button")).toBeInTheDocument();
    expect(sent().messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("shows a thinking state with a stop button, then a stopped note with retry", async () => {
    const user = userEvent.setup();
    seedDeck();
    fetchMock.mockImplementation(hangUntilAborted);
    render(<ChatPanel />);
    await user.type(input(), "Slow{Enter}");
    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    // Another message can't be sent while waiting.
    await user.type(input(), "Again{Enter}");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Stopped.")).toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(reply("Done this time"));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Done this time")).toBeInTheDocument();
    expect(screen.queryByText("Stopped.")).not.toBeInTheDocument();
    expect(sent().messages).toEqual([{ role: "user", content: "Slow" }]);
  });

  it("shows errors with a retry button that resends without the failed reply", async () => {
    const user = userEvent.setup();
    seedDeck();
    fetchMock.mockResolvedValue(json({ error: { code: "missing_api_key", message: "Add LLM_API_KEY to .env.local" } }, 500));
    render(<ChatPanel />);
    await user.type(input(), "Hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Add LLM_API_KEY to .env.local");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(reply("Works now"));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Works now")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent().messages).toEqual([{ role: "user", content: "Hello" }]);
    // The user's message is not duplicated.
    expect(screen.getAllByText("Hello")).toHaveLength(1);
  });

  it("explains when the app server can't be reached", async () => {
    const user = userEvent.setup();
    seedDeck();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ChatPanel />);
    await user.type(input(), "Hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the app server.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("only offers retry on the latest message", () => {
    seedDeck();
    act(() =>
      useChatStore
        .getState()
        .loadMessages([
          message("user", "One"),
          message("assistant", "Old failure", { status: "error" }),
          message("user", "Two"),
          message("assistant", "Fine"),
        ]),
    );
    render(<ChatPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("Old failure");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("summarises long change lists and skipped changes", () => {
    seedDeck();
    const assistant: ChatMessage = {
      id: "a",
      role: "assistant",
      content: "Did lots",
      createdAt: 1,
      status: "ok",
      changes: Array.from({ length: 9 }, (_, i) => `Change ${i}`),
      skipped: [
        { op: "delete_slide", reason: "slide S9 wasn't found" },
        { op: "delete_slide", reason: "slide S9 wasn't found" },
      ],
    };
    act(() => useChatStore.getState().loadMessages([assistant]));
    render(<ChatPanel />);
    const changes = screen.getByRole("list", { name: "Changes" });
    expect(changes.querySelectorAll("li")).toHaveLength(7);
    expect(changes).toHaveTextContent("Change 5");
    expect(changes).not.toHaveTextContent("Change 6");
    expect(screen.getByText("and 3 more")).toBeInTheDocument();
    expect(screen.getByText("Skipped 2 changes: slide S9 wasn't found")).toBeInTheDocument();
  });

  it("uses the singular for one skipped change", () => {
    seedDeck();
    act(() => useChatStore.getState().loadMessages([message("assistant", "Partly", { skipped: [{ op: "update_element", reason: "element E1 is locked" }] })]));
    render(<ChatPanel />);
    expect(screen.getByText("Skipped 1 change: element E1 is locked")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Changes" })).not.toBeInTheDocument();
  });

  it("clears the conversation", async () => {
    const user = userEvent.setup();
    seedDeck();
    render(<ChatPanel />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    act(() => useChatStore.getState().loadMessages([message("user", "Old question")]));
    expect(screen.getByText("Old question")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("Old question")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: DECK_SUGGESTIONS[0] })).toBeInTheDocument();
  });

  it("clearing while waiting cancels the request silently", async () => {
    const user = userEvent.setup();
    seedDeck();
    fetchMock.mockImplementation(hangUntilAborted);
    render(<ChatPanel />);
    await user.type(input(), "Slow{Enter}");
    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.queryByText("Stopped.")).not.toBeInTheDocument();
    expect(screen.queryByText("Slow")).not.toBeInTheDocument();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("shows a character counter near the limit", () => {
    seedDeck();
    render(<ChatPanel />);
    expect(input()).toHaveAttribute("maxLength", String(MAX_PROMPT_CHARS));
    fireEvent.change(input(), { target: { value: "x".repeat(MAX_PROMPT_CHARS * 0.8) } });
    expect(screen.queryByText(`${MAX_PROMPT_CHARS * 0.8}/${MAX_PROMPT_CHARS}`)).not.toBeInTheDocument();
    fireEvent.change(input(), { target: { value: "x".repeat(MAX_PROMPT_CHARS * 0.8 + 1) } });
    expect(screen.getByText(`${MAX_PROMPT_CHARS * 0.8 + 1}/${MAX_PROMPT_CHARS}`)).not.toHaveClass("text-red-600");
    fireEvent.change(input(), { target: { value: "x".repeat(MAX_PROMPT_CHARS) } });
    expect(screen.getByText(`${MAX_PROMPT_CHARS}/${MAX_PROMPT_CHARS}`)).toHaveClass("text-red-600");
  });

  describe("condensed history note", () => {
    const long = (label: string) => `${label} ${"x".repeat(MAX_TURN_CHARS)}`;

    it("does not appear for a short conversation", () => {
      seedDeck();
      act(() => useChatStore.getState().loadMessages([message("user", "Hi"), message("assistant", "Hello")]));
      render(<ChatPanel />);
      expect(screen.queryByTestId("chat-condensed")).not.toBeInTheDocument();
    });

    it("tells how many older messages are sent as a summary", () => {
      seedDeck();
      const history = Array.from({ length: 10 }, (_, i) => message(i % 2 === 0 ? "user" : "assistant", long(`Message ${i}`)));
      expect(buildConversationContext(history).condensedCount).toBe(2);
      act(() => useChatStore.getState().loadMessages(history));
      render(<ChatPanel />);
      expect(screen.getByTestId("chat-condensed")).toHaveTextContent(
        "To stay within the AI's limits, the 2 oldest messages are sent as a short summary.",
      );
    });

    it("uses the singular for a single condensed message", () => {
      seedDeck();
      // Consecutive user messages happen when failed replies are left out of the context.
      const history = Array.from({ length: 9 }, (_, i) => message("user", long(`Question ${i}`)));
      act(() => useChatStore.getState().loadMessages(history));
      render(<ChatPanel />);
      expect(screen.getByTestId("chat-condensed")).toHaveTextContent("To stay within the AI's limits, the 1 oldest message is sent as a short summary.");
    });

    it("condenses older turns once there are more than the verbatim turn limit", () => {
      seedDeck();
      const history = Array.from({ length: 22 }, (_, i) => message(i % 2 === 0 ? "user" : "assistant", `Short ${i}`));
      act(() => useChatStore.getState().loadMessages(history));
      render(<ChatPanel />);
      expect(screen.getByTestId("chat-condensed")).toHaveTextContent("the 2 oldest messages are sent");
    });

    it("ignores failed and stopped messages when deciding what to condense", () => {
      seedDeck();
      const failures = Array.from({ length: 12 }, (_, i) => message("assistant", long(`Failure ${i}`), { status: i % 2 === 0 ? "error" : "stopped" }));
      act(() => useChatStore.getState().loadMessages([message("user", "Hi"), ...failures]));
      render(<ChatPanel />);
      expect(screen.queryByTestId("chat-condensed")).not.toBeInTheDocument();
    });

    it("appears as the conversation grows, matches what is sent and goes away when cleared", async () => {
      const user = userEvent.setup();
      seedDeck();
      const history = Array.from({ length: 8 }, (_, i) => message(i % 2 === 0 ? "user" : "assistant", long(`Message ${i}`)));
      act(() => useChatStore.getState().loadMessages(history));
      render(<ChatPanel />);
      expect(screen.queryByTestId("chat-condensed")).not.toBeInTheDocument();
      fetchMock.mockResolvedValue(reply("Short answer"));
      fireEvent.change(input(), { target: { value: "One more question" } });
      await user.click(screen.getByRole("button", { name: "Send" }));
      expect(await screen.findByText("Short answer")).toBeInTheDocument();
      expect(screen.getByTestId("chat-condensed")).toHaveTextContent("the 2 oldest messages are sent");
      // The two oldest messages went to the model as a digest; the rest verbatim.
      const body = sent();
      expect(body.messages).toHaveLength(7);
      expect(body.messages[0].content.startsWith("Message 2")).toBe(true);
      expect(body.messages.at(-1)).toEqual({ role: "user", content: "One more question" });
      expect(body.digest).toContain("- User asked: Message 0");
      expect(body.digest).toContain("- Assistant replied: Message 1");
      await user.click(screen.getByRole("button", { name: "Clear" }));
      expect(screen.queryByTestId("chat-condensed")).not.toBeInTheDocument();
    });
  });
});
