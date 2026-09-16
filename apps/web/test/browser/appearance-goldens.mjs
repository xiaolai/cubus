// The appearance goldens: what each fixture renders to, how a render is compared with its golden,
// and how the goldens are written. Shared by renderer-appearance.test.mjs and, run as a script, by
// the writer:
//
//   node test/browser/appearance-goldens.mjs --write --yes     re-render and rewrite every golden
//
// WHY GOLDENS ARE ALLOWED HERE (dev-docs/renderer-v2-plan.md §3c, measured 2026-09-15). Headless
// Chromium draws WebGL with SwiftShader on the dev Mac and on Linux alike, and 20 fresh launches
// per machine gave the same bytes every time. Between machines — the Mac (SwiftShader on LLVM),
// an arm64 Linux box (the same) and an x86_64 one (Subzero, the build CI's ubuntu-latest runs) —
// thousands of pixels differ by ONE channel step and not one pixel differs by more. The smallest
// regression tried that moves any pixel by two steps, focus flattening 0.62 → 0.59, moves 494;
// 0.58 moves 6,582. So a pixel counts as changed when a channel moves by more than one step, and a
// fixture fails when more than TOLERANCE pixels changed. The resolution this buys, stated rather
// than hidden: a change that moves no channel by two steps (flattening ±0.02 on these fixtures) is
// below what the suite can see — and below what a person can.
//
// WebKit does NOT share goldens: the Mac and Linux builds differ by up to 114 steps over thousands
// of pixels. Its appearance is held by the sampled-output assertions in
// cube-highlight-render.test.mjs, which compare a render with another render on the same machine.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { decodePng, encodePng } from '../png.mjs';

export const GOLDENS = new URL('../fixtures/appearance/', import.meta.url);

/** A pixel is changed when a channel moved by more than this many steps. See the header. */
export const CHANNEL_STEP = 1;
/** A fixture fails when more than this many pixels changed. 0 were seen between machines; the
 *  smallest regression that registered at all moved 494. 16 absorbs an edge pixel the unmeasured
 *  fixtures might place differently, and admits nothing a person could see. */
export const TOLERANCE = 16;

/** The renderer the goldens were drawn with. Compared on anything else, a golden means nothing. */
export const BACKEND = /SwiftShader/;

/** Chromium's launch options: the software rasteriser, named rather than left to the default. */
export const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const HALF_READ = `${'U'.repeat(9)}${'R'.repeat(9)}${'?'.repeat(27)}${'B'.repeat(9)}`;
const SCRAMBLE = "R U R' U' F2 L D B'";

/**
 * §3c's matrix, one axis at a time from a scrambled muted Western cube at 240x240 — the cross
 * product would be hundreds of pictures and say nothing more about any one mechanism.
 *
 * `camera-up` is drawn NON-SQUARE on purpose: on a square canvas a quarter roll cannot change what
 * fits, so a fit that ignored the up vector would pass there (camera-up.test.mjs, and this plan's
 * own revision 1, which fell into exactly that).
 */
export const FIXTURES = [
  { name: 'solved', attrs: { facelets: SOLVED } },
  { name: 'scrambled', attrs: { scramble: SCRAMBLE } },
  { name: 'half-read', attrs: { facelets: HALF_READ } },
  ...['muted', 'classic', 'colorsafe'].flatMap((palette) => ['western', 'japanese'].map((scheme) => ({
    name: `palette-${palette}-${scheme}`, attrs: { scramble: SCRAMBLE, palette, scheme },
  }))),
  { name: 'ghosts-4', attrs: { scramble: SCRAMBLE, ghosts: 'on', 'ghost-elevation': '4' } },
  { name: 'ghosts-9', attrs: { scramble: SCRAMBLE, ghosts: 'on', 'ghost-elevation': '9' } },
  { name: 'focus', attrs: { scramble: SCRAMBLE, focus: 'layer:U' } },
  { name: 'highlight', attrs: { scramble: SCRAMBLE, highlight: 'slot:UF,corners' } },
  { name: 'orientation-UF', attrs: { scramble: SCRAMBLE, orientation: 'U F' } },
  { name: 'orientation-DB', attrs: { scramble: SCRAMBLE, orientation: 'D B' } },
  ...['R', 'L', 'F', 'B'].map((up) => ({ name: `camera-up-${up}`, attrs: { scramble: SCRAMBLE, 'camera-up': up }, w: 320, h: 180 })),
  { name: 'back-view-none', attrs: { scramble: SCRAMBLE, 'back-view': 'none' }, w: 320, h: 240 },
  { name: 'back-view-side-by-side', attrs: { scramble: SCRAMBLE, 'back-view': 'side-by-side' }, w: 320, h: 240 },
  { name: 'back-view-top-right', attrs: { scramble: SCRAMBLE, 'back-view': 'top-right' }, w: 320, h: 240 },
  { name: 'mid-turn', attrs: { facelets: SOLVED, alg: 'R' }, turn: true },
  { name: 'non-square', attrs: { scramble: SCRAMBLE, ghosts: 'on' }, w: 240, h: 360 },
];

