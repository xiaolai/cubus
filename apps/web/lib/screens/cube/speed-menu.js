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
// THE TABLE IS NOT THIS MENU'S. It was defined here, and written to this screen's cube only, so
// every other cube the app draws animated at the renderer's raw 190ms — the Drill page measured
// 200ms per turn against 1620ms at Normal (2026-09-30). It now lives beside the rest of the cube's
// look in `lib/cube-view.js` and `applyCubeView` puts it on every cube; this menu CHOOSES and
// overrides, which is all a screen should do with a look every screen shares.
import { WALK_SPEEDS, DEFAULT_WALK_SPEED, WALK_SPEED_KEY, tempoFor } from '../../cube-view.js';

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
  let speedId = DEFAULT_WALK_SPEED;
  // localStorage is untrusted input: an id no longer in WALK_SPEEDS must not reach setAttribute.
  const saved = load(WALK_SPEED_KEY, { id: DEFAULT_WALK_SPEED }).id;
  if (WALK_SPEEDS.some((o) => o.id === saved)) speedId = saved;
  const menu = createMenu({ root, button: speedBtn, label: t('Animation speed'), signal, place: placeMenuUnder });

  const applySpeed = () => {
    const chosen = WALK_SPEEDS.find((o) => o.id === speedId);
    // AN OVERRIDE, NOT THE ONLY WRITE. `applyCubeView` has already put the saved tempo on this cube
    // and on every other cube the app draws; what is special here is the FOLLOWING case — while a
    // cube in a hand drives the walk, the child's own turn must appear as they make it, so tempo
    // goes to 1 and the choice is stored but not applied until they hand it back.
    // Through `tempoFor`, not `chosen.tempo`: one resolver, so this menu and `applyCubeView`
    // cannot come to disagree about what "normal" means.
    cube.setAttribute('tempo-scale', String(following() ? 1 : tempoFor(speedId)));
    speedBtn.title = `Animation speed — ${chosen.label}`;
    speedBtn.setAttribute('aria-label', speedBtn.title);
    menu.mark((b) => b.dataset.speed === speedId);
  };
  for (const o of WALK_SPEEDS) {
    const b = menu.radio(t(o.label), () => { speedId = o.id; save(WALK_SPEED_KEY, { id: o.id }); applySpeed(); menu.close(); speedBtn.focus(); });
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
