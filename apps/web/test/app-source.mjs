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

import { Parser, tokTypes as tt } from 'acorn';
import { transformSync } from 'esbuild';

/** Every module whose text is the app's UI thread, app.js first. Paths are relative to apps/web. */
export const APP_SOURCES = Object.freeze([
  'lib/app.js',
  // lifted out of app.js, 2026-09-13
  'lib/walk-session.js', 'lib/walk-live-distance.js', 'lib/walk-resolver.js',
  'lib/walk-follow.js', 'lib/walk-presenter.js', 'lib/hold-presenter.js',
  'lib/version.js', 'lib/app-state.js', 'lib/app-settings.js', 'lib/screen-slots.js', 'lib/solver-service.js',
  'lib/cube-subject.js', 'lib/cube-drawing.js', 'lib/wake-lock.js', 'lib/window-chrome.js',
  'lib/cube-memory.js', 'lib/cube-trust-state.js',
  'lib/reconnect-answer.js',
  'lib/live-session.js',
  'lib/cube-reports.js',
  'lib/cube-connection.js', 'lib/scramble-roll.js', 'lib/prove-affordance.js', 'lib/update-ui.js',
  'lib/screen-shell.js',
  // the menu both screens' corner menus are built on, 2026-09-14
  'lib/menu-popover.js', 'lib/scroll-strip.js',
  // the band over the cube card's foot for the rows a walk shows only sometimes, 2026-10-19 (E12.1)
  'lib/foot-band.js',
  'lib/screens/scan.js', 'lib/screens/cube.js', 'lib/screens/timer.js', 'lib/screens/settings.js',
  'lib/screens/stats.js',
  // the whole picture catalogue as a grid, and the two services behind it, 2026-10-04
  'lib/screens/shapes.js', 'lib/shape-recency.js', 'lib/shape-thumb.js',
  // the cube screen's own parts, 2026-09-14
  'lib/screens/cube/route-race.js', 'lib/screens/cube/die.js',
  'lib/screens/cube/pattern-menu.js',
  // the method row, generated from the method registry, 2026-10-16 (ADR 0011)
  'lib/method-row.js', 'lib/speed-menu.js',
  'lib/screens/cube/reconnect-ask.js',
  // the scan screen's own parts, 2026-09-13
  'lib/screens/scan/stage-chips.js', 'lib/screens/scan/voice.js',
  'lib/screens/scan/camera-menu.js', 'lib/screens/scan/reconnect-check.js', 'lib/screens/scan/refusal.js',
  'lib/screens/scan/board.js', 'lib/screens/scan/sticker-picker.js', 'lib/screens/scan/capture-record.js',
  'lib/screens/scan/confirm-hold.js', 'lib/screens/scan/chime.js', 'lib/sound.js',
  'lib/screens/scan/sticker-view.js', 'lib/screens/scan/cues.js',
  // the identity question the scanner raises when it cannot name the side in hand, 2026-09-25
  'lib/screens/scan/identity-ask.js',
  'lib/screens/scan/report-sides.js',
  // the settings screen's own parts, 2026-09-14
  'lib/screens/settings/smart-cube.js', 'lib/screens/settings/window-orientation.js',
  'lib/screens/settings/preferences.js',
  // the Timer's own parts, 2026-09-14
  'lib/screens/timer/scramble-request.js',
  // algorithm practice and its parts, and the lesson's way to it, 2026-10-17 (dev-docs/algorithm-drill-v2-plan.md §4)
  'lib/screens/practice.js', 'lib/screens/practice/library-view.js', 'lib/screens/practice/page-view.js',
  'lib/practice-link.js', 'lib/screens/settings/practice-target.js',
  // the library's case photographs, taken by the one parked renderer, 2026-10-18 (dev-docs/practice-redesign-plan.md §3)
  'lib/case-photo.js',
]);

/** Every other module under lib/: the engines, drivers, pure helpers, workers and bundle entries
 *  the app USES but that are not its own screens or services. They answer to their own tests, not
 *  to the app's source scans — the stage engine calls its own search, which the app must never do.
 *
 *  A module is put in one list or the other ON PURPOSE: the classification case in
 *  app-source.test.mjs fails until it is, and a "library" that imports the app's own modules is
 *  refused, because that is app code filed where the scans cannot see it. */
