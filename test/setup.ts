import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetStores } from "./utils";

if (typeof window !== "undefined") {
  // jsdom has no layout engine; components only need ResizeObserver to exist.
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  cleanup();
});
