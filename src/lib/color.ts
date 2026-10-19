// Picks a readable text colour for a business's own accent colour (D-037).
const HEX = /^#[0-9a-fA-F]{6}$/;
type RGB = [number, number, number];

const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;

function luminance([r, g, b]: RGB): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(toRgb(a)), luminance(toRgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The text colour (white or black) with the higher contrast on `bg`. Invalid input falls back to white (the default blue's choice). */
export function readableOn(bg: string | null | undefined): "#FFFFFF" | "#000000" {
  const c = bg && HEX.test(bg) ? bg : "#007AFF";
  return contrastRatio(c, "#FFFFFF") >= contrastRatio(c, "#000000") ? "#FFFFFF" : "#000000";
}
