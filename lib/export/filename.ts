export const UNTITLED = "Untitled presentation";

/** A filesystem-safe file name derived from the deck title. */
export function exportFileName(title: string, extension: "pdf" | "pptx"): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return `${base || UNTITLED}.${extension}`;
}
