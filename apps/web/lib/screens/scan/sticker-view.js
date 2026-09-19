// The scan screen's sticker view: where the camera sees each sticker, drawn from the scanner's boxes
// (2026-09-19; dev-docs/scan-guidance-plan.md 4.1, the study's "dots" arm).
//
// A frame shaped like the camera's picture, and in it a square for every sticker the detector found
// on the latest frame, in its colour and at its place. It is NOT a camera picture — the owner's call
// (D2, 2026-09-18): nothing the camera sees is ever drawn but the stickers it read. The squares are
// mirrored unless the camera faces away from the person, so they move the way the hand does. The nine
// a side was fitted to are outlined as one face, and the frame's edge fills as that read settles —
// the READING state, never the capture, which is the chime's and the tile's.
//
// What it can show is what the detector found. A covered lens, the wrong camera and a cube out of view
// all draw the same empty frame (the plan's §9, round 2): it is a view of detections, and the study
// asks whether children can use it. It is drawn only while the study's setting is on and a scan is
// reading: an ask for a side back keeps the twin, which is drawing that ask
// (lib/screens/scan/confirm-hold.js), and so does a finished scan.

import { t } from '../../i18n.js';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * @param {object} deps `slot`, the element the twin sits in, whose `seen-on` class hides the twin
 *   while this shows; `classColor(i)`, a colour class's paint; `enabled()`, whether the study's arm is
 *   on, read at every report.
 */
export function createStickerView({ slot, classColor, enabled }) {
  const view = slot.ownerDocument.createElement('div');
  view.className = 'scan-seen';
  view.hidden = true;
  view.setAttribute('role', 'img');
  view.setAttribute('aria-label', t('Where the camera sees stickers'));
  const svg = slot.ownerDocument.createElementNS(SVG, 'svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  view.appendChild(svg);
  slot.appendChild(view);

  /** An SVG element with `attrs` set — built, never parsed, so no report can become markup. */
  const el = (name, attrs) => {
    const node = slot.ownerDocument.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };

  /** Draw one report's frame, or hand the slot back to the twin. */
  const show = (p) => {
    // Only while the scanner is READING: the boxes are the camera's, and a painting, a check, a
    // camera error or a scan that has not started has no camera behind them (audit, 2026-09-19).
    const on = enabled() && p.phase === 'scanning' && !p.complete && !p.confirm && p.seen != null;
    view.hidden = !on;
    // The twin is hidden by a class on THIS screen's slot, never by an attribute on the twin: the
    // twin is the page's one parked `<cubus-cube>`, and a `hidden` it still wore when the screen was
    // left went with it to the next screen, whose cube was then not drawn at all — `recycle()` resets
    // only the renderer's own attributes (round-3 audit). The slot goes with the screen.
    slot.classList.toggle('seen-on', on);
    if (!on) return;
    const { width: w, height: h, stickers } = p.seen;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const mirror = p.device?.facing !== 'environment';
    const s = p.settling;
    const settle = s ? Math.min(1, s.run / s.needed, s.heldMs / s.neededMs) : 0;
    const edge = Math.max(2, Math.round(Math.min(w, h) / 120));
    const outline = { x: edge / 2, y: edge / 2, width: w - edge, height: h - edge, rx: edge * 4 };
    const group = el('g', mirror ? { class: 'seen-stickers', transform: `translate(${w} 0) scale(-1 1)` } : { class: 'seen-stickers' });
    for (const k of stickers) {
      const side = Math.min(k.w * w, k.h * h);
      group.appendChild(el('rect', {
        class: k.inFace ? 'seen-sticker in-face' : 'seen-sticker',
        x: k.x * w - side / 2, y: k.y * h - side / 2, width: side, height: side, rx: side / 8,
        // A palette colour, or the unknown sticker's `var(--facelet-off)`: `style`, because a CSS
        // variable is not reliably honoured in an SVG presentation attribute.
        style: `fill:${classColor(k.colour)}`, 'fill-opacity': (0.45 + 0.55 * k.confidence).toFixed(2),
        // Every sticker wears the net's hairline (white on the sunk panel is otherwise a hole); the
        // nine of the face being read wear the ink outline, twice as wide.
        'stroke-width': k.inFace ? edge : edge / 2,
      }));
    }
    svg.replaceChildren(
      el('rect', { class: 'seen-frame', ...outline, 'stroke-width': edge }),
      el('rect', { class: 'seen-settle', ...outline, 'stroke-width': edge * 2, pathLength: 1, 'stroke-dasharray': `${settle} 1` }),
      group,
    );
  };

  return Object.freeze({ show });
}
