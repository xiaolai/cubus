// The Practice screen's LIBRARY composition: one method at a time, its stages in order, each a grid of case tiles —
// as markup (dev-docs/practice-redesign-plan.md §4, WI-3).
//
// Pure over the catalogue the library worker sends (`catalogueOf` in lib/drill/library-client.js): no DOM, no
// state, so what a tile shows is a function of the row and nothing else. Every word the library writes goes through
// `t()`, and so does every FIXED sentence the ledger declares — a set's name and its purpose. A row's own sentence
// (`says`) does not: the ledger assembles it in the library worker, in English, and a catalogue keyed by whole
// sentences cannot translate an assembled one. No locale ships (nothing outside the tests calls `registerLocale`), so
// that waits for the first one; test/practice-view.test.mjs holds the rest to a locale made for the test. Every
// string from the ledger is escaped — a row is data, never markup.
//
// PICTURES, NOT PROSE (R1). A tile is a case picture, the name the SOURCE gives the case where it gives one, and a
// ring; a stage is what it builds, its name and a count. A set's purpose waits behind the stage's book button
// (`aboutHtml`), and a row's sentence on its page: the audience is a child who cannot read, and a parent who asks.
//
// DRAWN ON APPROACH. A stage's grids are drawn EMPTY (`bodyHtml`); the screen fills a grid (`tilesHtml`) when it
// comes near the view. Every card of every set built at every visit was 208 ms on the UI thread (measured
// 2026-10-18 in WebKit) — for pictures nobody had scrolled to.

import { PHOTO_FRAME, isMarked, isPhotographed } from '../../case-photo.js';
import { netSvg, topFaceSvg } from '../../cube-flat.js';
import { movedPieces } from '../../drill/case-of.js';
import { fingersOf } from '../../drill/record.js';
import { plural, t } from '../../i18n.js';
import { REGISTRY_LEVELS } from '../../method-row.js';
import { methodById } from '../../methods/registry.js';
import { targetPicture } from '../../stage-picture.js';

/** The width a card's picture is drawn at: a net is twelve stickers across, a top face three plus its ring. */
const NET_W = 132;
const TOP_W = 96;

/** What a row is called on a card: the source's label with its nickname, or the id where the source gives
 *  neither (a hand-written table names an algorithm by its id only — the ledger's `notGiven` says so). */
export const rowName = (row) => {
  const name = row.label ?? row.id;
  return row.nickname ? t('%1 · %2', name, row.nickname) : name;
};

/** What a tile is captioned with: the name the SOURCE gives the case — its nickname where it has one ("Sune"), else
 *  its label — or null where the source names none (422 rows: every hand-written and proved row, most of Mehta's).
 *  Never the id, which `rowName` falls back to for assistive tech: an id is a key, not a name a learner can say
 *  (dev-docs/practice-redesign-plan.md §4.2, owner decision D5). */
export const captionOf = (row) => row.nickname ?? row.label ?? null;

/** What a set is FOR: the ledger's purpose, the set's where the row carries none of its own — a fixed sentence,
 *  so it is said in the active language. */
export const purposeOf = (row, set) => {
  const purpose = row.purpose ?? set?.purpose ?? null;
  return purpose === null ? null : t(purpose);
};

/** The row's case, drawn: a top face where the algorithm keeps the first two layers, the net otherwise. */
export function casePicture(row, { palette, scheme, scale = 1 } = {}) {
  const { facelets, picture } = row.solves;
  const title = t('The case %1 solves', rowName(row));
  if (picture === 'net') return netSvg(facelets, { palette, scheme, width: NET_W * scale, title });
  return topFaceSvg(facelets, {
    palette, scheme, width: TOP_W * scale, ring: true, mode: picture === 'top-orientation' ? 'orientation' : 'colours', title,
  });
}

/** The least band an outline is drawn with, in the picture's own units. */
const OUTLINE_LEAST = 1.6;

