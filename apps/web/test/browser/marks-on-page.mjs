// A moved sticker's mark, judged on the PAGE by WCAG 1.4.11 (non-text contrast), sticker by sticker
// (dev-docs/practice-redesign-plan.md E15): the real library and the real book, in the page's own stylesheet and
// rasteriser, at the context's DPR.
//
//   (a) CONTRAST: the band's colour against the sticker's own colour is at least 3:1 — a flat sticker's colours as the
//       page resolves them on its own rect, a photograph's read off its still at full resolution.
//   (b) STROKE: the band is at least `MARK_STROKE_LEAST_PX` CSS px wide at the size the page draws the picture.
//   (c) COLOUR KEPT: the area inside the band is at least `MARK_COLOUR_KEPT` of the sticker's.
//   And the mark RENDERS: something of every marked sticker is drawn differently for it.
//
// (b) and (c) are judged on the DRAWN geometry, not on pixels read back: a 1–1.5 px antialiased stroke read back measures
// the rasteriser, not the design, and WCAG judges the graphic as drawn. The band's width comes from the one function the
// drawing uses (`outlineBand`, `photoBandDepth`), and the page is held to have drawn exactly that; the size it is shown
// at is measured on the page.
//
// WHERE A STICKER IS is never read off the marking under test (AGENTS.md §5). A flat picture's sticker is its rect in
// the row's BARE picture (`casePicture`, which draws no mark), put in place of the page's marked picture after the
// screenshot and held first to be the page's picture less its marks. A photograph's is the polygon its outline was
// stroked on (`photoMarks`), whose count case-photos holds to the visible moved stickers; the width it was stroked at is
// the canvas context's own, read back (`photoStrokes`).

import { inflateSync } from 'node:zlib';

import { MARK_COLOUR_KEPT, MARK_STROKE_LEAST_PX, photoBandDepth } from '../../lib/case-photo.js';
import { contrastOf } from '../../lib/contrast.js';
import { BOOK_OUTLINE, TILE_OUTLINE, outlineBand } from '../../lib/screens/practice/library-view.js';

/** (a): WCAG 1.4.11's ratio for a graphic that carries meaning. */
export const MARK_CONTRAST = 3;
export { MARK_COLOUR_KEPT, MARK_STROKE_LEAST_PX };

/** The fixtures the gate is held at: the narrowest portrait tiles and a landscape window, from geometry's table. */
export const MARK_FIXTURES = Object.freeze([
  Object.freeze({ name: 'iPhone SE', viewport: { width: 375, height: 667 }, insets: [20, 0, 0, 0], touch: true }),
  Object.freeze({ name: 'desktop landscape window', viewport: { width: 840, height: 682 }, insets: [0, 0, 0, 0], touch: false }),
]);

/** No transition or animation is mid-way when a screenshot is taken; the drawing at rest is unchanged. */
const STILL_CSS = '*, *::before, *::after { transition: none !important; animation: none !important; }';

/**
 * A page on Practice in `theme`, set before load as Settings stores it, at the fixture's size and `dpr`.
 *
 * @returns {Promise<{ page: import('playwright').Page, context: import('playwright').BrowserContext, problems: string[] }>}
 */
