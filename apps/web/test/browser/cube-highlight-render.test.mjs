// The highlight and focus channels where they actually run — real WebGL, read back off the canvas.
//
// cube-highlight.test.mjs proves WHICH pieces a selector names. Nothing there can prove what the
// renderer then puts on screen, and that half has traps a pure test cannot reach:
//
//   - the rounded cubie body uses ONE material shared by all 26 cubies, so lighting a cubie by
//     walking its children lights the whole cube unless the body is skipped by name;
//   - the pulse is a function of time, so a naive single reading is a coin flip — at the trough of
//     the breath a correctly highlighted piece reads as dark.
//
// EVERY ASSERTION HERE IS ON PIXELS (dev-docs/renderer-v2-plan.md §3c). This file used to read the
// materials — `emissiveIntensity`, `color`, `opacity` — which say what the renderer MEANT to draw
// and pass when the value is set and the pixels are wrong. Now a sticker is lit when it draws
// brighter than it does with the highlight cleared, out of focus when focus changes its pixels,
// and so on, each compared with another render on the same machine and view. sampling.mjs reads
// the canvas; two opposite eyes between them show every sticker once.
//
// The second trap is handled by running most assertions under `prefers-reduced-motion: reduce`,
// where the highlight is deliberately frozen at full strength, and by testing the motion itself
// separately in a page that has it.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startBrowserFixture } from './harness.mjs';
import { channelDelta, installSampler, luminance } from './sampling.mjs';

let fixture;
/** One page per motion preference, shared by every test in this file. */
const PAGES = {};

/** Solved facelets, in URFDLB order — the string the renderer paints from. */
const SOLVED = ['U', 'R', 'F', 'D', 'L', 'B'].map((c) => c.repeat(9)).join('');

/** A sticker is LIT when it draws this much brighter than at rest. The highlight at full strength
 *  adds 38% of the sticker's own colour; the darkest palette colour gains well over 20. */
const LIT = 8;
/** A sticker is CHANGED when any channel moved by more than this. Same machine, same view: an
 *  unchanged sticker reads back identically, so this only has to clear rounding. */
const CHANGED = 2;

before(async () => {
  fixture = await startBrowserFixture();
  // TWO pages for the whole file, one per motion preference — not one per test.
  //
  // Each page load is the entire SPA (onnxruntime and all), and ten of them made this file run
  // long enough to still be holding a WebKit process and a server when scanner-gpu and
  // solve-worker-browser started. Under `--test-concurrency=6` that pushed those suites past their
  // own startup budgets: 14 failures, none of them assertions, none of them reproducible when the
  // suites were run alone. Raising their timeouts would have hidden the load rather than removed it.
  for (const motion of ['reduce', 'no-preference']) {
    const page = await fixture.browser.newPage({ reducedMotion: motion });
    const warnings = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    await page.goto(`${fixture.base}/index.html`);
    await page.waitForFunction(() => !!customElements.get('cubus-cube'));
    await page.evaluate(installSampler);
    PAGES[motion] = { page, warnings, motion };
  }
});

after(async () => { await fixture?.close(); });

/**
 * A fresh <cubus-cube> on the shared page for `reducedMotion`, with the warning buffer cleared.
 *
 * The old element is disposed before it is dropped. Building one costs a WebGL context, and WebKit
 * caps how many a document may hold — replacing ten without disposing would trade a timeout problem
 * for a context-exhaustion one.
 */
async function cubePage({ reducedMotion = 'reduce', ghosts = 'none', facelets = SOLVED } = {}) {
  const ctx = PAGES[reducedMotion];
  // Reset any per-test emulateMedia override (the mid-pulse test flips this page's preference).
  await ctx.page.emulateMedia({ reducedMotion: ctx.motion });
  ctx.warnings.length = 0;
  await ctx.page.evaluate(async ({ facelets: fl, ghosts: g }) => {
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove(); }
    const el = document.createElement('cubus-cube');
    el.style.cssText = 'position:fixed;left:0;top:0;width:220px;height:220px;z-index:99999';
    // `scramble` is only applied when there is no valid facelets string, so a test that needs the
    // scramble path asks for facelets:null rather than fighting the precedence.
    if (fl) el.setAttribute('facelets', fl);
    el.setAttribute('ghosts', g);
    document.body.appendChild(el);
    window.__cube = el;
    await new Promise((r) => requestAnimationFrame(() => r()));
  }, { facelets, ghosts });
  return { page: ctx.page, warnings: ctx.warnings };
}

