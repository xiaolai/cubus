// The episode player driving a real `<cubus-cube>`.
//
// THE PROPERTY THIS FILE EXISTS FOR: a listener drops the needle wherever they like, so the cube at
// a given `t` must be the same cube whether that `t` was reached by playing forwards, by dragging
// the scrubber backwards, or by clicking a line in the transcript. `lesson-schedule.test.mjs`
// proves the arithmetic; this proves the arithmetic actually reaches the stickers.
//
// Everything else here is a consequence of that. The player writes attributes only on change —
// `focus` and `highlight` repaint 108 materials — so "did it write" and "did it stop writing" are
// both worth asserting, and a picture is compared rather than a set of attribute values, because
// what the child sees is the picture.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { checkEpisode, resolveSpanning } from '../../lib/lesson-format.js';
import { buildSchedule, viewAt } from '../../lib/lesson-schedule.js';
import { MANIFEST, installPublicCube } from './public-cube.mjs';
import { startBrowserFixture } from './harness.mjs';

const raw = JSON.parse(
  readFileSync(new URL('../fixtures/episode-structure.json', import.meta.url), 'utf8'),
);
const EPISODE = checkEpisode({ cues: resolveSpanning(raw.cues) });
const SCHEDULE = buildSchedule(EPISODE);

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  await page.evaluate(async () => {
    const el = document.createElement('cubus-cube');
    // Non-square, per rule 22 — a square frame is the one shape in which a roll cannot change what
    // fits, and this episode rolls.
    el.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px;z-index:99999';
    el.setAttribute('camera-fit', 'stable');
    document.body.appendChild(el);
    window.__cube = el;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  // The player is module code, so it is loaded IN the page rather than reimplemented in the test.
  await page.addScriptTag({
    type: 'module',
    content: `
      import { createLessonPlayer } from '/lib/lesson-player.js';
      import { buildSchedule } from '/lib/lesson-schedule.js';
      window.__makePlayer = (episode) => {
        window.__schedule = buildSchedule(episode);
        window.__player = createLessonPlayer(window.__cube, window.__schedule);
      };
    `,
  });
  await page.waitForFunction(() => typeof window.__makePlayer === 'function');
  await page.evaluate((episode) => window.__makePlayer(episode), EPISODE);
});

after(async () => { await fixture?.close(); });

/**
 * Wait until the renderer has finished every turn it was handed.
 *
 * A picture taken mid-animation is a picture of a cube part-way through a quarter turn, which is a
 * real state and not the one anybody is asserting about. Without this the play-through case
 * compared a settled cube against one caught mid-turn and blamed the player.
 */
const settle = () => page.waitForFunction(
  () => !window.__cube._anim && window.__cube._queue.length === 0,
  undefined,
  { timeout: 20_000 },
);

/** What the child sees: every sticker's place in the world and its colour. */
const picture = async () => {
  await settle();
  const pic = await page.evaluate(() => {
    const el = window.__cube;
    el.scene.updateMatrixWorld(true);
    const r3 = (v) => +v.toFixed(3) + 0;
    return el.stickers.map((m) => {
      const p = m.getWorldPosition(new (Object.getPrototypeOf(el.camera.position).constructor)());
      return `${r3(p.x)},${r3(p.y)},${r3(p.z)}=${m.material.color.getHexString()}`;
    }).sort();
  });
  assert.equal(pic.length, 54, 'the cube drew no stickers — its scene was never built');
  return pic.join('|');
};

const seek = (t) => page.evaluate((x) => { window.__player.seek(x); }, t);

// Times chosen to land in different places: before anything turns, inside the timed sequence,
// after it, in the second position, and at the very end.
const PROBES = [0, 12, 40, 95, 150, 260, SCHEDULE.duration - 1];

test('the schedule survives the trip into the page', async () => {
  const inPage = await page.evaluate(() => ({
    cues: window.__schedule.cues.length,
    segments: window.__schedule.segments.length,
    duration: window.__schedule.duration,
  }));
  assert.equal(inPage.cues, SCHEDULE.cues.length);
  assert.equal(inPage.segments, SCHEDULE.segments.length);
  assert.equal(inPage.duration, SCHEDULE.duration);
});

