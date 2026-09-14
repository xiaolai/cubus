// The cube screen's speed menu: the gauge in the cube card's corner, the three walking speeds it
// offers, the one that is saved, and the tempo the renderer is given.
//
// Lifted out of lib/screens/cube.js on 2026-09-14 and built on lib/menu-popover.js, the menu the
// scan screen's camera menu is built on. Pinned by the speed-menu cases in
// test/router-wiring.test.mjs.

import { $ } from '../../app-state.js';
import { load, save } from '../../app-settings.js';
import { t } from '../../i18n.js';
import { createMenu } from '../../menu-popover.js';
import { placeMenuUnder } from '../../screen-shell.js';

/** The three walking speeds, as renderer tempo-scale values. The renderer divides a 190ms base by
 * this, so a LARGER number is faster. None of them is quick: Fast is 0.95s per quarter turn, still
 * slower than the 760ms that used to be the only speed and was the complaint that prompted this. */
const SPEEDS = [
  { id: 'slow', label: 'Slow', tempo: 0.05 },     // 3.8s per quarter turn
  { id: 'normal', label: 'Normal', tempo: 0.1 },  // 1.9s
  { id: 'fast', label: 'Fast', tempo: 0.2 },      // 0.95s
];
const DEFAULT_SPEED = 'normal';

/**
 * The speed menu of one mounted cube screen: wired, with the saved speed applied.
 *
 * @param {object} deps `root`; the renderer `cube`, whose tempo this writes; the screen's abort
 *   `signal`, which the page's click and Escape listeners carry; and `following()`, whether the
 *   smart cube is driving the walk.
 * @returns {Function} `applyTempo()`, which writes the tempo again: the walk session calls it
 *   whenever the driver changes. A screen with no walk draws no speed button, and gets one that
 *   does nothing.
 */
export function createSpeedMenu({ root, cube, signal, following }) {
  const speedBtn = $('#speedBtn', root);
  if (!speedBtn) return () => {};
  let speedId = DEFAULT_SPEED;
  // localStorage is untrusted input: an id no longer in SPEEDS must not reach setAttribute.
  const saved = load('walkSpeed', { id: DEFAULT_SPEED }).id;
  if (SPEEDS.some((o) => o.id === saved)) speedId = saved;
  const menu = createMenu({ root, button: speedBtn, label: t('Animation speed'), signal, place: placeMenuUnder });

  const applySpeed = () => {
    const chosen = SPEEDS.find((o) => o.id === speedId);
    // The ONE place tempo is written. While the cube drives, the choice is stored but not
    // applied — it takes effect the moment the user takes over.
    cube.setAttribute('tempo-scale', String(following() ? 1 : chosen.tempo));
    speedBtn.title = `Animation speed — ${chosen.label}`;
    speedBtn.setAttribute('aria-label', speedBtn.title);
    menu.mark((b) => b.dataset.speed === speedId);
  };
  for (const o of SPEEDS) {
    const b = menu.radio(t(o.label), () => { speedId = o.id; save('walkSpeed', { id: o.id }); applySpeed(); menu.close(); speedBtn.focus(); });
    b.dataset.speed = o.id;
    menu.el.appendChild(b);
  }
  applySpeed();

  const onAway = (ev) => { menu.closeUnless(ev.target); };
  const onEsc = (ev) => {
    if (ev.key !== 'Escape' || !menu.isOpen()) return;
    menu.close();
    speedBtn.focus(); // Escape returns you to the control you opened it from
  };
  // `{ signal }`, not a hand-written removal pair: this screen's abort is cut by
  // renderScreen on every navigation, so a listener that carries it cannot outlive its
  // screen — which is the same mechanism the parked <cubus-cube>'s listener relies on, and
  // one fewer place for a teardown to be written correctly. The pair it replaces was the
  // whole of `cleanup` here.
  document.addEventListener('click', onAway, { signal });
  document.addEventListener('keydown', onEsc, { signal });
  return applySpeed;
}
