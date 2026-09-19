// What the scan screen's twin DRAWS for a confirm ask, asked of the real renderer (2026-09-19).
//
// The ask names a side and the colour to hold on top of it; the twin turns until that side faces the
// viewer with that colour on top (lib/screens/scan/confirm-hold.js, dev-docs/scan-guidance-plan.md
// 2.2). test/confirm-hold.test.mjs checks the arithmetic against a stand-in; this reads back what the
// renderer actually painted — its `orientation` names the faces at the top and the front, and
// `drawnColours()` says what colour each face's centre is drawn in — for every ask a scanner can make,
// under both colour arrangements. The expected colours are the palette's colours for the colours the
// ask NAMED, never a position computed the way the screen computes it, so the two cannot be wrong
// together.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startBrowserFixture } from './harness.mjs';
import { pace } from '../browser-wait.mjs';
// The 24 asks of each arrangement, shared with the arithmetic suite (test/confirm-asks.mjs).
import { FACES, asksUnder } from '../confirm-asks.mjs';
/** The classic palette, by the colour a slot names: white, red, green, yellow, orange, blue. */
const CLASSIC = { U: '#f4f2ec', R: '#c41e3a', F: '#00a651', D: '#f0c000', L: '#ff6c00', B: '#0051ba' };

let fixture;
const pages = [];

/** The scan screen with its scanner silenced, so only the reports this test sends reach the screen. */
async function scanScreen({ reducedMotion }) {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 1012 }, reducedMotion });
  // The suite's shared liveness bounds, not Playwright's 30 s: a saturated CI runner is slow, not
  // broken (../browser-wait.mjs).
  const page = pace(await context.newPage());
  pages.push(context);
  await page.goto(`${fixture.base}/#/scan`);
  await page.waitForFunction(() => document.querySelector('#scanCube > cubus-cube')?.drawnColours?.() != null);
  // Removed, not stopped: a detached panel runs no camera and sends nothing more, and its listeners
  // still hear the reports dispatched on it — which is how the screen hears the real one.
  await page.evaluate(() => { globalThis.__panel = document.querySelector('ai-scan-panel'); globalThis.__panel.remove(); });
  return page;
}

/**
 * Send one report carrying `confirm` (or none) under `scheme`, and wait for the twin's hold to land —
 * sampling, on every frame in between, where a corner cubie actually IS. The hold is written when the
 * turn settles, so waiting for it says the cube ARRIVED; only the poses in between say it travelled,
 * which is what tells an animated turn from a snap (audit, 2026-09-19).
 */
async function ask(page, confirm, scheme, { settle }) {
  return page.evaluate(async ({ confirm, scheme, settle, FACES }) => {
    const twin = document.querySelector('#scanCube > cubus-cube');
    const before = twin.getAttribute('orientation');
    const V3 = twin.camera.position.constructor;
    /** A corner cubie's place in the world, rounded so a pose is comparable. */
    const pose = () => twin.cubies[0].getWorldPosition(new V3()).toArray().map((n) => Number(n.toFixed(3)) + 0).join(',');
    const poses = [pose()];
    globalThis.__panel.dispatchEvent(new CustomEvent('scan-progress', {
      detail: {
        phase: confirm ? 'confirm' : 'scanning', message: 'x', live: null, device: null, complete: false,
        notice: null, suspects: [], runtime: null, scheme, confirm,
        captured: FACES.map((f, i) => ({ face: f, colors: Array(9).fill(i) })), sides: 6,
      },
    }));
    const t0 = performance.now();
    while (performance.now() - t0 < settle) {
      await new Promise((r) => requestAnimationFrame(r));
      poses.push(pose());
      if (twin.getAttribute('orientation') !== before) break;
    }
    const [up, front] = twin.orientation.split(' ');
    const drawn = twin.drawnColours();
    return {
      hold: twin.orientation, top: drawn[up], front: drawn[front],
      longitude: twin.getAttribute('camera-longitude'), ghosts: twin.getAttribute('ghosts'),
      poses: [...new Set(poses)].length, moved: poses[0] !== poses.at(-1),
    };
  }, { confirm, scheme, settle, FACES });
}

before(async () => { fixture = await startBrowserFixture(); });
after(async () => {
  for (const c of pages) await c.close().catch(() => {});
  await fixture?.close();
});