/**
 * How a flat picture's moved stickers are outlined: the band's width as a share of the sticker's (`perSticker` bands
 * make a sticker, never under `OUTLINE_LEAST`), and whether the band lies wholly INSIDE the sticker's edge rather than
 * astride it.
 *
 * A TILE's is the edge the plan measured (§3.6): astride the edge, a sixth of the sticker, and the tiles' lists and their
 * 0 alike pairs per set were derived with it (test/browser/case-photos.test.mjs).
 */
export const TILE_OUTLINE = Object.freeze({ perSticker: 6.25, inside: false });

/**
 * The BOOK's (E13). Its picture is 112 px wide, a net's sticker under 9 px, and the tile's band astride that edge put
 * half of it on the gap and the neighbours: 6,680 of 9,151 marked stickers in white at DPR 1 had under 25% of their own
 * pixels changed at 48/255 (median 22.2%) — a mark present but not SEEN, the defect E8 settled for photographs. Drawn
 * INSIDE the edge, all of the band falls on the sticker, which keeps its size and its fill. The least band meets E8's
 * gate there at DPR 1 and 2 (smallest 28.0% and 30.2% of a sticker, measured 2026-10-19), so it is the least band:
 * "the book's picture: every marked sticker …" in test/browser/case-photos.test.mjs, which reads the size, the ink and
 * the ground off the open book.
 */
export const BOOK_OUTLINE = Object.freeze({ perSticker: Infinity, inside: true });

/**
 * A flat picture with the pieces its case moves MARKED: every sticker of a moved piece keeps its fill — never greyed,
 * never recoloured (AGENTS.md §2) — and gets a heavier edge in the ink colour, so it follows the theme
 * (dev-docs/practice-redesign-plan.md §3.6). `moved` are viewed facelet indices (`movedPieces(...).viewed`, flattened);
 * a moved sticker the picture does not draw is simply not there to mark. `outline` says how heavy, and where.
 */
export function outlineMoved(svg, moved, outline = TILE_OUTLINE) {
  const on = new Set(moved);
  return svg.replace(/<rect data-facelet="(\d+)"([^>]*?) stroke="[^"]*" stroke-width="1"\/>/g, (m, f, rest) => {
    if (!on.has(Number(f))) return m;
    const w = Number(/ width="([\d.]+)"/.exec(rest)?.[1] ?? 10);
    const band = Math.max(OUTLINE_LEAST, w / outline.perSticker);
    // Inside the edge: the rect drawn half a band in on every side, so the stroke's OUTER edge is the sticker's.
    const at = outline.inside
      ? rest.replace(/ (x|y|width|height|rx|ry)="([\d.]+)"/g, (_, k, v) => ` ${k}="${Math.max(0, Number(v) + ({ x: 1, y: 1, width: -2, height: -2, rx: -1, ry: -1 })[k] * band / 2).toFixed(2)}"`)
      : rest;
    return `<rect class="moved" data-facelet="${f}"${at} stroke="currentColor" stroke-width="${band.toFixed(2)}"/>`;
  });
}

/**
 * A card's picture: for a photographed row (lib/case-photo.js) an empty well the size of its photograph, which the
 * screen fills when the photograph lands — never today's net first, so no card swaps from a net to a cube; for every
 * other row the flat picture, its moved pieces outlined unless its set is on the unmarked list.
 */
export function tilePicture(row, region, look, esc) {
  if (isPhotographed(row)) {
    // Sized by the stylesheet, which knows where the well is drawn; its shape is the still's — cut to the cube in
    // PHOTO_FRAME's shape — so the photograph fills it.
    return `<span class="case-photo" data-photo="pending" role="img" aria-label="${esc(t('The case %1 solves', rowName(row)))}" style="aspect-ratio:${PHOTO_FRAME.w}/${PHOTO_FRAME.h}"></span>`;
  }
  return markedPicture(row, region, look);
}

/**
 * A row's flat picture with the pieces its case moves outlined, unless its set is on the unmarked list (§3.6): a flat
 * tile's picture, and — with the book's heavier outline (`bookPicture`) — the Practice book's for every row (E13): there
 * the live cube beside it is the 3D view, so the book keeps the flat one rather than a copy of the photograph.
 */
