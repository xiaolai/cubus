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
// so no hold the walk turns the cube to puts the cube under the band.
//
// AND THE ROOM IS KEPT FOR THE LONGEST THING THE BAND CAN SAY (E12.7, E12.8), so nothing in it is ever behind a scroller.
// The screen hands over every state the band can be in at its longest (`longest`); each is laid out once in a probe band
// nobody sees, and the tallest is the room needed. Where the room under the sphere is less, the card keeps a reserve at
// its foot (`--band-reserve`, the card's bottom padding): the cube's slot gives that much, the renderer fits the cube
// to the smaller slot, and the room grows. The reserve depends on the card and on what the band can say, never on what
// it says now, so the cube is one size with the band shown or put away. It only grows while the card keeps its size —
// a fit that leaves less room asks for more, a fit that leaves more keeps what it has — and starts again when the card
// changes size.
//
// ONE DOM, two places, as the modes' row on Practice (E11.6): the stylesheet names the composition (`--foot-band:
// band` on the walking composition in portrait) and this module moves the rows into the band or back to where the
// screen wrote them — landscape keeps today's rows. Nothing here measures a width.

/** The least room kept between the cube's sphere and the band. */
const CLEAR_PX = 4;

/**
 * How many times the reserve may change while the card keeps one size. Each change asks the renderer to fit the cube to
 * a smaller slot and the room is measured again; the model it is sized by is exact for a cube held by the slot's height,
 * so it lands in one or two. A reserve still moving past this is a measurement feeding itself, and it THROWS — the
 * failure is the loop, and a loop that spins quietly costs a machine, not a test (E12.8; three hours of check:fast).
 */
export const RESERVE_FITS_MOST = 6;

/** How many frames the camera is watched after something that can move it, at most, while the cube is not moving. */
const WATCH_FRAMES = 3;
/** And while it is, at most: a turn of the whole cube is under three seconds at the slowest tempo. */
const WATCH_FRAMES_MOST = 600;

/**
 * How wide `text` is drawn in `el`'s font, as a function — what "longest" means for the band's enumerations
 * (lib/walk-follow.js, lib/practice-link.js), because two strings of one length are not one width.
 */
export function drawnWidth(el) {
  const doc = el.ownerDocument;
  const pen = doc.createElement('canvas').getContext('2d');
  if (!pen) return (text) => text.length;
  pen.font = doc.defaultView.getComputedStyle(el).font;
  return (text) => pen.measureText(text).width;
}

/**
 * Put `rows` in a band at the foot of `card` whenever `host`'s composition says so.
 *
 * @param {{ host: HTMLElement, card: HTMLElement, cube: () => (HTMLElement | null), rows: HTMLElement[],
 *   longest?: () => { row: HTMLElement, text?: string, info?: boolean }[][], signal: AbortSignal }} options  `cube`
 *   answers the card's `<cubus-cube>` when it is in the page; `longest` every state the band can be in at its longest,
 *   each the rows shown together — `text` what the row says (in its status line, if it has one), `info` its quiet form
 * @returns {{ band: HTMLElement, place: () => void, remeasure: () => void }}
 */