test('for every ask, under both arrangements, the asked colour is drawn facing the viewer and the up colour on top', async () => {
  const page = await scanScreen({ reducedMotion: 'reduce' }); // the renderer lands a turnTo at once
  const wrong = [];
  for (const scheme of ['western', 'japanese']) {
    assert.equal(asksUnder(scheme).length, 24);
    for (const a of asksUnder(scheme)) {
      // Home between asks, so every ask is a turn from the scan's hold — and the home ask (green, white
      // up) is the one case that needs none.
      await ask(page, null, scheme, { settle: 500 });
      const got = await ask(page, a, scheme, { settle: 500 });
      if (got.front !== CLASSIC[a.face] || got.top !== CLASSIC[a.up]) {
        wrong.push(`${scheme} ${a.face}/${a.up}: held ${got.hold}, front ${got.front} (want ${CLASSIC[a.face]}), top ${got.top} (want ${CLASSIC[a.up]})`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test('with motion, the twin plays the turn and lands on the hold — then goes home when the ask is answered', async () => {
  const page = await scanScreen({ reducedMotion: 'no-preference' });
  const got = await ask(page, { face: 'D', up: 'F' }, 'western', { settle: 5000 });
  assert.equal(got.hold, 'F D', 'the animated turn never wrote the hold it landed on');
  // It TURNED: the cube stood in several places between the two holds. A snap to the target would
  // show two (audit, 2026-09-19).
  assert.ok(got.poses > 3, `the turn was snapped, not played: ${got.poses} poses`);
  assert.equal(got.moved, true, 'the cube ended where it started');
  assert.equal(got.front, CLASSIC.D);
  assert.equal(got.top, CLASSIC.F);
  // Seen from the front: from the reading view's corner, two sides face the eye equally.
  assert.deepEqual([got.longitude, got.ghosts], ['0', 'none'], 'the ask was drawn from a corner, where two sides face the viewer');
  const home = await ask(page, null, 'western', { settle: 5000 });
  assert.equal(home.hold, 'U F', 'the ask was answered and the twin stayed turned');
  assert.deepEqual([home.longitude, home.ghosts], ['45', 'floating'], 'the reading view did not come back');
});

test('leaving the scan screen while the sticker view shows: the next screen\'s cube is drawn', async () => {
  // The twin is the page's one parked `<cubus-cube>`, re-used by the next screen. The sticker view
  // once hid it with an attribute, which it carried to Home, where the cube was then not drawn at all
  // (round-3 audit); it gives way through the scan screen's own slot now, which is thrown away.
  const page = await scanScreen({ reducedMotion: 'reduce' });
  const during = await page.evaluate(async () => {
    const { settings } = await import('/lib/app-settings.js');
    settings.devScanView = 'dots';
    const twin = document.querySelector('#scanCube > cubus-cube');
    twin.dataset.scanTwin = 'yes';
    globalThis.__panel.dispatchEvent(new CustomEvent('scan-progress', {
      detail: {
        phase: 'scanning', message: 'x', live: null, device: { deviceId: 'cam', label: 'Webcam' },
        complete: false, notice: null, suspects: [], runtime: null, scheme: null, confirm: null,
        captured: [], sides: 0, settling: null, shownAgain: false,
        seen: {
          width: 640, height: 480,
          stickers: [0.25, 0.5, 0.75].map((x) => ({ x, y: 0.5, w: 0.05, h: 32 / 480, colour: 1, confidence: 0.9, inFace: true })),
        },
      },
    }));
    const view = document.querySelector('#scanCube .scan-seen');
    const box = view.getBoundingClientRect();
    return {
      twin: getComputedStyle(twin).display,
      viewHidden: view.hidden || getComputedStyle(view).display === 'none',
      viewArea: box.width * box.height,
      stickers: view.querySelectorAll('.seen-sticker').length,
    };
  });
  assert.equal(during.twin, 'none', 'the sticker view is drawn and the twin still shows beside it');
  // …and the view that took its place is really there: visible, with size, and with the stickers the
  // report described in it. "The cube is hidden" alone passes when the slot shows nothing at all
  // (audit, 2026-09-19).
  assert.deepEqual([during.viewHidden, during.stickers], [false, 3], 'the sticker view drew nothing in the twin\'s place');
  assert.ok(during.viewArea > 0, 'the sticker view has no size');
  await page.evaluate(() => { location.hash = '#/home'; });
  await page.waitForFunction(() => document.querySelector('#stage cubus-cube')?.drawnColours?.() != null);
  const home = await page.evaluate(() => {
    const cube = document.querySelector('#stage cubus-cube');
    const box = cube.getBoundingClientRect();
    return { reused: cube.dataset.scanTwin === 'yes', hidden: cube.hidden, display: getComputedStyle(cube).display, area: box.width * box.height };
  });
  assert.equal(home.reused, true, 'precondition: Home did not re-use the parked twin, so nothing here was tested');
  assert.equal(home.hidden, false, 'the twin carried the scan screen\'s hiding to Home');
  assert.notEqual(home.display, 'none', 'Home\'s cube is not drawn');
  assert.ok(home.area > 0, 'Home\'s cube has no size');
});
