// The scan screen's small cube, turned to the hold a confirm ask wants (2026-09-19).
//
// A nearly solved cube can read as several cubes, so the scanner asks for one side again, held a
// stated way up: "Looking for the GREEN side — hold it with WHITE up." That sentence was the only
// place the hold reached the screen. The board pointed at the asked tile and nothing ever read the
// ask's `up`, so a child who cannot read had no way to answer (dev-docs/scan-guidance-plan.md 2.2).
// Now the Detected-state twin turns — the whole cube, animated, never a layer — until the asked side
// faces the viewer with the up side on top, and turns back to the scan's hold once the ask is gone.
//
// The ask names SLOTS (a capture, by its centre's colour) and the twin draws POSITIONS in the
// arrangement the tiles use, so both go through `tileOf`: under the Japanese arrangement the yellow
// and blue sides sit at each other's positions. The hold is written to the twin's `orientation`
// once the turn has landed, so what the twin shows can be read back, and so an element that has not
// yet upgraded to the renderer (the node mount tests) still carries the hold it will draw.

import { SCAN_HOLD } from '../../solving-hold.js';

/** The scan's own hold — white on top, green facing you — as `[up, front]`: the twin's resting pose,
 *  from the one place it is declared (lib/solving-hold.js). */
const [HOME_UP, HOME_FRONT] = SCAN_HOLD;
/** Long enough to be seen as one whole-cube turn. Under reduced motion the renderer snaps it. */
const TURN_MS = 900;
/**
 * How the twin is looked at while an ask stands: straight at the front, from a little above, with the
 * floating ghost faces put away. The resting view looks from a corner, where two sides face the eye
 * equally — "the red side, facing you" then showed red and blue side by side with nothing to say
 * which was meant (seen on the first screenshots, 2026-09-19). From the front only two sides are in
 * view, and they are exactly the ask: the side to show, and the colour on top of it.
 */
const ASK_VIEW = Object.freeze({ ghosts: 'none', 'camera-longitude': '0', 'camera-latitude': '30' });

/**
 * @param {object} deps `cube`, the twin (a `<cubus-cube>`, upgraded or not); `tileOf(slot)`, the
 *   position a slot's colour is drawn at in the arrangement the tiles use, read at every call; and
 *   `restView`, the attributes the screen gives the twin to read a scan by, put back when an ask ends.
 */
export function createConfirmHold({ cube, tileOf, restView }) {
  let showing = `${HOME_UP} ${HOME_FRONT}`;
  const view = (attrs) => { for (const [k, v] of Object.entries(attrs)) cube.setAttribute(k, v); };
  // A later ask supersedes a turn still in flight: only the newest may write the hold it landed on.
  let latest = 0;

  const holdAt = (up, front) => {
    const hold = `${up} ${front}`;
    if (hold === showing) return;
    showing = hold;
    const mine = ++latest;
    const land = () => { if (mine === latest) cube.setAttribute('orientation', hold); };
    if (typeof cube.turnTo === 'function') {
      void cube.turnTo(up, front, { ms: TURN_MS }).then((completed) => { if (completed) land(); });
    } else {
      land();
    }
  };

  let asking = false;
  /** Show the hold `confirm` asks for, or the scan's own hold when there is no ask. */
  const show = (confirm) => {
    // The eye moves BEFORE the turn and back AFTER the ask, so the turn itself is seen from the front.
    if (Boolean(confirm) !== asking) {
      asking = Boolean(confirm);
      view(asking ? ASK_VIEW : restView);
    }
    if (confirm) holdAt(tileOf(confirm.up), tileOf(confirm.face));
    else holdAt(HOME_UP, HOME_FRONT);
  };

  return Object.freeze({ show });
}
