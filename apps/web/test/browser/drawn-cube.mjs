// Reading a drawn `<cubus-cube>` back as a child sees it: world facelets, on the oracle's layout.
//
// Shared by the tutorial corpus (test/browser/tutorial-scenarios.test.mjs) and the renderer's frame suite
// (test/browser/renderer-frame.test.mjs). A sticker is read by where its cubie sits in the world — the
// element's orientation and any whole-cube turn in its sequence included — and which way it faces,
// then placed on the published facelet layout by `test/cube-oracle.mjs`, which shares no code with
// the renderer. The letter is the sticker's home face: the colour a cube built from moves (rather
// than a facelet string) painted it.
import { faceletAt } from '../cube-oracle.mjs';

/** Every sticker of the element in `window.__cube`: its home face, where its cubie sits, which way it faces. */
export const readStickers = (page) => page.evaluate(() => {
  const el = window.__cube;
  el.root.updateMatrixWorld(true);
  const V = el.stickers[0].position.constructor;
  return el.stickers.map((m) => {
    const s = m.getWorldPosition(new V());
    const c = m.parent.getWorldPosition(new V());
    return { face: m.userData.face, cubie: [c.x, c.y, c.z], offset: [s.x - c.x, s.y - c.y, s.z - c.z] };
  });
});

/** Stickers as world facelets. Throws on a sticker that lands on no facelet, or two on one. */
export function toWorld(stickers) {
  const scale = Math.max(...stickers.flatMap((s) => s.cubie.map(Math.abs)));
  const out = new Array(54).fill('?');
  for (const s of stickers) {
    const pos = s.cubie.map((v) => Math.round(v / scale) + 0);
    const len = Math.hypot(...s.offset);
    const n = s.offset.map((v) => Math.round(v / len) + 0);
    const i = faceletAt(pos, n);
    if (i < 0) throw new Error(`a sticker at ${pos} facing ${n} is on no facelet`);
    if (out[i] !== '?') throw new Error(`two stickers drawn on facelet ${i}`);
    out[i] = s.face;
  }
  return out.join('');
}

/** Every cubie's world matrix, rounded so a settled pose compares exactly. */
export const readMatrices = (page) => page.evaluate(() => {
  const el = window.__cube;
  el.root.updateMatrixWorld(true);
  return el.cubies.map((c) => [...c.matrixWorld.elements].map((v) => Math.round(v * 1e6) / 1e6 + 0));
});
