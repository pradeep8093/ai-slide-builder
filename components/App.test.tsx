import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "@/lib/store/toastStore";
import type { Route } from "./hooks/useHashRoute";
import App from "./App";

const { editorMounted } = vi.hoisted(() => ({ editorMounted: vi.fn() }));

vi.mock("./Editor", () => ({
  default: function EditorStub({ deckId, onNavigate }: { deckId: string; onNavigate: (route: Route) => void }) {
    // Runs once per mounted instance: a remount (new key) calls it again.
    useEffect(() => {
      editorMounted(deckId);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <div data-testid="editor">
        <p>Editor for {deckId}</p>
        <button type="button" onClick={() => onNavigate({ view: "dashboard" })}>
          Back home
        </button>
        <button type="button" onClick={() => onNavigate({ view: "deck", deckId: "other-deck" })}>
          Open other deck
        </button>
      </div>
    );
  },
}));

vi.mock("./dashboard/Dashboard", () => ({
  default: function DashboardStub({ onOpen }: { onOpen: (deckId: string) => void }) {
    return (
      <div data-testid="dashboard">
        <button type="button" onClick={() => onOpen("deck-1")}>
          Open deck-1
        </button>
      </div>
    );
  },
}));

function setHashSilently(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}

beforeEach(() => {
  setHashSilently("");
  editorMounted.mockReset();
});

describe("App", () => {
  it.each(["", "#/", "#/unknown", "#/deck/", "#/deck/bad id"])("shows the dashboard for %j", (hash) => {
    setHashSilently(hash);
    render(<App />);
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
  });

  it("shows the editor for #/deck/<id>", () => {
    setHashSilently("#/deck/abc-123");
    render(<App />);
    expect(screen.getByText("Editor for abc-123")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
    expect(editorMounted).toHaveBeenCalledWith("abc-123");
  });

  it("opening a deck from the dashboard updates the hash and shows the editor", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open deck-1" }));
    expect(window.location.hash).toBe("#/deck/deck-1");
    expect(await screen.findByText("Editor for deck-1")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("the editor can navigate home and to another deck (with a fresh editor)", async () => {
    const user = userEvent.setup();
    setHashSilently("#/deck/first");
    render(<App />);
    expect(editorMounted).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Open other deck" }));
    expect(window.location.hash).toBe("#/deck/other-deck");
    expect(await screen.findByText("Editor for other-deck")).toBeInTheDocument();
    expect(editorMounted).toHaveBeenCalledTimes(2);
    expect(editorMounted).toHaveBeenLastCalledWith("other-deck");

    await user.click(screen.getByRole("button", { name: "Back home" }));
    expect(window.location.hash).toBe("#/");
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
  });

  it("follows hash changes made outside the app (back button, edited URL)", async () => {
    render(<App />);
    act(() => {
      window.location.hash = "#/deck/typed";
    });
    expect(await screen.findByText("Editor for typed")).toBeInTheDocument();
    act(() => {
      window.location.hash = "#/";
    });
    await waitFor(() => expect(screen.getByTestId("dashboard")).toBeInTheDocument());
  });

  it("renders toasts on every screen", async () => {
    render(<App />);
    act(() => {
      toast.success("Saved on the dashboard");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved on the dashboard");

    act(() => {
      window.location.hash = "#/deck/abc";
    });
    await screen.findByTestId("editor");
    act(() => {
      toast.error("Something failed in the editor");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Something failed in the editor");
    expect(screen.getByText("Saved on the dashboard")).toBeInTheDocument();
  });
});
