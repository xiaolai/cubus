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
export const APP_SOURCES = Object.freeze([
  'lib/app.js',
  // lifted out of app.js, 2026-09-13
  'lib/walk-session.js', 'lib/walk-live-distance.js', 'lib/walk-offer.js', 'lib/walk-resolver.js',
  'lib/walk-follow.js', 'lib/walk-presenter.js', 'lib/hold-presenter.js',
  'lib/version.js', 'lib/app-state.js', 'lib/app-settings.js', 'lib/screen-slots.js', 'lib/solver-service.js',
  'lib/cube-subject.js', 'lib/cube-drawing.js', 'lib/wake-lock.js', 'lib/window-chrome.js',
  'lib/cube-memory.js', 'lib/cube-trust-state.js',
  // the course's own state: which episode is showing, and surviving the load that fetches it
  'lib/course-session.js',
  'lib/reconnect-answer.js',
  'lib/live-session.js',
  'lib/cube-reports.js',
  'lib/cube-connection.js', 'lib/scramble-roll.js', 'lib/prove-affordance.js', 'lib/update-ui.js',
  'lib/screen-shell.js',
  // the menu both screens' corner menus are built on, 2026-09-14
  'lib/menu-popover.js', 'lib/scroll-strip.js',
  'lib/screens/scan.js', 'lib/screens/cube.js', 'lib/screens/timer.js', 'lib/screens/settings.js',
  'lib/screens/stats.js', 'lib/screens/lessons.js', 'lib/screens/course.js',
  // the Course screen's second composition: a lesson playing
  'lib/screens/course/episode-view.js',
  // the Drill screen's rounds
  'lib/screens/drill/round-play.js',
  // the cube screen's own parts, 2026-09-14
  'lib/screens/cube/route-race.js', 'lib/screens/cube/speed-menu.js', 'lib/screens/cube/die.js',
  'lib/screens/cube/reconnect-ask.js',
  // the scan screen's own parts, 2026-09-13
  'lib/screens/scan/stage-chips.js', 'lib/screens/scan/voice.js',
  'lib/screens/scan/camera-menu.js', 'lib/screens/scan/reconnect-check.js', 'lib/screens/scan/refusal.js',
  'lib/screens/scan/board.js', 'lib/screens/scan/sticker-picker.js', 'lib/screens/scan/capture-record.js',
  'lib/screens/scan/confirm-hold.js', 'lib/screens/scan/chime.js', 'lib/sound.js',
  'lib/screens/scan/sticker-view.js', 'lib/screens/scan/spoken.js', 'lib/speech.js',
  'lib/screens/scan/report-sides.js',
  // the settings screen's own parts, 2026-09-14
  'lib/screens/settings/smart-cube.js', 'lib/screens/settings/window-orientation.js',
  'lib/screens/settings/preferences.js', 'lib/screens/settings/spoken-lines.js',
  // the Timer's own parts, 2026-09-14
  'lib/screens/timer/scramble-request.js',
]);

/** Every other module under lib/: the engines, drivers, pure helpers, workers and bundle entries
 *  the app USES but that are not its own screens or services. They answer to their own tests, not
 *  to the app's source scans — the stage engine calls its own search, which the app must never do.
 *
 *  A module is put in one list or the other ON PURPOSE: the classification case in
 *  app-source.test.mjs fails until it is, and a "library" that imports the app's own modules is
 *  refused, because that is app code filed where the scans cannot see it. */