// THE ONE THAT MATTERS. Reached forwards, reached backwards, reached cold — one picture.
test('a timestamp gives one cube, however the listener got there', async () => {
  const forwards = [];
  for (const t of PROBES) { await seek(t); forwards.push(await picture()); }

  const backwards = [];
  for (const t of [...PROBES].reverse()) { await seek(t); backwards.push(await picture()); }
  backwards.reverse();
  assert.deepEqual(backwards, forwards, 'scrubbing backwards drew a different cube');

  // And cold, from a player that has never seen any other time.
  for (let i = 0; i < PROBES.length; i += 1) {
    await page.evaluate((episode) => window.__makePlayer(episode), EPISODE);
    await page.evaluate(() => window.__cube.recycle());
    await page.evaluate((x) => { window.__player.seek(x); }, PROBES[i]);
    assert.equal(await picture(), forwards[i], `a cold seek to ${PROBES[i]}s drew a different cube`);
  }
});

test('playing through a sequence lands where jumping to its end lands', async () => {
  // Walk the window around the FIRST run of turns, not the whole position. Capping by move count
  // did not work and the reason is worth writing down: this position's nine turns are spread over
  // 146 seconds of narration, so "the first twelve moves" was still almost the whole episode, and
  // at one animation frame per 50ms of episode time the case took 49 seconds. A window is the
  // right unit because what is being tested is stepping through consecutive turns, and the gaps
  // between cues contain no turns at all.
  const seg = SCHEDULE.segments.find((s) => s.moves.length > 0);
  assert.ok(seg, 'the fixture episode should contain a turned sequence');
  // One cue's turns are consecutive and evenly spaced; the gap to the next cue's is minutes of
  // narration. So the window is the first RUN of at least three — not the first move, which in
  // this episode is a single turn sitting on its own two minutes before the rest.
  const runs = [];
  for (let i = 0; i < seg.moves.length; i += 1) {
    let n = 1;
    while (i + n < seg.moves.length
      && Math.abs(seg.moves[i + n].at - seg.moves[i + n - 1].at - seg.moves[i + n - 1].step) < 1e-6) n += 1;
    if (n >= 3) { runs.push({ i, n }); break; }
    i += n - 1;
  }
  assert.ok(runs.length, 'the fixture episode should contain a run of at least three turns');
  const { i: at, n: len } = runs[0];
  const first = seg.moves[at];
  const end = seg.moves[at + len - 1].at + first.step;

  await page.evaluate((episode) => window.__makePlayer(episode), EPISODE);
  await page.evaluate(async ([from, to]) => {
    for (let t = from; t <= to; t += 0.05) {
      window.__player.paint(t);
      // Let the renderer actually run its animation, or `step()` piles up and gets snapped.
      await new Promise((r) => requestAnimationFrame(r));
    }
  }, [first.at - 0.3, end]);
  const played = await picture();

  await page.evaluate((episode) => window.__makePlayer(episode), EPISODE);
  await page.evaluate(() => window.__cube.recycle());
  await seek(end);
  assert.equal(await picture(), played, 'playing the turns gave a different cube from seeking past them');
});

test('the player writes what the view says, and stops writing when nothing changes', async () => {
  await seek(150);
  const view = viewAt(SCHEDULE, 150);
  const attrs = await page.evaluate(() => ({
    highlight: window.__cube.getAttribute('highlight'),
    ghosts: window.__cube.getAttribute('ghosts'),
    lat: window.__cube.getAttribute('camera-latitude'),
    lon: window.__cube.getAttribute('camera-longitude'),
    up: window.__cube.getAttribute('camera-up'),
  }));
  assert.equal(attrs.highlight, view.highlight);
  assert.equal(attrs.ghosts, view.ghosts ? 'floating' : 'none');
  assert.equal(Number(attrs.lat), view.camera.lat);
  assert.equal(Number(attrs.lon), view.camera.lon);
  assert.equal(attrs.up, view.camera.up);

  // Painting the same time again must not touch the element: `focus` and `highlight` repaint 108
  // materials, and writing them every frame would spend the budget the turn animation needs.
  const writes = await page.evaluate((t) => {
    let n = 0;
    const set = window.__cube.setAttribute.bind(window.__cube);
    const rm = window.__cube.removeAttribute.bind(window.__cube);
    window.__cube.setAttribute = (...a) => { n += 1; return set(...a); };
    // `removeAttribute` too: clearing `focus` every frame is just as much a repaint as setting it,
    // and counting only one of the two made half the writes invisible.
    window.__cube.removeAttribute = (...a) => { n += 1; return rm(...a); };
    try {
      window.__player.paint(t);
    } finally {
      // In `finally`, or a throw leaves the SHARED cube permanently patched and every later case
      // in this file runs against an instrumented element.
      window.__cube.setAttribute = set;
      window.__cube.removeAttribute = rm;
    }
    return n;
  }, 150);
  assert.equal(writes, 0, 'repainting an unchanged time wrote to the element');
});

