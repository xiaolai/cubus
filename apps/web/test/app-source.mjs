// The app's UI-thread source as the text-reading tests read it, and the one scanner they share.
//
// Many invariants in this suite are properties of the SOURCE, checked by reading it: no stage search
// on the UI thread, no minimality claim outside its sanctioned regions, no invented stage structure,
// no forbidden wording. They were written when app.js was all of that source, and each read app.js
// alone. Then code began moving out of app.js into modules its screens import — the walk's hold
// (`lib/hold-presenter.js`), then the walk session (`lib/walk-session.js`) — and a scan that reads
// only app.js stops covering what moved while it goes on passing. That is exactly how an invariant
// stops holding without ever failing, so the list lives here, once, and the rule is: A MODULE LIFTED
// OUT OF app.js JOINS `APP_SOURCES` IN THE SAME CHANGE.
//
// `blockAt` is the other half. The wiring tests cut a function out of the source with a lazy match
// up to a `}` at a fixed indentation, and moving code re-indents it: the match then ends early, or
// runs on into the NEXT function and passes on lines that were never its subject. Simulated on the
// walk session's extraction (2026-09-13) with a four-space re-indent, `liveUpdate`'s block ran on
// into `liveGap` and still found the line it was looking for. The scanner below is the one
// `optimal.test.mjs` hardened against being walked past, and it reads a block to its own closing
// brace wherever that is indented.

import { readFileSync } from 'node:fs';

/** Every module whose text is the app's UI thread, app.js first. Paths are relative to apps/web. */
export const APP_SOURCES = Object.freeze(['lib/app.js', 'lib/walk-session.js', 'lib/hold-presenter.js']);

/** The app's source: every file in `APP_SOURCES`, joined. A missing file throws. */
export function readAppSource() {
  return APP_SOURCES.map((p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')).join('\n');
}

// ---- reading JavaScript properly enough to make an invariant out of it ------------------------------
//
// Why a walk and not a regex is recorded where the scanner was first needed, in `optimal.test.mjs`,
// together with the negative fixtures that prove it cannot be walked past.

const REGEX_MAY_FOLLOW = new Set([...'(,=:[!&|?{};+-*%~^<>']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
  'instanceof', 'do', 'else', 'yield', 'await']);

/** Is the `/` at `at` a regex literal rather than a division? The standard heuristic: look back
 *  at the last significant token. A regex can only follow an operator, a punctuator or one of a
 *  few keywords; after an identifier, a `)` or a `]` it is division. */
function startsRegex(src, at) {
  let k = at - 1;
  while (k >= 0 && /\s/.test(src[k])) k -= 1;
  if (k < 0) return true;
  if (REGEX_MAY_FOLLOW.has(src[k])) return true;
  if (!/[\w$]/.test(src[k])) return false;
  let s = k;
  while (s >= 0 && /[\w$]/.test(src[s])) s -= 1;
  return REGEX_KEYWORDS.has(src.slice(s + 1, k + 1));
}

function endOfQuoted(src, at) {
  const quote = src[at];
  for (let i = at + 1; i < src.length; i += 1) {
    if (src[i] === '\\') { i += 1; continue; }
    if (src[i] === '\n') throw new Error(`scan: a ${quote} string ran past the end of its line at ${at}`);
    if (src[i] === quote) return i + 1;
  }
  throw new Error(`scan: unterminated ${quote} string at ${at}`);
}

function endOfRegex(src, at) {
  let inClass = false;
  for (let i = at + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '\n') throw new Error(`scan: a regex literal ran past the end of its line at ${at}`);
    if (inClass) { if (ch === ']') inClass = false; continue; }
    if (ch === '[') { inClass = true; continue; }
    if (ch === '/') {
      let end = i + 1;
      while (end < src.length && /[a-z]/.test(src[end])) end += 1;
      return end;
    }
  }
  throw new Error(`scan: unterminated regex literal at ${at}`);
}

/**
 * Walk JavaScript, collecting every literal's TEXT.
 *
 * A template contributes the parts outside its `${}` — its cooked text — and each expression
 * inside is walked as code, so a literal nested three deep is collected exactly once and counts
 * exactly once. (Collecting the whole template as well would double-count every nested claim,
 * and `claims(label) === 1` in optimal.test.mjs is an equality.)
 *
 * With `balanced`, the scan starts at a `{` and stops after the `}` that closes it, ignoring
 * braces inside strings, templates, comments and regexes — which is how a block is extracted
 * without depending on how it happens to be indented.
 */
export function walk(src, { from = 0, balanced = false } = {}) {
  const literals = [];
  const modes = [];
  let i = from;
  let part = '';
  if (balanced) {
    if (src[i] !== '{') throw new Error('scan: a balanced walk must start at a {');
    modes.push('block');
    i += 1;
  }
  while (i < src.length) {
    const ch = src[i];
    if (modes[modes.length - 1] === 'template') {
      if (ch === '\\') { part += src.slice(i, i + 2); i += 2; continue; }
      if (ch === '`') { literals.push(part); part = ''; modes.pop(); i += 1; continue; }
      if (ch === '$' && src[i + 1] === '{') { literals.push(part); part = ''; modes.push('expr'); i += 2; continue; }
      part += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`scan: unterminated block comment at ${i}`);
      i = end + 2;
      continue;
    }
    if (ch === '/' && startsRegex(src, i)) { i = endOfRegex(src, i); continue; }
    if (ch === "'" || ch === '"') {
      const end = endOfQuoted(src, i);
      literals.push(src.slice(i + 1, end - 1));
      i = end;
      continue;
    }
    if (ch === '`') { modes.push('template'); i += 1; continue; }
    if (ch === '{') { modes.push('block'); i += 1; continue; }
    if (ch === '}') {
      if (modes.length === 0) throw new Error(`scan: a } closing nothing at ${i}`);
      modes.pop();
      i += 1;
      if (balanced && modes.length === 0) return { literals, end: i };
      continue;
    }
    i += 1;
  }
  if (modes.length > 0) throw new Error(`scan: ended inside a ${modes[modes.length - 1]}`);
  if (balanced) throw new Error('scan: the block never closed');
  return { literals, end: i };
}

/**
 * The source of the block `anchor` opens: from the anchor to the `}` that closes the first `{` at or
 * after it, however the block is indented.
 *
 * Refuses rather than guesses, and every refusal throws — so a case built on a block can never pass
 * over an empty one, which is the silent pass the old `?.[0] ?? ''` extractions allowed. The anchor
 * must appear exactly once, or the block found could be a different one; and nothing between the
 * anchor and its brace may open a literal, or the brace could be one inside a string.
 */
export function blockAt(src, anchor) {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`blockAt: ${JSON.stringify(anchor)} is not in the source`);
  if (src.indexOf(anchor, at + 1) >= 0) throw new Error(`blockAt: ${JSON.stringify(anchor)} appears more than once`);
  const brace = src.indexOf('{', at);
  if (brace < 0) throw new Error(`blockAt: nothing opens a block after ${JSON.stringify(anchor)}`);
  if (/['"`]/.test(src.slice(at + anchor.length, brace))) {
    throw new Error(`blockAt: a literal opens between ${JSON.stringify(anchor)} and its brace — anchor closer to the block`);
  }
  return src.slice(at, walk(src, { from: brace, balanced: true }).end);
}
