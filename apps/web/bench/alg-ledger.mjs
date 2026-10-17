// The algorithm ledger, row by row: every algorithm this repository holds, with everything computed about it.
//
//   node bench/alg-ledger.mjs            a short report
//   node bench/alg-ledger.mjs --emit     rewrite test/fixtures/alg-ledger.mjs and the review page
//                                        dev-docs/artifacts/algorithm-ledger.html
//
// dev-docs/algorithm-drill-v2-plan.md §2. The rows are `lib/alg-library.js`'s — this file computes nothing
// about an algorithm itself, so the page, the fixture and the drill cannot describe one algorithm three ways.
// What it adds is the shape: the rows in order, the counts, the PENDING sources, and the GAPS — every column
// the library could not fill for a row, which owner decision 4 makes the gate (plan §8): no row becomes
// drillable until its sentence, its picture and its source are on the review page, and a row that cannot be
// described is listed, never silently left out.
//
// The page is for the owner's review and lives under dev-docs/ (gitignored); the fixture is what
// `alg-ledger.test.mjs` holds the library to.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALG_SETS, ALG_SOURCES, METHOD_SETS, PENDING_SOURCES, TRIGGERS, TRIGGER_SOURCES, algIds, algRow, algSet,
} from '../lib/alg-library.js';
import { netSvg, topFaceSvg } from '../lib/cube-flat.js';
import { movesOf } from '../lib/cube-pieces.js';

/** Every leaf of a row that is `null`, as a dotted path. */
function nullPaths(value, path = '') {
  if (value === null) return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => nullPaths(v, `${path}[${i}]`));
  if (typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => nullPaths(v, path ? `${path}.${k}` : k));
  return [];
}

/**
 * Why a `null` is there. A field the SOURCE does not give is not a gap: the set says why (`notGiven`). A
 * `sourceAlg` or `nicknameSource` is null exactly when there is nothing to record — the row's algorithm is
 * its source's string, or it has no nickname. Anything else null is a GAP: a column the library could not fill.
 */
function explainNull(row, path) {
  const set = algSet(row.set);
  const field = path === 'solves.case' ? 'case' : path;
  if (Object.hasOwn(set.notGiven, field)) return { given: false, why: set.notGiven[field] };
  if (path === 'sourceAlg') return { given: false, why: 'the algorithm is the source\'s string unchanged' };
  if (path === 'nicknameSource') return { given: false, why: 'no nickname, so no source for one' };
  return null;
}

/**
 * The ledger, built from the library: rows in `algIds()` order, the counts, the pending sources and the gaps.
 * A row the library refuses to build is a GAP with the refusal as its reason — listed, never dropped.
 */
export async function buildLedger() {
  const rows = [];
  const gaps = [];
  for (const id of await algIds()) {
    let row;
    try {
      row = await algRow(id);
    } catch (err) {
      gaps.push({ id, column: '*', why: err.message });
      continue;
    }
    for (const path of nullPaths(row)) {
      if (!explainNull(row, path)) gaps.push({ id, column: path, why: 'the generator could not compute it' });
    }
    rows.push(row);
  }
  const perSet = Object.fromEntries(ALG_SETS.filter((s) => s.kind !== 'not an algorithm')
    .map((s) => [s.id, rows.filter((r) => r.set === s.id).length]));
  const perKind = {};
  for (const r of rows) perKind[algSet(r.set).kind] = (perKind[algSet(r.set).kind] ?? 0) + 1;
  return {
    counts: { rows: rows.length, perKind, perSet, gaps: gaps.length, distinctAlgs: new Set(rows.map((r) => r.alg)).size },
    pending: PENDING_SOURCES.map((p) => ({ ...p })),
    gaps,
    rows,
  };
}

// ---- the page ---------------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PICTURE_TITLE = { 'top-orientation': 'The top face: which stickers show the top colour', 'top-colours': 'The top face and its ring', net: 'The whole cube, unfolded' };

function pictureOf(row) {
  const { facelets, picture } = row.solves;
  const title = `${row.label ?? row.id}: ${PICTURE_TITLE[picture]}`;
  if (picture === 'net') return netSvg(facelets, { width: 168, title });
  return topFaceSvg(facelets, { width: 104, ring: true, mode: picture === 'top-orientation' ? 'orientation' : 'colours', title });
}