// The grip. This episode is written after the flip, so the finished layer is underneath the child —
// and a cube drawn without the roll shows it at the TOP of the screen, looking entirely deliberate.
// cubus-im shipped exactly that for six lessons.
test('the roll reaches the renderer, so the finished layer is not drawn upside down', async () => {
  const rolled = SCHEDULE.cams.find((c) => c.up !== 'U');
  assert.ok(rolled, 'the fixture episode should carry a roll');
  await seek(rolled.at + 0.1);
  const up = await page.evaluate(() => {
    const u = window.__cube.camera.up;
    return [u.x, u.y, u.z].map((n) => Math.round(n) + 0);
  });
  assert.deepEqual(up, [0, -1, 0], 'camera-up never reached the camera');
});

// ---- the branches the real fixture never reaches ------------------------------------------------
//
// The audit's point: the committed episode carries no `focus`, no `orientation` and no camera
// change, so three of the player's branches were never executed by any case in this file. A small
// purpose-built episode is the cheapest way to reach them, and it does not weaken the real-episode
// cases — those are about a schedule nobody wrote for the test.
test('focus, orientation and camera changes all reach the element', async () => {
  const cue = (start, end, extra = {}) => ({ say: `line ${start}`, ...extra, start, end });
  const episode = {
    cues: [
      cue(0, 1, { hl: 'none', ghosts: false, cam: [35, 45] }),
      cue(2, 3, { hl: 'layer:U', focus: 'layer:U', ghosts: false, cam: [35, 45] }),
      cue(4, 5, { hl: 'none', ghosts: false, cam: [-35, 135], orientation: 'D B' }),
      cue(6, 7, { hl: 'none', ghosts: true, cam: [35, 45] }),
    ],
  };
  await page.evaluate((e) => window.__makePlayer(e), episode);
  await page.evaluate(() => window.__cube.recycle());

  const at = async (t) => {
    await page.evaluate((x) => { window.__player.seek(x); }, t);
    return page.evaluate(() => ({
      focus: window.__cube.getAttribute('focus'),
      orientation: window.__cube.getAttribute('orientation'),
      up: window.__cube.getAttribute('camera-up'),
      ghosts: window.__cube.getAttribute('ghosts'),
      lon: window.__cube.getAttribute('camera-longitude'),
    }));
  };

  const a = await at(2.5);
  // The PIECES the selector named, not the selector: a positional focus is bound to the cube at its own
  // cue before it is written, so the same lesson lights the same pieces played or scrubbed into (below).
  assert.equal(a.focus, 'piece:FRU,piece:FLU,piece:BLU,piece:BRU,piece:RU,piece:FU,piece:LU,piece:BU,piece:U',
    'focus never reached the element as the pieces it names');
  // CLEARED, not left behind: a focus that outlives its cue greys pieces the narration is talking
  // about.
  const b = await at(4.5);
  assert.equal(b.focus, null, 'focus outlived the cue that set it');
  assert.equal(b.orientation, 'D B', 'the orientation never reached the element');

  // And BOTH camera channels are written every time, so the picture cannot depend on which cues
  // happened to be visited on the way. Seeking backwards must clear the orientation again.
  const c = await at(6.5);
  assert.equal(c.orientation, 'U F', 'an orientation from an earlier cue was left standing');
  assert.equal(c.ghosts, 'floating');
  // Cold, from a player that has seen nothing else: same answer.
  await page.evaluate((e) => window.__makePlayer(e), episode);
  await page.evaluate(() => window.__cube.recycle());
  assert.deepEqual(await at(6.5), c, 'the picture depended on the path taken to reach it');
});

