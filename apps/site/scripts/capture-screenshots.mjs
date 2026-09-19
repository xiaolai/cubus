// Screenshots of the REAL app for the introduction site — never mockups, never retouched.
//
// The site's pictures are a claim about what the app looks like, so they come from the app: this
// serves apps/web with its own dev server (serve.mjs, the same files every desktop bundle ships)
// and photographs it in headless WebKit, the engine every shipped build is. Each shot is the
// desktop window at one of its two reference shapes (dev-docs/stage-contract.md: 1280×1012 in
// landscape, 900×1252 in portrait, on a 2560×1410 work area), pinned to the macOS chrome with
// `?platform=macos` — the pin the app provides for design review — at 2× so the pictures are as
// crisp as a Retina screen. The traffic lights are the OS's to draw, so their zone is empty here;
// that is the window as the app sees it, and it is not painted in.
//
// The one shot that is not WebKit's is the scan screen: it needs a camera, and headless WebKit
// has none to fake. Chromium can be handed a video file as its camera, so that shot feeds it a
// golden frame — one of the twenty photographs `ml/golden_frames.py` gates the model on — and
// waits for the scanner to read the side it shows. The picture is therefore a real read of a
// real cube, not a lens drawn over a stock photo.
//
// The list of shots is scripts/shots.mjs, shared with site.test.mjs; this file holds only how
// each is driven. Nothing here is a test: `pnpm --filter cubus-site screenshots` is run by hand
// when the app's look changes, and the .webp files it writes are committed. site.test.mjs checks
// that every picture the page names exists and has the size this script produces — so a
// screenshot that was dropped or edited by hand is a failing test rather than a broken image.
//
// Requires the Playwright browsers apps/web already uses:
//   pnpm --filter cubus-web exec playwright install webkit chromium
// and, for the .webp encode, `cwebp` (brew install webp) and `ffmpeg` (for the camera file).

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

import { freePort } from '../../web/test/free-port.mjs';
import { makeCameraFeed } from './camera-feed.mjs';
import { OG, SCALE, SHOTS, WINDOWS } from './shots.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, '../../web');
const SERVE = join(WEB, 'serve.mjs');
const GOLDEN_FRAME = resolve(here, '../../../ml/golden/frames/photo-00.png');

/** Where the pictures go. `--out <dir>` for a look without touching the committed set. */
const OUT = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(here, '../public/screenshots'));

/** One wall-clock bound for every wait; liveness, not a speed claim (see apps/web/test/browser-wait.mjs). */
const WAIT_MS = 90_000;

/** The die is a developer shortcut ("Random-cube die", Settings › Advanced) that loads a random
 *  scrambled cube and its solution — the state a camera scan puts the screen in, without a
 *  camera. Stored before the page runs, because the app reads its settings at module scope. */
const DIE = { devRandCube: true };

/**
 * How each shot is driven into the state worth photographing: what the page must show before
 * the picture is taken, and any setting to store first. Keyed by the shot's name in shots.mjs;
 * a shot listed there with no driver here is a loud failure below, not a blank picture.
 */
const DRIVE = {
  'home-landscape': {
    act: async (page) => {
      await cubeDrawn(page);
      await settle(page);
    },
  },
  // Three moves into the walk, so the picture shows a walk under way: played chips behind, the
  // current move lit, the rest ahead.
  'walk-landscape': { settings: DIE, act: (page) => rollAndStep(page, 3) },
  'walk-portrait-night': { settings: DIE, act: (page) => rollAndStep(page, 2) },
  'scramble-portrait': {
    act: async (page) => {
      await cubeDrawn(page);
      await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0);
      await settle(page);
    },
  },
  'scan-landscape': {
    camera: true,
    act: async (page) => {
      // A side is read when its tile stops being the pending nine-well and takes the colours the
      // scanner saw: the pending tile lights one cell (the centre), so "more than one lit cell in
      // some tile" is a read. Bounded by the shared wait; a scanner that reads nothing fails loud.
      await page.waitForFunction(() => {
        const lit = (tile) => [...tile.querySelectorAll('.cell')]
          .filter((c) => !c.style.backgroundColor.includes('var(')).length;
        return [...document.querySelectorAll('.scan-face .tgrid')].some((t) => lit(t) > 1);
      });
      await settle(page);
    },
  },
};

const cubeDrawn = (page) =>
  page.waitForFunction(() => document.querySelector('#viewCube cubus-cube canvas') !== null);

/**
 * Roll the die, then step `n` moves into the walk — and wait for each TURN TO LAND, not for the
 * click. The renderer animates a move and fires `cubus-step` when it has baked it; a click during
 * the turn queues behind it, so a fixed pause after three clicks photographed a cube mid-twist
 * under a label reading "1 / 20". The event's index is the count of moves applied, which is
 * exactly the thing to wait on.
 */