/** The algorithm, token by token, with each sourced trigger wrapped in a mark naming it. */
function algHtml(row) {
  const tokens = movesOf(row.alg);
  const names = Object.fromEntries(TRIGGERS.map((tr) => [tr.id, tr.name]));
  const out = [];
  for (let i = 0; i < tokens.length;) {
    const chunk = row.chunks.find((c) => c.from === i);
    if (chunk) {
      out.push(`<mark title="${esc(names[chunk.trigger])}">${tokens.slice(chunk.from, chunk.to).map(esc).join(' ')}</mark>`);
      i = chunk.to;
    } else {
      out.push(esc(tokens[i]));
      i += 1;
    }
  }
  return out.join(' ');
}

const links = (ids) => (ids.length ? ids.map((id) => `<a href="#row-${esc(id)}">${esc(id)}</a>`).join(', ') : '—');

function sourceHtml(row) {
  if (typeof row.source === 'string') return esc(row.source);
  const s = row.source;
  let out = `<a href="${esc(s.url)}" rel="noreferrer">${esc(s.name)}</a> <span class="dim">fetched ${esc(s.fetched)}</span>`;
  if (row.nicknameSource) out += `; nickname: <a href="${esc(row.nicknameSource.url)}" rel="noreferrer">${esc(row.nicknameSource.name)}</a>`;
  if (row.sourceAlg) out += `<br><span class="dim">as the source wrote it: <code>${esc(row.sourceAlg)}</code></span>`;
  return out;
}

const cycles = (list) => list.map((c) => `(${c.positions.join(' → ')})${c.turn ? `<sup>+${c.turn}</sup>` : ''}`).join(' ');

function effectHtml(row) {
  const e = row.effect;
  const parts = [];
  if (e.cornerCycles.length) parts.push(`corners ${cycles(e.cornerCycles)}`);
  if (e.twistedInPlace.length) parts.push(`twisted ${e.twistedInPlace.map((p) => `${p.position}<sup>+${p.turn}</sup>`).join(' ')}`);
  if (e.edgeCycles.length) parts.push(`edges ${cycles(e.edgeCycles)}`);
  if (e.flippedInPlace.length) parts.push(`flipped ${e.flippedInPlace.map((p) => p.position).join(' ')}`);
  parts.push(`${e.parity} parity`);
  if (!e.keepsHold) parts.push(`ends held [${e.endHold.join(', ')}]`);
  return parts.join(' · ');
}

const observableHtml = (row) => (row.observable.length
  ? row.observable.map((o) => `<code>${esc(o.token)}</code> (move ${o.at + 1}) reports ${o.reports.length ? o.reports.map((r) => `<code>${esc(r)}</code>`).join(' + ') : 'nothing'}`).join('; ')
  : 'every move is a face turn: a smart cube reports each as written');

const notGivenHtml = (row, field) => {
  const why = algSet(row.set).notGiven[field];
  return `<span class="dash" title="${esc(why ?? '')}">—</span>`;
};

function rowHtml(row) {
  const name = row.label ?? notGivenHtml(row, 'label');
  const nick = row.nickname ? ` <span class="nick">“${esc(row.nickname)}”</span>` : '';
  const methods = row.methods.length ? row.methods.map((m) => `${esc(m.method)}/${esc(m.stage)}`).join(', ') : 'taught by no method — the oracle';
  const search = [row.id, row.label, row.nickname, row.alg, row.says, row.set].filter(Boolean).join(' ').toLowerCase();
  return `<article class="row" id="row-${esc(row.id)}" data-search="${esc(search)}">
  <div class="pic">${pictureOf(row)}</div>
  <div class="body">
    <h4>${name}${nick} <span class="id">${esc(row.id)}</span></h4>
    <p class="says">${esc(row.says)}</p>
    <p class="alg"><code>${algHtml(row)}</code></p>
    <dl>
      <dt>Source</dt><dd>${sourceHtml(row)}</dd>
      <dt>Taught by</dt><dd>${methods}</dd>
      <dt>Length</dt><dd>${row.htm} HTM · ${row.stm} STM · ${row.qtm} QTM · ${row.tokens} moves written${row.kinds.length ? ` · uses ${row.kinds.join(', ')}` : ''}</dd>
      <dt>Effect</dt><dd>${effectHtml(row)}</dd>
      <dt>Keeps</dt><dd>${row.keeps.length ? row.keeps.join(', ') : 'nothing'} · order ${row.order}</dd>
      <dt>Case</dt><dd>${row.solves.case ? `<code>${esc(row.solves.case)}</code> · ` : ''}held [${row.solves.viewHold.join(', ')}] · ${esc(PICTURE_TITLE[row.solves.picture])}</dd>
      <dt>Same moves</dt><dd>${links(row.sameAs)}</dd>
      <dt>Inverse</dt><dd>${links(row.inverseOf)}</dd>
      <dt>Mirror</dt><dd>${links(row.mirrorOf)}</dd>
      <dt>Smart cube</dt><dd>${observableHtml(row)}</dd>
    </dl>
  </div>
</article>`;
}