/**
 * Positions of the cubies with at least one sticker that draws brighter than it does with the
 * highlight cleared, sorted for comparison. The highlight is put back exactly as it was: the
 * attribute is restored, which re-reads and re-resolves it.
 */
const litPositions = (page) => page.evaluate(({ lit }) => {
  const el = window.__cube;
  const spec = el.getAttribute('highlight');
  const shown = window.__appearance.stickers(el);
  el.setAttribute('highlight', 'none');
  const rest = window.__appearance.stickers(el);
  if (spec === null) el.removeAttribute('highlight'); else el.setAttribute('highlight', spec);
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const cubies = new Set(Object.keys(shown).filter((k) => lum(shown[k]) - lum(rest[k]) > lit).map((k) => Number(k.split(':')[0])));
  return [...cubies].map((i) => {
    const c = el.cubies[i];
    return [c.position.x, c.position.y, c.position.z].map(Math.round).join(',');
  }).sort();
}, { lit: LIT });

const setHighlight = (page, spec) => page.evaluate((s) => {
  window.__cube.setAttribute('highlight', s);
}, spec);

test('every sticker is sampled once, so a head count means the whole cube', async () => {
  // The instrument's own precondition. Two opposite eyes are meant to show all 54 stickers; a view
  // that missed some would make "lit on the real cube" silently mean "lit on the part in view".
  const { page } = await cubePage();
  const seen = await page.evaluate(() => Object.keys(window.__appearance.stickers()).length);
  assert.equal(seen, 54, 'the two views do not show every sticker');
});

test('six centres, twelve edges, eight corners — lit on the real cube', async () => {
  const { page } = await cubePage();
  for (const [spec, count] of [['centers', 6], ['edges', 12], ['corners', 8]]) {
    await setHighlight(page, spec);
    assert.equal((await litPositions(page)).length, count, spec);
  }
  // The narration line this whole channel exists for, as one union.
  await setHighlight(page, 'centers,edges,corners');
  assert.equal((await litPositions(page)).length, 26);
});

const setFocus = (page, spec) => page.evaluate((v) => {
  if (v === null) window.__cube.removeAttribute('focus');
  else window.__cube.setAttribute('focus', v);
}, spec);

/** Every sticker's drawn colour, keyed `cubie:face`. */
const stickers = (page) => page.evaluate(() => window.__appearance.stickers());

/** The keys whose drawn colour differs between two readings. */
const changed = (a, b) => Object.keys(a).filter((k) => channelDelta(a[k], b[k]) > CHANGED);

test('focus greys everything it does not name, and restores exactly', async () => {
  const { page } = await cubePage();
  const before = await stickers(page);
  assert.equal(Object.keys(before).length, 54, 'a cube has 54 stickers');

  await setFocus(page, 'centers');
  const during = await stickers(page);
  const greyed = changed(before, during);
  assert.equal(greyed.length, 48, 'focus on the centres must change every sticker but the six centres');
  const kept = Object.keys(before).filter((k) => !greyed.includes(k));
  const centreCubies = await page.evaluate(() => window.__cube.cubies
    .map((c, i) => (Math.abs(Math.round(c.position.x)) + Math.abs(Math.round(c.position.y)) + Math.abs(Math.round(c.position.z)) === 1 ? i : -1))
    .filter((i) => i >= 0));
  assert.deepEqual(kept.map((k) => Number(k.split(':')[0])).sort((x, y) => x - y), centreCubies.sort((x, y) => x - y),
    'the stickers left as they were are exactly the centres');
  // And greyed means drawn with less colour, not merely drawn differently.
  const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
  assert.ok(greyed.every((k) => chroma(during[k]) < chroma(before[k]) || chroma(before[k]) < 12),
    'a sticker out of focus kept its colour');

  // Restoring must return the ORIGINAL pixels, not merely un-grey them: focus writes colour, and
  // _paint() rewrites the true colour first, so a second application must not compound.
  await setFocus(page, null);
  assert.deepEqual(changed(before, await stickers(page)), [], 'removing focus restores every sticker');

  await setFocus(page, 'centers');
  const twice = await stickers(page);
  await setFocus(page, null);
  await setFocus(page, 'centers');
  assert.deepEqual(changed(twice, await stickers(page)), [], 'applying focus twice equals applying it once');
});

