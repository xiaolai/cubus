// WCAG 2 contrast between two sRGB colours, for a choice the app makes between two of its own tokens: which one a moved
// sticker's mark is drawn in (lib/case-photo.js `markInk`, dev-docs/practice-redesign-plan.md E14). Pure, and nothing in
// it reaches a cube: the 0.05 below is WCAG's flare term.

/** WCAG relative luminance of an sRGB triple, 0–255 a channel. */
export function luminance(rgb) {
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** The contrast ratio of two sRGB triples, 1 to 21. */
export function contrastOf(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