export async function practiceAt(fixture, { browser, base, theme, dpr, timeout }) {
  const context = await browser.newContext({ viewport: fixture.viewport, deviceScaleFactor: dpr, hasTouch: fixture.touch });
  await context.addInitScript((th) => localStorage.setItem('cubusSettings', JSON.stringify({ theme: th })), theme);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /<cubus-cube>|case-photo/.test(m.text()))) problems.push(`${m.type()}: ${m.text()}`); });
  await page.goto(`${base}/?insets=${fixture.insets.join(',')}#/practice`);
  await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout });
  await page.evaluate(async (css) => {
    const still = document.createElement('style');
    still.textContent = css;
    document.head.append(still);
    const { library } = await import('/lib/drill/library-client.js');
    const view = await import('/lib/screens/practice/library-view.js');
    const photo = await import('/lib/case-photo.js');
    const { settings } = await import('/lib/app-settings.js');
    const catalogue = await library.catalogue();
    const inks = photo.inksAt(document.querySelector('.practice-screen'));
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const parse = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstElementChild; };
    /** The scale a contained picture is drawn at: CSS px per unit of its own. */
    const scaleOf = (el, w, h) => { const b = el.getBoundingClientRect(); return Math.min(b.width / w, b.height / h); };
    /**
     * A flat picture's marked stickers: for each, the band the page drew, the sticker in the BARE picture (its rect in
     * the picture's units, and its corners on the page), and the picture's frame and drawn scale. The bare picture is
     * put in the marked one's place, after holding it to be the page's picture less its marks.
     */
    const stickersOfSvg = (svg, id) => {
      const plain = parse(view.casePicture(catalogue.rows[id], { palette: settings.palette, scheme: settings.scheme }));
      // Each mark's colours as the page RESOLVES them: the sticker's fill (an off-grey at its opacity, over the ground it
      // lies on) and the band's stroke. Read back from pixels, a strip 6.75 px tall at DPR 1 has no pixel that is not
      // blended with its edge.
      const rgb = (css) => { const n = (String(css).match(/[\d.]+/g) ?? []).map(Number); return /^color\(srgb/.test(css) ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3); };
      const marks = new Map([...svg.querySelectorAll('rect.moved')].map((r) => {
        const cs = getComputedStyle(r);
        const a = Number(cs.fillOpacity);
        const fill = rgb(cs.fill).map((v, i) => v * a + inks.ground[i] * (1 - a));
        return [r.dataset.facelet, { token: r.dataset.mark, band: Number(r.getAttribute('stroke-width')), own: fill, stroke: rgb(cs.stroke) }];
      }));
      if (!marks.size) throw new Error(`${id}: a picture with no mark`);
      const others = (el) => [...el.querySelectorAll('rect[data-facelet]')].filter((r) => !marks.has(r.dataset.facelet)).map((r) => r.outerHTML).join('');
      for (const a of ['viewBox', 'width', 'height']) {
        if (svg.getAttribute(a) !== plain.getAttribute(a)) throw new Error(`${id}: the page's picture is not the bare one's frame (${a})`);
      }
      if (others(svg) !== others(plain)) throw new Error(`${id}: the page's picture differs from the bare one away from its marks`);
      const [, , fw, fh] = svg.getAttribute('viewBox').split(' ').map(Number);
      const scale = scaleOf(svg, fw, fh);
      svg.replaceWith(plain);
      return [...plain.querySelectorAll('rect[data-facelet]')].filter((r) => marks.has(r.dataset.facelet)).map((r) => {
        const b = r.getBoundingClientRect();
        const n = (a) => Number(r.getAttribute(a) ?? 0);
        return {
          f: r.dataset.facelet, ...marks.get(r.dataset.facelet), frame: { w: fw, h: fh }, scale,
          rect: { w: n('width'), h: n('height'), rx: n('rx'), ry: r.hasAttribute('ry') ? n('ry') : n('rx') },
          points: [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]],
        };
      });
    };
    /**
     * A photographed tile's marked stickers: each polygon its still was stroked on, in the still's pixels and on the
     * page; the still's width and drawn scale; and, read off the still at its own resolution — where the page has not
     * blended a small sticker's band into it — the sticker's own colour at its core, which token its band is drawn in,
     * and how many of its pixels are that band's colour.
     */
    const stickersOfPhoto = (img, id) => {
      const polys = photo.photoMarks(img.src);
      if (!polys) throw new Error(`${id}: a marked photograph with no marks recorded`);
      // The width each sticker's band was stroked at, as the canvas context held it: the drawing read back, so the
      // band (b) and (c) are judged on is the one drawn, not only the one `photoBandDepth` says.
      const widths = photo.photoStrokes(img.src);
      if (widths?.length !== polys.length) throw new Error(`${id}: ${widths?.length ?? 'no'} stroke widths recorded for ${polys.length} marks`);
      if (getComputedStyle(img).objectFit !== 'contain') throw new Error(`${id}: a photograph not contained in its box`);
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, cv.width, cv.height).data;
      const inside = (poly, k) => {
        const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length; const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
        const path = new Path2D(); poly.forEach(([x, y], i) => { const q = [cx + (x - cx) * k, cy + (y - cy) * k]; if (i) path.lineTo(...q); else path.moveTo(...q); }); path.closePath();
        const out = [];
        for (let y = 0; y < cv.height; y += 1) for (let x = 0; x < cv.width; x += 1) if (g.isPointInPath(path, x + 0.5, y + 0.5)) { const j = (y * cv.width + x) * 4; out.push([px[j], px[j + 1], px[j + 2]]); }
        return out;
      };
      const off = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      const b = img.getBoundingClientRect();
      const scale = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight);
      const ox = b.left + (b.width - img.naturalWidth * scale) / 2; const oy = b.top + (b.height - img.naturalHeight * scale) / 2;
      return polys.map((poly, i) => {
        const core = inside(poly, 0.45);
        if (!core.length) throw new Error(`${id}: a sticker with no pixel at its core`);
        const own = [0, 1, 2].map((c) => core.map((p) => p[c]).sort((x, y) => x - y)[core.length >> 1]);
        // Only pixels that are not the sticker's own colour say which: a white sticker's own pixels are "near" a white ground.
        const rest = inside(poly, 1).filter((p) => off(p, own) > 48);
        const near = (K) => rest.filter((p) => off(p, K) <= 24).length;
        const token = near(inks.ink) >= near(inks.ground) ? 'ink' : 'ground';
        return { f: String(i), token, own, drawn: near(inks[token]), poly, lineWidth: widths[i], stillWidth: img.naturalWidth, scale, points: poly.map(([x, y]) => [ox + x * scale, oy + y * scale]) };
      });
    };
    window.__marks = { catalogue, settings, frames, stickersOfSvg, stickersOfPhoto, inks };
  }, STILL_CSS);
  return { page, context, problems };
}

