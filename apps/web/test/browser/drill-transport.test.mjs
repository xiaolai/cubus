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
