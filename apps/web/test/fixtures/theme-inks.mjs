// The two tokens a moved sticker's mark is chosen between (plan E14), and the off-grey a flat picture draws an unlit
// sticker in, per theme — READ from tokens.css, never typed here, so a token that moves moves the tests with it.
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../../tokens.css', import.meta.url), 'utf8');

/** The first block opened by `selector`, as text. */
function block(selector) {
  const at = CSS.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`theme-inks: no block "${selector}" in tokens.css`);
  return CSS.slice(at, CSS.indexOf('}', at));
}

const hexIn = (text, token) => {
  const m = new RegExp(`${token}:\\s*#([0-9A-Fa-f]{6})\\b`).exec(text);
  if (!m) throw new Error(`theme-inks: ${token} is not a hex colour in its block`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
};

const inksOf = (text) => Object.freeze({ ink: hexIn(text, '--ink'), ground: hexIn(text, '--panel'), off: hexIn(text, '--facelet-off') });

/** `{ white, cream, night }`: each `{ ink, ground, off }` as sRGB triples. */
export const THEME_INKS = Object.freeze({
  cream: inksOf(block(':root')),
  white: inksOf(block(':root[data-theme="white"], :root:not([data-theme])')),
  night: inksOf(block(':root[data-theme="night"]')),
});