/** A screenshot's pixels: Playwright writes 8-bit RGB or RGBA, non-interlaced; anything else is refused. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('marks-on-page: not a PNG');
  let at = 8; let w = 0; let h = 0; let channels = 0; const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at); const type = buf.toString('ascii', at + 4, at + 8); const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      const [depth, colour, , , interlace] = data.subarray(8, 13);
      channels = { 2: 3, 6: 4 }[colour];
      if (depth !== 8 || !channels || interlace) throw new Error(`marks-on-page: a PNG of depth ${depth}, colour type ${colour}, interlace ${interlace}`);
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels; const out = new Uint8Array(w * h * 3); const prev = new Uint8Array(stride); const line = new Uint8Array(stride);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)]; const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0; const b = prev[i]; const c = i >= channels ? prev[i - channels] : 0;
      const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      if (pred === undefined) throw new Error(`marks-on-page: PNG filter ${f}`);
      line[i] = (src[i] + pred) & 255;
    }
    for (let x = 0; x < w; x += 1) for (let k = 0; k < 3; k += 1) out[(y * w + x) * 3 + k] = line[x * channels + k];
    prev.set(line);
  }
  return { w, h, d: out };
}

const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i]; const [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const areaOf = (p) => Math.abs(p.reduce((a, [x, y], i) => { const [nx, ny] = p[(i + 1) % p.length]; return a + x * ny - nx * y; }, 0)) / 2;

/** A convex polygon shrunk by `d` on every side (each edge's inward half-plane, offset `d`): its area, 0 when gone. */
function shrunkArea(p, d) {
  const sign = Math.sign(p.reduce((a, [x, y], i) => { const [nx, ny] = p[(i + 1) % p.length]; return a + x * ny - nx * y; }, 0));
  let out = p;
  for (let i = 0; i < p.length && out.length; i += 1) {
    const [x1, y1] = p[i]; const [x2, y2] = p[(i + 1) % p.length]; const L = Math.hypot(x2 - x1, y2 - y1);
    if (!L) continue;
    const nx = (-(y2 - y1) / L) * sign; const ny = ((x2 - x1) / L) * sign;
    const side = ([x, y]) => (x - x1) * nx + (y - y1) * ny - d;
    const next = [];
    for (let j = 0; j < out.length; j += 1) {
      const a = out[j]; const b = out[(j + 1) % out.length]; const sa = side(a); const sb = side(b);
      if (sa >= 0) next.push(a);
      if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    }
    out = next;
  }
  return out.length >= 3 ? areaOf(out) : 0;
}

