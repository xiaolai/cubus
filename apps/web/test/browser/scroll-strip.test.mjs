// The one-line target strip's two duties (lib/scroll-strip.js), each where it could fail: the
// chosen button in view on mount, and the edges marked when there is more beyond them. And what it
// must NOT do: take a vertical mouse wheel and turn it sideways (owner, 2026-10-17).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { decodePng } from '../png.mjs';
import { startBrowserFixture } from './harness.mjs';
import { stripLabelsUnread } from './strip-labels.mjs';

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

test('a vertical wheel is left alone: it neither moves the strip nor is taken from the page', async () => {
  await strip(300, 6, 0);
  const s = await read();
  assert.deepEqual([s.scrollLeft, s.left, s.right], [0, false, true], 'precondition: at the start, more on the right');
  assert.equal(await wheel(120), false, 'the strip took a vertical wheel');
  assert.equal((await read()).scrollLeft, 0, 'a vertical wheel moved the strip sideways');
});

test('scrolling the strip by any other means marks both edges part-way along', async () => {
  await strip(300, 6, 0);
  await page.evaluate(() => {
    const row = document.querySelector('#strip-under-test');
    row.scrollLeft = 40;
    row.dispatchEvent(new Event('scroll'));
  });
  const s = await read();
  assert.deepEqual([s.left, s.right], [true, true], 'part-way along, both edges have more');
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

test('no scroller draws a bar: the strip, and any other element that scrolls', async () => {
  // `scrollbar-width` is NOT inherited. Set on `:root` it hid the page's bar and left the strip's,
  // a grey bar under the pills with a mouse (2026-10-17) — while the stylesheet sweep in
  // design-discipline.test.mjs passed, because it reads the rule's text, not what it reaches.
  await strip(300, 6, 0);
  const widths = await page.evaluate(() => {
    const other = document.createElement('div');
    other.style.cssText = 'overflow:auto;width:50px;height:50px';
    other.innerHTML = '<div style="width:400px;height:400px"></div>';
    document.body.appendChild(other);
    const out = {
      strip: getComputedStyle(document.querySelector('#strip-under-test')).scrollbarWidth,
      other: getComputedStyle(other).scrollbarWidth,
    };
    other.remove();
    return out;
  });
  assert.deepEqual(widths, { strip: 'none', other: 'none' }, 'a scroller draws its own scrollbar');
});

test('its listeners go with the screen', async () => {
  await strip(300, 6, 0);
  await page.evaluate(() => {
    window.__stripAbort.abort();
    const row = document.querySelector('#strip-under-test');
    row.scrollLeft = 40;
    row.dispatchEvent(new Event('scroll'));
  });
  assert.equal((await read()).left, false, 'an aborted strip still marked its edges on scroll');
});

// THE WALK'S STRIP CENTRES ITS TURN (dev-docs/practice-redesign-plan.md §5.7). In portrait the moves are one line
// under the cube, and the turn you are on sits at its centre. Half-width spacers at both ends are what let the
// FIRST and LAST turns reach the centre; `centre` is the scroll that puts them there. Every button is asked,
// the two ends included, because those are the ones a strip without its spacers cannot centre.
test('centre puts a button\'s centre at the strip\'s centre, the first and the last included', async () => {
  await strip(300, 9, -1);
  const off = await page.evaluate(async () => {
    const { oneLineStrip } = await import('/lib/scroll-strip.js');
    const row = document.querySelector('#strip-under-test');
    for (const end of ['prepend', 'append']) {
      const spacer = document.createElement('i');
      spacer.style.cssText = 'flex:none;width:50%';
      row[end](spacer);
    }
    const { centre } = oneLineStrip(row, { signal: window.__stripAbort.signal });
    const box = row.getBoundingClientRect();
    const middle = box.left + row.clientLeft + row.clientWidth / 2;
    return [...row.querySelectorAll('button')].map((b) => {
      centre(b);
      const r = b.getBoundingClientRect();
      return Math.round((r.left + r.width / 2 - middle) * 10) / 10;
    });
  });
  assert.equal(off.length, 9);
  for (const [i, d] of off.entries()) assert.ok(Math.abs(d) <= 2, `button ${i} is ${d}px from the strip's centre`);
});

// THE SAME CALL, DOWN (stage-contract.md, 2026-10-18). In landscape a sectioned lesson's list wraps and is taller than
// any sheet, so it scrolls down, and `centre` keeps the turn you are on at its vertical centre — the one mechanism
// on both axes. And what must NOT happen: a row that CLIPS down (portrait's strip, `overflow-y: hidden`) is never
// scrolled down, because a script can move a box a person cannot.
const wrapped = (overflowY) => page.evaluate(async (oy) => {
  document.querySelector('#wrapped-under-test')?.remove();
  const { oneLineStrip } = await import('/lib/scroll-strip.js');
  const row = document.createElement('div');
  row.id = 'wrapped-under-test';
  row.style.cssText = `width:200px;height:90px;overflow-x:hidden;overflow-y:${oy};display:flex;flex-wrap:wrap;gap:6px;padding:6px 0`;
  for (let i = 0; i < 60; i++) {
    const b = document.createElement('button');
    b.style.cssText = 'flex:none;width:36px;height:36px;padding:0';
    b.textContent = String(i);
    row.appendChild(b);
  }
  document.body.appendChild(row);
  const { centre } = oneLineStrip(row, { signal: new AbortController().signal });
  const box = row.getBoundingClientRect();
  const seen = { top: box.top + row.clientTop, bottom: box.top + row.clientTop + row.clientHeight };
  const middle = (seen.top + seen.bottom) / 2;
  return [...row.querySelectorAll('button')].filter((_, i) => i % 7 === 0 || i === 59).map((b) => {
    centre(b);
    const r = b.getBoundingClientRect();
    return { i: b.textContent, top: row.scrollTop, inside: r.top >= seen.top - 1 && r.bottom <= seen.bottom + 1,
      off: Math.round((r.top + r.height / 2 - middle) * 10) / 10, max: row.scrollHeight - row.clientHeight };
  });
}, overflowY);

test('centre scrolls a list that scrolls down, keeping the button wholly inside what it shows', async () => {
  const at = await wrapped('auto');
  assert.ok(at[0].max > 300, `precondition: the list overflows down (${at[0].max}px)`);
  for (const a of at) assert.ok(a.inside, `button ${a.i} is outside the list's visible box after centre`);
  // Clamped at the two ends; everywhere else at the centre line.
  for (const a of at.filter((x) => x.top > 0 && x.top < x.max)) assert.ok(Math.abs(a.off) <= 2, `button ${a.i} is ${a.off}px from the list's centre`);
});

test('centre never scrolls down a row that clips down', async () => {
  const at = await wrapped('hidden');
  assert.ok(at[0].max > 300, `precondition: the row overflows down (${at[0].max}px)`);
  assert.deepEqual(at.map((a) => a.top), at.map(() => 0), 'a row with overflow-y: hidden was scrolled down');
});

// A SECTION'S LABEL IS TEXT, and text is never drawn where it cannot be read (AGENTS.md §2). The walk's strip labels a
// part by its trigger's name ("Sexy move") or a lesson's stage; scrolled under the edge fade, the label was drawn cut
// mid-word ("ve", WI-5's iPhone 16 screenshot). So at EVERY scroll position: each label is wholly inside the strip's
// unfaded box or wholly outside the strip (strip-labels.mjs); a label sticks to the visible left edge while a chip of
// its section is in view; it never overlaps the next label, and is drawn only while its section is in view.
const LABEL_GAP = 8; // the least room between two drawn labels, as lib/scroll-strip.js keeps it
test('a section label is never drawn half under the fade, and sticks to the visible left edge while its part is in view', async () => {
  const at = await page.evaluate(async ({ gate }) => {
    const unread = (0, eval)(`(${gate})`);
    document.querySelector('#labels-under-test')?.remove();
    const { oneLineStrip } = await import('/lib/scroll-strip.js');
    const host = document.createElement('div');
    host.id = 'labels-under-test';
    host.innerHTML = '<style>:where(#labels-under-test .walk-strip) { --fade-left: 0px; --fade-right: 0px; }</style>';
    const row = document.createElement('div');
    row.className = 'list walk-strip';
    row.style.cssText = 'position:fixed;left:20px;top:200px;width:320px;display:flex;flex-wrap:nowrap;align-items:flex-end;overflow-x:auto;overflow-y:hidden;background:#fff;z-index:99999';
    // A plain run, a trigger, a trigger whose name is wider than its two turns, a plain run, a trigger.
    const parts = [[null, 6], ['Sexy move', 4], ['Sledgehammer, long name', 2], [null, 5], ['Left sledgehammer', 4]];
    const spacer = () => { const i = document.createElement('i'); i.style.cssText = 'flex:none;width:50%'; return i; };
    row.append(spacer());
    let k = 0;
    for (const [name, n] of parts) {
      const sec = document.createElement('div');
      sec.className = 'walk-sec';
      sec.style.cssText = 'flex:none;padding:3px 4px 5px';
      if (name) {
        const l = document.createElement('div');
        l.className = 'sub walk-sec-l';
        l.style.cssText = 'font-size:12px;white-space:nowrap';
        l.textContent = name;
        sec.append(l);
      }
      const chips = document.createElement('div');
      chips.className = 'move-chips';
      chips.style.cssText = 'display:flex;flex-wrap:nowrap;gap:6px';
      for (let i = 0; i < n; i++) {
        const c = document.createElement('span');
        c.className = 'chip-m';
        c.style.cssText = 'flex:none;width:40px;height:40px';
        c.textContent = String(k++);
        chips.append(c);
      }
      sec.append(chips);
      row.append(sec);
    }
    row.append(spacer());
    host.append(row);
    document.body.append(host);
    oneLineStrip(row, { signal: new AbortController().signal });
    const max = row.scrollWidth - row.clientWidth;
    const out = [];
    for (let x = 0; x <= max; x += 3) {
      row.scrollLeft = x;
      row.dispatchEvent(new Event('scroll'));
      const cs = getComputedStyle(row);
      const b = row.getBoundingClientRect();
      const shows = { left: b.left + (Number.parseFloat(cs.getPropertyValue('--fade-left')) || 0), right: b.right - (Number.parseFloat(cs.getPropertyValue('--fade-right')) || 0) };
      const labels = [...row.querySelectorAll('.walk-sec-l')].map((l) => {
        const sec = l.parentElement;
        const sb = sec.getBoundingClientRect();
        const run = sec.querySelector('.move-chips').getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(l);
        const r = range.getBoundingClientRect();
        const style = getComputedStyle(l);
        return { name: l.textContent, natural: sb.left + Number.parseFloat(getComputedStyle(sec).paddingLeft), w: r.width, left: r.left,
          drawn: style.visibility !== 'hidden' && style.display !== 'none', inView: run.right > shows.left && run.left < shows.right };
      });
      out.push({ x, shows, faded: shows.left > b.left || shows.right < b.right, unread: unread(host), labels });
    }
    host.remove();
    return out;
  }, { gate: stripLabelsUnread.toString() });

  assert.ok(at.length > 100, `precondition: the strip scrolls through ${at.length} positions`);
  assert.ok(at.some((p) => p.faded), 'precondition: the strip fades an edge somewhere');
  // THE GATE, at every position.
  for (const p of at) assert.deepEqual(p.unread, [], `at scrollLeft ${p.x}: a label drawn where it cannot be read whole`);
  for (const name of ['Sexy move', 'Sledgehammer, long name', 'Left sledgehammer']) {
    const seen = at.map((p) => ({ x: p.x, shows: p.shows, l: p.labels.find((l) => l.name === name), all: p.labels }));
    // MUST NOT: a label drawn while no chip of its section is in view.
    for (const s of seen) assert.ok(!s.l.drawn || s.l.inView, `${name}: drawn at scrollLeft ${s.x} with none of its turns in view`);
    // It STICKS: past the fade, at the visible left edge, at a position where its own place has gone under it.
    assert.ok(seen.some((s) => s.l.drawn && s.l.natural < s.shows.left - 1 && Math.abs(s.l.left - s.shows.left) <= 1),
      `${name}: never drawn stuck to the visible left edge after its place scrolled under the fade`);
    // Wherever it is drawn, it is at its place or, once that has scrolled under the fade, at the visible left edge.
    for (const s of seen.filter((v) => v.l.drawn)) {
      assert.ok(Math.abs(s.l.left - Math.max(s.l.natural, s.shows.left)) <= 1, `${name}: drawn at ${s.l.left} at scrollLeft ${s.x}, not at ${Math.max(s.l.natural, s.shows.left)}`);
    }
    // It is NOT drawn while a turn of its part is in view only where drawing it there would break the gate: it would
    // run past the visible right edge, or into the next label drawn (which it never overlaps).
    for (const s of seen.filter((v) => v.l.inView && !v.l.drawn)) {
      const pin = Math.max(s.l.natural, s.shows.left);
      const next = s.all.filter((o) => o.drawn && o.natural > s.l.natural).map((o) => o.left);
      const room = Math.min(s.shows.right, ...next.map((n) => n - LABEL_GAP));
      assert.ok(pin + s.l.w > room - 1, `${name}: hidden at scrollLeft ${s.x} while a turn of its part is in view and it fits (${pin}+${s.l.w} <= ${room})`);
    }
  }
});