export function footBand({ host, card, cube, rows, longest = () => [], signal }) {
  const doc = card.ownerDocument;
  const view = doc.defaultView;
  const band = doc.createElement('div');
  band.className = 'foot-band';
  band.hidden = true;
  card.append(band);
  // The reserve as a box of its own, drawn nothing: what it holds is room, and the composition's gap gate measures to
  // it as a slot kept on purpose (test/browser/reserved-slots.mjs).
  const held = doc.createElement('div');
  held.className = 'band-reserve';
  held.setAttribute('aria-hidden', 'true');
  card.append(held);
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

  /** The room the band needs: the tallest of `longest`'s states, each laid out in a probe band nobody sees or hears. */
  const measureNeed = () => {
    const states = longest();
    if (!states.length) return 0;
    const probe = doc.createElement('div');
    probe.className = 'foot-band';
    probe.setAttribute('aria-hidden', 'true');
    probe.inert = true;
    probe.style.cssText = 'visibility: hidden; max-height: none; pointer-events: none;';
    card.append(probe);
    let most = 0;
    try {
      for (const state of states) {
        probe.replaceChildren(...state.map(({ row, text, info }) => {
          const copy = row.cloneNode(true);
          // No id twice on the page, even for the moment it is measured; the stylesheet styles the rows by class.
          for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id');
          copy.hidden = false;
          if (info !== undefined) copy.classList.toggle('info', info);
          if (text !== undefined) (copy.querySelector('[role="status"]') ?? copy).textContent = text;
          return copy;
        }));
        most = Math.max(most, probe.getBoundingClientRect().height);
      }
    } finally {
      probe.remove();
    }
    return Math.ceil(most);
  };

  let inBand = false;
  let need = 0;
  let reserve = 0;
  let fresh = true;   // the card changed size: the next fit may give reserve back as well as take it
  let fits = 0;       // reserve changes since the card last changed size
  const setReserve = (px) => {
    if (px === reserve) return;
    fits += 1;
    if (fits > RESERVE_FITS_MOST) {
      throw new Error(`foot-band: the reserve under the cube changed ${fits} times without the card changing size (now ${reserve}px, asked ${px}px, the band needs ${need}px) — the measurement is feeding itself`);
    }
    reserve = px;
    if (px > 0) card.style.setProperty('--band-reserve', `${px}px`); else card.style.removeProperty('--band-reserve');
  };

  let watched = null;
  const fitBand = (adjust = true) => {
    if (band.parentElement !== card) return;
    // Drawn only while it holds a row that is shown: the band is a box of its own, over the cube card.
    band.hidden = !homes.some(({ el }) => el.parentElement === band && !el.hidden);
    // Out of the band's composition there is nothing to fit, and nothing is measured: no layout read on any frame.
    if (!inBand) return;
    const el = cube();
    if (el && el !== watched) { watched = el; shown.observe(el, { attributes: true }); resized.observe(el); }
    const bottom = cubeBottom();
    // No camera yet: nothing is drawn to be clear of, and the next resize of the card fits it.
    if (bottom === null) { band.style.maxHeight = ''; return; }
    const box = card.getBoundingClientRect();
    const room = box.bottom - bottom - CLEAR_PX;
    if (adjust && inBand && (need > room + 0.5 || (fresh && reserve > 0))) {
      // The room grows by (1 - c) for each px of reserve, where c is the share of the canvas's height below the sphere:
      // the slot gives the px, and the renderer's fit takes back c of it. The renderer fits on its own resize, and the
      // next fit here checks the room it left (`resized`, below).
      const canvas = el.querySelector('canvas').getBoundingClientRect();
      const c = Math.min(0.9, Math.max(0, (canvas.bottom - bottom) / Math.max(1, canvas.height)));
      // Never past half the card: a band that cannot fit even so is a band that scrolls, which geometry.test.mjs
      // refuses, rather than a cube taken down to nothing to make room for words.
      const next = Math.min(Math.floor(box.height / 2), Math.max(0, Math.ceil(reserve + (need - room) / (1 - c))));
      const mayGive = fresh;
      fresh = false;
      if (next > reserve || (mayGive && next < reserve)) setReserve(next);
    }
    band.style.maxHeight = `${Math.max(0, room)}px`;
  };

  const place = () => {
    inBand = view.getComputedStyle(host).getPropertyValue('--foot-band').trim() === 'band';
    for (const { el, mark } of homes) {
      if (inBand) { if (el.parentElement !== band) band.append(el); } else if (mark.nextSibling !== el) mark.after(el);
    }
    if (inBand) need = measureNeed(); else { need = 0; setReserve(0); }
    // A card that has just changed size is fitted on the next frame, once the renderer has fitted its camera to it.
    fitBand(!fresh);
  };

  // The card changes size with the stage and the composition; the renderer fits its camera on its own frame after it.
  let pending = 0;
  const observer = new view.ResizeObserver(() => {
    view.cancelAnimationFrame(pending);
    fresh = true;
    fits = 0;
    place();
    pending = view.requestAnimationFrame(() => fitBand());
    watchAgain();
  });
  observer.observe(card);
  // The cube's own slot changing size — the reserve taking from it — is fitted again once the renderer has fitted its
  // camera to it, which it does on its own resize.
  const resized = new view.ResizeObserver(() => { view.cancelAnimationFrame(pending); pending = view.requestAnimationFrame(() => fitBand()); watchAgain(); });
  // Whatever moves the camera — a turn of the whole cube, a fit the renderer makes as the cube turns over, a new hold —
  // is none of it an event here, so after anything that can move it the camera is ASKED, frame by frame, for a bounded
  // while: as long as the cube is moving, and a few frames after, never more than WATCH_FRAMES_MOST. Never a loop that
  // runs for as long as the page does: one did, and every whole-app test in happy-dom spun on it until killed.
  let camAt = '';
  let watchFrame = 0;
  let still = 0;
  let frames = 0;
  const watchCamera = () => {
    watchFrame = 0;
    const el = cube();
    const cam = el?.camera;
    if (!cam) return;
    const at = `${cam.position.x},${cam.position.y},${cam.position.z},${cam.projectionMatrix.elements[5]},${cam.aspect}`;
    if (at !== camAt) { camAt = at; still = 0; fitBand(); } else still += 1;
    frames += 1;
    const moving = Boolean(el.animating || el.turning);
    if ((moving || still < WATCH_FRAMES) && frames < WATCH_FRAMES_MOST) watchFrame = view.requestAnimationFrame(watchCamera);
  };
  const watchAgain = () => {
    if (!inBand) return;
    still = 0;
    frames = 0;
    if (!watchFrame) watchFrame = view.requestAnimationFrame(watchCamera);
  };
  // A row coming into the band, or changing what it says, is fitted as it comes: the cube may have been put in, or
  // turned over, since the last fit. And whatever the host changes on the cube — its hold, its camera, its ghosts —
  // refits it, watched from the first fit that finds the cube. Not a `cubus-step` listener: the parked cube's step
  // handlers are counted, one per screen (screen-swap.test.mjs), and this is not one.
  const shown = new view.MutationObserver(() => { fitBand(); view.cancelAnimationFrame(pending); pending = view.requestAnimationFrame(() => fitBand()); watchAgain(); });
  for (const { el } of homes) shown.observe(el, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
  signal?.addEventListener('abort', () => {
    observer.disconnect(); resized.disconnect(); shown.disconnect();
    view.cancelAnimationFrame(pending); view.cancelAnimationFrame(watchFrame);
    // Given back as the screen goes, not fitted: the card may be re-used, and this is no measurement.
    reserve = 0;
    card.style.removeProperty('--band-reserve');
    held.remove();
  }, { once: true });
  place();
  /** What the band can say has changed (an enumeration that resolves late): measure the room it needs again. */
  const remeasure = () => { if (inBand) { need = measureNeed(); fitBand(); } };
  return { band, place, remeasure };
}
