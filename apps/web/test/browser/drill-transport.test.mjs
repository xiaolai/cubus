// The drill page's demonstration controls, against the REAL renderer — the wiring nothing measured.
//
// `drill-library.test.mjs` checks the markup these controls are built from, and `geometry.test.mjs`
// checks that the page lays out. Neither presses anything: the next/back/play/pause buttons and the
// turn chips had no behavioural coverage at all, and the generic driver suites cover the driver,
// not this screen's use of it (audit, 2026-09-29). Three of the defects that audit found were on
// exactly this surface — a click handler that matched the SET-UP chips and threw out of
// `script-drive`, a highlight written with a class the stylesheet does not define, and a `turnTo`
// the driver immediately superseded — and all three were invisible to every existing test.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startBrowserFixture } from './harness.mjs';

let fixture; let page;
const errors = [];

/**
 * Open sune's drill page from scratch.
 *
 * A HELPER RATHER THAN JUST A `before`, because one case here navigates to Home to prove that
 * leaving stops the driver — and anything after it inherits Home, where `#algMoves` does not
 * exist and a click waits thirty seconds for a selector that is never coming. A case that needs
 * the drill page says so instead of depending on the order it happens to run in.
 */
async function openSuneDrill() {
  await page.goto(`${fixture.base}/index.html#/drill`);
  await page.waitForSelector('.screen.active');
  // THE SCREEN REMEMBERS WHICH ALGORITHM WAS CHOSEN, so re-entering `#/drill` renders the drill
  // PAGE rather than the chooser — and then waiting for a card waits for something that is never
  // coming. Go back to the list first when that is where we have landed.
  if (await page.$('#algBackToList')) {
    await page.click('#algBackToList');
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('#algGroups [data-alg]');
  await page.click('#scopeAll');
  await page.waitForSelector('#algGroups [data-alg="sune"]');
  await page.click('#algGroups [data-alg="sune"]');
  await page.waitForSelector('#algCube cubus-cube');
  await page.waitForTimeout(300);
}

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${fixture.base}/index.html#/drill`);
  await page.waitForSelector('.screen.active');
  await page.waitForSelector('#algGroups [data-alg]');
  // SUNE, DELIBERATELY, and not "the first card". The first card in the default scope is a
  // one-turn algorithm, which has no second chip to compare a highlight against and no third turn
  // to seek to — a suite written against it measures almost nothing and times out looking for the
  // rest. Seven turns is enough for next, back, seek and play to be distinguishable.
  await page.click('#scopeAll');
  await page.waitForSelector('#algGroups [data-alg="sune"]');
  await page.click('#algGroups [data-alg="sune"]');
  await page.waitForSelector('#algCube cubus-cube');
  await page.waitForTimeout(300);
  const turns = await page.evaluate(() => document.querySelectorAll('#algMoves button[data-i]').length);
  assert.ok(turns >= 5, `precondition: this suite needs a multi-turn algorithm, got ${turns}`);
});

after(async () => { await fixture?.close(); });

/** How far the demonstration has got, read off the transport's own live counter (#algAt). */
const shown = () => page.evaluate(() => {
  const el = document.querySelector('#algAt');
  return el ? el.textContent.trim() : null;
});

/**
 * Count the calls the transport makes INTO the cube element.
 *
 * A counter and a chip highlight can both advance while the rendered cube stands still, which is
 * what a transport wired to nothing looks like (verify, 2026-09-29). The element's position lives
 * in its scene, not in an attribute — `alg`, `facelets` and `orientation` are identical at turn 0
 * and turn 2, measured — so what is watched is the driver actually calling the element's own
 * stepping methods. Wired to nothing, the count stays at zero.
 */
const watchCube = () => page.evaluate(() => {
  const el = document.querySelector('#algCube cubus-cube');
  window.__calls = 0;
  for (const m of ['stepStop', 'stepBackStop', 'playTo', 'step']) {
    const was = el?.[m];
    if (typeof was === 'function' && !was.__watched) {
      const spy = (...a) => { window.__calls += 1; return was.apply(el, a); };
      spy.__watched = true;
      el[m] = spy;
    }
  }
  return Boolean(el);
});
const cubeCalls = () => page.evaluate(() => window.__calls ?? 0);

