// cubus-im's lessons 10 to 12, played through cubus's script player.
//
// dev-docs/tutorial-capability-plan.md item 6.6. The lesson course writes every score in the child's
// letters and converts them itself before cubus sees them: every alg and every selector is relabelled by
// the grip and the holds in its lesson parser. Retiring that conversion is the course's own work. What cubus
// owes is the proof that its interpreter reaches the same place from the child's letters alone — so each
// score's SOURCE is read here as a script (the grip a hold, `@ hold` a regrip composed by the interpreter,
// `@ scramble` a cut, `@ turn` a move in the hold in force, `@ show` a selector as written), and at every
// narration line the player's view is held to the course's own parser, run on the same file: the hold, the
// tokens the element is handed, the cube after a cut, and the pieces lit.
//
// Two things are not compared, on purpose. A CAMERA: a script's `cam` is in the element's frame, and the
// course writes cameras the way the child sees the cube, so its emitter keeps converting them. A FOCUS: the
// player binds a positional focus where it is written (ADR 0004 R9), and the course re-binds it on every
// line — the behaviour R9 exists to end. Both are in dev-docs/cubus-im-adoption-requirements.md.
//
// UNCHECKED, never passed, where the course is not checked out beside this repository or python3 cannot run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { run } from '../lib/cube-moves.js';
import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { checkScript } from '../lib/lesson-format.js';
import { buildScript, viewAtPosition } from '../lib/script-view.js';

const CUBUS_IM = process.env.CUBUS_IM_REPO ?? fileURLToPath(new URL('../../../../cubus-im/', import.meta.url));
const PARSER = join(CUBUS_IM, 'pipeline', 'parse-lesson.py');
const LESSONS = ['10-finishing-the-first-layer', '11-the-middle-layer', '12-finishing-the-middle-layer'];
const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

const holdName = (pair) => pair.join(' ');
/** A move text with its timing taken off: `in <secs>` and `spanning <n>` say when, not what. */
const untimed = (arg) => arg.replace(/\s*\b(?:in\s+[0-9.]+|spanning\s+\d+)\s*$/, '').trim();

/**
 * A score, read the way the course's parser reads it, as a script in the child's letters.
 *
 * Returns the script and, for each narration line, the index of the last step it made — the position a
 * line is compared at. Cue verbs the three lessons do not use are refused rather than skipped, so a lesson
 * that grows one fails here instead of passing over it.
 */
function scriptOf(source) {
  const text = source.replace(/<!--[\s\S]*?-->/g, '');
  let hold = ['U', 'F'];
  let grip = hold;
  let written = hold;
  const steps = [];
  const lines = [];
  let pending = {};
  const cues = { hl: 'none', ghosts: false };
  const shown = { hl: undefined, ghosts: undefined };
  const regrip = (from, token) => [...run(token, from, SOLVED).hold];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line === '---' || /^##\s+/.test(line)) continue;
    const meta = /^#\s+(\w[\w-]*):\s*(.+)$/.exec(line);
    if (meta) {
      if (meta[1] === 'grip') {
        for (const token of meta[2].split(/\s+/)) hold = regrip(hold, token);
        grip = hold;
        written = hold;
      }
      continue;
    }
    if (line.startsWith('@')) {
      const [verb, ...rest] = line.slice(1).trim().split(/\s+/);
      const arg = rest.join(' ');
      if (verb === 'reset') pending.cut = { step: { cube: SOLVED_FACELETS }, hold };
      else if (verb === 'hold') hold = ['', 'reset', 'default'].includes(arg) ? grip : regrip(hold, arg);
      else if (verb === 'scramble') {
        if (untimed(arg) !== arg || /^random:/.test(arg)) throw new Error(`a timed or sidecar scramble, which lessons 10–12 do not use: ${line}`);
        pending.cut = { step: { setup: arg }, hold };
      } else if (verb === 'turn') pending.move = { step: { move: untimed(arg) }, hold };
      else if (verb === 'show') cues.hl = arg || 'none';
      else if (verb === 'ghosts') cues.ghosts = arg === 'on';
      else if (!['focus', 'camera', 'number'].includes(verb)) throw new Error(`a cue this reading does not know: ${line}`);
      continue;
    }
    // A narration line: what is pending happens on it, each in the hold it was written in.
    const before = steps.length;
    const holdTo = (h) => {
      if (holdName(h) === holdName(written)) return;
      steps.push({ hold: holdName(h) });
      written = h;
    };
    for (const kind of ['cut', 'move']) {
      if (!pending[kind]) continue;
      holdTo(pending[kind].hold);
      steps.push({ ...pending[kind].step });
    }
    pending = {};
    holdTo(hold);
    if (steps.length === before) steps.push({});
    const last = steps[steps.length - 1];
    last.say = line;
    for (const key of ['hl', 'ghosts']) {
      if (shown[key] !== cues[key]) { last[key] = cues[key]; shown[key] = cues[key]; }
    }
    lines.push(steps.length - 1);
  }
  return { script: { schema: 2, start: { hold: holdName(grip) }, steps }, lines };
}