// A jumped seek during an animation has to re-seat the cursor even when the move count is the
// same on both sides of the jump — otherwise the renderer finishes a turn the listener scrubbed
// away from, and the cube settles somewhere the schedule never said.
test('seeking during an animation does not leave a stale turn running', async () => {
  const seg = SCHEDULE.segments.find((s) => s.moves.length > 0);
  const m = seg.moves[0];
  await page.evaluate((e) => window.__makePlayer(e), EPISODE);
  await page.evaluate(() => window.__cube.recycle());
  const stale = await page.evaluate(async (at) => {
    window.__player.seek(at - 0.2);
    window.__player.paint(at + 0.01); // steps: one move begins animating
    await new Promise((r) => requestAnimationFrame(r));
    const animating = !!window.__cube._anim;
    window.__player.seek(at - 0.2);   // jump back; the move count is the same as before the step
    return { animating, stillAnimating: !!window.__cube._anim };
  }, m.at);
  assert.equal(stale.animating, true, 'the step never started, so this proves nothing');
  assert.equal(stale.stillAnimating, false, 'a turn went on running after the listener jumped away');
});

// THE CONTRACT, RUN RATHER THAN DECLARED (plan item 2.5). The player is a consumer of
// `<cubus-cube>`, and until the manifest grew it could not paint a single frame without reaching
// past it: `setAttribute` was not in the contract, and neither was "is a turn animating", which is
// why it read the private `_anim`. Both cases are here because the refusal is what makes the claim
// checkable — the proxy names what it refused.
test('the player paints an episode through the public cube, touching nothing the manifest omits', async () => {
  await installPublicCube(page);
  await page.addScriptTag({
    type: 'module',
    content: `
      import { createLessonPlayer } from '/lib/lesson-player.js';
      window.__playerOn = (target) => createLessonPlayer(target, window.__schedule);
    `,
  });
  await page.waitForFunction(() => typeof window.__playerOn === 'function');
  await page.evaluate((episode) => window.__makePlayer(episode), EPISODE);
  await page.evaluate(() => window.__cube.recycle());

  const refused = await page.evaluate(async (probes) => {
    const player = window.__playerOn(window.__publicCube(window.__cube));
    const out = [];
    for (const t of probes) {
      try { player.seek(t); player.paint(t + 0.01); } catch (e) { out.push(`${t}: ${e.message}`); }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  }, PROBES);
  assert.deepEqual(refused, [], 'the player reached past the manifest');

  // And the picture is the one the same episode draws through the element directly: a contract that
  // is kept by drawing nothing would pass the case above.
  const throughProxy = await picture();
  await page.evaluate((episode) => window.__makePlayer(episode), EPISODE);
  await page.evaluate(() => window.__cube.recycle());
  await seek(PROBES.at(-1));
  await page.evaluate((t) => { window.__player.paint(t + 0.01); }, PROBES.at(-1));
  assert.equal(await picture(), throughProxy, 'the player drew a different cube through the proxy');
});

test('the contract is what makes that possible: without it the first attribute write is refused', async () => {
  // The manifest as it was before item 2.5 — attributes and methods, no DOM operations — is what the
  // player used to be held to, and it cannot write an attribute at all. Restored at the end, because
  // every later case in this file drives the real one.
  const asSchema1 = { ...MANIFEST, properties: [], events: [], operations: {} };
  await installPublicCube(page, asSchema1);
  try {
    await page.evaluate((episode) => window.__makePlayer(episode), EPISODE);
    await page.evaluate(() => window.__cube.recycle());
    const first = await page.evaluate(() => {
      const player = window.__playerOn(window.__publicCube(window.__cube));
      try { player.seek(0); return null; } catch (e) { return e.message; }
    });
    assert.match(first ?? '', /no member "(setAttribute|removeAttribute)"/,
      'a manifest without DOM operations should refuse the first attribute the player writes');
  } finally {
    await installPublicCube(page);
  }
});

// The private read the public member replaced. A comment saying "use `animating`" is not a check;
// this is, and it fails the day someone reaches for a private field again.
test('the player reads no private member of the element', () => {
  const src = readFileSync(new URL('../../lib/lesson-player.js', import.meta.url), 'utf8');
  const privateReads = [...src.matchAll(/\bcube\._[A-Za-z]+/g)].map((m) => m[0]);
  assert.deepEqual(privateReads, [], 'the player is reaching past the manifest into the element');
  assert.ok(/cube\.animating/.test(src), 'precondition: the player asks whether a turn is animating');
});

// ADR 0004 decisions 9 and 10, the writer's half. The element binds a positional focus where it is
// WRITTEN and keeps those pieces through a seek — so a cold seek, which writes it after the jump, bound
// it to whatever had arrived in the slot by then: `focus: 'slot:UR'` on a line whose turn is `R` lit the
// piece the turn brought there rather than the one the child was shown (Codex audit, 2026-09-16).
test('a positional focus names the pieces its own cue named, however the listener arrived', async () => {
  const cue = (start, end, extra = {}) => ({ say: `line ${start}`, ...extra, start, end });
  const episode = {
    cues: [
      cue(0, 1, { hl: 'none', ghosts: false, cam: [35, 45] }),
      cue(2, 3, { hl: 'none', ghosts: false, cam: [35, 45], focus: 'slot:UR', quarters: ['R'], secs: 1 }),
      cue(6, 7, { hl: 'none', ghosts: false, cam: [35, 45], focus: 'slot:UR' }),
    ],
  };
  const focusAt = async (t) => {
    await page.evaluate((e) => window.__makePlayer(e), episode);       // a fresh player: a COLD arrival
    await page.evaluate((x) => { window.__player.seek(x); }, t);
    return page.evaluate(() => window.__cube.getAttribute('focus'));
  };
  // `piece:RU` is the UR edge, spelled the way a piece key is: the letters sorted, so `UR` and `RU` are
  // one piece rather than two names for it.
  assert.equal(await focusAt(2.5), 'piece:RU', 'the focus was not bound to the piece at its own cue');
  assert.equal(await focusAt(4.5), 'piece:RU',
    'seeking past the cue\'s own turn bound the focus to whatever the turn brought to UR');
  // A LATER cue that names the same slot is a different cue, and names what is in that slot NOW — the
  // FR edge, which the R turn put there.
  assert.equal(await focusAt(6.5), 'piece:FR', 'a cue written after the turn was bound before it');
  // And played through rather than jumped into, the answer is the same one.
  await page.evaluate((e) => window.__makePlayer(e), episode);
  const played = await page.evaluate(async () => {
    const seen = [];
    for (const t of [0.5, 2.5, 3.5, 4.5]) { window.__player.paint(t); seen.push(window.__cube.getAttribute('focus')); }
    return seen;
  });
  assert.deepEqual(played, [null, 'piece:RU', 'piece:RU', 'piece:RU'], 'playing through gave a different answer from jumping');
});

// `<cubus-cube>` is parked and RE-USED between screens (app.js), and the renderer gives a valid
// `facelets` precedence over a `scramble` — so an episode loaded onto an element whose last user left
// facelets on it drew that user's cube, for every segment, with nothing saying so. The script runtime's
// writer has always cleared it; this is the same rule (Codex audit, 2026-09-16).
test('an episode clears a facelets left on a re-used cube, which would outrank its own scramble', async () => {
  const cue = (start, end, extra = {}) => ({ say: `line ${start}`, ...extra, start, end });
  const episode = { cues: [cue(0, 1, { setup: "R U R'", hl: 'none', ghosts: false, cam: [35, 45] })] };
  const OTHER = 'DDDDUDDDDRRRRRRRRRFFFFFFFFFUUUUDUUUULLLLLLLLLBBBBBBBBB';
  await page.evaluate((f) => { window.__cube.setAttribute('facelets', f); }, OTHER);
  await page.evaluate((e) => window.__makePlayer(e), episode);
  await page.evaluate(() => { window.__player.seek(0.5); });
  assert.equal(await page.evaluate(() => window.__cube.getAttribute('facelets')), null,
    "the episode's segment was drawn over a cube some other screen left behind");
  assert.equal(await page.evaluate(() => window.__cube.getAttribute('scramble')), "R U R'");
});