export const LIBRARY_SOURCES = Object.freeze([
  'lib/annotation-inks.js', 'lib/app-update.js', 'lib/ble-bridge.js', 'lib/ble-polyfill.js', 'lib/cube-flat.js', 'lib/cube-frame.js', 'lib/cube-gallery.js',
  'lib/cube-highlight.js', 'lib/cube-kit.js', 'lib/cube-layout.js', 'lib/cube-moves.js', 'lib/cube-notation.js',
  'lib/cube-orientation.js', 'lib/cube-pieces.js', 'lib/cube-questions.js',
  'lib/cube-reconnect.js', 'lib/cube-registry.js', 'lib/cube-report.js', 'lib/cube-selfcheck.js',
  'lib/cube-session.js', 'lib/cube-trust.js', 'lib/cube-view.js', 'lib/cubejs-entry.js',
  'lib/course-source.js',
  'lib/data/case-tables.js', 'lib/drill-rounds.js', 'lib/element-writes.js', 'lib/episode-audio.js', 'lib/host.js', 'lib/i18n.js', 'lib/lesson-format.js',
  'lib/lesson-player.js', 'lib/lesson-schedule.js', 'lib/method-ladder.js', 'lib/method-lesson.js',
  'lib/method-solver.js', 'lib/methods/cross.js', 'lib/methods/engine.js', 'lib/methods/index.js',
  'lib/methods/last-layer.js', 'lib/methods/pairs.js', 'lib/optimal-challenges.js', 'lib/optimal.js',
  'lib/os-insets.js', 'lib/random-state.js', 'lib/router.js', 'lib/scheme.js', 'lib/smartcube-entry.js',
  'lib/solve-client.js', 'lib/solve-stats.js', 'lib/solve-target.js', 'lib/solve-timer.js',
  'lib/script-drive.js', 'lib/script-player.js', 'lib/script-questions.js', 'lib/script-rounds.js', 'lib/script-track.js', 'lib/script-view.js',
  'lib/walk-clock.js', 'lib/walk-script.js',
  'lib/solve-worker.js', 'lib/solved.js', 'lib/solver-engine.js', 'lib/solving-hold.js', 'lib/stage-distance.js',
  'lib/stage-picture.js', 'lib/stage-report.js', 'lib/stage-route.js', 'lib/stage-targets.js',
  'lib/stage.js', 'lib/sticker-palettes.js', 'lib/tauri-mcp-guest-entry.js', 'lib/two-phase.js',
]);

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
 *
 * `sentences` is the other reading of the same literals: the pieces of ONE expression joined back
 * together — a template's parts across its holes, and literals joined by `+` — because a claim split
 * across an interpolation (`will ${qualifier} settle`) or a concatenation is still one sentence on
 * screen, and a guard that reads the pieces alone never sees it (audit, 2026-09-19). The hole itself
 * becomes a space, so what is read is what remains fixed in the sentence.
 */
export function walk(src, { from = 0, balanced = false } = {}) {
  const literals = [];
  /** Each literal with where it sat, so the pieces of one expression can be told from separate ones. */
  const pieces = [];
  const modes = [];
  let i = from;
  let part = '';
  /** Where the piece being gathered began: a quote, or the `}` that closed the hole before it. */
  let partAt = from;
  const piece = (text, start, end, { hole = false } = {}) => {
    literals.push(text);
    pieces.push({ text, start, end, hole });
  };
  if (balanced) {
    if (src[i] !== '{') throw new Error('scan: a balanced walk must start at a {');
    modes.push('block');
    i += 1;
  }
  while (i < src.length) {
    const ch = src[i];
    if (modes[modes.length - 1] === 'template') {
      if (ch === '\\') { part += src.slice(i, i + 2); i += 2; continue; }
      // Past the closing backtick, so what lies between two templates is the `+` alone.
      if (ch === '`') { piece(part, partAt, i + 1, { hole: partAt > from && src[partAt - 1] === '}' }); part = ''; modes.pop(); i += 1; continue; }
      if (ch === '$' && src[i + 1] === '{') {
        piece(part, partAt, i, { hole: partAt > from && src[partAt - 1] === '}' });
        part = '';
        modes.push('expr');
        i += 2;
        continue;
      }
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
      piece(src.slice(i + 1, end - 1), i, end);
      i = end;
      continue;
    }
    // From the backtick itself, as a quoted literal's span starts at its quote.
    if (ch === '`') { modes.push('template'); partAt = i; i += 1; continue; }
    if (ch === '{') { modes.push('block'); i += 1; continue; }
    if (ch === '}') {
      if (modes.length === 0) throw new Error(`scan: a } closing nothing at ${i}`);
      const closed = modes.pop();
      i += 1;
      if (closed === 'expr') partAt = i;
      if (balanced && modes.length === 0) return { literals, sentences: sentencesOf(src, pieces), end: i };
      continue;
    }
    i += 1;
  }
  if (modes.length > 0) throw new Error(`scan: ended inside a ${modes[modes.length - 1]}`);
  if (balanced) throw new Error('scan: the block never closed');
  return { literals, sentences: sentencesOf(src, pieces), end: i };
}