/** A selector list as a set, each piece's letters in one order: the element matches a piece by its letters. */
const selectors = (spec) => String(spec ?? 'none').split(',').map((s) => s.trim()).filter(Boolean)
  .map((s) => s.replace(/^(\w+):([URFDLB]+)/, (_, kind, letters) => `${kind}:${[...letters].sort().join('')}`))
  .sort().join(',');

/** The course's parser on one lesson, into a temporary file — or null where it cannot run here. */
function courseCues(slug) {
  const dir = mkdtempSync(join(tmpdir(), 'cubus-im-lesson-'));
  try {
    const out = join(dir, 'score.json');
    execFileSync('python3', [PARSER, join(CUBUS_IM, 'lessons', `${slug}.md`), out], { cwd: CUBUS_IM, stdio: ['ignore', 'ignore', 'pipe'] });
    return JSON.parse(readFileSync(out, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let turns = 0;
let regrips = 0;
let cuts = 0;

for (const slug of LESSONS) {
  test(`cubus-im lesson ${slug}: every line's hold, moves, cube and lit pieces, through the player`, (t) => {
    if (!existsSync(PARSER)) {
      t.skip(`the lesson course is not checked out beside this repo (${PARSER}); UNCHECKED, not passed`);
      return;
    }
    const course = courseCues(slug);
    if (course === null) {
      t.skip('python3 is not available to run the course\'s parser; UNCHECKED, not passed');
      return;
    }
    const { script, lines } = scriptOf(readFileSync(join(CUBUS_IM, 'lessons', `${slug}.md`), 'utf8'));
    const built = buildScript(checkScript(script));
    assert.equal(lines.length, course.length, `${slug}: a narration line the two readings do not agree on`);
    let heldBefore = null;
    for (const [n, cue] of course.entries()) {
      const where = `${slug} line ${n} ("${cue.say.slice(0, 48)}")`;
      const step = lines[n];
      const position = built.positions.reduce((found, p, i) => (p.step === step ? i : found), -1);
      assert.ok(position >= 0, `${where}: no position for its step`);
      const view = viewAtPosition(built, position);

      // The hold: the course writes the letters each of the child's faces stands for, in URFDLB order.
      const hold = cue.hold ? `${cue.hold[0]} ${cue.hold[2]}` : 'U F';
      assert.equal(view.hold, hold, `${where}: the hold`);
      if (heldBefore !== null && heldBefore !== hold) regrips += 1;
      heldBefore = hold;

      if (cue.setup !== undefined) {
        cuts += 1;
        assert.deepEqual(view.cube, applyAlg(SOLVED, cue.setup), `${where}: the cube after the cut`);
      }
      if (cue.quarters) {
        turns += 1;
        const first = built.positions.findIndex((p) => p.step === step);
        const drawn = view.alg.split(' ').filter(Boolean).slice(built.positions[first - 1].moves, view.moves);
        assert.deepEqual(drawn, cue.quarters, `${where}: the tokens the element is handed`);
      }
      assert.equal(selectors(view.cues.hl), selectors(cue.hl), `${where}: the pieces lit`);
      assert.equal(Boolean(view.cues.ghosts), Boolean(cue.ghosts), `${where}: the ghosts`);
    }
  });
}

test('the three lessons exercise what the reading is for: turns, regrips and cuts', (t) => {
  if (!existsSync(PARSER)) {
    t.skip('the lesson course is not checked out beside this repo; UNCHECKED, not passed');
    return;
  }
  // Runs after the three above (node:test runs a file's tests in order), so a reading that compared
  // nothing — no turn, no hold change, no cut — cannot pass as one that compared everything.
  assert.ok(turns >= 8 && regrips >= 2 && cuts >= 6, `${turns} turns, ${regrips} hold changes, ${cuts} cuts compared`);
});