export function markedPicture(row, region, look, outline = TILE_OUTLINE) {
  const flat = casePicture(row, look);
  return isMarked(row) ? outlineMoved(flat, movedPieces(row, region).viewed.flat(), outline) : flat;
}

/** The Practice book's picture of a row: the marked flat picture, outlined for the book's size (`BOOK_OUTLINE`). */
export const bookPicture = (row, region, look) => markedPicture(row, region, look, BOOK_OUTLINE);

// ---- the methods ---------------------------------------------------------------------------------------------

/**
 * A library method's KEY: the registry id of a method the app's solver walks, a key made from the name of one it
 * does not, and `tables` for the proved tables no method teaches. Stored as `settings.practiceMethod`, whose load
 * checks the shape (`isLibraryKey` in lib/app-settings.js) — the keys themselves are only known here.
 */
export const libraryKey = (group) => group.method
  ?? (group.label === null ? 'tables' : group.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

/** What a library method is called: its method's name, or — for the tables no method teaches — that. Never "fewest"
 *  or "proved": a minimum is claimed from three places only (AGENTS.md §1, optimal.test.mjs), and this is none. */
const methodLabel = (group) => group.label ?? 'Not taught by any method';

/** The method row's groups (lib/method-row.js): the registry's levels, then the two the library adds (plan §4.1). */
export const LIBRARY_LEVELS = Object.freeze([
  ...REGISTRY_LEVELS,
  Object.freeze({ id: 'not-in-solver', name: () => t('Not in the app’s solver yet') }),
  Object.freeze({ id: 'tables', name: () => t('Tables') }),
]);

/** The methods the library offers, for the method row: `{ id, label, level }`, in the catalogue's order. */
export const libraryMethods = (catalogue) => catalogue.groups.map((g) => Object.freeze({
  id: libraryKey(g),
  label: methodLabel(g),
  level: g.method ? methodById(g.method).level : g.label === null ? 'tables' : 'not-in-solver',
}));

/**
 * The method the library opens on: its own choice (`practiceMethod`) where it holds that method, else the solve tab's
 * method, else its first — Beginner. Quick teaches no algorithm, so it opens on Beginner, the fallback `methodNow` in
 * lib/screens/cube.js uses (plan §4.1).
 */
export function openingKey(catalogue, { practiceMethod, solveMethod }) {
  const keys = catalogue.groups.map(libraryKey);
  if (practiceMethod !== null && keys.includes(practiceMethod)) return practiceMethod;
  if (keys.includes(solveMethod)) return solveMethod;
  return keys[0];
}

// ---- stages and grids ----------------------------------------------------------------------------------------

/** A stage's rows: its sets' rows in the ledger's order, each once. */
export const stageIds = (catalogue, phase) => [...new Set(phase.sets.flatMap((id) => catalogue.sets[id].ids))];

/** OLL's groups by how many top edges are already up (owner decision D5): derived per row in the catalogue. */
const EDGES_UP_PARTS = Object.freeze([
  Object.freeze({ up: 0, name: 'No top edge up' }),
  Object.freeze({ up: 2, name: 'Two top edges up' }),
  Object.freeze({ up: 4, name: 'All four top edges up' }),
]);

/** A grid's rows: a whole set (`part` empty), or one edges-up group of it (`part` the count, as a string). */
export function gridIds(catalogue, setId, part = '') {
  const set = catalogue.sets[setId];
  if (part === '' || part === undefined) return set.ids;
  if (set.edgesUp === null) throw new Error(`library-view: ${setId} is not grouped by top edges up`);
  return set.ids.filter((id) => String(set.edgesUp[id]) === String(part));
}

/** The grids of one stage, in order: `{ set, part, caption }` — a set's name when the stage holds several, and an
 *  edges-up caption for each of OLL's groups. */
function gridsOf(catalogue, phase) {
  return phase.sets.flatMap((id) => {
    const set = catalogue.sets[id];
    const named = phase.sets.length > 1 ? t(set.name) : null;
    if (set.edgesUp === null) return [{ set: id, part: '', caption: named, sub: null }];
    return EDGES_UP_PARTS.filter((p) => gridIds(catalogue, id, String(p.up)).length)
      .map((p, i) => ({ set: id, part: String(p.up), caption: i === 0 ? named : null, sub: t(p.name) }));
  });
}

/** What a stage BUILDS, drawn as the Shapes screen draws a target — or nothing where its end is no stop (plan §4.3). */
const stagePicture = (phase, look) => (phase.endsAt === null
  ? ''
  : netSvg(targetPicture(phase.endsAt), { ...look, width: 66, title: t('What this stage builds') }));

/** What a stage is called: its phase's name, or the tables' heading. */
const stageName = (phase) => (phase.phase === null ? t('Every case') : t(phase.phase));

/** A count the screen fills once the record is read (`countHtml`); until then the number of rows alone. */
const countSlot = (ids) => `<span class="ct" data-count="${ids.length}"><span class="num">${ids.length}</span></span>`;

/**
 * The rail: one item per stage, its picture, its name and its count — a jump to its section, and where the reader is.
 *
 * @param {object} group  a catalogue group
 * @param {object} catalogue
 * @param {{ palette: string, scheme: string }} look
 * @param {(v: unknown) => string} esc
 */
export function railHtml(group, catalogue, look, esc) {
  return group.phases.map((p, i) => {
    const ids = stageIds(catalogue, p);
    return `<button class="rail-item${i === 0 ? ' on' : ''}" type="button" data-jump="${i}" aria-label="${esc(t('%1: %2', stageName(p), plural(ids.length, { one: '%1 algorithm', other: '%1 algorithms' })))}">
      <span class="pic">${stagePicture(p, look)}</span><span class="nm">${esc(stageName(p))}</span>${countSlot(ids)}</button>`;
  }).join('');
}

/**
 * The stages, each a section: its header — picture, name, count, the book button — and its grids, EMPTY.
 *
 * @param {object} group
 * @param {object} catalogue
 * @param {{ palette: string, scheme: string }} look
 * @param {(v: unknown) => string} esc
 * @param {(name: string, size?: number) => string} icon  the app's icon map
 */
export function bodyHtml(group, catalogue, look, esc, icon) {
  return group.phases.map((p, i) => `<section class="stage-sec" data-sec="${i}">
    <div class="sec-head">
      <span class="pic">${stagePicture(p, look)}</span>
      <span class="ttl"><b>${esc(stageName(p))}</b>${countSlot(stageIds(catalogue, p))}</span>
      <button class="tbtn" type="button" data-about="${i}" aria-label="${esc(t('What these are for'))}" title="${esc(t('What these are for'))}">${icon('book', 18)}</button>
    </div>
    ${gridsOf(catalogue, p).map((g) => `${g.caption ? `<div class="set-cap">${esc(g.caption)}</div>` : ''}${g.sub ? `<div class="set-cap sub-cap">${esc(g.sub)}</div>` : ''}<div class="tiles" data-set="${esc(g.set)}" data-part="${esc(g.part)}"></div>`).join('')}
  </section>`).join('');
}

/** The book menu's words for a stage: each set's name and what it is for (plan §4.3) — the only prose the library has. */
export function aboutHtml(phase, catalogue, esc) {
  return phase.sets.map((id) => {
    const set = catalogue.sets[id];
    return `<p><b>${esc(t(set.name))}.</b>${set.purpose ? ` ${esc(t(set.purpose))}` : ''}</p>`;
  }).join('');
}

/** The sources the ledger names and does not hold yet, said in the library's head; nothing when there are none. */
export function pendingHtml(catalogue, esc) {
  if (!catalogue.pending.length) return '';
  return `<div class="lib-note" data-pending="${esc(catalogue.pending.map((p) => p.id).join(' '))}">${esc(t('Not here yet: %1. Their tables are not part of the app yet, so they cannot be practised.', catalogue.pending.map((p) => t(p.name)).join(t(', '))))}</div>`;
}

// ---- tiles and rings -----------------------------------------------------------------------------------------

/** A tile's name for assistive tech: the row's name (an id is acceptable to a screen reader, not to the eye), and
 *  its progress once the record has been read — nothing about progress before then (`streak` null). */
export function tileLabel(row, streak, n) {
  if (streak === null || streak === 0) return rowName(row);
  return streak >= n ? t('%1, in the fingers', rowName(row)) : t('%1, %2 of %3 in a row', rowName(row), streak, n);
}

/**
 * Tiles for a grid's rows: ONE button each, which opens the row's page — its picture, its caption where the source
 * names the case, and an empty badge the screen fills with the ring once the record is read.
 */
export function tilesHtml(ids, catalogue, look, esc) {
  return ids.map((id) => {
    const row = catalogue.rows[id];
    const caption = captionOf(row);
    return `<button class="case-tile" type="button" data-alg="${esc(id)}" aria-label="${esc(tileLabel(row, null, 0))}">
      ${tilePicture(row, catalogue.sets[row.set].region, look, esc)}${caption === null ? '' : `<span class="cap">${esc(caption)}</span>`}<span class="badge" aria-hidden="true"></span></button>`;
  }).join('');
}

/** Past this many segments a ring is one continuous arc: segments narrower than this read as a dashed line. */
const MOST_SEGMENTS = 12;

/**
 * "In the fingers" as a picture: `n` segments with `k` lit, and at `k >= n` a filled disc with a tick (plan §4.2) —
 * one continuous arc past twelve segments. Drawn only for a record that has been read: an empty ring means
 * "read, and zero", never "unknown".
 */
export function ringSvg(k, n, size) {
  if (!Number.isInteger(k) || k < 0 || !Number.isInteger(n) || n < 1) throw new Error(`library-view: a ring of ${k} in ${n}`);
  const r = 9;
  const c = 12;
  const at = (a) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  const done = k >= n;
  const open = `<svg class="ring${done ? ' done' : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">`;
  const tick = done ? '<circle class="disc" cx="12" cy="12" r="6.2"/><path class="tick" d="M9.2 12.2l2 2 3.8-4"/>' : '';
  if (n > MOST_SEGMENTS) {
    const f = Math.min(k / n, 1);
    const a = f * 2 * Math.PI - Math.PI / 2;
    const arc = f <= 0 ? '' : f >= 1 ? `<circle class="seg on" cx="${c}" cy="${c}" r="${r}"/>`
      : `<path class="seg on" d="M${c} ${c - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${at(a)}"/>`;
    return `${open}<circle class="seg" cx="${c}" cy="${c}" r="${r}"/>${arc}${tick}</svg>`;
  }
  const gap = (9 * Math.PI) / 180;   // between segments: 9 degrees of the circle
  const segs = Array.from({ length: n }, (_, i) => {
    const a0 = (i / n) * 2 * Math.PI + gap / 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * 2 * Math.PI - gap / 2 - Math.PI / 2;
    return `<path class="seg${i < k ? ' on' : ''}" d="M${at(a0)} A${r} ${r} 0 0 1 ${at(a1)}"/>`;
  });
  return `${open}${segs.join('')}${tick}</svg>`;
}

/**
 * A tile's ring for a row's figures (`statsOf`): the same reading the Practice page's beads draw (`fingersOf`), so a
 * tile and its page never disagree (dev-docs/practice-redesign-plan.md WI-7). Nothing for a record not read (`null`).
 */
export function tileRing(stats, n, size) {
  const fingers = fingersOf(stats, n);
  return fingers === null ? '' : ringSvg(fingers.lit, n, size);
}

/** A stage's or method's count once the record is read: how many of its rows are in the fingers, as a ring and k/n. */
export function countHtml(ids, statsOfRow, n, size = 14) {
  const k = ids.filter((id) => fingersOf(statsOfRow(id), n).reached).length;
  return `${ringSvg(k, ids.length, size)}<span class="num">${k}/${ids.length}</span>`;
}