test('focus is per-sticker: same colour, opposite treatment', async () => {
  // THE assertion for this channel. It writes sticker COLOUR, so if any two stickers shared a
  // material, greying one would grey the other — the bodyMat trap, which is real on this element
  // (one material for all 26 cubie bodies) and caught the highlight channel once already.
  // Naming one U-layer piece puts U-face stickers on BOTH sides of the divide at the same time.
  const { page } = await cubePage();
  const before = await stickers(page);
  await setFocus(page, 'piece:UF');
  const during = await stickers(page);
  const u = Object.keys(before).filter((k) => k.endsWith(':U'));
  const greyed = changed(before, during).filter((k) => k.endsWith(':U'));
  const kept = u.filter((k) => !greyed.includes(k));
  assert.equal(u.length, 9, 'all nine U-face stickers sampled');
  assert.equal(kept.length, 1, 'the named piece keeps its U sticker as it was');
  assert.equal(greyed.length, 8, 'the other eight U stickers are greyed');
  assert.ok(greyed.every((k) => channelDelta(during[k], during[kept[0]]) > CHANGED),
    'no greyed sticker draws like the kept one — so no material is shared');
});

test('an invalid focus selector is refused whole, like an invalid highlight', async () => {
  const { page, warnings } = await cubePage();
  const before = await stickers(page);
  warnings.length = 0;
  await setFocus(page, 'centers,nonsense');
  assert.deepEqual(changed(before, await stickers(page)), [], 'a spec with one bad token changes nothing at all');
  assert.ok(warnings.some((w) => /refusing focus/.test(w)), 'and says which selector it refused');
});

test('layer:X lights that face\'s nine cubies and nothing else — all six faces', async () => {
  // Untested until a notation lesson leaned its whole visual argument on it: six `layer:X`
  // highlights, one per face. Three of the six (D, B, L) are invisible from the default camera,
  // so a highlight that lit the wrong slab — or nothing — would read as "that face is hidden"
  // and survive review. The axis check is what makes this an assertion rather than a head count:
  // nine lit cubies could be the wrong nine.
  const { page } = await cubePage();
  const AXIS = { R: [0, 1], L: [0, -1], U: [1, 1], D: [1, -1], F: [2, 1], B: [2, -1] };
  for (const [face, [axis, sign]] of Object.entries(AXIS)) {
    await setHighlight(page, `layer:${face}`);
    const lit = (await litPositions(page)).map((s) => s.split(',').map(Number));
    assert.equal(lit.length, 9, `layer:${face} should light nine cubies`);
    const strays = lit.filter((p) => p[axis] !== sign);
    assert.deepEqual(strays, [], `layer:${face} lit ${strays.length} cubies outside the layer`);
  }
});

test('the shared cubie body is never lit — only the stickers are', async () => {
  // bodyGeo/bodyMat are built ONCE and handed to all 26 cubies. Walking a highlighted cubie's
  // children and lighting anything with an `emissive` would light that one material, and every
  // cubie on the cube with it. Read where it would show: the body between neighbouring stickers,
  // on every face, with the highlight on every corner and with it cleared.
  // The resting reading is taken BEFORE any highlight is set. Clearing a highlight resets the
  // stickers and ghosts it touched, never the body — so a lit body stays lit, and a baseline read
  // after clearing is as lit as the render it is compared with. That baseline let a body lit by
  // every highlight pass this test.
  const { page } = await cubePage();
  const { lit, rest } = await page.evaluate(() => {
    const el = window.__cube;
    const untouched = window.__appearance.bodies(el);
    el.setAttribute('highlight', 'corners');
    return { lit: window.__appearance.bodies(el), rest: untouched };
  });
  // Only between two stickers that are NOT lit: beside a lit sticker, where a face is foreshortened,
  // its glow reaches the sample through the edge's antialiasing — measured at up to 7.9 — while a
  // lit body would brighten every one of these places, not a few.
  const corners = await page.evaluate(() => window.__cube.cubies
    .map((c, i) => (Math.abs(Math.round(c.position.x)) + Math.abs(Math.round(c.position.y)) + Math.abs(Math.round(c.position.z)) === 3 ? i : -1))
    .filter((i) => i >= 0));
  const keys = Object.keys(rest).filter((k) => !k.split(':')[0].split('-').some((i) => corners.includes(Number(i))));
  assert.ok(keys.length >= 24, `precondition: the body is sampled between unlit stickers on every face (${keys.length} places)`);
  const brighter = keys.filter((k) => luminance(lit[k]) - luminance(rest[k]) > 1);
  assert.deepEqual(brighter, [], 'a cubie body drew brighter under the highlight');
});

