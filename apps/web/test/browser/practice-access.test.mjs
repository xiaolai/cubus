// Practice's reduced motion, its graphics' contrast and its symbols, in a real WebKit (dev-docs/practice-redesign-plan.md
// §7, WI-9, E14).
//
// Three claims, each held in what must NOT happen:
//   - every graphic that carries meaning — a bead, a ring's segment, the current stage's mark — clears 3:1 on what it is
//     drawn on, in every theme; and a ring's lit stroke is told from its unlit one by WIDTH, since both clear 3:1;
//   - under `prefers-reduced-motion: reduce` nothing animates on the library or the page, and nothing is declared to:
//     no running animation, no declared duration over 0.001 ms, and no shake on a turn marked off — while WITHOUT the
//     preference the shake does run, so the check cannot pass by measuring a page where nothing ever moves;
//   - within one screen's body no symbol does two jobs: no icon is drawn by two controls with different names. Keyed on
//     the CONTROL, so one control whose name changes with its state is one control; the tab row is left out, because a
//     tab's icon names a screen, not an action.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { ORIENTATIONS } from '../../lib/cube-orientation.js';
import { toFacelets } from '../../lib/cube-pieces.js';
import { lcg } from '../fixtures/seeded-scrambles.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';
import { cameraSettled } from './fake-scan.mjs';
import {
  AXIS, PAST_WINDOW_MS, axesNear, feedRep, mixStage, openPractice, randomStart, reportsPerToken, settle, show, stageToMix, toLibrary,
} from './practice-page.mjs';

let fixture;
before(async () => { fixture = await startBrowserFixture(); });
after(async () => { await fixture?.close(); });

const SUNE = "R U R' U R U2 R'";
const THEMES = ['white', 'cream', 'night'];

/** The page, `theme` set as Settings sets it, and transitions held still so a colour is read as it stands. */
const inTheme = (page, theme) => page.evaluate((th) => {
  document.documentElement.setAttribute('data-theme', th);
  if (!document.querySelector('#still-for-reading')) {
    const still = document.createElement('style');
    still.id = 'still-for-reading';
    still.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.append(still);
  }
  getComputedStyle(document.documentElement).color;
}, theme);

/**
 * In the page: each graphic named by `sels`, the colour it is drawn in (`prop` of its computed style) against the colour
 * of what is behind it — the first opaque background among its ancestors, the semi-transparent ones laid over it — and
 * its stroke's width where it has one. Self-contained.
 */
