import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDeck } from "@/test/utils";
import { createSlide } from "@/lib/factory";
import { MAX_PROMPT_CHARS, useChatStore, type ChatMessage } from "@/lib/store/chatStore";
import ChatPanel, { DECK_SUGGESTIONS, EMPTY_DECK_SUGGESTIONS } from "./ChatPanel";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("ChatPanel", () => {
  it("suggests prompts that fit an empty deck", () => {
    seedDeck([]);
    render(<ChatPanel />);
    for (const s of EMPTY_DECK_SUGGESTIONS) expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message the AI assistant" })).toHaveAttribute("placeholder", "Describe the slides you need…");
  });

  it("suggests edits once the deck has slides", () => {
    seedDeck([createSlide()]);
    render(<ChatPanel />);
    for (const s of DECK_SUGGESTIONS) expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
  });

  it("sends a suggestion and shows the reply with the applied changes", async () => {
    const user = userEvent.setup();
    seedDeck([createSlide()]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ reply: "Added a summary slide.", operations: [{ op: "add_slide", position: null, background: null, elements: [] }] })));
    render(<ChatPanel />);
    await user.click(screen.getByRole("button", { name: DECK_SUGGESTIONS[1] }));
    expect(await screen.findByText("Added a summary slide.")).toBeInTheDocument();
    expect(screen.getByText(DECK_SUGGESTIONS[1])).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Changes" })).toHaveTextContent("Added slide 2");
    expect(screen.queryByRole("button", { name: DECK_SUGGESTIONS[0] })).not.toBeInTheDocument();
  });

  it("sends with Enter, keeps Shift+Enter for new lines and ignores blank input", async () => {
    const user = userEvent.setup();
    seedDeck();
    const fetchMock = vi.fn().mockResolvedValue(json({ reply: "ok", operations: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: "Message the AI assistant" });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(input, "   {Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "Line one{Shift>}{Enter}{/Shift}Line two");
    expect(input).toHaveValue("Line one\nLine two");
    await user.keyboard("{Enter}");
    await screen.findByText("ok");
    expect(input).toHaveValue("");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toBe("Line one\nLine two");
  });

  it("submits with the send button", async () => {
    const user = userEvent.setup();
    seedDeck();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ reply: "Sent via button", operations: [] })));
    render(<ChatPanel />);
    await user.type(screen.getByRole("textbox", { name: "Message the AI assistant" }), "Hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Sent via button")).toBeInTheDocument();
  });

  it("shows a thinking state with a stop button", async () => {
    const user = userEvent.setup();
    seedDeck();
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))),
    );
    render(<ChatPanel />);
    await user.type(screen.getByRole("textbox", { name: "Message the AI assistant" }), "Slow{Enter}");
    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Stopped.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows errors with a retry button", async () => {
    const user = userEvent.setup();
    seedDeck();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { code: "missing_api_key", message: "Add LLM_API_KEY to .env.local" } }, 500)));
    render(<ChatPanel />);
    await user.type(screen.getByRole("textbox", { name: "Message the AI assistant" }), "Hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Add LLM_API_KEY to .env.local");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ reply: "Works now", operations: [] })));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Works now")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("summarises long change lists and skipped changes", () => {
    seedDeck();
    const message: ChatMessage = {
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
    act(() => useChatStore.getState().loadMessages([message]));
    render(<ChatPanel />);
    expect(screen.getByText("and 3 more")).toBeInTheDocument();
    expect(screen.getByText("Skipped 2 changes: slide S9 wasn't found")).toBeInTheDocument();
  });

  it("clears the conversation", async () => {
    const user = userEvent.setup();
    seedDeck();
    act(() => useChatStore.getState().loadMessages([{ id: "u", role: "user", content: "Old question", createdAt: 1, status: "ok" }]));
    render(<ChatPanel />);
    expect(screen.getByText("Old question")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("Old question")).not.toBeInTheDocument();
  });

  it("shows a character counter near the limit", async () => {
    seedDeck();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: "Message the AI assistant" });
    expect(input).toHaveAttribute("maxLength", String(MAX_PROMPT_CHARS));
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "x".repeat(MAX_PROMPT_CHARS) } });
    expect(screen.getByText(`${MAX_PROMPT_CHARS}/${MAX_PROMPT_CHARS}`)).toHaveClass("text-red-600");
  });
});