test('clearing the highlight returns every sticker to rest', async () => {
  const { page } = await cubePage();
  await setHighlight(page, 'edges');
  assert.equal((await litPositions(page)).length, 12);

  await setHighlight(page, 'centers');
  assert.equal((await litPositions(page)).length, 6, 'the previous set must not linger');

  await setHighlight(page, 'none');
  assert.equal((await litPositions(page)).length, 0);

  // Removing the attribute means "back to the default", which is none — not "null", the bug the
  // ghosts attribute already had to be fixed for.
  await setHighlight(page, 'corners');
  await page.evaluate(() => window.__cube.removeAttribute('highlight'));
  assert.equal((await litPositions(page)).length, 0);
});

test('piece: follows the piece through a turn; slot: stays with the position', async () => {
  const { page } = await cubePage();

  // F rotates the z=+1 layer, carrying the UF edge at [0,1,1] round to [1,0,1] — the FR slot.
  await page.evaluate(() => {
    window.__cube.setAttribute('alg', 'F');
    window.__cube.seek(1); // instant, no animation: this is the primitive a scrubber uses
  });

  await setHighlight(page, 'piece:UF');
  assert.deepEqual(await litPositions(page), ['1,0,1'], 'the UF edge travelled to the FR slot');

  await setHighlight(page, 'slot:UF');
  assert.deepEqual(await litPositions(page), ['0,1,1'], 'the UF slot did not move');

  const carried = await page.evaluate(() => window.__cube.cubies
    .find((c) => Math.round(c.position.x) === 0 && Math.round(c.position.y) === 1 && Math.round(c.position.z) === 1)
    .userData.piece);
  assert.notEqual(carried, 'FU', 'a different piece is in the UF slot after F');
});

test('an unread sticker leaves its whole cubie without an identity, and says so', async () => {
  // Facelet 0 is the ULB corner's U sticker. One unread sticker makes the PIECE unknown — naming
  // it by the letters that were read would name a cubie nobody has seen.
  const { page, warnings } = await cubePage();
  await page.evaluate((fl) => { window.__cube.setAttribute('facelets', fl); },
    `?${SOLVED.slice(1)}`);

  const unknown = await page.evaluate(() => window.__cube.cubies.filter((c) => c.userData.piece === null).length);
  assert.equal(unknown, 1);

  await setHighlight(page, 'piece:BLU');
  assert.deepEqual(await litPositions(page), []);
  assert.ok(
    warnings.some((w) => w.includes('highlight matched nothing') && w.includes('piece:BLU')),
    `expected a warning naming the empty selector, got: ${JSON.stringify(warnings)}`,
  );
});

test('an invalid selector is refused loudly and highlights nothing', async () => {
  const { page, warnings } = await cubePage();
  await setHighlight(page, 'edges,slot:UD');
  assert.deepEqual(await litPositions(page), [], 'whole-or-nothing: the valid half must not light');
  assert.ok(
    warnings.some((w) => w.includes('refusing highlight') && w.includes('slot:UD')),
    `expected a warning naming the bad token, got: ${JSON.stringify(warnings)}`,
  );
});

