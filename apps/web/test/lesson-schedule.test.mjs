// The episode runtime, which is arithmetic and therefore testable without a browser.
//
// The property every case here is really about: **the same `t` gives the same picture, however it
// was reached.** An episode is an audio track plus a cube, and a listener drops the needle wherever
// they like. Anything that eases from "wherever the cube is now" breaks that, which is the same
// argument that made the renderer's orientation channel a phase rather than an animation.
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkEpisode, MIN_PER_MOVE, resolveSpanning, SPAN_LEAD } from '../lib/lesson-format.js';
import {
  buildSchedule,
  CAM_DEFAULT,
  cameraAt,
  GHOST_ELEV,
  lineAt,
  numberAt,
  segmentAt,
  viewAt,
} from '../lib/lesson-schedule.js';

/** A small episode carrying every feature: two positions, a timed sequence, ghosts, a count. */
const cue = (start, end, extra = {}) => ({ say: `line at ${start}`, ...extra, start, end });
const EPISODE = {
  cues: [
    cue(0, 4, { hl: 'none', ghosts: false, cam: CAM_DEFAULT, setup: "R U R'", section: 'One' }),
    cue(5, 9, { hl: 'layer:U', ghosts: true, cam: CAM_DEFAULT }),
    cue(10, 12, { hl: 'none', ghosts: true, cam: [-35, 135], camUp: 'D', quarters: ['R', 'U', "R'"], secs: 3, move: "R U R'" }),
    cue(20, 24, { hl: 'none', ghosts: false, cam: [-35, 135], camUp: 'D', setup: 'F2' }),
    cue(25, 29, { hl: 'none', ghosts: false, cam: [-35, 135], camUp: 'D', number: '43,252,003,274,489,856,000' }),
  ],
};

const built = () => buildSchedule(checkEpisode(EPISODE));

test('segments start at a setup and carry only their own turns', () => {
  const s = built();
  assert.equal(s.segments.length, 2, 'two positions, so two segments');
  assert.equal(s.segments[0].scramble, "R U R'");
  assert.equal(s.segments[1].scramble, 'F2');
  assert.equal(s.segments[0].moves.length, 3, "the timed cue's turns belong to the first position");
  assert.equal(s.segments[1].moves.length, 0);
  // A TIMED cue spaces its turns over its own wall clock, from the end of its line.
  assert.deepEqual(s.segments[0].moves.map((m) => m.at), [12, 13, 14]);
});

test('seeking into a later segment rebuilds from THAT position, not from the start', () => {
  const s = built();
  assert.equal(segmentAt(s, 0).scramble, "R U R'");
  assert.equal(segmentAt(s, 21).scramble, 'F2');
  // The moves of the first segment are not replayed to reach the second — the jump cut is the
  // whole reason a segment exists.
  assert.equal(viewAt(s, 21).moves, 0);
  assert.equal(viewAt(s, 21).alg, '');
});

// THE PROPERTY THE WHOLE FILE IS ABOUT.
test('a time gives one picture, whichever direction it is reached from', () => {
  const s = built();
  const at = (t) => JSON.stringify(viewAt(s, t));
  for (const t of [0, 3.5, 9.9, 13.2, 14, 22, 27]) {
    assert.equal(at(t), at(t), 'not even self-consistent');
  }
  // Reached by walking forwards, and by walking backwards: the function never reads a clock or a
  // previous value, so these cannot differ — and asserting it is what stops someone adding state.
  const forwards = [0, 5, 10, 13.2].map(at);
  const backwards = [13.2, 10, 5, 0].map(at).reverse();
  assert.deepEqual(forwards, backwards);
});

test('turns land one at a time, on the schedule the cue bought', () => {
  const s = built();
  assert.equal(viewAt(s, 11.9).moves, 0, 'before the line has finished, nothing has turned');
  assert.equal(viewAt(s, 12).moves, 1);
  assert.equal(viewAt(s, 13).moves, 2);
  assert.equal(viewAt(s, 14).moves, 3);
  assert.equal(viewAt(s, 19).moves, 3, 'and it stays put until the next position');
});

