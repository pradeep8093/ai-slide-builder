import { afterEach, describe, expect, it, vi } from "vitest";
import { isApplePlatform, isTypingTarget, shortcutLabel } from "./platform";

describe("platform helpers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("detects Apple platforms", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(isApplePlatform()).toBe(true);
    expect(shortcutLabel("Z")).toBe("⌘Z");
    expect(shortcutLabel("Z", { shift: true })).toBe("⇧⌘Z");
  });

  it("uses Ctrl elsewhere", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    expect(isApplePlatform()).toBe(false);
    expect(shortcutLabel("Z")).toBe("Ctrl+Z");
    expect(shortcutLabel("Z", { shift: true })).toBe("Ctrl+Shift+Z");
  });

  it("recognises typing targets", () => {
    const text = document.createElement("input");
    const color = document.createElement("input");
    color.type = "color";
    const area = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    const button = document.createElement("button");
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(select)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(color)).toBe(false);
    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
