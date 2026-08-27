// The layout contract's arithmetic, as an oracle — dev-docs/stage-contract.md.
//
// These functions produce the EXPECTED numbers: the safe content area a client offers, the
// reference box fit to its short axis, what the long axis does with the difference, and the fixed
// desktop window for a monitor. They are not the runtime. The stylesheet is the runtime
// (index.html's .stage / .screen rules and the container query), and the geometry tests measure
// that in a real engine against what these return. Keeping the arithmetic here, pure and tiny,
// is what lets the contract's fixture table be a tested claim rather than a hand-typed one:
// stage.test.mjs reads the table out of the document and checks every row against these.

/** The long side over the short side of the reference box: 4:3 landscape, 3:4 portrait. */
export const RATIO = 4 / 3;

/**
 * Fit the reference box into a client.
 *
 * @param {object} o
 * @param {number} o.width   viewport width, logical px
 * @param {number} o.height  viewport height, logical px
 * @param {{top?: number, right?: number, bottom?: number, left?: number}} [o.insets]
 *        the OS safe-area insets — status bar, Dynamic Island, home indicator
 * @param {{top?: number, bottom?: number}} [o.bars]
 *        the app's own bars — the top bar, and the bottom tab bar (portrait only; the caller
 *        decides, the chrome rule is not this function's claim)
 * @returns {{
 *   orientation: 'landscape' | 'portrait',
 *   safe: {w: number, h: number},   the stage: viewport less insets less bars
 *   ref: {w: number, h: number},    the reference box fit to the stage's short axis
 *   surplus: number,                long-axis room beyond the reference box — the sheet's to take
 *   paper: number,                  short-axis margin on EACH side when the long axis is too short
 * }}
 */
export function fitStage({ width, height, insets = {}, bars = {} }) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = insets;
  const w = width - left - right;
  const h = height - top - bottom - (bars.top ?? 0) - (bars.bottom ?? 0);
  if (!(w > 0) || !(h > 0)) throw new RangeError(`no stage left: ${w}×${h} after insets and bars`);
  // A square counts as landscape: it is the orientation the desktop reference is designed in.
  const portrait = h > w;
  const [short, long] = portrait ? [w, h] : [h, w];
  const box = (s, l) => (portrait ? { w: s, h: l } : { w: l, h: s });
  const orientation = portrait ? 'portrait' : 'landscape';
  const refLong = short * RATIO;
  if (refLong <= long) {
    return { orientation, safe: { w, h }, ref: box(short, refLong), surplus: long - refLong, paper: 0 };
  }
  // The long axis cannot hold the reference: the box shrinks to it, and the short axis pads.
  const boxShort = long / RATIO;
  return { orientation, safe: { w, h }, ref: box(boxShort, long), surplus: 0, paper: (short - boxShort) / 2 };
}

/**
 * The desktop window's constants. Tuning values, not the contract: k is the share of the work
 * area the window asks for before the clamps; min/max bound the stage's long side; margin keeps
 * the window off the work area's edge when it is height-bound.
 */
export const DESKTOP = Object.freeze({
  landscape: Object.freeze({ k: 0.5, min: 840, max: 1600 }), // of work-area WIDTH; bounds stage width
  portrait: Object.freeze({ k: 0.9, min: 500, max: 1200 }), // of work-area HEIGHT; bounds stage height
  margin: 16,
});

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * The fixed desktop window for a monitor, in logical px.
 *
 * @param {object} o
 * @param {number} o.workW  work-area width (monitor less menu bar / Dock / taskbar), logical px
 * @param {number} o.workH  work-area height, logical px
 * @param {number} o.bar    the app's title bar: 52 on macOS (overlay), 44 on Windows/Linux
 * @param {'landscape' | 'portrait'} o.orientation
 * @param {typeof DESKTOP} [o.constants]
 * @returns {{stage: {w: number, h: number}, window: {w: number, h: number}}}
 */
export function desktopWindow({ workW, workH, bar, orientation, constants = DESKTOP }) {
  const { margin } = constants;
  if (orientation === 'landscape') {
    const { k, min, max } = constants.landscape;
    const w = Math.min(clamp(k * workW, min, max), (workH - bar - margin) * RATIO);
    const h = w / RATIO;
    return { stage: { w, h }, window: { w, h: h + bar } };
  }
  const { k, min, max } = constants.portrait;
  const h = Math.min(clamp(k * workH, min, max), workH - bar - margin);
  const w = h / RATIO;
  return { stage: { w, h }, window: { w, h: h + bar } };
}