test('the camera swings between angles and wraps the short way round', () => {
  const s = built();
  const start = cameraAt(s, 10);
  const mid = cameraAt(s, 10.7);
  const settled = cameraAt(s, 12);
  assert.deepEqual([start.lat, start.lon], [35, 45], 'the swing starts at the previous angle');
  assert.deepEqual([settled.lat, settled.lon], [-35, 135]);
  assert.ok(mid.lat < 35 && mid.lat > -35, 'the latitude should be part-way through');
  // 45 to 135 is 90 degrees the short way; the long way would pass through 315.
  assert.ok(mid.lon > 45 && mid.lon < 135, `longitude took the long way round: ${mid.lon}`);
});

test('longitude never takes the long way, even across the wrap', () => {
  const s = buildSchedule(checkEpisode({
    cues: [cue(0, 1, { cam: [35, 45] }), cue(2, 3, { cam: [35, 315] })],
  }));
  // 45 to 315 is a quarter turn one way, not three quarters the other. Interpolating the raw
  // numbers once swung the camera 270 degrees to show a quarter regrip.
  const mid = cameraAt(s, 2.7);
  assert.ok(mid.lon > 315 || mid.lon < 45, `swung the long way: ${mid.lon}`);
});

test('the roll and the grip land at the start of the swing, never half-way', () => {
  const s = built();
  // There is no half-way between held-up and held-over; easing through one draws the cube lying on
  // its side for a second.
  assert.equal(cameraAt(s, 10).up, 'D');
  assert.equal(cameraAt(s, 10.7).up, 'D');
  assert.equal(cameraAt(s, 9.9).up, 'U');
});

test('an episode may carry an orientation instead of a roll', () => {
  const s = buildSchedule(checkEpisode({
    cues: [cue(0, 1, {}), cue(2, 3, { orientation: 'D B' })],
  }));
  assert.equal(cameraAt(s, 0).orientation, null);
  assert.equal(cameraAt(s, 2.5).orientation, 'D B');
});

test('ghosts fly out rather than appearing, and the reveal is a function of t', () => {
  const s = built();
  assert.equal(viewAt(s, 4.9).ghosts, false);
  assert.equal(viewAt(s, 5).ghostElevation, 0, 'the reveal starts on the sticker');
  const mid = viewAt(s, 6).ghostElevation;
  assert.ok(mid > 0 && mid < GHOST_ELEV, `mid-reveal should be between 0 and ${GHOST_ELEV}, got ${mid}`);
  assert.equal(viewAt(s, 8).ghostElevation, GHOST_ELEV);
  // Reduced motion lands it at once: the ghosts are the content, the fly-out is decoration.
  assert.equal(viewAt(s, 5, { reducedMotion: true }).ghostElevation, GHOST_ELEV);
});

test('a run of ghosted lines reveals once, not once per line', () => {
  const s = built();
  // Line 2 is the second ghosted line in the same run, so by then the reveal is finished rather
  // than starting again — scrubbing into the middle of a run must not restart it.
  assert.equal(s.ghostFrom[1], 5);
  assert.equal(s.ghostFrom[2], 5, 'the second line of the run points at the run, not at itself');
});

// The count exists to make a huge number FEEL huge, and the huge number is past
// Number.MAX_SAFE_INTEGER — so a float anywhere in the chain quietly rewrites its last four digits.
test('the count rolls in BigInt and lands on the exact number', () => {
  const s = built();
  assert.equal(numberAt(s, 24.9), null, 'no number before the line that carries it');
  assert.equal(numberAt(s, 25), '0');
  const mid = numberAt(s, 25.5);
  assert.ok(mid !== '0' && mid !== '43,252,003,274,489,856,000', `mid-roll should be between: ${mid}`);
  assert.equal(numberAt(s, 27), '43,252,003,274,489,856,000', 'the roll must land on the exact figure');
  assert.equal(numberAt(s, 25, { reducedMotion: true }), '43,252,003,274,489,856,000');
  // Every intermediate is a plain grouped integer — never exponential, never a rounded float.
  for (let t = 25; t <= 26.5; t += 0.1) {
    assert.match(numberAt(s, t), /^[\d,]+$/, `at ${t.toFixed(1)}: ${numberAt(s, t)}`);
  }
});