/**
 * Whether what sits between two literals makes them ONE expression. `+` and whitespace do, with at
 * most one plain name or call between them, so `'a' + b + 'c'` and `t('a') + ' b'` are each one
 * sentence. A comma, a new statement or an argument list does not — array elements and a call's
 * arguments are separate sentences however close together they are written.
 */
const JOINS = /^\s*\)*\s*\+\s*(?:[A-Za-z_$][\w$.]*\s*\(?\s*)?$/;

/** The pieces of one expression joined back into the sentence they make, holes closed up as spaces. */
function sentencesOf(src, pieces) {
  const out = [];
  let run = null;
  for (const p of pieces) {
    const joins = run && (p.hole || JOINS.test(src.slice(run.end, p.start)));
    if (joins) run.parts.push(p.text);
    else {
      if (run) out.push(run.parts.join(' '));
      run = { parts: [p.text] };
    }
    run.end = p.end;
  }
  if (run) out.push(run.parts.join(' '));
  return out;
}

/**
 * The source of the block `anchor` opens: from the anchor to the `}` that closes the first `{` at or
 * after it — after the parameter list, when the anchor opens a function's — however the block is
 * indented.
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
  // A FUNCTION's parameters can open a brace of their own: `function f({ a, b }) { … }`. Anchored
  // inside that list — `'function f('` — the first brace is the destructuring pattern, and the "block"
  // was the parameters: a case needing two lines of the body failed only because neither was there,
  // and a negative assertion on it would have passed over nothing (2026-09-13, `resolveWalk`). So a
  // definition's list is closed before the body's brace is looked for. Only a definition's: after a
  // call's open paren the first brace is the callback's body, which is the block those anchors want.
  //
  // From the anchor itself otherwise, not from its end: an anchor may carry its own brace (`'} else {'`),
  // and that brace is the block's. The first version of this rule searched after every anchor, and read
  // the scan screen's adoption branch as the options object two lines inside it.
  let from = at;
  const unclosed = (anchor.match(/\(/g) ?? []).length - (anchor.match(/\)/g) ?? []).length;
  if (unclosed > 0 && /\bfunction\b[^(]*\(/.test(anchor)) {
    let depth = unclosed;
    from = at + anchor.length;
    while (from < src.length && depth > 0) {
      const ch = src[from];
      if (ch === "'" || ch === '"' || ch === '`') {
        throw new Error(`blockAt: a literal opens in the parameters after ${JSON.stringify(anchor)} — anchor on the whole signature`);
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      from += 1;
    }
    if (depth > 0) throw new Error(`blockAt: the parameters after ${JSON.stringify(anchor)} never close`);
  }
  const brace = src.indexOf('{', from);
  if (brace < 0) throw new Error(`blockAt: nothing opens a block after ${JSON.stringify(anchor)}`);
  if (/['"`]/.test(src.slice(at + anchor.length, brace))) {
    throw new Error(`blockAt: a literal opens between ${JSON.stringify(anchor)} and its brace — anchor closer to the block`);
  }
  return src.slice(at, walk(src, { from: brace, balanced: true }).end);
}