test('ghosts breathe too, in how much of them is drawn rather than in glow', async () => {
  // A ghost is unlit, so the highlight shows on it as opacity rather than glow. Read the ghosts the
  // default view SHOWS, with the corners highlighted and without. Corners, not centres: from the
  // default eye every centre's ghost sits behind the cube, where no pixel of it is drawn.
  const { page } = await cubePage({ ghosts: 'all' });
  const { lit, rest, corners } = await page.evaluate(() => {
    const el = window.__cube;
    el.setAttribute('highlight', 'corners');
    const shown = window.__appearance.ghosts(el);
    el.setAttribute('highlight', 'none');
    const cornerIndex = el.cubies
      .map((c, i) => (Math.abs(Math.round(c.position.x)) + Math.abs(Math.round(c.position.y)) + Math.abs(Math.round(c.position.z)) === 3 ? i : -1))
      .filter((i) => i >= 0);
    return { lit: shown, rest: window.__appearance.ghosts(el), corners: cornerIndex };
  });
  const shown = Object.keys(rest).filter((k) => k in lit);
  const moved = shown.filter((k) => channelDelta(lit[k], rest[k]) > CHANGED).sort();
  const cornerGhosts = shown.filter((k) => corners.includes(Number(k.split(':')[0]))).sort();
  assert.ok(cornerGhosts.length >= 3, `precondition: the view shows corner ghosts (${cornerGhosts.length})`);
  assert.ok(shown.length > cornerGhosts.length, 'precondition: and ghosts of pieces that are not highlighted');
  assert.deepEqual(moved, cornerGhosts, 'exactly the highlighted corners\' ghosts changed');
});