function setHtml(set, rows, rendered, where) {
  if (rendered.has(set.id)) {
    return `<section class="set ref"><h3>${esc(set.name)}</h3><p class="dim">The same ${rows.length} rows as under <a href="#set-${esc(set.id)}">${esc(rendered.get(set.id))}</a>.</p></section>`;
  }
  rendered.set(set.id, where);
  return `<section class="set" id="set-${esc(set.id)}"><h3>${esc(set.name)} <span class="dim">· ${rows.length} · ${esc(set.kind)}</span></h3>
<p class="purpose">${esc(rows[0]?.purpose ?? set.purpose)}</p>
<p class="prov">${esc(set.provenance.replace(/\.$/, ''))}. <span class="dim">Verified: ${esc(set.verified)}</span></p>
${rows.map(rowHtml).join('\n')}</section>`;
}

const CSS = `
:root{color-scheme:light dark;--bg:#faf8f4;--fg:#1f1c17;--dim:#6b645a;--card:#fff;--line:#e4dfd5;--accent:#7a4e1d;--mark:#f6e3b4;--facelet-off:#3A332A}
@media (prefers-color-scheme:dark){:root{--bg:#16140f;--fg:#ece6da;--dim:#a39b8d;--card:#1f1c16;--line:#36312a;--accent:#e2b371;--mark:#5a4720;--facelet-off:#cfc6b6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 80px}h1{font-size:1.7rem;margin:.2em 0}h2{margin-top:2.2em;border-bottom:2px solid var(--line);padding-bottom:.2em}
h3{margin:1.6em 0 .4em}.dim{color:var(--dim);font-weight:normal}a{color:var(--accent)}code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.counts{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.counts div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px}.counts b{display:block;font-size:1.4rem}
#q{width:100%;padding:10px 12px;font-size:1rem;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);position:sticky;top:8px;z-index:2}
.row{display:grid;grid-template-columns:180px 1fr;gap:16px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}
.row h4{margin:0;font-size:1.05rem}.row .id{color:var(--dim);font:12px ui-monospace,Menlo,monospace;margin-left:6px}.nick{font-weight:normal;font-style:italic}
.says{font-size:1.08rem;font-weight:600;margin:.3em 0}.purpose{font-size:1.1rem;margin:.2em 0 .4em;max-width:80ch}.alg code{font-size:15px}mark{background:var(--mark);color:inherit;border-radius:4px;padding:0 3px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:.5em 0 0;font-size:.88rem}dt{color:var(--dim)}dd{margin:0}
.pic{display:flex;align-items:flex-start;justify-content:center}.pic svg{max-width:100%;height:auto}.prov{max-width:80ch}
.dash{color:var(--dim);cursor:help}table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
.hidden{display:none}@media (max-width:640px){.row{grid-template-columns:1fr}.pic{justify-content:flex-start}}
`;

const SCRIPT = `
const q=document.getElementById('q');
q.addEventListener('input',()=>{const v=q.value.trim().toLowerCase();let n=0;
for(const r of document.querySelectorAll('.row')){const hit=!v||r.dataset.search.includes(v);r.classList.toggle('hidden',!hit);if(hit)n++;}
for(const s of document.querySelectorAll('.set')){const any=!s.querySelector('.row')||s.querySelector('.row:not(.hidden)');s.classList.toggle('hidden',Boolean(v)&&!any);}
document.getElementById('shown').textContent=v?n+' rows match':'';});
`;