test('a small count does not roll, because a slot machine announcing six is silly', () => {
  const s = buildSchedule(checkEpisode({ cues: [cue(0, 1, { number: '6' })] }));
  assert.equal(numberAt(s, 0), '6');
  assert.equal(numberAt(s, 0.5), '6');
});

test('lineAt walks forward with the cue list and lands on exactly one line', () => {
  const s = built();
  assert.equal(lineAt(s, 0), 0);
  assert.equal(lineAt(s, 4.9), 0, 'the gap after a line still belongs to it');
  assert.equal(lineAt(s, 5), 1);
  assert.equal(lineAt(s, 99), 4, 'past the end is the last line');
});

// ---- the format, and the refusals -------------------------------------------------------------

test('`spanning` is resolved from the measured timings, not guessed in the score', () => {
  const cues = [
    cue(0, 4, { quarters: ['R', 'U'], spanning: 2 }),
    cue(5, 9, {}),
    cue(12, 16, {}),
  ];
  const [first] = resolveSpanning(cues);
  // From the end of this line until the line 2 ahead starts, less the lead so the last turn has
  // landed before the sentence that announces it.
  assert.equal(first.secs, 12 - 4 - SPAN_LEAD);
  assert.equal('spanning' in first, false, 'the unresolved field must not survive');
});

// This ran in cubus-im's BUILDER, before its player ever saw the cues — so an app handed raw score
// and timing files and told to "run the same player" would have produced a different schedule with
// no way to notice. That is why it moved here.
test('a span too short to follow is refused rather than flickering', () => {
  const cues = [cue(0, 4, { quarters: ['R', 'U', 'F', 'D'], spanning: 1 }), cue(4.5, 8, {})];
  assert.throws(() => resolveSpanning(cues), /too fast to follow/);
  assert.throws(() => resolveSpanning([cue(0, 4, { spanning: 9 }), cue(5, 6, {})]), /past the end/);
  assert.throws(
    () => resolveSpanning([cue(0, 4, { spanning: 1 }), cue(4.1, 6, {})]),
    /the lines are too short/,
  );
  assert.ok(MIN_PER_MOVE > 0);
});

test('an episode is checked rather than trusted, and every refusal names its cue', () => {
  const bad = (cues, re) => assert.throws(() => checkEpisode({ cues }), re);
  bad([], /non-empty/);
  bad([cue(0, 1, { say: '' })], /cue 0: `say`/);
  bad([cue(5, 6, {}), cue(1, 2, {})], /cue 1: starts at 1, before/);
  bad([cue(2, 1, {})], /cue 0: ends \(1\) before it starts \(2\)/);
  bad([cue(0, 1, { quarters: ['y'] })], /cue 0: "y" is not a face turn/);
  bad([cue(0, 1, { cam: [1, 2, 3] })], /cue 0: `cam`/);
  bad([cue(0, 1, { orientation: 'U D' })], /cue 0: "U D" is not an orientation/);
  bad([cue(0, 1, { camUp: 'X' })], /cue 0: "X" is not a face letter/);
  bad([cue(0, 1, { nonsense: 1 })], /cue 0: unknown field "nonsense"/);
  // An unresolved span reaching the player is the failure the resolution step exists to prevent.
  bad([cue(0, 1, { spanning: 2 })], /cue 0: `spanning` is unresolved/);
});