/** A rounded rect's area, elliptical corners `rx` by `ry`. */
const roundedArea = (w, h, rx, ry) => Math.max(0, w) * Math.max(0, h) - (4 - Math.PI) * Math.min(rx, w / 2) * Math.min(ry, h / 2);

/** The pixels of a screenshot of `clip` whose centres lie inside polygon `P` (page px). */
function pixelsIn(A, clip, P) {
  const k = A.w / clip.width; const xs = P.map((p) => p[0]); const ys = P.map((p) => p[1]); const out = [];
  for (let py = Math.max(0, Math.floor((Math.min(...ys) - clip.y) * k)); py < Math.min(A.h, Math.ceil((Math.max(...ys) - clip.y) * k)); py += 1) {
    for (let px = Math.max(0, Math.floor((Math.min(...xs) - clip.x) * k)); px < Math.min(A.w, Math.ceil((Math.max(...xs) - clip.x) * k)); px += 1) {
      if (!inPoly(clip.x + (px + 0.5) / k, clip.y + (py + 0.5) / k, P)) continue;
      const j = (py * A.w + px) * 3; out.push([A.d[j], A.d[j + 1], A.d[j + 2]]);
    }
  }
  return out;
}

/**
 * A flat sticker, judged: its colours as the page resolves them give (a); the screenshots marked (`A`) and unmarked
 * (`B`) give whether the mark renders (pixels of it drawn differently); the drawing gives (b) and (c).
 */
function judgeFlat(A, B, clip, s, inks, outline) {
  const a = pixelsIn(A, clip, s.points); const b = pixelsIn(B, clip, s.points);
  const rendered = a.filter((p, i) => p.some((v, c) => Math.abs(v - b[i][c]) > 8)).length;
  const meant = outlineBand(outline, s.frame);
  const { w, h, rx, ry } = s.rect;
  const kept = roundedArea(w - 2 * s.band, h - 2 * s.band, Math.max(0, rx - s.band), Math.max(0, ry - s.band)) / roundedArea(w, h, rx, ry);
  // The band is stroked in the token it names (`data-mark`), or the colour it was chosen against is not the one shown.
  const named = inks[s.token].every((v, i) => Math.abs(v - s.stroke[i]) < 1.5);
  return { f: s.f, token: s.token, contrast: contrastOf(s.own, s.stroke), named, stroke: s.band * s.scale, kept, rendered, drawnAsMeant: Math.abs(s.band - meant) < 0.006, size: Math.min(w, h) * s.scale };
}

/** A photograph's sticker, judged: its colours read off its still; (b) and (c) from the depth the photographer strokes,
 *  held to the width its canvas context was given — clipped to the sticker, a stroke shows half its width. */
