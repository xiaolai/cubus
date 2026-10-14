// A whole-cube turn on the real element, at the walk's pace — dev-docs/lesson-holds-plan.md Phase 1.
//
// Three things the unit suites can only assert as arithmetic and wiring, measured here as time on the
// real renderer in both engines:
//
//   1.1  the tumble takes the walk's time — it was a flat 400ms, the fastest thing on the screen at a
//        speed where a face quarter turn takes 1.9s;
//   1.2  no face turn starts while the cube is still going over — nothing paced on `turnTo`, because
//        `animating` is about face turns only;
//   1.3  reduced motion SHORTENS the tumble rather than snapping it, the rule face turns already keep.
//
// The 1.2 case was run once with the driver's wait reverted (`transportWhenStill` calling `transport`
// straight through): it failed in both engines, with face-turn frames inside the tumble.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { WALK_SPEEDS } from '../../lib/cube-view.js';
import { startBrowserFixture } from './harness.mjs';

const tempoOf = (id) => WALK_SPEEDS.find((o) => o.id === id).tempo;
const QUARTER_AT = (tempo) => 190 / tempo;

for (const engine of ['webkit', 'chromium']) {
  let fixture;
  const pages = [];

  /** A page with one bare cube on it, 16:9 so a turn changes what fits, upgraded and built. */
  const cubePage = async ({ reducedMotion = 'no-preference' } = {}) => {
    // ONE page at a time. Every page left open keeps drawing its cube, and in Chromium the pages then
    // compete for frames: a timing case measured a turn 1.5s long that the renderer asked to take 950ms.
    for (const p of pages.splice(0)) await p.close().catch(() => {});
    const page = await fixture.browser.newPage();
    pages.push(page);
    await page.emulateMedia({ reducedMotion });
    await page.goto(`${fixture.base}/index.html`);
    await page.waitForFunction(() => !!customElements.get('cubus-cube'));
    await page.evaluate(() => {
      const el = document.createElement('cubus-cube');
      el.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px;z-index:99999';
      document.body.appendChild(el);
      window.__cube = el;
    });
    await page.waitForFunction(() => (window.__cube.stickers?.length ?? 0) > 0);
    return page;
  };

  /** Ask the hold presenter for a tumble at `tempo`; resolve with how long the element said it was turning. */
  const timedTumble = (page, tempo) => page.evaluate(async (t) => {
    const { createHoldCube } = await import('/lib/hold-presenter.js');
    const el = window.__cube;
    el.setAttribute('tempo-scale', String(t));
    el.turnTo('U', 'F', { ms: 0 });
    const holdCube = createHoldCube({ cube: el, isStale: () => false });
    holdCube(['U', 'F']);
    const t0 = performance.now();
    holdCube(['D', 'B']);
    const started = el.turning;
    while (el.turning) {
      await new Promise((r) => requestAnimationFrame(r));
      if (performance.now() - t0 > 20000) break;
    }
    return { started, ms: performance.now() - t0 };
  }, tempo);

  before(async () => { fixture = await startBrowserFixture({ engine }); });
  after(async () => {
    for (const p of pages) await p.close().catch(() => {});
    await fixture?.close();
  });

  test(`${engine}: the tumble takes two face quarter turns at the walk's speed, at Slow and at Fast`, async () => {
    const page = await cubePage();
    for (const id of ['fast', 'slow']) {
      const want = 2 * QUARTER_AT(tempoOf(id));
      const got = await timedTumble(page, tempoOf(id));
      assert.equal(got.started, true, `${id}: the tumble never started turning`);
      // A frame either side, plus a loaded runner's slack — and never anywhere near the old 400ms.
      assert.ok(got.ms > want * 0.9 && got.ms < want + 1500,
        `${id}: the tumble took ${Math.round(got.ms)}ms, want about ${Math.round(want)}ms`);
    }
  });

  test(`${engine}: a press made during a Slow tumble does not turn a face until the cube has landed`, async () => {
    const page = await cubePage();
    const got = await page.evaluate(async (slow) => {
      const { buildScript } = await import('/lib/script-view.js');
      const { createStopDriver } = await import('/lib/script-drive.js');
      const el = window.__cube;
      el.setAttribute('tempo-scale', String(slow));
      const built = buildScript({ schema: 2, start: {}, steps: [{ move: 'R' }, { hold: 'D B' }, { move: 'U' }] });
      const walk = createStopDriver(built, { cube: el });
      walk.next();
      // Let the R land before the hold, so the only thing in flight below is the tumble.
      while (el.animating) await new Promise((r) => requestAnimationFrame(r));
      walk.next();
      const tumbled = el.turning;
      walk.next();
      let overlap = 0; let faceAfter = false; const t0 = performance.now();
      while (performance.now() - t0 < 20000) {
        await new Promise((r) => requestAnimationFrame(r));
        if (el.turning && el.animating) overlap++;
        if (!el.turning && el.animating) { faceAfter = true; break; }
      }
      return { tumbled, overlap, faceAfter };
    }, tempoOf('slow'));
    assert.equal(got.tumbled, true, 'precondition: walking into the new hold turned the cube over');
    assert.equal(got.overlap, 0, `a face turned in ${got.overlap} frames while the cube was still going over`);
    assert.equal(got.faceAfter, true, 'the press was lost: no face turned after the tumble landed');
  });

  test(`${engine}: a superseded turn settles false and never leaves \`turning\` standing`, async () => {
    // Plan §5's open question for 1.2: a walk waits while `turning` is true, so a supersede that left it
    // set would stall the walk for ever. Under both motion settings, since 1.3 changed the reduced path.
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const page = await cubePage({ reducedMotion });
      const got = await page.evaluate(async () => {
        const el = window.__cube;
        const first = el.turnTo('D', 'B', { ms: 3000 });
        const during = el.turning;
        const second = el.turnTo('U', 'R', { ms: 300 });
        const settled = await first;
        const landed = await second;
        return { during, settled, landed, after: el.turning };
      });
      assert.equal(got.during, true, `${reducedMotion}: the first turn never started`);
      assert.equal(got.settled, false, `${reducedMotion}: a superseded turn did not resolve false`);
      assert.equal(got.landed, true, `${reducedMotion}: the superseding turn did not land`);
      assert.equal(got.after, false, `${reducedMotion}: \`turning\` stayed true after every turn had settled`);
    }
  });

  test(`${engine}: a centre named as a piece lights that one sticker and nothing else`, async () => {
    // Plan item 2.2 pulses the centre a turn brings to the front as \`piece:<letter>\`. The parser accepts a
    // one-letter piece; this is the renderer agreeing about what it names.
    const page = await cubePage({ reducedMotion: 'reduce' });
    for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
      const lit = await page.evaluate(async (f) => {
        window.__cube.setAttribute('highlight', `piece:${f}`);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return window.__cube.cubies.flatMap((cu) => cu.children
          .filter((m) => m.userData?.face && !m.userData.n && m.material.emissiveIntensity > 0)
          .map((m) => m.userData.face));
      }, face);
      assert.deepEqual(lit, [face], `piece:${face} lit ${JSON.stringify(lit)}`);
    }
  });

  /**
   * The duration the renderer SCHEDULED for a face quarter turn and for a hold quarter turn, read the instant
   * each starts. An equality is a claim about the rule, and wall-clock time is the wrong instrument for it:
   * with eight browser suites running at once Chromium's frames came late enough to make a 950ms turn read
   * as 1,873ms. The rule is what is asserted here; that a turn really TAKES its time is the Slow/Fast case.
   */
  const scheduled = async (page, tempo) => {
    // TWO cubes per page, built once and re-used, and only measured once their scenes exist. Fresh elements
    // on every call cost two WebGL contexts each, WebKit caps them per document, and an element whose scene
    // was never built schedules nothing — which reads exactly like a renderer that does not time its turns.
    await page.evaluate(() => {
      if (window.__pair) return;
      const make = () => {
        const el = document.createElement('cubus-cube');
        el.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:90px';
        document.body.appendChild(el);
        return el;
      };
      window.__pair = [make(), make()];
    });
    await page.waitForFunction(() => window.__pair.every((el) => (el.stickers?.length ?? 0) > 0));
    return page.evaluate((t) => {
      const [a, b] = window.__pair;
      for (const el of [a, b]) { el.setAttribute('tempo-scale', t); el.turnTo('U', 'F', { ms: 0 }); }
      a.setAttribute('alg', 'R'); a.step();
      b.turnTo('U', 'R', { pace: 'tempo' });
      const out = { face: a._anim?.dur ?? null, hold: b._turning?.ms ?? null };
      a.setAttribute('alg', ''); b.turnTo('U', 'F', { ms: 0 });
      return out;
    }, tempo);
  };

  test(`${engine}: a hold quarter turn is scheduled for exactly what a face quarter turn is, under both motion settings`, async () => {
    // Audit 2026-10-14: the app kept its own copy of the renderer's timing rule, and the two already
    // disagreed about a tempo of 0; then the reduced-motion cap was written out twice inside the renderer.
    // One rule for each now (`_quarterMs`, `_motionMs`); this reads that they are one.
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const page = await cubePage({ reducedMotion });
      const got = await scheduled(page, String(tempoOf('fast')));
      assert.ok(got.face > 0 && got.hold > 0, `${reducedMotion}: a turn was not scheduled — ${JSON.stringify(got)}`);
      assert.equal(got.hold, got.face, `${reducedMotion}: a hold quarter is ${got.hold}ms, a face quarter ${got.face}ms`);
      if (reducedMotion === 'reduce') assert.equal(got.hold, 120, 'reduced motion did not cap the turn at 120ms a quarter');
    }
  });

  test(`${engine}: a tempo of 0, below 0 or empty schedules a hold turn as it schedules a face turn`, async () => {
    // Audit 2026-10-14, finding 2: the app's copy of the rule read these as the bare default while the
    // renderer clamped them to its floor.
    const page = await cubePage();
    for (const tempo of ['0', '-1', '']) {
      const got = await scheduled(page, tempo);
      assert.ok(got.face > 0, `tempo "${tempo}": no face turn was scheduled`);
      assert.equal(got.hold, got.face, `tempo "${tempo}": a hold quarter is ${got.hold}ms, a face quarter ${got.face}ms`);
    }
  });

  test(`${engine}: the pace is measured from where the cube IS, not where it was last asked to go`, async () => {
    // Audit 2026-10-14: a duration worked out from the last REQUESTED hold made a turn the cube barely
    // had to make take a whole tumble's time, holding every move behind it.
    const page = await cubePage();
    const ms = await page.evaluate(async (slow) => {
      const el = window.__cube;
      el.setAttribute('tempo-scale', String(slow));
      el.turnTo('D', 'B', { pace: 'tempo' });          // 7.6s at Slow
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const t0 = performance.now();
      await el.turnTo('U', 'F', { pace: 'tempo' });    // turned back almost at once: nearest is still U F
      return performance.now() - t0;
    }, tempoOf('slow'));
    assert.ok(ms < 500, `turning back from just past the start took ${Math.round(ms)}ms`);
  });

  test(`${engine}: a duration that is not a number settles at once under BOTH motion settings`, async () => {
    // Audit 2026-10-14: the reduced-motion cut ran before the check, so Infinity became 240ms of motion there.
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const page = await cubePage({ reducedMotion });
      const got = await page.evaluate(async () => {
        const el = window.__cube;
        const p = el.turnTo('D', 'B', { ms: Infinity });
        return { turning: el.turning, done: await p };
      });
      assert.deepEqual(got, { turning: false, done: true }, `${reducedMotion}: a non-finite duration animated`);
    }
  });

  test(`${engine}: under reduced motion the tumble is shortened, not snapped`, async () => {
    const page = await cubePage({ reducedMotion: 'reduce' });
    const got = await timedTumble(page, tempoOf('normal'));
    const unreduced = 2 * QUARTER_AT(tempoOf('normal'));
    assert.equal(got.started, true, 'the tumble snapped: the cube was never turning');
    assert.ok(got.ms < unreduced / 4, `the reduced tumble took ${Math.round(got.ms)}ms of ${Math.round(unreduced)}ms`);
  });
}