export function pageHtml(ledger) {
  const byId = new Map(ledger.rows.map((r) => [r.id, r]));
  const rowsOf = (setId) => ledger.rows.filter((r) => r.set === setId);
  const rendered = new Map();
  const sections = [];
  for (const m of METHOD_SETS) {
    const stages = m.phases.map((p) => {
      if (!p.held) return `<h3>${esc(p.phase)}${p.stage ? ` <span class="dim">· stage ${esc(p.stage)}</span>` : ''}</h3><p class="dim">Nothing to memorise: ${esc(p.intuitive)}.</p>`;
      return `<h3 class="stage">${esc(p.phase)} <span class="dim">· stage ${esc(p.stage)}</span></h3>${p.held.map((id) => setHtml(algSet(id), rowsOf(id), rendered, `${m.method} → ${p.phase}`)).join('\n')}`;
    }).join('\n');
    sections.push(`<section class="method"><h2>${esc(m.method)} <span class="dim">· ${esc(m.id)}</span></h2>${stages}</section>`);
  }
  const oracle = ALG_SETS.filter((s) => s.kind === 'proved');
  sections.push(`<section class="method"><h2>Not taught — the proved tables <span class="dim">· the oracle</span></h2>
<p class="prov">The fewest-turn answers, proved minimal by search. No method teaches them; <code>human-algs.test.mjs</code> checks every sourced row against them.</p>
${oracle.map((s) => setHtml(s, rowsOf(s.id), rendered, 'the oracle')).join('\n')}</section>`);
  const unplaced = ledger.rows.filter((r) => !rendered.has(r.set));
  if (unplaced.length) throw new Error(`alg-ledger: ${unplaced.length} rows belong to no section of the page: ${unplaced.slice(0, 5).map((r) => r.id).join(', ')}`);

  const c = ledger.counts;
  const counts = [
    ['rows', c.rows], ['distinct algorithms', c.distinctAlgs], ...Object.entries(c.perKind), ['gaps', c.gaps], ['pending sources', ledger.pending.length],
  ].map(([k, v]) => `<div><b>${v}</b>${esc(k)}</div>`).join('');
  const perSet = Object.entries(c.perSet).map(([id, n]) => `<tr><td><a href="#set-${esc(id)}">${esc(algSet(id).name)}</a></td><td>${esc(algSet(id).kind)}</td><td>${n}</td></tr>`).join('');
  const pending = ledger.pending.map((p) => `<li><code>${esc(p.module)}</code> — ${esc(p.why)}</li>`).join('');
  const gaps = ledger.gaps.length
    ? `<table><tr><th>row</th><th>column</th><th>why</th></tr>${ledger.gaps.map((g) => `<tr><td>${byId.has(g.id) ? `<a href="#row-${esc(g.id)}">${esc(g.id)}</a>` : esc(g.id)}</td><td>${esc(g.column)}</td><td>${esc(g.why)}</td></tr>`).join('')}</table>`
    : '<p>None. Every row has its sentence, its picture, its source and every computed column. A dash on a row is a name the <em>source</em> does not give; hover it for why.</p>';
  const triggers = TRIGGERS.map((tr) => `<li><mark>${esc(tr.alg)}</mark> ${esc(tr.name)} — <a href="${esc(TRIGGER_SOURCES[tr.source].url)}" rel="noreferrer">${esc(TRIGGER_SOURCES[tr.source].name)}</a>, fetched ${esc(TRIGGER_SOURCES[tr.source].fetched)}</li>`).join('');
  const holds = Object.entries(ALG_SOURCES).map(([id, s]) => `<li><code>${esc(s.module)}</code> — held [${s.hold.join(', ')}]: ${esc(s.holdWhy)}</li>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Algorithm ledger — cubus</title><style>${CSS}</style></head>
<body><main>
<h1>Algorithm ledger</h1>
<p class="dim">Every algorithm cubus holds, one row each, generated by <code>apps/web/bench/alg-ledger.mjs</code> from <code>lib/alg-library.js</code>. Nothing on a row is typed beside the algorithm: the sentence, the picture, the lengths, the effect and the links are computed, and the test re-derives them with cubejs.</p>
<div class="counts">${counts}</div>
<input id="q" type="search" placeholder="Search by name, id, moves or sentence" aria-label="Search the rows"><p id="shown" class="dim"></p>
<details><summary>Rows per set</summary><table><tr><th>set</th><th>kind</th><th>rows</th></tr>${perSet}</table></details>
<details><summary>How to read a row</summary><ul>
<li>Each set opens with its <b>purpose</b>: what its algorithms are for, in plain words. The test holds it to every row's case and effect.</li>
<li>Each row's sentence says what the algorithm does toward that purpose: its point first, then what it keeps, then what it disturbs on the way. Before the last layer the point is the pieces the stage has built; the top layer, and pieces not built yet, may move. In the last layer the point is the top layer, and the sentence says what it keeps. The full account is the Effect line.</li>
<li>The picture is the case: the algorithm's inverse played on a solved cube, seen in the hold the learner starts in (white underneath). A top-face picture when it keeps the first two layers, the whole net otherwise.</li>
<li>HTM counts a half turn as 1, a slice as 2, a whole-cube turn as 0; STM counts a slice as 1; QTM counts a half turn as 2. All count the moves as written.</li>
<li>Effect positions are named with the cube held as the letters are written: U is the top, D the bottom (white).</li>
<li>Highlighted moves are triggers, named only where a source names them:</li><ul>${triggers}</ul>
<li>The hold each source module's letters are written in:</li><ul>${holds}</ul>
</ul></details>
${sections.join('\n')}
<h2 id="pending">Pending</h2><p>Not committed, so not read — listed rather than left out:</p><ul>${pending}</ul>
<h2 id="gaps">Gaps</h2>${gaps}
</main><script>${SCRIPT}</script></body></html>
`;
}

// ---- the fixture --------------------------------------------------------------------------------------------

const HEADER = `// The per-algorithm ledger. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/alg-ledger.mjs --emit
//   re-verify:  node --test apps/web/test/alg-ledger.test.mjs
//
// One row per algorithm, every column computed by lib/alg-library.js (dev-docs/algorithm-drill-v2-plan.md
// §2.1). The algorithms themselves live in their source modules; this records what the library says about
// them, so a change to what it says is a diff here that somebody reads.
`;

export function fixtureText(ledger) {
  return `${HEADER}
export const ALG_LEDGER_COUNTS = Object.freeze(${JSON.stringify(ledger.counts, null, 2)});

export const ALG_LEDGER_PENDING = Object.freeze(${JSON.stringify(ledger.pending, null, 2)});

export const ALG_LEDGER_GAPS = Object.freeze(${JSON.stringify(ledger.gaps, null, 2)});

/** One line a row, in the library's order. */
export const ALG_LEDGER_ROWS = Object.freeze([
${ledger.rows.map((r) => `  ${JSON.stringify(r)},`).join('\n')}
]);
`;
}

// Run only when invoked directly — the same guard as bench/algorithm-ledger.mjs, by resolved path, so an
// importer whose name merely ends the same way prints nothing.
const RUN_DIRECTLY = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (RUN_DIRECTLY) {
  const started = performance.now();
  const ledger = await buildLedger();
  const c = ledger.counts;
  console.log(`${c.rows} rows (${Object.entries(c.perKind).map(([k, v]) => `${v} ${k}`).join(', ')}), ${c.distinctAlgs} distinct algorithms.`);
  for (const [id, n] of Object.entries(c.perSet)) console.log(`  ${id.padEnd(16)} ${String(n).padStart(3)}`);
  console.log(`${c.gaps} gaps; ${ledger.pending.length} pending sources (${ledger.pending.map((p) => p.id).join(', ')}).`);
  if (process.argv.includes('--emit')) {
    const fixture = fileURLToPath(new URL('../test/fixtures/alg-ledger.mjs', import.meta.url));
    writeFileSync(fixture, fixtureText(ledger));
    console.log(`wrote ${fixture}`);
    const page = fileURLToPath(new URL('../../../dev-docs/artifacts/algorithm-ledger.html', import.meta.url));
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, pageHtml(ledger));
    console.log(`wrote ${page}`);
  }
  console.log(`built in ${Math.round(performance.now() - started)} ms`);
}