function judgePhoto(s, inks) {
  const area = areaOf(s.poly);
  const depth = photoBandDepth(area, s.stillWidth);
  return { f: s.f, token: s.token, contrast: contrastOf(s.own, inks[s.token]), named: true, stroke: depth * s.scale, kept: shrunkArea(s.poly, depth) / area, rendered: s.drawn, drawnAsMeant: Math.abs(s.lineWidth / 2 - depth) < 0.006, size: Math.sqrt(area) * s.scale };
}

/** Screenshot `clip`, ask the page where the marked stickers are (which unmarks the flat ones in place), screenshot
 *  again, and judge each. */
async function shotAndJudge(page, clip, locate, arg, outline) {
  const shot = async () => decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
  const A = await shot();
  const { pictures, inks } = await page.evaluate(locate, arg);
  await page.evaluate(() => window.__marks.frames());
  const B = await shot();
  if (A.w !== B.w || A.h !== B.h) throw new Error('marks-on-page: two screenshots of one clip are not one size');
  return pictures.map((t) => ({ what: t.what, id: t.id, stickers: t.stickers.map((s) => (t.what === 'photo' ? judgePhoto(s, inks) : judgeFlat(A, B, clip, s, inks, outline))) }));
}

/**
 * Every marked tile of the library, method by method, as the page draws it: the body scrolled through, and each tile
 * judged once, whole in view and with nothing over it. Returns `{ what: 'tile'|'photo', id, f, ... }` per marked sticker.
 */
export async function measureLibrary(page, { methods, timeout }) {
  const out = [];
  const seen = new Set();
  for (const key of methods) {
    await page.evaluate(async (k) => {
      const { renderScreen } = await import('/lib/screen-shell.js');
      window.__marks.settings.practiceMethod = k;
      renderScreen();
    }, key);
    await page.waitForSelector(`.practice-screen[data-ready="1"][data-method="${key}"]`, { timeout });
    for (let top = 0, last = -1; ; ) {
      // The tiles drawn on approach, and every photograph in view landed.
      await page.evaluate(async (y) => { const b = document.querySelector('.lib-body'); b.scrollTop = y; await window.__marks.frames(); await window.__marks.frames(); }, top);
      await page.waitForFunction(() => {
        const body = document.querySelector('.lib-body').getBoundingClientRect();
        return [...document.querySelectorAll('.case-photo[data-photo="pending"]')].every((w) => { const r = w.getBoundingClientRect(); return r.bottom < body.top || r.top > body.bottom; });
      }, null, { timeout });
      const view = await page.evaluate(async (done) => {
        const photo = await import('/lib/case-photo.js');
        const body = document.querySelector('.lib-body');
        const b = body.getBoundingClientRect();
        const clip = { x: Math.max(0, b.left), y: Math.max(0, b.top), width: Math.min(innerWidth, b.right) - Math.max(0, b.left), height: Math.min(innerHeight, b.bottom) - Math.max(0, b.top) };
        const whole = (el) => { const r = el.getBoundingClientRect(); return r.top >= clip.y && r.bottom <= clip.y + clip.height && r.left >= clip.x && r.right <= clip.x + clip.width; };
        const tiles = [...body.querySelectorAll('.case-tile')].filter((t) => !done.includes(t.dataset.alg) && whole(t)).filter((t) => {
          // Nothing over it — a stage's head stays at the top of the body as it scrolls, and covers a tile's top row:
          // the tile is what is drawn at its centre and near each corner.
          const r = t.getBoundingClientRect();
          return [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]].every(([fx, fy]) => t.contains(document.elementFromPoint(
            r.left + 6 + fx * (r.width - 12), r.top + 6 + fy * (r.height - 12))));
        });
        const failed = [...body.querySelectorAll('.case-photo[data-photo="failed"]')].map((w) => w.closest('[data-alg]').dataset.alg);
        // THE TILE ITSELF is named for what follows, never looked up by its row: one row can be a tile in two of a
        // method's grids, and the other may be out of view.
        const once = new Map();
        for (const tile of tiles) if (!once.has(tile.dataset.alg)) once.set(tile.dataset.alg, tile);
        const named = (list) => list.map((tile) => { window.__marksTile = (window.__marksTile ?? 0) + 1; tile.dataset.measure = String(window.__marksTile); return { id: tile.dataset.alg, at: tile.dataset.measure }; });
        return {
          clip, failed, scrollTop: body.scrollTop, room: body.clientHeight, end: body.scrollHeight,
          tallest: Math.max(0, ...[...body.querySelectorAll('.case-tile, .sec-head')].map((el) => el.getBoundingClientRect().height)),
          flat: named([...once.values()].filter((t) => t.querySelector(':scope > svg rect.moved'))),
          // A photograph is marked where the photographer recorded where it stroked (an unmarked set's is bare).
          photo: named([...once.values()].filter((t) => { const img = t.querySelector('.case-photo[data-photo="shown"] > img'); return img && photo.photoMarks(img.src); })),
        };
      }, [...seen]);
      if (view.failed.length) throw new Error(`photographs that failed: ${view.failed.join(', ')}`);
      const todo = [...view.flat.map((t) => ({ what: 'tile', ...t })), ...view.photo.map((t) => ({ what: 'photo', ...t }))];
      if (todo.length) {
        const judged = await shotAndJudge(page, view.clip, (list) => ({
          inks: window.__marks.inks,
          pictures: list.map((t) => {
            const tile = document.querySelector(`[data-measure="${t.at}"]`);
            return { ...t, stickers: t.what === 'tile'
              ? window.__marks.stickersOfSvg(tile.querySelector(':scope > svg'), t.id)
              : window.__marks.stickersOfPhoto(tile.querySelector('.case-photo > img'), t.id) };
          }),
        }), todo, TILE_OUTLINE);
        for (const t of judged) {
          seen.add(t.id);
          for (const s of t.stickers) out.push({ what: t.what, id: t.id, method: key, ...s });
        }
      }
      // Tiles not yet whole and seen: the next view overlaps this one by a stage's head and two tiles, so a tile cut at
      // the foot of this one, or under a head at its top, is whole and clear in the next.
      if (view.scrollTop + view.room >= view.end - 1 || view.scrollTop === last) break;
      last = view.scrollTop;
      top = view.scrollTop + Math.max(40, view.room - 3 * view.tallest);
    }
  }
  return out;
}

