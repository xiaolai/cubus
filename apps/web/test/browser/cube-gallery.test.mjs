// Many cubes on one page — plan item 4.6 of dev-docs/tutorial-capability-plan.md.
//
// The decision in `lib/cube-gallery.js` rests on one number, so the number is measured here, in both engines,
// on every run: how many live WebGL contexts a page keeps before the browser starts losing the oldest. If a
// browser raises its cap the budget can rise with it; if one lowers it, this fails before a gallery goes dark.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { CONTEXT_CAP, LIVE_BUDGET, flatGallery, galleryKind } from '../../lib/cube-gallery.js';
import { FULL_OLL, FULL_PLL } from '../../lib/data/case-tables.js';
import { LAUNCH } from './appearance-goldens.mjs';
import { startBrowserFixture } from './harness.mjs';

const fixtures = {};

before(async () => {
  fixtures.webkit = await startBrowserFixture();
  fixtures.chromium = await startBrowserFixture({ engine: 'chromium', launch: LAUNCH });
});

after(async () => { for (const f of Object.values(fixtures)) await f?.close(); });

/** Live contexts left after asking a page for forty. */
const liveContexts = async (fixture) => {
  const page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  const live = await page.evaluate(async () => {
    const contexts = [];
    for (let i = 0; i < 40; i++) {
      const c = document.createElement('canvas');
      document.body.appendChild(c);
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) break;
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      contexts.push(gl);
      await new Promise((r) => setTimeout(r, 5));
    }
    return contexts.filter((gl) => !gl.isContextLost()).length;
  });
  await page.close();
  return live;
};

test('a page keeps sixteen live WebGL contexts in both engines, and the live budget is under that', async () => {
  for (const [engine, fixture] of Object.entries(fixtures)) {
    assert.equal(await liveContexts(fixture), CONTEXT_CAP, `${engine} keeps a different number of contexts than the gallery assumes`);
  }
  assert.ok(LIVE_BUDGET < CONTEXT_CAP - 1, 'the budget leaves no room for the app\'s own parked cube');
});

test('the corpus\'s galleries are flat, and a small set of cases is live cubes', () => {
  assert.equal(galleryKind(FULL_OLL.length), 'flat');
  assert.equal(galleryKind(FULL_PLL.length), 'flat');
  assert.equal(galleryKind(4), 'cubes');
  assert.equal(galleryKind(LIVE_BUDGET), 'cubes');
  assert.equal(galleryKind(LIVE_BUDGET + 1), 'flat');
  assert.throws(() => galleryKind(4, { budget: CONTEXT_CAP }), /under the 16 live contexts/);
});

test('fifty-seven OLL cases on one page: every diagram drawn, and not one WebGL context', async () => {
  const page = await fixtures.webkit.browser.newPage();
  await page.goto(`${fixtures.webkit.base}/index.html`);
  const gallery = flatGallery(FULL_OLL);
  const drawn = await page.evaluate((items) => {
    const host = document.createElement('div');
    host.innerHTML = items.map((g) => `<figure data-case="${g.name}">${g.svg}</figure>`).join('');
    document.body.appendChild(host);
    const canvases = [...host.querySelectorAll('canvas')].length;
    const figures = [...host.querySelectorAll('figure')].map((f) => ({
      name: f.dataset.case, stickers: f.querySelectorAll('rect').length, width: f.querySelector('svg').getBoundingClientRect().width,
    }));
    return { canvases, figures };
  }, gallery);
  await page.close();
  assert.equal(drawn.canvases, 0);
  assert.equal(drawn.figures.length, 57);
  assert.ok(drawn.figures.every((f) => f.stickers === 9 && f.width > 70), 'a case diagram did not lay out');
  // An OLL case is the orientation of all eight last-layer pieces, so with its ring every one of the 57 is a
  // different picture — compared on the stickers alone, since each diagram's title is its case's name.
  const stickersOnly = (svg) => svg.replace(/aria-label="[^"]*"/, '');
  const ringed = flatGallery(FULL_OLL, { ring: true });
  assert.equal(new Set(ringed.map((g) => stickersOnly(g.svg))).size, 57, 'two different OLL cases drew the same diagram');
  const pll = flatGallery(FULL_PLL, { mode: 'colours', ring: true });
  assert.ok(pll.every((g) => (g.svg.match(/<rect /g) ?? []).length === 21), 'a PLL diagram is missing its ring');
});