// A whole-cube rotation in `quarters` is the defect the fixed frame exists to prevent: after a `y`,
// an `R` means the new right or the old right, and nothing downstream could tell which.
test('a rotation can never reach the renderer as a turn', () => {
  for (const q of ['y', 'x2', "z'", 'M', 'Rw']) {
    assert.throws(() => checkEpisode({ cues: [cue(0, 1, { quarters: [q] })] }), /not a face turn/);
  }
});

// ---- a REAL episode ---------------------------------------------------------------------------
//
// Everything above is synthetic, and a runtime that agrees with a fixture somebody wrote to make it
// agree has proved nothing. This is the cue structure of an actual built episode — cubus-im's
// lesson 11, forty cues, two positions, a grip change and a timed sequence — with the narration
// replaced, because the words are the course's content and have no business being copied here.
//
// It is COMMITTED rather than read from the sibling checkout. cubus-im's `build/` is gitignored and
// absent from a clean clone, so reading it there would make this check skip exactly where it
// matters most, and a check that skips on the build machine is not a check.
/** The real fixture, loaded/resolved/checked/built in ONE place. */
const realSchedule = async () => {
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(
    readFileSync(new URL('./fixtures/episode-structure.json', import.meta.url), 'utf8'),
  );
  return buildSchedule(checkEpisode({ cues: resolveSpanning(raw.cues) }));
};

test('a real episode builds a schedule that holds together', async () => {
  const s = await realSchedule();

  assert.equal(s.cues.length, 40);
  assert.ok(s.segments.length >= 2, 'the episode changes position at least once');
  assert.ok(s.duration > 60, `a seven-minute lesson should be longer than ${s.duration}s`);

  // Every turn lands inside the episode, after the line that bought it, and in order.
  for (const seg of s.segments) {
    let previous = -Infinity;
    for (const m of seg.moves) {
      assert.ok(m.at >= s.cues[seg.from].start, 'a turn lands before its own position exists');
      assert.ok(m.at <= s.duration, `a turn lands at ${m.at}, past the end at ${s.duration}`);
      assert.ok(m.at >= previous, 'turns are out of order');
      previous = m.at;
      assert.ok(m.step > 0);
    }
  }

  // The picture is defined at every second of the episode, and never throws on the way.
  let ghostsSeen = false;
  let turnsSeen = 0;
  for (let t = 0; t <= s.duration; t += 0.5) {
    const v = viewAt(s, t);
    assert.ok(v.line >= 0 && v.line < 40);
    assert.ok(v.moves >= 0);
    assert.ok(Number.isFinite(v.camera.lat) && Number.isFinite(v.camera.lon));
    assert.match(v.camera.up, /^[URFDLB]$/);
    ghostsSeen ||= v.ghosts;
    turnsSeen = Math.max(turnsSeen, v.moves);
  }
  assert.equal(ghostsSeen, true, 'this episode floats its ghosts and the view never said so');
  assert.ok(turnsSeen > 0, 'this episode turns the cube and the view never showed a turn');

  // The grip: this lesson is written in the child's frame after the flip, so the roll is not U.
  const rolls = new Set(s.cams.map((c) => c.up));
  assert.ok(rolls.has('D'), `expected a turned-over grip somewhere; saw ${[...rolls].join(', ')}`);
});

// Monotonic in the one way that matters: a listener dragging the scrubber forwards must never see
// the cube go backwards within a position.
test('across a real episode, turns only ever accumulate within a position', async () => {
  const s = await realSchedule();
  let segment = -1;
  let moves = -1;
  for (let t = 0; t <= s.duration; t += 0.25) {
    const v = viewAt(s, t);
    if (v.segment !== segment) { segment = v.segment; moves = -1; }
    assert.ok(v.moves >= moves, `at ${t}s the cube went backwards: ${moves} -> ${v.moves}`);
    moves = v.moves;
  }
});

// ---- what the audit found ---------------------------------------------------------------------