/**
 * Render `fixture` in `page` and return `{ w, h, backend, rgba }`, rows top first.
 *
 * The clock is pinned BEFORE the element connects, so every timed thing — the highlight's breath,
 * the turn — starts on the pinned timeline and the frame is a function of the fixture alone.
 * `turn` catches the first move of `alg` half way; `seek` lands on a position of it, settled.
 */
export async function render(page, fixture) {
  const shot = await page.evaluate(async (fx) => {
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
    const el = document.createElement('cubus-cube');
    el.style.cssText = `position:fixed;left:0;top:0;width:${fx.w}px;height:${fx.h}px`;
    for (const [k, v] of Object.entries(fx.attrs)) el.setAttribute(k, v);
    el.clock = 3_000_000;
    document.body.appendChild(el);
    window.__cube = el;
    await tick();
    if (fx.turn) { el.step(); el.clock = 3_000_000 + 95; }
    if (fx.seek !== undefined) el.seek(fx.seek);
    await tick(); await tick();
    el._dirty = true;
    el._draw();
    const gl = el.renderer.getContext();
    const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const backend = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    let bin = '';
    for (let i = 0; i < px.length; i += 8192) bin += String.fromCharCode(...px.subarray(i, i + 8192));
    return { w, h, backend, data: btoa(bin) };
  }, { w: 240, h: 240, ...fixture });
  const bottomUp = Buffer.from(shot.data, 'base64');
  const rgba = Buffer.alloc(bottomUp.length);
  const row = shot.w * 4;
  for (let y = 0; y < shot.h; y++) bottomUp.copy(rgba, (shot.h - 1 - y) * row, y * row, (y + 1) * row);
  return { w: shot.w, h: shot.h, backend: shot.backend, rgba };
}

/** How `actual` differs from `expected`: pixels changed by more than CHANNEL_STEP, and the worst. */
export function compare(expected, actual) {
  if (expected.width !== actual.w || expected.height !== actual.h) {
    return { sizeMismatch: `${expected.width}x${expected.height} golden, ${actual.w}x${actual.h} render`, changed: Infinity, worst: Infinity };
  }
  let changed = 0; let worst = 0;
  const diff = Buffer.alloc(actual.rgba.length);
  for (let i = 0; i < actual.rgba.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(actual.rgba[i + c] - expected.rgba[i + c]));
    worst = Math.max(worst, d);
    if (d > CHANNEL_STEP) { changed++; diff[i] = 255; diff[i + 3] = 255; } else { diff[i + 3] = actual.rgba[i + 3] ? 40 : 0; }
  }
  return { changed, worst, diff };
}

export const goldenUrl = (fixture) => new URL(`${fixture.name}.png`, GOLDENS);
export const readGolden = (fixture) => decodePng(readFileSync(goldenUrl(fixture)));

// ---- the writer ---------------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--write') || !process.argv.includes('--yes')) {
    console.error('usage: node test/browser/appearance-goldens.mjs --write --yes\n'
      + 'Rewrites every appearance golden from the current bundle. Re-pinning is for a change to how the\n'
      + 'cube looks that you have already explained — never a way to make a failing suite pass.');
    process.exit(2);
  }
  const { startBrowserFixture } = await import('./harness.mjs');
  const fixture = await startBrowserFixture({ engine: 'chromium', launch: LAUNCH });
  try {
    const page = await fixture.browser.newPage({ deviceScaleFactor: 1, viewport: { width: 400, height: 400 } });
    await page.goto(`${fixture.base}/index.html`);
    await page.waitForFunction(() => !!customElements.get('cubus-cube'));
    mkdirSync(GOLDENS, { recursive: true });
    for (const f of FIXTURES) {
      const shot = await render(page, f);
      if (!BACKEND.test(shot.backend)) throw new Error(`refusing to write goldens drawn by ${shot.backend}, not SwiftShader`);
      writeFileSync(goldenUrl(f), encodePng(shot.w, shot.h, shot.rgba));
      console.log(`wrote ${fileURLToPath(goldenUrl(f))}`);
    }
  } finally {
    await fixture.close();
  }
}