test('the cube is drawn in the hold the card names, with no help from the screen', async () => {
  // The script's `start.hold` is the single owner since the redundant `turnTo` was removed.
  const held = await page.evaluate(() => document.querySelector('#algCube cubus-cube')?.getAttribute('orientation'));
  const said = await page.evaluate(() => document.querySelector('#algStep1')?.textContent ?? '');
  assert.ok(held, 'the cube carries no orientation, so the script never established the hold');
  // A tumbled stage is held white-underneath; a white-up stage is held white-on-top. The card's own
  // sentence and the element's attribute must agree — that is the whole claim.
  const whiteUp = /white on top/.test(said);
  assert.equal(held, whiteUp ? 'U F' : 'D B', `the card says "${said.trim()}" and the cube is held ${held}`);
});

test('next and back move the demonstration, and the chip for the turn is marked', async () => {
  const before = await shown();
  await page.click('#algNext');
  await page.waitForTimeout(250);
  const after1 = await shown();
  assert.notEqual(after1, before, `pressing next did not advance the demonstration (${before} -> ${after1})`);

  // THE MARK IS `cur`, WHICH IS THE CLASS THE STYLESHEET DEFINES. Asserted through the computed
  // style, not the class list, because a class nothing styles is exactly the defect this replaces.
  const mark = await page.evaluate(() => {
    const cur = document.querySelector('#algMoves button.cur');
    if (!cur) return { marked: false };
    const plain = [...document.querySelectorAll('#algMoves button')].find((b) => b !== cur);
    return {
      marked: true,
      differs: plain ? getComputedStyle(cur).backgroundColor !== getComputedStyle(plain).backgroundColor
        || getComputedStyle(cur).borderColor !== getComputedStyle(plain).borderColor : false,
    };
  });
  assert.ok(mark.marked, 'no algorithm chip carries the current-turn class');
  assert.ok(mark.differs, 'the current-turn chip is styled exactly like every other chip');

  await page.click('#algBack');
  await page.waitForTimeout(250);
  assert.equal(await shown(), before, 'pressing back did not return the demonstration');
});

test('clicking a SET-UP turn does nothing, and throws nothing', async () => {
  // The set-up turns are `.chip-m` spans with no `data-i`. The handler matched them, `Number(undefined)`
  // is NaN, and `seek(NaN)` threw "script-drive: null is not a position" out of the click.
  errors.length = 0;
  await page.click('#algNext');
  await page.waitForTimeout(250);
  const before = await shown();
  await page.click('#algSetup .chip-m');
  await page.waitForTimeout(250);
  assert.deepEqual(errors, [], 'clicking a set-up turn threw');
  assert.equal(await shown(), before, 'clicking a set-up turn moved the demonstration');
});

test('clicking an algorithm turn seeks the demonstration to it', async () => {
  const target = 2;
  await page.click(`#algMoves button[data-i="${target}"]`);
  await page.waitForTimeout(300);
  const marked = await page.evaluate(() => {
    const cur = document.querySelector('#algMoves button.cur');
    return cur ? Number(cur.dataset.i) : null;
  });
  assert.equal(marked, target, 'seeking to a turn did not mark that turn');
});

test('the transport drives the CUBE, not just the counter', async () => {
  await page.click('#algMoves button[data-i="0"]');
  await page.waitForTimeout(400);
  assert.ok(await watchCube(), 'there is no cube element to watch');
  await page.evaluate(() => { window.__calls = 0; });
  const before = await shown();
  await page.click('#algNext');
  await page.waitForTimeout(700);
  assert.notEqual(await shown(), before, 'precondition: the counter moved');
  assert.ok(await cubeCalls() > 0, 'the counter advanced without the cube being driven at all');
});