// #27: nothing exercised `counting: true`, so disabling `numberRoll` entirely passed the file. A
// counting run rolls across its OWN animation window rather than a fixed tween, which is what keeps
// the count and the turns linear in t over the same interval.
test('a counting run rolls across its animation window, not a fixed tween', () => {
  const s = buildSchedule(checkEpisode({
    cues: [
      cue(0, 4, { number: '1,000,000', counting: true, secs: 4, quarters: ['R', 'U'] }),
      cue(10, 12, { number: '1,000,000', counting: true }),
      cue(13, 15, {}),
    ],
  }));
  assert.equal(numberAt(s, 4), '0', 'the roll starts when the line ends, not when it begins');
  const mid = numberAt(s, 6);
  assert.ok(mid !== '0' && mid !== '1,000,000', `mid-roll should be between: ${mid}`);
  assert.equal(numberAt(s, 8), '1,000,000', 'the roll lands at the end of its own window');
  // Monotonic, and grouped, all the way through — an intermediate above the target would pass a
  // bare "is it between" check.
  let last = -1n;
  for (let x = 4; x <= 8; x += 0.25) {
    const v = numberAt(s, x);
    assert.match(v, /^\d{1,3}(,\d{3})*$/, `at ${x}: ${v}`);
    const n = BigInt(v.replace(/,/g, ''));
    assert.ok(n >= last, `the count went backwards at ${x}`);
    assert.ok(n <= 1000000n, `the count overshot at ${x}: ${v}`);
    last = n;
  }
  // A second line in the same run continues it rather than starting again.
  assert.equal(numberAt(s, 11), '1,000,000');
});

// #28: neither the tour branch nor reduced motion was exercised, so disabling either passed.
test('a tour revolves once, and two tours do not merge into one', () => {
  const s = buildSchedule(checkEpisode({
    cues: [
      cue(0, 2, { cam: 'tour' }),
      cue(3, 5, { cam: [10, 200] }),
      cue(6, 8, { cam: 'tour' }),
      cue(9, 11, { cam: [35, 45] }),
    ],
  }));
  assert.equal(s.tours.length, 2, 'two separated tours became one interval');
  // The ordinary cue BETWEEN them must be drawn — with a single merged interval it was swallowed
  // by the revolving branch and its angle never reached the screen.
  const between = cameraAt(s, 4.9);
  assert.equal(between.lat, 10, `the cue between two tours was swallowed: ${JSON.stringify(between)}`);
  // Inside a tour the longitude sweeps a full revolution and comes back.
  assert.ok(Math.abs(cameraAt(s, 0).lon - 45) < 1, 'a tour starts at the teaching angle');
  assert.ok(cameraAt(s, 1).lon > 100, 'a tour should be part-way round at its midpoint');
});

test('reduced motion holds a tour still rather than revolving anyway', () => {
  const s = buildSchedule(checkEpisode({ cues: [cue(0, 4, { cam: 'tour' }), cue(5, 6, {})] }));
  for (const x of [0, 1, 2, 3]) {
    assert.deepEqual(
      cameraAt(s, x, { reducedMotion: true }),
      { lat: 35, lon: 45, up: 'U', orientation: null },
      `the tour kept revolving at ${x}s for a reader who asked for less motion`,
    );
  }
  // And an ordinary swing lands at once rather than easing.
  const s2 = buildSchedule(checkEpisode({ cues: [cue(0, 1, {}), cue(2, 3, { cam: [-35, 135] })] }));
  assert.deepEqual(
    [cameraAt(s2, 2.01, { reducedMotion: true }).lat, cameraAt(s2, 2.01, { reducedMotion: true }).lon],
    [-35, 135],
  );
});

// #12: the episode must not end before its last turn has landed.
test('the duration covers the turns, not just the talking', () => {
  const s = buildSchedule(checkEpisode({
    cues: [cue(0, 1, { quarters: ['R', 'U', 'F'], secs: 6 })],
  }));
  const lastMove = Math.max(...s.segments.flatMap((g) => g.moves.map((m) => m.at)));
  assert.ok(s.duration > lastMove,
    `the episode claims to end at ${s.duration} while a turn lands at ${lastMove}`);
  assert.equal(viewAt(s, s.duration).moves, 3, 'every turn should have landed by the end');
});

