// ONE BAND OVER THE FOOT OF THE CUBE CARD, in portrait (dev-docs/practice-redesign-plan.md E12.1, E12.3), for the rows a
// walk shows only sometimes: on the cube screen the follow-note, the why line and the practise-step button; on Practice
// the record's notice.
//
// In the portrait walking composition the cube's row is the one that gives (§5.7), so every such row in the flow took
// its height from the cube: 22–166 px on Home, and on the iPhone SE any one of them took it from 172 to 144 px (E12).
// Drawn here they take nothing: the band lies over the foot of the cube card — over the ghost face below the cube,
// never over the cube — and the cube is the same size with it shown and hidden (geometry.test.mjs).
//
// THE ROOM IS THE CUBE'S, MEASURED. The band's height is capped at the room between the card's foot and the bottom of
// the sphere around the cube, projected through the renderer's own camera: no turn of the cube can leave that sphere,
// so no hold the walk turns the cube to puts the cube under the band. What does not fit in that room scrolls inside it.
//
// ONE DOM, two places, as the modes' row on Practice (E11.6): the stylesheet names the composition (`--foot-band:
// band` on the walking composition in portrait) and this module moves the rows into the band or back to where the
// screen wrote them — landscape keeps today's rows. Nothing here measures a width.

/** The least room kept between the cube's sphere and the band. */
const CLEAR_PX = 4;

/**
 * Put `rows` in a band at the foot of `card` whenever `host`'s composition says so.
 *
 * @param {{ host: HTMLElement, card: HTMLElement, cube: () => (HTMLElement | null), rows: HTMLElement[],
 *   signal: AbortSignal }} options  `cube` answers the card's `<cubus-cube>` when it is in the page
 * @returns {{ band: HTMLElement, place: () => void }}
 */
export function footBand({ host, card, cube, rows, signal }) {
  const doc = card.ownerDocument;
  const view = doc.defaultView;
  const band = doc.createElement('div');
  band.className = 'foot-band';
  band.hidden = true;
  card.append(band);
  // Where each row lives when it is not in the band: a marker before it, in the screen's own markup.
  const homes = rows.map((el) => {
    if (!el) throw new Error('foot-band: a row the screen named is not in its markup');
    const mark = doc.createComment('foot-band: home');
    el.before(mark);
    return { el, mark };
  });

  /** The bottom of the sphere around the cube on the page, or null while the cube has no camera to ask. */
  const cubeBottom = () => {
    const el = cube();
    const cam = el?.camera;
    const canvas = el?.querySelector('canvas');
    if (!cam || !el.root || !canvas) return null;
    el.root.updateMatrixWorld(true);
    cam.updateMatrixWorld(true);
    const V = cam.position.constructor;
    const r = 1.5 * Math.sqrt(3) * el.root.matrixWorld.getMaxScaleOnAxis();
    const up = new V(0, 1, 0).applyQuaternion(cam.quaternion);
    const low = new V(0, 0, 0).applyMatrix4(el.root.matrixWorld).addScaledVector(up, -r).project(cam);
    const box = canvas.getBoundingClientRect();
    return box.top + ((1 - low.y) / 2) * box.height;
  };

  let watched = null;
  const fitBand = () => {
    if (band.parentElement !== card) return;
    // Drawn only while it holds a row that is shown: the band is a box of its own, over the cube card.
    band.hidden = !homes.some(({ el }) => el.parentElement === band && !el.hidden);
    const el = cube();
    if (el && el !== watched) { watched = el; shown.observe(el, { attributes: true }); }
    const bottom = cubeBottom();
    // No camera yet: nothing is drawn to be clear of, and the next resize of the card fits it.
    if (bottom === null) { band.style.maxHeight = ''; return; }
    band.style.maxHeight = `${Math.max(0, card.getBoundingClientRect().bottom - bottom - CLEAR_PX)}px`;
  };

  const place = () => {
    const inBand = view.getComputedStyle(host).getPropertyValue('--foot-band').trim() === 'band';
    for (const { el, mark } of homes) {
      if (inBand) { if (el.parentElement !== band) band.append(el); } else if (mark.nextSibling !== el) mark.after(el);
    }
    fitBand();
  };

  // The card changes size with the stage and the composition; the renderer fits its camera on its own frame after it.
  let pending = 0;
  const observer = new view.ResizeObserver(() => {
    view.cancelAnimationFrame(pending);
    place();
    pending = view.requestAnimationFrame(fitBand);
  });
  observer.observe(card);
  // A row coming into the band, or changing what it says, is fitted as it comes: the cube may have been put in, or
  // turned over, since the last fit. And whatever the host changes on the cube — its hold, its camera, its ghosts —
  // refits it, watched from the first fit that finds the cube. Not a `cubus-step` listener: the parked cube's step
  // handlers are counted, one per screen (screen-swap.test.mjs), and this is not one.
  const shown = new view.MutationObserver(() => { fitBand(); view.cancelAnimationFrame(pending); pending = view.requestAnimationFrame(fitBand); });
  for (const { el } of homes) shown.observe(el, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
  signal?.addEventListener('abort', () => { observer.disconnect(); shown.disconnect(); view.cancelAnimationFrame(pending); }, { once: true });
  place();
  return { band, place };
}