const graphics = (sels) => {
  const parse = (s) => {
    const n = (s.match(/[\d.]+/g) ?? []).map(Number);
    if (/^color\(srgb/.test(s)) return { r: n[0] * 255, g: n[1] * 255, b: n[2] * 255, a: n.length > 3 ? n[3] : 1 };
    return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
  };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const behind = (el) => {
    const layers = [];
    for (let x = el.parentElement; x; x = x.parentElement) {
      const c = parse(getComputedStyle(x).backgroundColor);
      if (c.a > 0) layers.push(c);
      if (c.a >= 1) break;
    }
    return layers.reduceRight((acc, c) => over(c, acc), { r: 255, g: 255, b: 255, a: 1 });
  };
  return sels.map(([what, sel, prop]) => [...document.querySelectorAll(sel)].slice(0, 3).map((el) => {
    const cs = getComputedStyle(el);
    return { what, ratio: ratio(parse(cs[prop]), behind(el)), width: prop === 'stroke' ? parseFloat(cs.strokeWidth) : null };
  })).flat();
};

test('every graphic that carries meaning clears 3:1 on its ground in every theme, and a ring\'s lit stroke is twice its unlit one', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(919);
    // A tile on the library's first screen — so its ring is there when the page goes back to it — whose algorithm is
    // six turns or more, long enough to carry a pause between two of them.
    await page.waitForSelector('.case-tile[data-alg]', { timeout: LIVENESS_MS });
    const { id, alg } = await page.evaluate(async () => {
      const rows = (await window.__p.rows()).rows;
      const x = [...document.querySelectorAll('.case-tile[data-alg]')].map((t) => t.dataset.alg).find((k) => rows[k].alg.split(' ').length >= 6);
      return { id: x, alg: rows[x]?.alg };
    });
    assert.ok(id, 'precondition: no tile of six turns or more on the library\'s first screen');
    await show(page, id);
    const pageMarks = (sels) => sels.map(([what, sel, prop]) => [what, `#practiceFingers ${sel}`, prop]);
    const onPage = Object.fromEntries(THEMES.map((th) => [th, []]));
    const measurePage = async (sels) => {
      for (const theme of THEMES) {
        await inTheme(page, theme);
        onPage[theme].push(...await page.evaluate(graphics, pageMarks(sels)));
      }
    };
    // A clean rep: a lit bead and the empty ones after it.
    assert.equal((await feedRep(page, randomStart(rnd), reportsPerToken(alg, ORIENTATIONS[0], rnd).flat())).at(-1), 1, 'precondition: a clean rep');
    await settle(page);
    await measurePage([['an empty bead', '.bead:not(.on):not(.paused)', 'borderTopColor'], ['a lit bead', '.bead.on', 'backgroundColor']]);
    // A clean rep with a marked pause: the bead it would have lit, drawn paused.
    const per = reportsPerToken(alg, ORIENTATIONS[0], rnd);
    await page.evaluate(({ f, qs, at }) => { window.__p.facelets(f); qs.forEach((q, i) => window.__p.move(q, i === at ? { dt: 5000 } : {})); },
      { f: toFacelets(randomStart(rnd)), qs: per.flat(), at: per.slice(0, 3).flat().length });
    await settle(page);
    await page.waitForSelector('#practiceFingers .bead.paused', { timeout: LIVENESS_MS });
    await measurePage([['the paused bead', '.bead.paused', 'borderTopColor']]);
    // One more clean rep, so the tile's ring has a segment lit.
    await feedRep(page, randomStart(rnd), reportsPerToken(alg, ORIENTATIONS[0], rnd).flat());
    await settle(page);
    // The library: a ring with one segment lit (the tile's), the empty rings, the counts, the current stage.
    await toLibrary(page);
    await page.waitForSelector(`.case-tile[data-alg="${id}"] .ring .seg.on`, { timeout: LIVENESS_MS });
    const inLibrary = {};
    for (const theme of THEMES) {
      await inTheme(page, theme);
      inLibrary[theme] = await page.evaluate(graphics, [
        ['a ring\'s lit segment', `.case-tile[data-alg="${id}"] .ring .seg.on`, 'stroke'],
        ['a ring\'s unlit segment', '.case-tile .ring .seg:not(.on)', 'stroke'],
        ['a count\'s unlit segment', '.ct .ring .seg:not(.on)', 'stroke'],
        ['the current stage', '.rail-item.on', 'borderTopColor'],
      ]);
    }
    const all = { ...Object.fromEntries(THEMES.map((th) => [th, [...onPage[th], ...inLibrary[th]]])) };
    for (const theme of THEMES) {
      const found = new Set(all[theme].map((g) => g.what));
      for (const what of ['an empty bead', 'a lit bead', 'the paused bead', 'a ring\'s lit segment', 'a ring\'s unlit segment', 'a count\'s unlit segment', 'the current stage']) {
        assert.ok(found.has(what), `precondition, ${theme}: ${what} is not drawn`);
      }
      for (const g of all[theme]) assert.ok(g.ratio >= 3, `${theme}: ${g.what} is ${g.ratio.toFixed(2)}:1 on its ground — a graphic that carries meaning needs 3:1`);
      // Lit and unlit both clear 3:1, so luminance cannot tell them apart: the width must.
      const lit = Math.min(...all[theme].filter((g) => g.what === 'a ring\'s lit segment').map((g) => g.width));
      const unlit = Math.max(...all[theme].filter((g) => /unlit segment/.test(g.what)).map((g) => g.width));
      assert.ok(lit >= 2 * unlit, `${theme}: a ring's lit stroke is ${lit}px against its unlit ${unlit}px — not twice as wide`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

/** In the page: the motion it is running and declares — every running animation, and every element on the active
 *  screen (and an open menu) declaring an animation or a transition longer than 0.001 ms. */
const motionNow = () => {
  const secs = (list) => list.split(',').map((v) => (v.trim().endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v)));
  const running = document.getAnimations().filter((a) => a.playState === 'running' && (a.effect?.getComputedTiming().duration ?? 0) > 0.001)
    .map((a) => `${a.animationName ?? a.transitionProperty} on ${a.effect?.target?.className}`);
  const declared = [];
  for (const el of document.querySelectorAll('.screen.active, .screen.active *, .menu:not([hidden]), .menu:not([hidden]) *')) {
    const cs = getComputedStyle(el);
    const anim = cs.animationName !== 'none' && Math.max(...secs(cs.animationDuration)) > 0.000001;
    const trans = Math.max(...secs(cs.transitionDuration)) > 0.000001;
    if (anim || trans) declared.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(' ').join('.')}: ${anim ? cs.animationName : ''} ${trans ? cs.transitionProperty : ''}`);
  }
  return { running, declared: [...new Set(declared)] };
};

/** A wrong turn on sune, made once the hold is known: the chip that was expected is marked off. Answers the mark's
 *  computed animation and whether an animation started for it. */
async function turnOff(page, rnd) {
  const per = reportsPerToken(SUNE, ORIENTATIONS[0], rnd);
  await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
  await page.evaluate(() => {
    window.__started = [];
    document.addEventListener('animationstart', (e) => window.__started.push(e.animationName), true);
  });
  for (let k = 0; k < per.length - 1; k++) {
    await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, per[k]);
    if ((await page.evaluate(() => window.__p.data())).settled !== 'true' || per[k].length === 0) continue;
    const used = axesNear(per, k + 1);
    const wrong = 'URFDLB'.split('').find((f) => !used.has(AXIS[f]));
    if (!wrong) continue;
    await page.evaluate((q) => window.__p.move(q), wrong);
    await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
    return page.evaluate(() => {
      const chip = document.querySelector('#practiceAlg .chip-m.off');
      return chip && { name: getComputedStyle(chip).animationName, started: [...window.__started] };
    });
  }
  throw new Error('precondition: no settled position with a turn on a free axis');
}

test('under reduced motion nothing on the library or the page animates or is declared to — and without it the off turn does shake', async () => {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const shared = await fixture.browser.newContext({ viewport: { width: 1280, height: 1012 }, reducedMotion });
    const { page, context, errors } = await openPractice(fixture, { context: shared });
    try {
      const rnd = lcg(reducedMotion === 'reduce' ? 41 : 42);
      const library = await page.evaluate(motionNow);
      await show(page, 'sune');
      const off = await turnOff(page, rnd);
      assert.ok(off, 'precondition: no turn was marked off');
      const onPage = await page.evaluate(motionNow);
      if (reducedMotion === 'reduce') {
        assert.equal(off.name, 'none', `the off turn's chip declares the animation ${off.name}`);
        assert.deepEqual(off.started, [], 'an animation started for the off turn');
        assert.deepEqual(library, { running: [], declared: [] }, 'the library moves, or declares that it will');
        assert.deepEqual(onPage, { running: [], declared: [] }, 'the page moves, or declares that it will');
      } else {
        // The control: the same steps with motion allowed DO find the shake, and the controls' easing.
        assert.equal(off.name, 'chip-off-shake');
        assert.deepEqual(off.started, ['chip-off-shake']);
        assert.ok(library.declared.length > 0 && onPage.declared.length > 0, 'with motion allowed nothing was found to declare motion — the check measures nothing');
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

/**
 * In the page: every control in the active screen's BODY that draws one of the app's icons — the tab row is not in it —
 * as `{ icon, name, key }`. The icon is named by matching its drawing against the app's own icon map; the key is the
 * control itself (its id, else its place in the document), so one control whose name changes is one control.
 */
const iconControls = async () => {
  const { icon } = await import('/lib/app-state.js');
  const source = await (await fetch('/lib/app-state.js')).text();
  const names = [...source.split('const P = {')[1].split('\n};')[0].matchAll(/^\s+'?([a-z-]+)'?: '/gm)].map((m) => m[1]);
  const byDrawing = new Map(names.map((n) => { const d = document.createElement('div'); d.innerHTML = icon(n); return [d.firstElementChild.innerHTML, n]; }));
  const all = [...document.querySelectorAll('.screen.active button, .screen.active a, .screen.active [role="button"]')];
  const out = [];
  for (const svg of document.querySelectorAll('.screen.active svg.ic')) {
    const ctl = svg.closest('button, a, [role="button"]');
    if (!ctl) continue;
    const name = ctl.getAttribute('aria-label')?.trim() || ctl.textContent.replace(/\s+/g, ' ').trim() || ctl.getAttribute('title') || '';
    out.push({ icon: byDrawing.get(svg.innerHTML) ?? '?', name, key: ctl.id || `#${all.indexOf(ctl)}` });
  }
  return { names: names.length, controls: out };
};

test('within a screen\'s body no icon is drawn by two controls with different names — every screen, and Practice in every state', async () => {
  const seen = [];
  const take = async (page, where) => {
    const { names, controls } = await page.evaluate(iconControls);
    assert.ok(names > 15, `precondition: the app's icon map read as ${names} icons`);
    assert.deepEqual(controls.filter((c) => c.icon === '?').map((c) => c.name), [], `${where}: an icon drawn that is not the app's`);
    seen.push({ where, controls });
  };
  const context = await fixture.browser.newContext({ viewport: { width: 840, height: 682 } });
  try {
    const page = await context.newPage();
    for (const route of ['home', 'scan', 'scramble', 'timer', 'stats', 'settings', 'shapes']) {
      await page.goto(`${fixture.base}/index.html#/${route}`);
      // The screen asked for, by name. Past the first route this `goto` changes only the hash, a same-document
      // navigation: the screen being left stays `.screen.active` until the route is applied (AGENTS.md §5).
      await page.waitForSelector(`.screen.active[data-screen="${route}"]`, { timeout: LIVENESS_MS });
      await page.waitForLoadState('load');
      await take(page, route);
      // THE SCAN SCREEN AFTER A SIDE HAS BEEN READ, not only fresh (sweep 2026-10-20, G1): a read side's centre becomes
      // "Scan the … side again", which drew the same symbol as "Throw the whole scan away" — and a fresh screen has no
      // read side, so measuring it alone could never see the clash. Fed through the event the scanner emits.
      if (route === 'scan') {
        await cameraSettled(page);
        await page.evaluate(() => document.querySelector('ai-scan-panel').dispatchEvent(new CustomEvent('scan-progress', { detail: {
          phase: 'scanning', message: '', sides: 1, live: null, settling: null, seen: null, shownAgain: false, device: null, confirm: null,
          identity: null, complete: false, suspects: [], notice: null, captured: [{ face: 'U', colors: Array(9).fill(0), by: 'centre' }] } })));
        await page.waitForFunction(() => document.querySelector('.scan-face[data-face="U"] .tgrid > .cell:nth-child(5)')?.dataset.action === 'rescan',
          null, { timeout: LIVENESS_MS });
        await take(page, 'scan, a side read');
      }
    }
  } finally {
    await context.close();
  }
  const { page, context: practice, errors } = await openPractice(fixture);
  try {
    await take(page, 'practice, the library');
    await show(page, 'sune');
    await take(page, 'practice, the page with a cube');
    await page.evaluate(() => window.__p.disconnect());
    await page.waitForSelector('#demoPrev:not([hidden])', { timeout: LIVENESS_MS });
    await take(page, 'practice, the page with no cube');
    const stage = await stageToMix(page);
    await mixStage(page, stage.i);
    await page.waitForSelector('#practiceNext:not([hidden])', { timeout: LIVENESS_MS });
    await take(page, 'practice, mixing with no cube');
    assert.deepEqual(errors, []);
  } finally {
    await practice.close();
  }
  // Preconditions: the controls this relation was written for are in what was measured.
  const keys = new Set(seen.flatMap((s) => s.controls.map((c) => `${s.where}|${c.key}`)));
  for (const k of ['practice, mixing with no cube|demoPrev', 'practice, mixing with no cube|demoNext', 'practice, mixing with no cube|practiceRestart',
    'scan, a side read|scanResetBtn']) {
    assert.ok(keys.has(k), `precondition: ${k} was not measured`);
  }
  const clashes = [];
  for (const { where, controls } of seen) {
    const byIcon = new Map();
    for (const c of controls) {
      if (!byIcon.has(c.icon)) byIcon.set(c.icon, new Map());
      byIcon.get(c.icon).set(c.key, c.name);
    }
    for (const [ic, ctls] of byIcon) {
      const names = new Set(ctls.values());
      if (names.size > 1) clashes.push(`${where}: "${ic}" is drawn by ${[...names].map((n) => `"${n}"`).join(' and ')}`);
    }
  }
  assert.deepEqual(clashes, [], 'one symbol doing two jobs on one screen');
  // MUST NOT, by name, on the scan screen with a side read: the re-read and the throw-away share a symbol (G1).
  const read = seen.find((s) => s.where === 'scan, a side read').controls;
  const rescan = read.find((c) => /^Scan the .* side again$/.test(c.name));
  assert.ok(rescan, 'precondition: no read side offered to scan it again');
  assert.notEqual(read.find((c) => c.key === 'scanResetBtn').icon, rescan.icon, 'throwing the scan away draws the symbol of scanning one side again');
  // MUST NOT, by name: the three controls that shared a symbol before E14 draw none now.
  const practiceControls = seen.filter((s) => s.where.startsWith('practice')).flatMap((s) => s.controls);
  for (const name of ['All algorithms', 'Next algorithm', 'Practise this stage mixed, weakest first']) {
    assert.equal(practiceControls.filter((c) => c.name === name).length, 0, `"${name}" draws an icon`);
  }
});
