import { describe, expect, it } from "vitest";
import { toast, useToastStore } from "./toastStore";

describe("toastStore", () => {
  it("pushes, de-duplicates and dismisses toasts", () => {
    const id = toast.info("Hello");
    toast.info("Hello");
    toast.success("Done");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["Hello", "Done"]);
    useToastStore.getState().dismiss(useToastStore.getState().toasts[0].id);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["Done"]);
    expect(typeof id).toBe("string");
  });

  it("keeps at most four toasts", () => {
    for (let i = 0; i < 6; i += 1) toast.error(`e${i}`);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["e2", "e3", "e4", "e5"]);
    useToastStore.getState().clear();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