test('pause stops the demonstration where it is', async () => {
  await page.click('#algMoves button[data-i="0"]');
  await page.waitForTimeout(300);
  const before = await shown();
  await page.click('#algPlay');
  await page.waitForTimeout(1300);
  const running = await shown();
  assert.notEqual(running, before, `precondition: play advanced the demonstration (${before} -> ${running})`);

  // The play control is a toggle; pressing it again pauses.
  await page.click('#algPlay');
  await page.waitForTimeout(300);
  const atPause = await shown();
  await page.waitForTimeout(1800);
  const later = await shown();
  assert.equal(later, atPause, `the demonstration kept playing after pause (${atPause} -> ${later})`);
  const pressed = await page.evaluate(() => document.querySelector('#algPlay')?.getAttribute('aria-pressed'));
  assert.equal(pressed, 'false', 'the paused transport still reports itself as playing');
});

test('play runs the demonstration and leaving the screen stops it', async () => {
  errors.length = 0;
  await page.click('#algMoves button[data-i="0"]');
  await page.waitForTimeout(200);
  const before = await shown();
  await page.click('#algPlay');
  await page.waitForTimeout(1400);
  const during = await shown();
  assert.notEqual(during, before, 'play did not advance the demonstration');

  // LEAVING MUST STOP IT, and "the DOM is gone" does not establish that: a detached driver ticking
  // on satisfies that assertion perfectly (verify, 2026-09-29). What a live driver would do is keep
  // calling into the element, so the element is what gets watched — for longer than one reveal gap.
  await page.evaluate(() => {
    const el = document.querySelector('#algCube cubus-cube');
    window.__calls = 0;
    for (const m of ['stepStop', 'stepBackStop', 'playTo', 'step']) {
      const was = el?.[m];
      if (typeof was === 'function') el[m] = (...a) => { window.__calls += 1; return was.apply(el, a); };
    }
    window.location.hash = '#/home';
  });
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#algCube'))), false,
    'the drill page is still mounted after navigating away');
  await page.evaluate(() => { window.__calls = 0; });
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => window.__calls), 0, 'a driver kept driving after the screen was left');
  assert.deepEqual(errors, [], 'playback continued into a screen that had been left');
});

test('a demonstrated turn is slow enough to WATCH, not just slow enough to count', async () => {
  // THE ASSERTION THAT WAS MISSING, and the reason the defect shipped past a green suite. The case
  // above checks that pressing Next drives the element — it counts calls into it, and a call costs
  // the same whether the turn takes 200ms or 1.6s. So it passed while `tempo-scale` was never set
  // on this screen's cube at all and the renderer used its own 190ms base: a quarter turn over in a
  // fifth of a second, which a child reads as the cube having simply changed (measured 2026-09-30,
  // 200ms here against 1620ms on the cube screen for the same turn).
  //
  // Measured as DURATION because that is what "no animation" actually means to the person watching.
  // REDUCED MOTION LEGITIMATELY SHORTENS A TURN (AGENTS.md §7), so a runner that prefers it would
  // make this case assert something false. Stated rather than inherited from whatever the machine
  // happens to want.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSuneDrill();
  await page.click('#algMoves button[data-i="0"]');
  await page.waitForTimeout(400);
  const el = '#algCube cubus-cube';

  const tempo = await page.evaluate((sel) => document.querySelector(sel)?.getAttribute('tempo-scale'), el);
  assert.ok(tempo !== null, 'the drill cube carries no tempo-scale, so the renderer picks its own');

  // MEASURED AS ELAPSED TIME, NOT AS A COUNT OF SAMPLES. The first version of this counted how
  // many 20ms polls saw `animating` and multiplied by 20 — which silently measures the RUNNER as
  // well as the turn: on a loaded CI machine each iteration takes longer than the 20ms it assumes,
  // so fewer polls land inside the turn and a real 1620ms turn was reported as 600ms. It failed on
  // CI and passed here, which is the signature of a measurement that depends on the machine.
  // Timestamps at the two edges do not care how often they are taken.
  const ms = await page.evaluate(async (sel) => {
    const cube = document.querySelector(sel);
    document.querySelector('#algNext').click();
    let began = null;
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      const turning = Boolean(cube.animating);
      if (turning && began === null) began = performance.now();
      else if (!turning && began !== null) return performance.now() - began;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return began === null ? 0 : performance.now() - began;
  }, el);

  // 760ms was the complaint that produced the speed menu — the speed a real person called too fast.
  // Nothing the app draws should turn faster than the thing that was already too fast.
  assert.ok(ms >= 700, `a demonstrated quarter turn took about ${ms}ms, which reads as a snap`);
  // And an upper bound, so a future tempo of 0 does not pass this by animating for ever.
  assert.ok(ms <= 5000, `a demonstrated quarter turn took about ${ms}ms, which is not a turn but a wait`);
});