/**
 * The book's picture, as each of `ids`' pages shows it: the page opened on the row, the book opened, and each marked
 * sticker judged. Returns `{ what: 'book', id, f, ... }` per marked sticker.
 */
export async function measureBook(page, { ids, timeout }) {
  const out = [];
  for (const id of ids) {
    await page.evaluate(async (alg) => {
      const { state } = await import('/lib/app-state.js');
      const { refreshScreen } = await import('/lib/screen-shell.js');
      state.practiceAlg = alg;
      refreshScreen();
    }, id);
    await page.waitForSelector(`.practice-page[data-ready="1"][data-alg="${id}"]`, { timeout });
    if (await page.evaluate(() => document.querySelector('#practiceInfo').hidden)) await page.click('#practiceBook');
    await page.waitForFunction(() => !document.querySelector('#practiceInfo').hidden && document.querySelector('#practicePic svg rect.moved'), null, { timeout });
    await page.evaluate(() => window.__marks.frames());
    const clip = await page.evaluate(() => { const b = document.querySelector('#practicePic svg').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
    // The book is drawn in the context's one theme, so its two mark colours are the library's.
    const [m] = await shotAndJudge(page, clip, (alg) => ({
      inks: window.__marks.inks,
      pictures: [{ what: 'book', id: alg, stickers: window.__marks.stickersOfSvg(document.querySelector('#practicePic svg'), alg) }],
    }), id, BOOK_OUTLINE);
    for (const s of m.stickers) out.push({ what: 'book', id, ...s });
    await page.keyboard.press('Escape');
  }
  return out;
}