async function rollAndStep(page, n) {
  await cubeDrawn(page);
  await page.waitForFunction(() => !document.querySelector('#randCube')?.disabled);
  await page.click('#randCube');
  await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0);
  await page.evaluate(() => {
    globalThis.__applied = 0;
    document.querySelector('#viewCube cubus-cube')
      .addEventListener('cubus-step', (ev) => { globalThis.__applied = ev.detail.index; });
  });
  for (let i = 1; i <= n; i++) {
    await page.click('#nextBtn');
    await page.waitForFunction((k) => globalThis.__applied === k, i);
  }
  await settle(page);
}

/** Two painted frames and a beat: the renderer draws on its own animation frame after a mount,
 *  and a screenshot taken on the first is the empty slot. */
async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
}

/** Start serve.mjs on a free port and resolve with its origin; fail with the child's own words. */
async function serveWeb() {
  const port = await freePort();
  const proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolveStart, reject) => {
    let said = '';
    const note = (d) => { said += d.toString(); };
    const t = setTimeout(() => reject(new Error(`serve.mjs did not start within 20s. It said: ${said.trim() || '(nothing)'}`)), 20_000);
    proc.stdout.on('data', (d) => { note(d); if (d.toString().includes(`:${port}`)) { clearTimeout(t); resolveStart(); } });
    proc.stderr.on('data', note);
    proc.on('error', reject);
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => proc.kill('SIGTERM') };
}

/** A golden frame as a looping camera feed, for Chromium's fake video capture. */
function cameraFile(dir) {
  if (!existsSync(GOLDEN_FRAME)) throw new Error(`no golden frame at ${GOLDEN_FRAME}`);
  // The feed is made and checked in one place, which the site's test drives with a stand-in runner
  // (scripts/camera-feed.mjs says why the shape matters).
  return makeCameraFeed(GOLDEN_FRAME, join(dir, 'camera.y4m'), execFileSync);
}

/** Open the app at `shot`'s screen in a fresh context shaped like its window, drive it, and
 *  write a PNG. A page error during the drive fails the shot: a picture of a broken page is
 *  not a picture of the app. */
async function shoot(shot, { base, browser, scratch, scale = SCALE, drive = DRIVE[shot.name] }) {
  if (!drive) throw new Error(`shots.mjs lists "${shot.name}" but capture-screenshots.mjs has no driver for it`);
  const { width, height } = WINDOWS[shot.window];
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: shot.scheme,
    // Chromium asks before opening a camera; WebKit is never asked for one here.
    ...(drive.camera ? { permissions: ['camera'] } : {}),
  });
  if (drive.settings) {
    await context.addInitScript((extra) => {
      const key = 'cubusSettings';
      const cur = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({ ...cur, ...extra }));
    }, drive.settings);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT_MS);
  page.setDefaultNavigationTimeout(WAIT_MS);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/?platform=macos#/${shot.screen}`);
  await drive.act(page);
  const png = join(scratch, `${shot.name}.png`);
  await page.screenshot({ path: png, fullPage: false });
  await context.close();
  if (errors.length) throw new Error(`${shot.name}: the page threw while being photographed:\n  ${errors.join('\n  ')}`);
  return png;
}

/** PNG → WebP. `-q 90` is visually lossless on UI and keeps the 3D cube's gradients clean. */
function encode(png, webp) {
  execFileSync('cwebp', ['-quiet', '-q', '90', '-m', '6', png, '-o', webp]);
  return statSync(webp).size;
}

const kb = (path) => `${(statSync(path).size / 1024).toFixed(0)} KB`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'cubus-site-shots-'));
  const web = await serveWeb();
  let wk;
  let cr;
  try {
    wk = await webkit.launch();
    const y4m = cameraFile(scratch);
    cr = await chromium.launch({
      args: [
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${y4m}`,
        '--use-fake-ui-for-media-stream',
      ],
    });
    for (const shot of SHOTS) {
      const browser = DRIVE[shot.name]?.camera ? cr : wk;
      const png = await shoot(shot, { base: web.base, browser, scratch });
      const webp = join(OUT, `${shot.name}.webp`);
      encode(png, webp);
      const { width, height } = WINDOWS[shot.window];
      console.log(`${shot.name}.webp  ${width * SCALE}×${height * SCALE}  ${kb(webp)}`);
    }
    // The social card: the Home shot again at 1×, kept as the PNG the screenshot call writes.
    const home = SHOTS.find((s) => s.name === 'home-landscape');
    const og = join(OUT, `${OG.name}.png`);
    const png = await shoot({ ...home, name: OG.name, window: OG.window }, { base: web.base, browser: wk, scratch, scale: 1, drive: DRIVE[home.name] });
    execFileSync('cp', [png, og]);
    console.log(`${OG.name}.png  ${WINDOWS[OG.window].width}×${WINDOWS[OG.window].height}  ${kb(og)}`);
    // Anything in OUT this run did not write is a picture the page may still name and nobody can
    // regenerate — say so rather than leave it.
    const made = new Set([...SHOTS.map((s) => `${s.name}.webp`), `${OG.name}.png`]);
    const stale = readdirSync(OUT).filter((f) => !made.has(f));
    if (stale.length) console.warn(`not produced by this run, still in ${OUT}: ${stale.join(', ')}`);
  } finally {
    await wk?.close();
    await cr?.close();
    web.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
