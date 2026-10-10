const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

/**
 * Normalizes user/AI supplied colors to lowercase `#rrggbb`.
 * Accepts `#rgb` and `#rrggbb` (with or without the leading `#`). Anything else returns null.
 */
export function normalizeColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (!value.startsWith("#")) value = `#${value}`;
  if (HEX6.test(value)) return value.toLowerCase();
  const short = HEX3.exec(value);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function channel(hex: string, offset: number): number {
  const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const normalized = normalizeColor(hex) ?? "#ffffff";
  return 0.2126 * channel(normalized, 1) + 0.7152 * channel(normalized, 3) + 0.0722 * channel(normalized, 5);
}

/** True when white text reads better than near-black text on this background. */
export function isDarkColor(hex: string): boolean {
  const l = relativeLuminance(hex);
  const contrastWithWhite = 1.05 / (l + 0.05);
  const contrastWithBlack = (l + 0.05) / 0.05;
  return contrastWithWhite > contrastWithBlack;
}

/** Ink colors for text drawn directly on a slide background (chart axes, legends, labels). */
export function inkFor(background: string): { primary: string; secondary: string; grid: string } {
  return isDarkColor(background)
    ? { primary: "#f0efec", secondary: "#c3c2b7", grid: "rgba(255,255,255,0.16)" }
    : { primary: "#0b0b0b", secondary: "#52514e", grid: "rgba(0,0,0,0.10)" };
}
