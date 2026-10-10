import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { parseHash, routeToHash, useHashRoute, type Route } from "./useHashRoute";

/** Replaces the URL without firing hashchange, so tests start from a known hash. */
function setHashSilently(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}

beforeEach(() => {
  setHashSilently("");
});

describe("parseHash", () => {
  it("opens a presentation for #/deck/<id>", () => {
    expect(parseHash("#/deck/abc-123")).toEqual({ view: "deck", deckId: "abc-123" });
    expect(parseHash("#/deck/0f8fad5b-d9cb-469f-a165-70867728950e")).toEqual({ view: "deck", deckId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
    expect(parseHash(`#/deck/${"a".repeat(100)}`)).toEqual({ view: "deck", deckId: "a".repeat(100) });
  });

  it("falls back to the dashboard for anything else", () => {
    for (const hash of [
      "",
      "#",
      "#/",
      "#/deck",
      "#/deck/",
      "#/deck/abc/extra",
      "#/deck/abc?x=1",
      "#/deck/a b",
      "#/deck/a_b",
      "#/deck/<script>",
      "#/deck/%2e%2e",
      `#/deck/${"a".repeat(101)}`,
      "#deck/abc",
      "/deck/abc",
      "#/DECK/abc",
      "#/decks/abc",
      " #/deck/abc",
    ]) {
      expect(parseHash(hash), hash).toEqual({ view: "dashboard" });
    }
  });
});

describe("routeToHash", () => {
  it("writes the hash for each view", () => {
    expect(routeToHash({ view: "dashboard" })).toBe("#/");
    expect(routeToHash({ view: "deck", deckId: "abc-123" })).toBe("#/deck/abc-123");
  });

  it("round-trips through parseHash", () => {
    const routes: Route[] = [{ view: "dashboard" }, { view: "deck", deckId: "abc-123" }];
    for (const route of routes) expect(parseHash(routeToHash(route))).toEqual(route);
  });
});

describe("useHashRoute", () => {
  it("reads the current hash", () => {
    setHashSilently("#/deck/xyz");
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toEqual({ view: "deck", deckId: "xyz" });
  });

  it("shows the dashboard when there is no hash", () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toEqual({ view: "dashboard" });
  });

  it("follows hashchange events (e.g. the back button or an edited URL)", async () => {
    const { result } = renderHook(() => useHashRoute());
    setHashSilently("#/deck/one");
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current[0]).toEqual({ view: "deck", deckId: "one" });

    act(() => {
      window.location.hash = "#/";
    });
    await vi.waitFor(() => expect(result.current[0]).toEqual({ view: "dashboard" }));

    act(() => {
      window.location.hash = "#/deck/two";
    });
    await vi.waitFor(() => expect(result.current[0]).toEqual({ view: "deck", deckId: "two" }));
  });

  it("navigate() writes the hash and the route follows", async () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => result.current[1]({ view: "deck", deckId: "abc" }));
    expect(window.location.hash).toBe("#/deck/abc");
    await vi.waitFor(() => expect(result.current[0]).toEqual({ view: "deck", deckId: "abc" }));

    act(() => result.current[1]({ view: "dashboard" }));
    expect(window.location.hash).toBe("#/");
    await vi.waitFor(() => expect(result.current[0]).toEqual({ view: "dashboard" }));
  });

  it("navigate() does nothing when the route is already showing", async () => {
    setHashSilently("#/deck/same");
    const { result } = renderHook(() => useHashRoute());
    const onHashChange = vi.fn();
    window.addEventListener("hashchange", onHashChange);
    const historyLength = window.history.length;
    try {
      act(() => result.current[1]({ view: "deck", deckId: "same" }));
      // Give a (wrongly) queued hashchange the chance to fire.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onHashChange).not.toHaveBeenCalled();
      expect(window.history.length).toBe(historyLength);
      expect(window.location.hash).toBe("#/deck/same");
      expect(result.current[0]).toEqual({ view: "deck", deckId: "same" });
    } finally {
      window.removeEventListener("hashchange", onHashChange);
    }
  });

  it("keeps navigate stable across renders and stops listening on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { result, rerender, unmount } = renderHook(() => useHashRoute());
    const navigate = result.current[1];
    rerender();
    expect(result.current[1]).toBe(navigate);
    unmount();
    expect(remove).toHaveBeenCalledWith("hashchange", expect.any(Function));
  });
});
