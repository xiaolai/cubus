// The Practice screen's LIBRARY composition: every ledger row, by method, then stage, then set — as markup.
//
// Pure over the catalogue the library worker sends (`catalogueOf` in lib/drill/library-client.js): no DOM, no
// state, so what a card says is a function of the row and nothing else. Every word the library writes goes through
// `t()`, and so does every FIXED sentence the ledger declares — a set's name and its purpose. A row's own sentence
// (`says`) does not: the ledger assembles it in the library worker, in English, and a catalogue keyed by whole
// sentences cannot translate an assembled one. No locale ships (nothing outside the tests calls `registerLocale`), so
// that waits for the first one; test/practice-view.test.mjs holds the rest to a locale made for the test. Every
// string from the ledger is escaped — a row is data, never markup.
//
// WHAT IS SAID WHERE. The set's `purpose` — what every algorithm in it is FOR, one sentence shared by the set — is
// said ONCE, under the set's heading. A card says what is particular to its row: the case picture (`solves`), the
// row's name, and the row's own `says`. Saying the purpose on every card would repeat one sentence fifty times
// and hide the one that tells the cards apart. The library never writes a sentence about an algorithm itself (the
// ledger's rule: every fact is computed or sourced).

import { netSvg, topFaceSvg } from '../../cube-flat.js';
import { plural, t } from '../../i18n.js';

/** The width a card's picture is drawn at: a net is twelve stickers across, a top face three plus its ring. */
const NET_W = 132;
const TOP_W = 96;

/** What a row is called on a card: the source's label with its nickname, or the id where the source gives
 *  neither (a hand-written table names an algorithm by its id only — the ledger's `notGiven` says so). */
export const rowName = (row) => {
  const name = row.label ?? row.id;
  return row.nickname ? t('%1 · %2', name, row.nickname) : name;
};

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

/** One row as the button that opens it. `data-alg`, never an `id`: a set taught by two methods is listed twice.
 *  NAMED by what pressing it does and DESCRIBED by the row's sentence: the label replaces the name the content would
 *  give, so the sentence is tied back by `aria-describedby`, under `sayId` — unique on the page, which `data-alg`
 *  cannot be. */
function card(row, look, esc, sayId) {
  return `<button class="card alg-entry" type="button" data-alg="${esc(row.id)}" aria-label="${esc(t('Practise %1', rowName(row)))}" aria-describedby="${esc(sayId)}">
    ${casePicture(row, look)}
    <b class="alg-name">${esc(rowName(row))}</b>
    <span class="sub alg-say" id="${esc(sayId)}">${esc(row.says)}</span>
  </button>`;
}

/**
 * A set's cards, as markup — what goes in its grid the first time it is opened (`cardsHtml` is the screen's to call).
 *
 * @param {{ ids: string[] }} set
 * @param {Awaited<ReturnType<typeof import('../../drill/library-client.js').catalogueOf>>} catalogue
 * @param {{ palette: string, scheme: string }} look  the colours the pictures are painted in
 * @param {(v: unknown) => string} esc
 * @param {string|number} block  the set block's own number (`data-block`), which makes each card's ids unique
 */
export function cardsHtml(set, catalogue, look, esc, block) {
  return set.ids.map((id, k) => card(catalogue.rows[id], look, esc, `alg-say-${block}-${k}`)).join('');
}

/** One set: a disclosure, closed until asked for, so a list of three hundred pictures is a list of headings —
 *  each with its purpose, so what a set is for can be read before it is opened.
 *
 *  ITS GRID IS EMPTY until then. Every card of every closed set — 319 pictures, 10,593 stickers, 1.8 MB of markup —
 *  was built and inserted on the UI thread at every visit to the library, for headings nobody had opened (measured
 *  2026-10-18 in WebKit: 208 ms a visit). The screen fills a grid when its set is first opened. */
function setBlock(set, esc, n) {
  return `<details class="alg-set" data-set="${esc(set.id)}" data-block="${n}">
    <summary><b>${esc(t(set.name))}</b> <span class="sub">${esc(plural(set.ids.length, { one: '%1 algorithm', other: '%1 algorithms' }))}</span>
      ${set.purpose ? `<span class="sub alg-set-purpose">${esc(t(set.purpose))}</span>` : ''}</summary>
    <div class="alg-grid"></div>
  </details>`;
}

/**
 * The whole library, as markup: every method, stage and set, each set closed and its cards not yet drawn.
 *
 * @param {Awaited<ReturnType<typeof import('../../drill/library-client.js').catalogueOf>>} catalogue
 * @param {(v: unknown) => string} esc
 */
export function libraryHtml(catalogue, esc) {
  let n = 0;
  const groups = catalogue.groups.map((g) => `<section class="alg-method" data-method="${esc(g.method ?? '')}">
    <div class="eyebrow">${esc(g.label === null ? t('Not taught by any method') : t(g.label))}</div>
    ${g.phases.map((p) => `<div class="alg-phase">
      ${p.phase === null ? '' : `<div class="alg-phase-h">${esc(t(p.phase))}</div>`}
      ${p.sets.map((id) => setBlock(catalogue.sets[id], esc, n++)).join('')}
    </div>`).join('')}
  </section>`).join('');
  const pending = catalogue.pending.length
    ? `<div class="card alg-pending sub" data-pending="${esc(catalogue.pending.map((p) => p.id).join(' '))}">${esc(t('Not here yet: %1. Their tables are not part of the app yet, so they cannot be practised.', catalogue.pending.map((p) => t(p.name)).join(t(', '))))}</div>`
    : '';
  return `${groups}${pending}`;
}
