// Off the walk right after a whole-cube turn, on the REAL renderer — dev-docs/lesson-holds-plan.md item 3.1.
//
// `walk-session.test.mjs` pins what the follow tracker ASKS for: a seek and a step for a turn that is a token
// of the walk, a snap and a paced `turnTo` for a stage's tumble. Nothing there can say what the element then
// does with it (audit 2026-10-14, round 3). Here the real tracker, the real script player and the real hold
// presenter drive a real `<cubus-cube>`, and the cases read what is drawn: the regrip is animated again and
// the walk is left where the cube is; the tumble is turned again and the cube ends in the hold it was in.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startBrowserFixture } from './harness.mjs';

let fixture;

before(async () => { fixture = await startBrowserFixture(); });
after(async () => { await fixture?.close(); });

/**
 * A page holding a cube, a follow tracker and a script player on the walk `R <turn> <the child's next face>`,
 * worked out in the page from the same helpers the app uses. `stage`: the hold changes across a plain face
 * turn, as the tumble does, and the hold presenter turns the cube to it.
 */
async function world({ stage }) {
  const page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  await page.evaluate(async (isStage) => {
    const { createFollowTracker } = await import('/lib/walk-follow.js');
    const { createScriptPlayer } = await import('/lib/script-player.js');
    const { walkScript } = await import('/lib/walk-script.js');
    const { createHoldCube } = await import('/lib/hold-presenter.js');
    const { SCAN_HOLD, TUMBLED } = await import('/lib/solving-hold.js');
    const { identityFace, run, faceTurnsAlg } = await import('/lib/cube-moves.js');
    const { SOLVED: PIECES } = await import('/lib/cube-pieces.js');
    const Cube = (await import('/vendor/cubejs.js')).default;
    const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
    const turned = (alg) => { const c = Cube.fromString(SOLVED); if (alg) c.move(alg); return c.asString(); };

    const root = document.createElement('div');
    root.innerHTML = '<button data-mode="cube"></button><div id="followNote" hidden><span id="followMsg"></span><button id="resolveBtn"></button><button id="turnBackBtn"></button></div>';
    document.body.appendChild(root);
    const cube = document.createElement('cubus-cube');
    cube.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px';
    cube.setAttribute('tempo-scale', '0.2');
    document.body.appendChild(cube);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const after = isStage ? TUMBLED : run('y', SCAN_HOLD, PIECES).hold;
    const third = identityFace('F', after);
    const moves = isStage ? ['R', third] : ['R', 'y', third];
    const steps = isStage ? [SOLVED, turned('R'), turned(`R ${third}`)]
      : [SOLVED, turned('R'), turned('R'), turned(`R ${faceTurnsAlg(third)}`)];
    const holds = isStage ? [SCAN_HOLD, after, after] : [SCAN_HOLD, SCAN_HOLD, after, after];
    const walk = { moves, steps };
    const player = createScriptPlayer({ cube, owned: ['orientation'] });
    await player.load(walkScript({ moves, from: SOLVED }));
    const holdCube = createHoldCube({ cube, isStale: () => false });
    holdCube(SCAN_HOLD);
    const state = { cube: { facelets: SOLVED, trusted: true, isPhysical: true, source: 'cube', staleWhy: '' }, live: SOLVED };
    const follow = createFollowTracker({
      root, player, cube, state, cubejs: () => Cube,
      applyTempo: () => {}, setPlaying: () => {}, moveHoldAt: (k) => holds[Math.min(k, holds.length - 1)],
      markStale: () => {}, adoptCube: () => {}, go: () => {}, scrambling: false,
      refreshLiveDistance: async () => {}, dropLiveDistance: () => {},
      chainTrusted: () => true, walkNow: () => walk,
    });
    follow.rebase(walk);
    const settle = async () => {
      for (let i = 0; i < 600 && (cube.animating || cube.turning); i++) await new Promise((r) => requestAnimationFrame(r));
    };
    // The first move is on the walk; the stage case's presenter then turns the cube over, as a lesson does.
    follow.liveMove({ notation: 'R', serial: 1 });
    await settle();
    if (isStage) { holdCube(after); await settle(); }
    const pose = () => [...cube.root.quaternion.toArray()].map((v) => Math.round(v * 1000) / 1000 + 0);
    window.__w = { follow, player, cube, settle, pose, after, wrong: 'F' };
  }, stage);
  return page;
}

for (const stage of [false, true]) {
  const what = stage ? 'a stage tumble' : 'a regrip in the walk';
  test(`off the walk right after ${what}, the real cube shows the turn again and ends where it was`, async () => {
    const page = await world({ stage });
    const got = await page.evaluate(async () => {
      const { follow, player, cube, settle, pose } = window.__w;
      const at = player.position;
      const restPose = pose();
      const restHold = cube.dataset.hold;
      follow.liveMove({ notation: window.__w.wrong, serial: 2 });
      let moved = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        moved ||= cube.animating || cube.turning;
      }
      await settle();
      const note = document.querySelector('#followMsg').textContent;
      return { at, after: player.position, moved, restPose, endPose: pose(), restHold, endHold: cube.dataset.hold, note };
    });
    await page.close();
    assert.match(got.note, /^Your cube does not match this one\./);
    assert.equal(got.moved, true, 'nothing on the cube moved: the turn was not shown again');
    assert.equal(got.after, got.at, 'the replay left the walk somewhere other than where the cube is');
    assert.deepEqual(got.endPose, got.restPose, 'the cube did not end in the hold it was in');
    assert.equal(got.endHold, got.restHold, 'the replay changed the hold the presenter recorded');
  });
}