// #8/#9/#10: a named field is not a checked field.
test('field VALUES are checked, not just their names', () => {
  const bad = (extra, re) => assert.throws(() => checkEpisode({ cues: [cue(0, 1, extra)] }), re);
  bad({ number: 'six' }, /`number` must be digits/);
  bad({ ghosts: 'false' }, /`ghosts` must be true or false/);
  bad({ setup: 'banana' }, /moves the renderer cannot apply/);
  bad({ setup: 'R y U' }, /moves the renderer cannot apply/);
  bad({ counting: 'yes' }, /`counting` must be a boolean/);
  bad({ hl: 7 }, /`hl` must be a string/);
  // And the ones that are fine stay fine.
  checkEpisode({ cues: [cue(0, 1, { setup: '', ghosts: false, number: '43,252,003,274,489,856,000' })] });
});

test('overlapping sequences are refused, because the player applies a prefix', () => {
  // Two cues whose move windows overlap interleave in time while the player still applies them as
  // a prefix of the algorithm — so it draws the wrong turns and nothing says so.
  assert.throws(() => checkEpisode({
    cues: [cue(0, 1, { quarters: ['R', 'U'], secs: 4 }), cue(2, 3, { quarters: ['D'] })],
  }), /still landing at/);
  // Back to back with no overlap is fine.
  checkEpisode({ cues: [cue(0, 1, { quarters: ['R'], secs: 1 }), cue(3, 4, { quarters: ['D'] })] });
});

test('an unmeasured timing is refused rather than becoming NaN', () => {
  // `NaN <= 0` and `NaN / q < MIN` are both false, so this sailed through both guards.
  assert.throws(
    () => resolveSpanning([{ say: 'a', end: 1, spanning: 1 }, { say: 'b' }]),
    /needs measured timings/,
  );
});

// #16: a camera change arriving BEFORE the previous swing has finished used to jump to the old
// destination first — measured at longitude 71.24° snapping to 135° — because the swing started
// from the previous keyframe's target rather than from where the camera had actually reached.
test('a camera change mid-swing continues from where the camera is, without jumping', () => {
  const s = buildSchedule(checkEpisode({
    cues: [
      cue(0, 1, { cam: [35, 45] }),
      cue(2, 3, { cam: [35, 135] }),
      cue(2.5, 3.5, { cam: [35, 225] }), // arrives 0.5s into a 1.4s swing
    ],
  }));
  // Sampled densely across the handover: no step between consecutive samples may exceed what the
  // easing can produce in that time. A jump to the old destination shows up as one large step.
  let worst = 0;
  let previous = cameraAt(s, 2.4).lon;
  for (let t = 2.41; t <= 4.2; t += 0.01) {
    const lon = cameraAt(s, t).lon;
    worst = Math.max(worst, Math.abs(lon - previous));
    previous = lon;
  }
  assert.ok(worst < 3, `the camera jumped ${worst.toFixed(2)}° between two consecutive frames`);
  // And it still arrives.
  assert.equal(cameraAt(s, 4.2).lon, 225);
});

// ---- round 2: what the verification pass found --------------------------------------------------

// The first duration fix covered the TURNS and still truncated everything else that runs on its own
// clock. Measured before this: ghosts frozen at 2.15 of 9, a camera swing half finished, a counter
// stopped at 28,000 of 1,000,000 — all because the episode claimed to have ended.
test('the duration covers every animation, not only the turns', () => {
  const s = buildSchedule(checkEpisode({
    cues: [
      cue(0, 1, {}),
      cue(2, 3, { ghosts: true, cam: [-35, 135], number: '1,000,000', counting: true, secs: 4 }),
    ],
  }));
  const end = viewAt(s, s.duration);
  assert.equal(end.ghostElevation, GHOST_ELEV, 'the ghosts were still flying out at the end');
  assert.deepEqual([end.camera.lat, end.camera.lon], [-35, 135], 'the camera was still swinging');
  assert.equal(end.number, '1,000,000', 'the counter was still rolling');
});

