/** True on macOS/iOS, where shortcuts use ⌘ instead of Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Formats a shortcut for tooltips, e.g. shortcutLabel("Z", { shift: true }) → "⇧⌘Z" or "Ctrl+Shift+Z". */
export function shortcutLabel(key: string, options: { shift?: boolean } = {}): string {
  if (isApplePlatform()) return `${options.shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${options.shift ? "Shift+" : ""}${key}`;
}

/** Whether keyboard focus is in a place where typing must not trigger editor shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "color", "submit", "reset", "file"].includes(type);
  }
  return false;
}