test('the demonstration follows the cube in the child\'s hands', async () => {
  // THE PAGE'S PROMISE: the cube on screen is the cube you are holding (owner, 2026-09-30). The
  // demonstration and the live attempt used to be entirely separate, so turning your own cube moved
  // nothing. Driven through the app's OWN hooks and its own `state`, imported by URL so the page
  // gets the same module instances the app is running — a second copy would prove nothing.
  await openSuneDrill();
  await page.addScriptTag({
    type: 'module',
    content: `
      import { state } from '/lib/app-state.js';
      import { hooks } from '/lib/screen-slots.js';
      import { chainTrusted } from '/lib/cube-trust-state.js';
      import { entryById } from '/lib/alg-catalogue.js';
      import { SOLVED, applyAlg, invert, movesOf, toFacelets } from '/lib/cube-pieces.js';
      window.__follow = { state, hooks, chainTrusted, entryById, SOLVED, applyAlg, invert, movesOf, toFacelets };
    `,
  });
  await page.waitForFunction(() => Boolean(window.__follow));

  const said = () => page.evaluate(() => document.querySelector('#algAt')?.textContent?.trim());
  const tempo = () => page.evaluate(() => document.querySelector('#algCube cubus-cube')?.getAttribute('tempo-scale'));

  // A cube that is connected and believed. Set on the app's own state, because that is what the
  // screen asks — an unproven radio is refused, and this feature must not bypass that.
  const trusted = await page.evaluate(() => {
    const { state, chainTrusted } = window.__follow;
    state.connected = true;
    state.cube.trusted = true;
    state.cube.source = 'cube';
    return chainTrusted();
  });
  assert.equal(trusted, true, 'precondition: the app does not consider this cube trusted');

  // Step 1: a solved cube. The algorithm returns the case to solved, so solved is the LAST
  // position — the counter proving the mirror moved at all.
  await page.evaluate(() => {
    const { hooks, SOLVED, toFacelets } = window.__follow;
    hooks.liveUpdate(toFacelets(SOLVED), 0);
  });
  await page.waitForTimeout(500);
  assert.match(await said(), /7 of 7/, `a solved cube did not move the demonstration to its end (said "${await said()}")`);
  assert.equal(await tempo(), '1', 'while following, the demonstration still animates at the watching tempo');

  // Step 2: the printed set-up, which is the algorithm inverted — so the mirror walks backwards.
  await page.evaluate(() => {
    const { hooks, entryById, invert, movesOf } = window.__follow;
    const sune = entryById('sune');
    movesOf(invert(sune.scanAlg)).forEach((notation, i) => {
      hooks.liveMove({ notation, serial: i + 1, cubeTimestamp: (i + 1) * 400, timestamp: (i + 1) * 400 });
    });
  });
  await page.waitForTimeout(600);
  assert.match(await said(), /0 of 7/, `the set-up did not walk the demonstration to the case (said "${await said()}")`);

  // Step 3: three turns of the algorithm move it on by exactly three.
  await page.evaluate(() => {
    const { hooks, entryById, movesOf } = window.__follow;
    const sune = entryById('sune');
    const n = movesOf(window.__follow.invert(sune.scanAlg)).length;
    movesOf(sune.scanAlg).slice(0, 3).forEach((notation, i) => {
      hooks.liveMove({ notation, serial: n + 1 + i, cubeTimestamp: (n + 1 + i) * 400, timestamp: (n + 1 + i) * 400 });
    });
  });
  await page.waitForTimeout(600);
  assert.match(await said(), /3 of 7/, `three turns did not move the demonstration to 3 (said "${await said()}")`);

  // And taking the transport back restores the watching tempo, so a press is watchable again.
  await page.click('#algNext');
  await page.waitForTimeout(200);
  assert.notEqual(await tempo(), '1', 'pressing the transport left the demonstration at the following tempo');
});