// Between the end of a tour and the start of the next ordinary cue there is no keyframe in force.
// Defaulting to keyframe zero drew a cue's angle a full second before that cue existed.
test('a gap after a tour is not filled with a future camera cue', () => {
  const s = buildSchedule(checkEpisode({
    cues: [cue(0, 2, { cam: 'tour' }), cue(3, 4, { cam: [-35, 200] })],
  }));
  const gap = cameraAt(s, 2.5);
  assert.deepEqual([gap.lat, gap.lon], [35, 45],
    `a cue starting at 3s was drawn at 2.5s: ${JSON.stringify(gap)}`);
  // And the swing starts WHEN the cue does — just begun at 3.01s, so still near the default and
  // already moving toward the destination.
  const started = cameraAt(s, 3.01).lat;
  assert.ok(started < 35 && started > 34.5, `the swing had not just started: ${started}`);
  assert.equal(cameraAt(s, 4.5).lat, -35, 'and it arrives');
});

// A `setup` starts a new position and discards the previous one's remaining turns, so they cannot
// overlap anything. Carrying the reach across that boundary refused a legitimate reset.
test('a position reset is not an overlap', () => {
  checkEpisode({
    cues: [
      cue(0, 1, { quarters: ['R', 'U', 'F'], secs: 6 }),
      cue(2, 3, { setup: 'F2', quarters: ['D'] }),
    ],
  });
  // And a genuine overlap inside ONE position is still refused.
  assert.throws(() => checkEpisode({
    cues: [cue(0, 1, { quarters: ['R', 'U'], secs: 4 }), cue(2, 3, { quarters: ['D'] })],
  }), /still landing at/);
});

// Round 3: a tour between two ordinary keyframes resets where the camera IS — it ends a full
// revolution round, back at the teaching angle. Swinging the next keyframe from the ordinary one
// before the tour jumped from [35, 405] to [10, 135] the instant the tour ended.
test('a keyframe after a tour swings from where the tour left the camera', () => {
  const s = buildSchedule(checkEpisode({
    cues: [
      cue(0, 0.5, { cam: [10, 135] }),
      cue(1, 2, { cam: 'tour' }),
      cue(2.5, 3.5, { cam: [-35, 225] }),
    ],
  }));
  let worst = 0;
  let previous = cameraAt(s, 1.9).lon;
  for (let t = 1.91; t <= 4.5; t += 0.01) {
    const lon = cameraAt(s, t).lon;
    let d = lon - previous;
    d -= 360 * Math.round(d / 360); // 405 and 45 are the same place
    worst = Math.max(worst, Math.abs(d));
    previous = lon;
  }
  assert.ok(worst < 5, `the camera jumped ${worst.toFixed(2)}° leaving the tour`);
  assert.equal(cameraAt(s, 4.5).lat, -35, 'and it still arrives');
});

// Round 4: the same angle either side of a tour is not a duplicate. The tour moves the camera
// away, so asking for that angle again is a real instruction — dropping it as a repeat left the
// camera at the teaching angle the tour ended on, never coming back to what the lesson asked for.
test('an angle repeated across a tour is honoured, not deduplicated away', () => {
  const s = buildSchedule(checkEpisode({
    cues: [
      cue(0, 0.5, { cam: [10, 135] }),
      cue(1, 2, { cam: 'tour' }),
      cue(2.5, 3.5, { cam: [10, 135] }),
    ],
  }));
  assert.equal(s.cams.length, 2, 'the keyframe after the tour was dropped as a duplicate');
  assert.deepEqual([cameraAt(s, 4.5).lat, cameraAt(s, 4.5).lon], [10, 135],
    'the camera never came back to the angle the lesson asked for twice');
});