/** The URF corner's U sticker, as the frame on screen shows it — it faces the default eye. */
const cornerLuminance = (page) => page.evaluate(() => {
  const el = window.__cube;
  const i = el.cubies.findIndex((c) => Math.round(c.position.x) === 1 && Math.round(c.position.y) === 1 && Math.round(c.position.z) === 1);
  const rgb = window.__appearance.presented(i, 'U', el);
  return rgb && (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
});

/** That corner's luminance on each of `frames` frames the element draws for itself. */
const cornerOverFrames = (page, frames) => page.evaluate((n) => new Promise((done) => {
  const el = window.__cube;
  const i = el.cubies.findIndex((c) => Math.round(c.position.x) === 1 && Math.round(c.position.y) === 1 && Math.round(c.position.z) === 1);
  const seen = [];
  const tick = () => {
    const rgb = window.__appearance.presented(i, 'U', el);
    seen.push(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
    if (seen.length < n) requestAnimationFrame(tick); else done(seen);
  };
  requestAnimationFrame(tick);
}), frames);

test('the pulse actually moves, and stays inside its band', async () => {
  // The one assertion that needs motion, so it runs in a page that HAS it. Everything above is
  // deliberately frozen; without this test a highlight stuck at full strength would pass them all.
  // The band is read off the screen too: no darker than the sticker at rest, no brighter than the
  // same sticker held at full strength by reduced motion.
  const { page } = await cubePage({ reducedMotion: 'no-preference' });
  const rest = await cornerLuminance(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setHighlight(page, 'corners');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const peak = await cornerLuminance(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const samples = await cornerOverFrames(page, 60);
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  assert.ok(peak - rest > LIT, `precondition: full strength is visibly brighter than rest (${rest} → ${peak})`);
  assert.ok(max - min > 4, `expected the pulse to vary on screen, saw ${min}..${max}`);
  assert.ok(min >= rest - 1 && max <= peak + 1, `the pulse left its band ${rest}..${peak}: ${min}..${max}`);
});

test('reduced motion freezes the highlight at full strength rather than removing it', async () => {
  // The indicator carries meaning — it is how the narration says which piece it means — so the
  // motion goes and the signal stays. Same stance _next() takes on the turn itself.
  const { page } = await cubePage({ reducedMotion: 'reduce' });
  const rest = await cornerLuminance(page);
  await setHighlight(page, 'corners');
  const samples = await cornerOverFrames(page, 30);
  assert.equal(new Set(samples).size, 1, `reduced motion should hold one strength, saw ${[...new Set(samples)].join(', ')}`);
  assert.ok(samples[0] - rest > LIT, `and hold it at full strength, not at rest: ${rest} → ${samples[0]}`);
});

// ---------------------------------------------------------------------------------------------
// Regression: the lifecycle paths an audit found untested (2026-09-06).
//
// The "through a turn" test above seeks BEFORE setting the highlight, so it could never catch a
// stale set. These set the highlight FIRST — the order a lesson actually uses, where the cue is
// spoken and only then does the cube move.
// ---------------------------------------------------------------------------------------------

test('a highlight set BEFORE a seek is re-resolved against where the pieces land', async () => {
  const { page } = await cubePage();
  await setHighlight(page, 'piece:UF');
  assert.deepEqual(await litPositions(page), ['0,1,1'], 'starts at home');

  await page.evaluate(() => { window.__cube.setAttribute('alg', 'F'); window.__cube.seek(1); });
  assert.deepEqual(await litPositions(page), ['1,0,1'], 'seek() must re-resolve, not keep the old set');

  await setHighlight(page, 'slot:UF');
  await page.evaluate(() => window.__cube.seek(0));
  await setHighlight(page, 'slot:UF');
  await page.evaluate(() => window.__cube.seek(1));
  assert.deepEqual(await litPositions(page), ['0,1,1'], 'the slot stays put across a seek');
});

test('a highlight set BEFORE a scramble is re-resolved after it', async () => {
  // reset() paints (and resolves) while every cubie is at home, THEN applies the scramble.
  //
  // This MUST use a positional selector. An identity selector travels for free — the glow lives on
  // the cubie's own materials, so `piece:UF` lands on the right cubie whether or not anything
  // re-resolved. An earlier version of this test used `piece:` and passed against the bug.
  const { page } = await cubePage({ facelets: null });
  await setHighlight(page, 'slot:UF');
  assert.deepEqual(await litPositions(page), ['0,1,1']);

  await page.evaluate(() => window.__cube.setAttribute('scramble', 'F'));
  assert.deepEqual(await litPositions(page), ['0,1,1'],
    'the SLOT must stay lit; with no re-resolve the glow rides the departing cubie to 1,0,1');

  // The complement, pinned deliberately: identity highlights need no re-resolution at all.
  await setHighlight(page, 'piece:UF');
  assert.deepEqual(await litPositions(page), ['1,0,1'], 'the UF piece is where the scramble put it');
});

test('an animated turn re-resolves the highlight when the move completes', async () => {
  // Positional again, for the same reason as the scramble test above.
  const { page } = await cubePage({ reducedMotion: 'no-preference' });
  await setHighlight(page, 'slot:UF');
  await page.evaluate(() => new Promise((done) => {
    const el = window.__cube;
    el.addEventListener('cubus-step', function once() { el.removeEventListener('cubus-step', once); done(); });
    el.setAttribute('alg', 'F');
    el.step();
  }));
  // Read at full strength: a pulse caught near its trough is not an absent highlight.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.deepEqual(await litPositions(page), ['0,1,1'],
    '_completeMove must re-resolve after baking, or the glow leaves the slot with the piece');
});

test('clearing the highlight invalidates a frame, so the glow cannot linger', async () => {
  // One task, no rAF in between: _dirty is read in the same turn it should have been set.
  const { page } = await cubePage();
  const dirty = await page.evaluate(() => {
    const el = window.__cube;
    el.setAttribute('highlight', 'edges');
    el._dirty = false;                     // stand in for "the last frame has been drawn"
    el.setAttribute('highlight', 'none');  // clearing must ask for another one
    return el._dirty;
  });
  assert.equal(dirty, true, 'on a stationary cube nothing else would repaint, so the glow would stay');
});

test('turning reduced motion on mid-pulse snaps the highlight to full strength', async () => {
  // The branch that skipped the update under reduced motion froze the pulse wherever it was — at
  // the trough that is invisible, so the indicator vanished for the users who asked for less
  // motion. The phase is now evaluated every frame and written only when it changes.
  const { page } = await cubePage({ reducedMotion: 'no-preference' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setHighlight(page, 'corners');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const peak = await cornerLuminance(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Wait for a frame that is demonstrably OFF peak before flipping the preference. A fixed sleep
  // could land on the peak by chance, and then the assertion below would hold whether or not the
  // fix was present — the test would pass for the wrong reason.
  const before = await page.evaluate((top) => new Promise((done, fail) => {
    const el = window.__cube;
    const i = el.cubies.findIndex((c) => Math.round(c.position.x) === 1 && Math.round(c.position.y) === 1 && Math.round(c.position.z) === 1);
    let n = 0;
    const tick = () => {
      const rgb = window.__appearance.presented(i, 'U', el);
      const k = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      if (k < top - 8) return done(k);
      if (++n > 180) return fail(new Error(`never left the peak after ${n} frames (last ${k}, peak ${top})`));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), peak);
  assert.ok(before < peak - 8, `expected an off-peak frame before flipping, got ${before} against ${peak}`);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await new Promise((r) => setTimeout(r, 350)); // a handful of frames
  const k = await cornerLuminance(page);
  assert.ok(Math.abs(k - peak) <= 1, `the highlight should jump to peak ${peak}, not freeze at the ${before} it held (${k})`);
});