export const LIBRARY_SOURCES = Object.freeze([
  'lib/alg-effect.js', 'lib/alg-library.js', 'lib/annotation-inks.js', 'lib/app-update.js', 'lib/ble-bridge.js', 'lib/ble-polyfill.js', 'lib/cube-flat.js', 'lib/cube-frame.js', 'lib/cube-gallery.js',
  'lib/cube-highlight.js', 'lib/cube-kit.js', 'lib/cube-layout.js', 'lib/cube-moves.js', 'lib/cube-notation.js',
  'lib/cube-orientation.js', 'lib/cube-pieces.js', 'lib/cube-questions.js',
  'lib/cube-reconnect.js', 'lib/cube-registry.js', 'lib/cube-report.js', 'lib/cube-selfcheck.js',
  'lib/cube-session.js', 'lib/cube-trust.js', 'lib/cube-view.js', 'lib/cubejs-entry.js',
  'lib/data/case-tables.js', 'lib/data/corners-first-algs.js', 'lib/data/human-algs.js', 'lib/data/mehta-algs.js',
  // the drill engine, a module with no screen, 2026-10-17 (dev-docs/algorithm-drill-v2-plan.md §3)
  'lib/drill/candidates.js', 'lib/drill/engine.js', 'lib/drill/timing.js',
  // the practice record (an injected store, so no app module), its IndexedDB store (an injected factory, 2026-10-18)
  // and mixed practice, 2026-10-17 (§5)
  'lib/drill/mix.js', 'lib/drill/record.js', 'lib/drill/record-store.js',
  // the ledger read off the UI thread, 2026-10-17 (§4): the client and its worker
  'lib/drill/library-client.js', 'lib/drill/library-worker.js',
  // the case a row solves and the pieces it moves, out of the practice screen so a service can draw it, 2026-10-18
  'lib/drill/case-of.js',
  'lib/element-writes.js', 'lib/host.js', 'lib/i18n.js', 'lib/lesson-cut.js', 'lib/lesson-format.js',
  'lib/lesson-schedule.js', 'lib/method-lesson.js', 'lib/method-stops.js',
  'lib/method-solver.js', 'lib/methods/cross.js', 'lib/lesson-client.js', 'lib/lesson-worker.js',
  'lib/methods/engine.js', 'lib/methods/index.js', 'lib/methods/method-of.js', 'lib/methods/stage-ids.js',
  'lib/data/cmll-algs.js', 'lib/data/roux-manifest.js', 'lib/methods/roux.js', 'lib/methods/roux-blocks.js',
  'lib/methods/roux-build.js', 'lib/methods/roux-load.js', 'lib/methods/roux-tables.js',
  'lib/methods/last-layer.js', 'lib/methods/pairs.js', 'lib/methods/registry.js', 'lib/optimal-challenges.js', 'lib/optimal.js',
  'lib/os-insets.js', 'lib/random-state.js', 'lib/router.js', 'lib/scheme.js', 'lib/smartcube-entry.js',
  'lib/solve-client.js', 'lib/solve-stats.js', 'lib/solve-target.js', 'lib/solve-timer.js',
  'lib/script-drive.js', 'lib/script-player.js', 'lib/script-questions.js', 'lib/script-track.js', 'lib/script-view.js',
  'lib/walk-clock.js', 'lib/walk-script.js',
  'lib/solve-worker.js', 'lib/solved.js', 'lib/solver-engine.js', 'lib/solving-hold.js', 'lib/stage-distance.js',
  'lib/pattern-route.js', 'lib/patterns.js',
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
//
// THE TOKENS ARE ACORN'S, NOT OURS (audit, 2026-10-17). This walk once lexed by hand, and one audit
// beat it three ways: it judged a `/` by the character before it, so a regex after `if (…)` read as
// division and the `}` inside it closed the block early; it kept a literal's escapes, so
// `'More\nlight'` held a backslash rather than a line break; and it read source text where a screen
// shows the cooked value. Telling a regex from a division needs to know which `)` closes a statement's
// condition, which is a parser's knowledge, so a parser's tokenizer supplies it: strings arrive
// decoded, a template's parts cooked, and a lexical error throws rather than desynchronising the walk.

const TOKENS = Object.freeze({ ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });

/**
 * Acorn's tokenizer, given the two facts its parser would have supplied (verify pass, 2026-10-17).
 *
 * Without a parse, the tokenizer cannot know that `await` and `yield` sit inside an async function or a
 * generator, so `await /}/` read as division; and it reads a property NAMED like a keyword — `obj.if`,
 * `obj?.return` — as the keyword, so the `(…)` after `obj.if` closed a "statement's condition" and the
 * division after it became a regex. A word after `.` or `?.` is a name, whatever it spells; `await` and
 * `yield` are always followed by an expression here, since both are reserved in a module.
 */
const Lexer = Parser.extend((Base) => class extends Base {
  finishToken(type, value) {
    const property = (this.type === tt.dot || this.type === tt.questionDot) && type.keyword !== undefined;
    super.finishToken(property ? tt.name : type, value);
  }

  updateContext(prevType) {
    super.updateContext(prevType);
    if (this.type !== tt.name) return;
    // A property ends an operand whatever it spells; acorn already says so after `.`, not after `?.`.
    if (prevType === tt.dot || prevType === tt.questionDot) this.exprAllowed = false;
    else if (this.value === 'await' || this.value === 'yield') this.exprAllowed = true;
  }
});

/**
 * Every token the walk reads `src` as, type and span — for the test that holds `Lexer` to acorn's PARSER
 * over every file the scans read, so a context this tokenizer guesses wrong fails there, by file and
 * position, rather than shortening a block or hiding a literal somewhere a scan relies on.
 */
export function walkTokens(src) {
  return [...tokensOf(src)].map(({ type, start, end }) => ({ type: type.label, start, end }));
}

/** Acorn's tokens over `src`, a lexical error rethrown as the walk's own refusal. */
function* tokensOf(src) {
  const tokens = Lexer.tokenizer(src, TOKENS);
  for (;;) {
    let token;
    try { token = tokens.getToken(); } catch (e) { throw new Error(`scan: ${e.message}`, { cause: e }); }
    if (token.type === tt.eof) return;
    yield token;
  }
}

/**
 * What tags a template whose backtick follows `previous`: `'raw'` for `String.raw`, `'other'` for any other
 * tag, null for none. A tag is an expression ending in a name, a `)` or a `]`; after a keyword, an operator
 * or a punctuator the backtick starts an untagged template.
 */
function tagOf(previous, [twoBack, oneBack]) {
  if (!previous || ![tt.name, tt.parenR, tt.bracketR, tt.backQuote, tt.privateId].includes(previous.type)) return null;
  const raw = previous.type === tt.name && previous.value === 'raw' && oneBack?.type === tt.dot
    && twoBack?.type === tt.name && twoBack.value === 'String';
  return raw ? 'raw' : 'other';
}

/**
 * The text a template part puts on screen. Cooked — escapes decoded — except under `String.raw`, whose text
 * IS its source (line endings normalised, as the language does). Under any other tag the text is the tag's
 * to decide, so a part whose source and cooked text differ is REFUSED: `(String.raw)` and `String['raw']`
 * are `String.raw` written so this cannot see it, and guessing either way lets a wording past a guard
 * (verify pass, 2026-10-17). An escape no template may hold is an error in an untagged template, refused too.
 */
function templateText(src, token, template) {
  const raw = () => src.slice(token.start, token.end).replace(/\r\n?/g, '\n');
  if (template.tag === 'raw') return raw();
  if (template.tag === null) {
    if (token.type === tt.template) return token.value;
    throw new Error(`scan: an invalid escape in an untagged template at ${token.start}`);
  }
  if (token.type === tt.template && token.value === raw()) return token.value;
  throw new Error(`scan: a template tagged by something other than String.raw holds an escape at ${token.start} — its text is the tag's to decide`);
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
 * without depending on how it happens to be indented. `from` must be where a `{` TOKEN begins: a
 * brace inside a comment or a regex is refused, never read as the block's.
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
  /** What each open `{`, `${` and backtick is: a block, a template's hole, or a template and its number. */
  const open = [];
  let templates = 0;
  let previous = null;
  /** The two tokens before `previous`, so a template can tell whether `String.raw` tags it. */
  const earlier = [null, null];
  const piece = (text, start, end, extra = {}) => {
    literals.push(text);
    pieces.push({ text, start, end, hole: false, ...extra });
  };
  for (const token of tokensOf(src)) {
    if (token.end <= from) continue;
    // A block's `{`, or the `{` of a template's `${` — whose token begins one character earlier, at the `$`.
    if (balanced && previous === null && !(token.type === tt.braceL ? token.start === from
      : token.type === tt.dollarBraceL && token.start === from - 1)) {
      throw new Error('scan: a balanced walk must start at a {');
    }
    const top = open[open.length - 1];
    if (token.type === tt.string) piece(token.value, token.start, token.end);
    else if (token.type === tt.template || token.type === tt.invalidTemplate) {
      // A part spans from its backtick, or from just after the `}` that closed the hole before it, to
      // its `${` or past its closing backtick — so what lies between two templates is the `+` alone.
      const afterHole = previous?.type === tt.braceR;
      piece(templateText(src, token, top),
        afterHole ? token.start : previous.start,
        src[token.end] === '`' ? token.end + 1 : token.end,
        { hole: afterHole, template: top.template });
    } else if (token.type === tt.backQuote) {
      if (top?.kind === 'template') open.pop();
      else open.push({ kind: 'template', template: (templates += 1), tag: tagOf(previous, earlier) });
    } else if (token.type === tt.braceL) open.push({ kind: 'block' });
    else if (token.type === tt.dollarBraceL) open.push({ kind: 'expr' });
    else if (token.type === tt.braceR) {
      if (open.length === 0) throw new Error(`scan: a } closing nothing at ${token.start}`);
      open.pop();
      if (balanced && open.length === 0) return { literals, ...reading(src, pieces), end: token.end };
    }
    earlier.shift();
    earlier.push(previous);
    previous = token;
  }
  if (open.length > 0) throw new Error(`scan: ended inside a ${open[open.length - 1].kind}`);
  if (balanced) throw new Error(previous ? 'scan: the block never closed' : 'scan: a balanced walk must start at a {');
  return { literals, ...reading(src, pieces), end: src.length };
}

/**
 * Whether what sits between two literals makes them ONE expression. `+` and whitespace do, with any
 * number of plain names or calls between them, so `'a' + b + 'c'` and `t('a') + ' b'` are each one
 * sentence. A comma, a new statement or an argument list does not — array elements and a call's
 * arguments are separate sentences however close together they are written.
 *
 * ONE `+` WAS NOT ENOUGH (audit, 2026-10-06). A single alternative matched `' + x + '` only when one
 * name sat between the literals, so `'a' + x + y + 'b'` was read as two sentences and a refused
 * wording could be split across the join. The case that claimed to cover this passed either way: its
 * refused word sat entirely in the second piece, so the halves matched once whether joined or not.
 */
const JOINS = /^\s*\)*\s*(?:\+\s*(?:[A-Za-z_$][\w$.]*\s*(?:\([^()]*\))?\s*)?)+$/;

/**
 * The pieces of one expression joined back into the sentence they make, holes closed up as spaces.
 *
 * Each run also keeps WHERE IT BEGAN, so a caller can ask what the sentence was handed to — which is
 * how `translatedSentences` tells the app's copy from the strings its code happens to hold. The
 * positions are a second reading of the same runs, never a second walk: two walks of one file can
 * disagree about where a sentence starts, and then a caller filters on the wrong offsets.
 *
 * The text after a hole rejoins ITS OWN TEMPLATE's run, never the last run made: a hole can hold a
 * literal of its own (`will ${t('')} settle`), and that literal is a sentence of its own, not the one
 * the template's next part continues (audit, 2026-10-17).
 */
function sentencesOf(src, pieces) {
  const runs = [];
  /** The run each template's text went into, by the template's number. */
  const runOf = new Map();
  let run = null;
  for (const p of pieces) {
    const own = p.hole ? runOf.get(p.template) : undefined;
    if (own) run = own;
    else if (!run || !JOINS.test(src.slice(run.end, p.start))) {
      run = { parts: [], start: p.start };
      runs.push(run);
    }
    run.parts.push(p.text);
    run.end = p.end;
    if (p.template !== undefined) runOf.set(p.template, run);
  }
  return runs.map(({ parts, start }) => ({ text: parts.join(' '), start }));
}

/**
 * Every file whose words can reach a screen: the entries, and every module they import, followed
 * onwards.
 *
 * Read from the IMPORTS rather than from a folder: a sentence moved one module away — into a
 * service, a shared helper, the notices — is the same sentence on screen, and a folder read stopped
 * at the screen's own parts (audit, 2026-09-19). Package imports are not followed: a dependency's
 * words are not ours to hold to this. `within` narrows the walk to files whose path carries it, for
 * a question that is one screen's rather than the app's. Entry paths are relative to this file, which
 * is the directory every caller sits in.
 *
 * Shared, because two copy guards had each hand-rolled this walk and they had already drifted: one
 * followed every import shape, the other was a weaker copy of it (audit, 2026-10-06).
 */
export function reachable(entries, { within = '' } = {}) {
  const seen = new Set();
  const queue = entries.map((rel) => new URL(rel, import.meta.url));
  while (queue.length) {
    const url = queue.pop();
    if (seen.has(url.href) || !url.href.includes(within)) continue;
    let src;
    try { src = readFileSync(url, 'utf8'); } catch { continue; }
    seen.add(url.href);
    // Every shape an import can take: a `from` clause however many lines its names span, a
    // side-effect import with no names at all, and a dynamic one inside a call — a one-line `from`
    // pattern saw only the first of the three (audit, 2026-09-19).
    for (const m of src.matchAll(/from\s*['"](\.[^'"]+)['"]|\bimport\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      queue.push(new URL(m[1] ?? m[2], url));
    }
  }
  return [...seen];
}

/**
 * Every file whose words can reach the scan screen: the scanner's panel, the scan screen, and every
 * module either of them imports, followed onwards — through `reachable`, so the copy guards cannot drift
 * apart about what "reaches a screen" means. The bundle the app actually loads is read as well as the
 * sources it was built from: a bundle that has drifted from them ships words nobody scanned (audit,
 * 2026-09-19); `vendor-bundles.test.mjs` holds the two to each other, and this holds what is SERVED.
 *
 * Here rather than in `scan-sentences.test.mjs` because a second test reads it: the walk's tokens are held
 * to acorn's parser over every file a scan reads, and a list of its own would be how one is left out — as
 * three of these were (verify pass, 2026-10-17).
 */
/**
 * A scanned file's source as the walk must read it: JavaScript as written, and TypeScript COMPILED — with
 * esbuild, types erased — because the walk's tokenizer is JavaScript's. Reading raw TypeScript, a non-null
 * `y!` before a division looked like `!` and a regex that swallowed the literals after it, and a check that
 * compared the source's literals with the compiled ones was fooled by string TYPES standing in for the
 * swallowed literals (verify passes, 2026-10-17). What runs is the compiled code, so that is what is read,
 * and the parity test holds it to acorn's parser like any other file.
 */
export function readScanned(href) {
  const src = readFileSync(new URL(href), 'utf8');
  return href.endsWith('.ts') ? transformSync(src, { loader: 'ts', target: 'esnext', format: 'esm' }).code : src;
}

export function scanSources() {
  return [
    new URL('../vendor/ai-scan-panel.js', import.meta.url).href,
    ...reachable(['../../../packages/cube-scanner/view/ai-scan-panel.ts', '../lib/screens/scan.js']),
  ];
}

/**
 * Every sentence the app's ONE COPY DOOR carries: the argument of a `t(...)` call, with a template's
 * holes closed up, a concatenation joined, and comments skipped.
 *
 * This replaced a regex for `t('…')` that saw none of those three (audit, 2026-10-06): a sentence
 * written as a template walked past the guard that exists to refuse it, and so did one added up from
 * pieces, while a commented-out line counted as copy the screen could show. Asking `walk` means the
 * copy guards and the source scans agree about what a literal IS.
 */
export function translatedSentences(src) {
  return walk(src).spans
    .filter(({ start }) => /\bt\(\s*$/.test(src.slice(Math.max(0, start - 32), start)))
    .map(({ text }) => text);
}

/** A hole's stand-in in `markup`: one character no source contains, so a value that was
 *  interpolated is visibly NOT an empty string. */
export const HOLE = '\u0001';

/**
 * `sentences` as the text alone, `spans` keeping each one's start, and `markup` the literals run
 * together with a stand-in where a template had a hole — one walk, three readings.
 *
 * `markup` exists because `literals.join('')` turns `id="${id}"` into `id=""`, which is
 * indistinguishable from an id nobody wrote. A check for a NON-EMPTY id then reported every
 * interpolated one as missing, and a check that accepted `id=""` could not be tightened at all
 * (audit, 2026-10-06).
 */
function reading(src, pieces) {
  const spans = sentencesOf(src, pieces);
  return {
    sentences: spans.map((s) => s.text),
    spans,
    markup: pieces.map((p) => (p.hole ? HOLE : '') + p.text).join(''),
  };
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
  const at = anchorAt(src, anchor, 'blockAt');
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
  const brace = braceAfter(src, anchor, at, from, 'blockAt');
  return src.slice(at, walk(src, { from: brace, balanced: true }).end);
}

/** Where `anchor` is in `src` — exactly once, or a throw: two candidates is the case a first match resolved
 *  silently, by position. */
function anchorAt(src, anchor, who) {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`${who}: ${JSON.stringify(anchor)} is not in the source`);
  if (src.indexOf(anchor, at + 1) >= 0) throw new Error(`${who}: ${JSON.stringify(anchor)} appears more than once`);
  return at;
}

/** The first `{` at or after `from`, refused when a literal opens between the anchor and it. */
function braceAfter(src, anchor, at, from, who) {
  const brace = src.indexOf('{', from);
  if (brace < 0) throw new Error(`${who}: nothing opens a block after ${JSON.stringify(anchor)}`);
  if (/['"`]/.test(src.slice(at + anchor.length, brace))) {
    throw new Error(`${who}: a literal opens between ${JSON.stringify(anchor)} and its brace — anchor closer to the block`);
  }
  return brace;
}

/**
 * `blockAt` for a STYLESHEET: the rule or at-rule `anchor` opens, to the `}` that closes it, past braces in
 * strings and comments.
 *
 * Its own reader because CSS is not JavaScript, and `blockAt` reads with a JavaScript tokenizer that refuses
 * a stylesheet outright. The hand lexer that once read both did so by accident: a `/` in a CSS value was
 * judged a regex or a division by JavaScript's rules. A brace in CSS can hide in only four places — a
 * string, a comment, an escape (`\}`) and an unquoted `url(…)` — so those are all this skips, before the
 * block's brace as well as inside it.
 */
export function cssBlockAt(src, anchor) {
  const at = anchorAt(src, anchor, 'cssBlockAt');
  let depth = 0;
  // From the anchor itself, so a brace the anchor carries is the block's.
  for (let i = at; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') i += 1;
    else if (/^url\(\s*[^\s'")]/i.test(src.slice(i, i + 6)) && !/[\w-]/.test(src[i - 1] ?? '')) {
      // An unquoted url() is one token to its `)`, braces and all.
      const close = src.indexOf(')', i);
      if (close < 0) throw new Error(`cssBlockAt: an unclosed url( at ${i}`);
      i = close;
    }
    else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`cssBlockAt: unterminated comment at ${i}`);
      i = end + 1;
    } else if (ch === '"' || ch === "'") {
      if (depth === 0) {
        throw new Error(`cssBlockAt: a literal opens between ${JSON.stringify(anchor)} and its brace — anchor closer to the block`);
      }
      i = endOfCssString(src, i);
    } else if (ch === '{') depth += 1;
    else if (ch === '}') {
      if (depth === 0) throw new Error(`cssBlockAt: nothing opens a block after ${JSON.stringify(anchor)}`);
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(depth === 0
    ? `cssBlockAt: nothing opens a block after ${JSON.stringify(anchor)}`
    : `cssBlockAt: the block after ${JSON.stringify(anchor)} never closed`);
}

/** Where the CSS string opening at `at` ends: its closing quote. An unescaped line break is an error. */
function endOfCssString(src, at) {
  for (let j = at + 1; j < src.length; j += 1) {
    if (src[j] === '\\') j += 1;
    else if (src[j] === '\n') throw new Error(`cssBlockAt: a ${src[at]} string ran past the end of its line at ${at}`);
    else if (src[j] === src[at]) return j;
  }
  throw new Error(`cssBlockAt: unterminated ${src[at]} string at ${at}`);
}
