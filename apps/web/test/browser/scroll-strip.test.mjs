// The one-line target strip's three duties (lib/scroll-strip.js), each where it could fail: the
// chosen button in view on mount, the edges marked when there is more beyond them, and a vertical
// mouse wheel moving the strip sideways — without swallowing the wheel once the strip cannot move.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { decodePng } from '../png.mjs';
import { startBrowserFixture } from './harness.mjs';

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
});

after(async () => { await fixture?.close(); });

/** A strip `width` px wide with `count` buttons, the one at `chosen` marked on, helper attached. */
const strip = (width, count, chosen) => page.evaluate(async ({ w, n, on }) => {
  const { oneLineStrip } = await import('/lib/scroll-strip.js');
  document.querySelector('#strip-under-test')?.remove();
  window.__stripAbort?.abort();
  const row = document.createElement('div');
  row.id = 'strip-under-test';
  row.className = 'stage-row one-line';
  row.style.cssText = `position:fixed;left:0;top:0;width:${w}px;box-sizing:border-box;background:#fff;z-index:99999`;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button');
    b.className = `pill${i === on ? ' on' : ''}`;
    b.textContent = `target number ${i}`;
    row.appendChild(b);
  }
  document.body.appendChild(row);
  window.__stripAbort = new AbortController();
  oneLineStrip(row, { signal: window.__stripAbort.signal });
}, { w: width, n: count, on: chosen });

const read = () => page.evaluate(() => {
  const row = document.querySelector('#strip-under-test');
  const box = row.getBoundingClientRect();
  const on = row.querySelector('.on')?.getBoundingClientRect();
  return {
    scrollLeft: row.scrollLeft, max: row.scrollWidth - row.clientWidth,
    onInside: on ? on.left >= box.left + 17 && on.right <= box.right - 17 : null,
    left: row.classList.contains('more-left'), right: row.classList.contains('more-right'),
    mask: getComputedStyle(row).maskImage,
    lines: new Set([...row.children].map((b) => Math.round(b.getBoundingClientRect().top) + 0)).size,
  };
});

/** Dispatch a wheel over the strip; report whether the strip took it. */
const wheel = (deltaY, deltaX = 0) => page.evaluate(({ dy, dx }) => {
  const row = document.querySelector('#strip-under-test');
  const e = new WheelEvent('wheel', { deltaY: dy, deltaX: dx, bubbles: true, cancelable: true });
  row.dispatchEvent(e);
  return e.defaultPrevented;
}, { dy: deltaY, dx: deltaX });

test('a strip too narrow for its buttons stays one line, with the chosen last button in view', async () => {
  await strip(300, 6, 5);
  const s = await read();
  assert.equal(s.lines, 1, 'the buttons wrapped');
  assert.ok(s.max > 100, `precondition: the strip overflows (${s.max}px)`);
  assert.equal(s.onInside, true, 'the chosen button is not in view on mount');
  assert.deepEqual([s.left, s.right], [true, false], 'scrolled to its end: more on the left only');
  assert.match(s.mask, /gradient/, 'an edge is marked but nothing fades it');
});

test('a vertical wheel scrolls the strip sideways, and hands the wheel back at the end', async () => {
  await strip(300, 6, 0);
  let s = await read();
  assert.deepEqual([s.scrollLeft, s.left, s.right], [0, false, true], 'precondition: at the start, more on the right');
  assert.equal(await wheel(120), true, 'the strip did not take a wheel it could move by');
  s = await read();
  assert.ok(s.scrollLeft > 0, 'the wheel did not move the strip');
  assert.deepEqual([s.left, s.right], [true, true], 'part-way along, both edges have more');
  for (let i = 0; i < 40; i++) await wheel(120);
  s = await read();
  assert.ok(Math.abs(s.scrollLeft - s.max) <= 1, 'many wheels did not reach the end');
  assert.equal(await wheel(120), false, 'at the end the strip still swallowed the wheel');
  assert.equal(await wheel(0, 50), false, 'a sideways gesture is the browser\'s to scroll, not the handler\'s');
});

test('a strip that fits marks nothing and leaves the wheel alone', async () => {
  await strip(1400, 3, 1);
  const s = await read();
  assert.equal(s.max, 0, 'precondition: nothing to scroll');
  assert.deepEqual([s.left, s.right], [false, false]);
  assert.equal(s.mask, 'none', 'a strip with nothing beyond its edges is masked anyway');
  assert.equal(await wheel(120), false);
});

test('a strip made wide enough by a resize stops marking its edges', async () => {
  await strip(300, 6, 0);
  assert.deepEqual([(await read()).left, (await read()).right], [false, true], 'precondition: more on the right');
  await page.evaluate(() => {
    document.querySelector('#strip-under-test').style.width = '1400px';
    window.dispatchEvent(new Event('resize'));
  });
  const s = await read();
  assert.equal(s.max, 0, 'precondition: the wider strip fits');
  assert.deepEqual([s.left, s.right], [false, false], 'a resize left a mark on an edge with nothing beyond it');
});

// A scroller clips at its padding edge, and a focus ring is drawn outside the button, so the
// strip's padding is all that keeps a keyboard user's ring whole. The same strip with nothing
// clipped is the reference: a side where the clipped one draws less ring has too little padding.
test('a focused button keeps its whole focus ring inside the strip', async () => {
  await strip(600, 3, 0);
  const reach = async (overflow) => {
    const box = await page.evaluate((o) => {
      const row = document.querySelector('#strip-under-test');
      row.style.top = '100px'; row.style.left = '40px'; row.style.overflow = o;
      document.activeElement?.blur?.();
      const r = row.querySelector('button').getBoundingClientRect();
      return { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.width), h: Math.ceil(r.height) };
    }, overflow);
    const pad = 10;
    const clip = { x: box.x - pad, y: box.y - pad, width: box.w + 2 * pad, height: box.h + 2 * pad };
    const plain = decodePng(await page.screenshot({ clip }));
    await page.keyboard.press('Shift'); // a key first, so a scripted focus counts as :focus-visible
    await page.evaluate(() => document.querySelector('#strip-under-test button').focus());
    const focused = decodePng(await page.screenshot({ clip }));
    let top = Infinity; let bottom = -Infinity; let left = Infinity; let right = -Infinity;
    for (let y = 0; y < focused.height; y++) {
      for (let x = 0; x < focused.width; x++) {
        const i = (y * focused.width + x) * 4;
        let d = 0;
        for (let k = 0; k < 3; k++) d += Math.abs(focused.rgba[i + k] - plain.rgba[i + k]);
        if (d > 6) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
      }
    }
    await page.evaluate(() => document.activeElement.blur());
    return { above: pad - top, below: bottom - (pad + box.h - 1), left: pad - left, right: right - (pad + box.w - 1) };
  };
  const unclipped = await reach('visible');
  assert.ok(unclipped.above > 0 && unclipped.below > 0, `precondition: a ring is drawn outside the button (${JSON.stringify(unclipped)})`);
  assert.deepEqual(await reach(''), unclipped, 'the strip cut the focused button\'s ring');
});

test('its listeners go with the screen', async () => {
  await strip(300, 6, 0);
  await page.evaluate(() => window.__stripAbort.abort());
  assert.equal(await wheel(120), false, 'an aborted strip still handled the wheel');
  assert.equal((await read()).scrollLeft, 0);
});
