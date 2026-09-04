#!/usr/bin/env node
// Render an algorithm as video, from the app's OWN renderer.
//
// WHY IT DRIVES `<cubus-cube>` RATHER THAN DRAWING A CUBE. A second renderer would be a second
// implementation of the thing the app is judged on, and it would drift — the palette, the sticker
// inset, the ghost faces, the easing. A teaching video that looks subtly unlike the app teaches a
// cube the learner will not meet. So this drives the shipped element and records what it draws.
//
// WHY IT FAKES THE CLOCK, which is the whole design. `<cubus-cube>` animates against
// `performance.now()` inside `requestAnimationFrame`. Both are overridden here so that frame N is
// at exactly N/fps, which buys three things a real-time recording cannot have: the same algorithm
// renders to the same bytes every time (verified — see alg-video.test.mjs), the frame rate is a
// CHOICE rather than a measurement of how busy the machine was, and capture speed is decoupled
// from playback speed, so 60 fps costs whatever it costs with no dropped frames.
//
// TWO THINGS LEARNED BY DOING IT, both of which look like bugs in the renderer and are not:
//
//   * `page.screenshot()` HANGS under a faked rAF — Playwright waits for a compositor frame that
//     will never arrive, because nothing is driving the real clock. The canvas is read directly
//     instead, which works because the element sets `preserveDrawingBuffer: true`, and is faster.
//   * The capture page must contain NOTHING BUT the element. Pumping frames on the app's own page
//     also drives the app's cubes, and a disposed one throws `this.controls is null`. The page is
//     served by route interception rather than a file, so nothing has to be written into apps/web.
//
// Usage:
//   node scripts/alg-video.mjs --alg "R U R' U'" --out-dir docs/media --name sexy-move
//   node scripts/alg-video.mjs --alg "R U R' U'" --out one.mp4        (single format by extension)

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULTS = Object.freeze({
  fps: 60,
  size: 512,
  // A beat before and after. A hard cut into the first turn reads as a glitch, and a loop with no
  // rest is unwatchable — 0.4 s is long enough to see the start state and short enough not to drag.
  hold: 0.4,
  tempo: 1,
  // The RENDER is always transparent (the element sets alpha: true), so one capture serves every
  // format. This colour is what the formats that cannot carry alpha — mp4, webm and gif, see
  // encode() — get flattened onto, which is why it is an encode-time option and not a render one.
  background: '#ffffff',
});

/** The page the capture runs in: the element, and deliberately nothing else. */
const CAPTURE_HTML = `<!doctype html><meta charset="utf-8"><title>cubus capture</title>
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
cubus-cube{display:block}</style>
<body><script type="module">
  import './vendor/cubus-cube.js';
  window.__ready = true;
</script></body>`;

/** Installed before any script: frame N is at exactly N/fps, and nothing advances on its own. */
function fakeClock() {
  window.__t = 0;
  const queue = [];
  performance.now = () => window.__t;
  window.requestAnimationFrame = (cb) => queue.push(cb);
  window.cancelAnimationFrame = () => {};
  window.__frame = (dt) => {
    window.__t += dt;
    for (const cb of queue.splice(0)) cb(window.__t);
  };
}

/**
 * Capture one algorithm as an array of PNG buffers.
 *
 * @param {object} o
 * @param {string} o.alg          the moves to animate
 * @param {string} [o.scramble]   the state to start from, if not solved
 * @param {string} [o.facelets]   an explicit start state, overriding scramble
 * @returns {Promise<{frames: Buffer[], moves: number}>}
 */
export async function capture(o) {
  // Resolved from apps/web, which is where Playwright is pinned. This script lives at the repo
  // root beside the other tools, and adding a second copy of a ~100 MB browser harness to the root
  // package just to import it from here would be a dependency bought for a path.
  // `.default` because Playwright's entry is CommonJS: importing it by path gives a namespace
  // whose exports hang off default, not off the namespace itself.
  const pw = await import(playwrightUrl());
  const { chromium } = pw.chromium ? pw : pw.default;
  const opts = { ...DEFAULTS, ...o };
  const serve = fileURLToPath(new URL('../apps/web/serve.mjs', import.meta.url));
  const port = await freePort();
  const server = spawn(process.execPath, [serve], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`serve.mjs did not start on ${port} within 20s`)), 20_000);
    server.stdout.on('data', (d) => {
      if (d.toString().includes(`:${port}`)) {
        clearTimeout(t);
        ok();
      }
    });
    server.on('error', no);
  });

  // Chromium rather than the WebKit the app ships in, because this renders an ARTEFACT rather than
  // testing the app — the three.js scene is the same either way, and Chromium is the engine already
  // installed for the scanner's GPU suite. WebKit also works; the spike that proved this approach
  // ran there.
  //
  // NO GL FLAGS. An early version passed `--use-gl=swiftshader --enable-unsafe-swiftshader` and one
  // run produced six playable files whose every frame was empty. I blamed the flags, removed them,
  // and it worked — but re-adding them later reproduced nothing: the output is identical with and
  // without (46366 opaque pixels either way). So the flags were NOT the cause, that run's cause is
  // unknown, and it has not recurred. They stay off because they bought nothing, and the frame
  // checks in alg-video.test.mjs stay because blank output is the failure that looks most like
  // success — six files, right codecs, right frame count, nothing inside.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: opts.size, height: opts.size },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(fakeClock);
    // Served by interception: the page needs the server's ORIGIN so `./vendor/…` resolves, but it
    // must not be a file inside apps/web — nothing here should write into the app's tree.
    await page.route('**/__cubus_capture.html', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: CAPTURE_HTML }));
    await page.goto(`http://127.0.0.1:${port}/__cubus_capture.html`);
    await page.waitForFunction(() => window.__ready === true);

    const moves = await page.evaluate((o) => {
      const c = document.createElement('cubus-cube');
      c.style.width = `${o.size}px`;
      c.style.height = `${o.size}px`;
      if (o.facelets) c.setAttribute('facelets', o.facelets);
      else if (o.scramble) c.setAttribute('scramble', o.scramble);
      c.setAttribute('alg', o.alg);
      c.setAttribute('tempo-scale', String(o.tempo));
      for (const [attr, key] of [
        ['camera-latitude', 'cameraLatitude'],
        ['camera-longitude', 'cameraLongitude'],
        ['ghosts', 'ghosts'],
        ['ghost-elevation', 'ghostElevation'],
        ['palette', 'palette'],
        ['facelet-scale', 'faceletScale'],
        ['back-view', 'backView'],
      ]) if (o[key] != null) c.setAttribute(attr, String(o[key]));
      document.body.appendChild(c);
      window.__cube = c;
      window.__done = false;
      c.addEventListener('cubus-step', (e) => {
        if (e.detail.index >= e.detail.total) window.__done = true;
      });
      return o.alg.trim().split(/\s+/).filter(Boolean).length;
    }, opts);

    const shoot = () =>
      page.evaluate(() => {
        const el = window.__cube;
        const canvas = el.shadowRoot?.querySelector('canvas') ?? el.querySelector('canvas');
        // `preserveDrawingBuffer: true` on the element is what makes this readable at all; without
        // it the buffer is cleared before this runs and every frame comes back blank.
        return canvas ? canvas.toDataURL('image/png') : null;
      });
    const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');

    // One frame to mount and draw the start state, which is also the frame the opening hold holds.
    await page.evaluate(() => window.__frame(16.667));
    const first = await shoot();
    if (!first) throw new Error('the element drew no canvas — did vendor/cubus-cube.js load?');

    const frames = [];
    const holdFrames = Math.round(opts.hold * opts.fps);
    for (let i = 0; i < holdFrames; i++) frames.push(png(first));

    await page.evaluate(() => window.__cube.play());
    const dt = 1000 / opts.fps;
    // A bound, not a schedule: the loop ends on `cubus-step` reaching total. This only stops a
    // renderer that never finishes from filling the disk, and it is generous — 190 ms per quarter
    // turn at tempo 1 means even a 60-move alg is far inside it.
    const limit = Math.ceil(((260 * Math.max(1, moves)) / opts.tempo / dt) + opts.fps * 4);
    let done = false;
    for (let i = 0; i < limit && !done; i++) {
      const r = await page.evaluate((d) => {
        window.__frame(d);
        const el = window.__cube;
        const canvas = el.shadowRoot?.querySelector('canvas') ?? el.querySelector('canvas');
        return { url: canvas ? canvas.toDataURL('image/png') : null, done: window.__done };
      }, dt);
      if (!r.url) throw new Error('the canvas disappeared mid-capture');
      frames.push(png(r.url));
      done = r.done;
    }
    if (!done) throw new Error(`the algorithm did not finish within ${limit} frames — is "${opts.alg}" valid?`);

    // The closing hold repeats the LAST rendered frame, so the rest is on the finished state.
    const last = frames[frames.length - 1];
    for (let i = 0; i < holdFrames; i++) frames.push(last);

    if (errors.length) throw new Error(`the capture page threw: ${errors.join('; ')}`);
    return { frames, moves };
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

/** Where Playwright actually lives, or a message naming the install rather than ERR_MODULE_NOT_FOUND. */
function playwrightUrl() {
  const from = new URL('../apps/web/package.json', import.meta.url);
  try {
    return pathToFileURL(createRequire(from).resolve('playwright')).href;
  } catch (cause) {
    throw new Error(
      'playwright is not installed — run `pnpm install`, then ' +
        '`pnpm --filter cubus-web exec playwright install chromium`',
      { cause },
    );
  }
}

/** ffmpeg, or a message that says what to install rather than "spawn ENOENT". */
function ffmpeg(args, what) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') throw new Error(`ffmpeg is not installed — needed to write ${what} (brew install ffmpeg)`);
  if (r.status !== 0) throw new Error(`ffmpeg failed writing ${what}: ${(r.stderr || '').trim().slice(0, 400)}`);
}

/**
 * Encode captured frames into every format asked for.
 *
 * WHICH FORMATS KEEP TRANSPARENCY, measured rather than assumed:
 *
 *     png    yes    56034/102400 transparent on the reference frame
 *     apng   yes    56034/102400, identical to the stills
 *     webm   NO     0, even though libvpx-vp9 accepts -pix_fmt yuva420p and reports it
 *     mp4    no     H.264 has no alpha
 *     gif    no*    one-bit only, and it fringes badly around a lit, rounded cube
 *
 * So mp4, webm and gif are flattened onto `background`. That is not a default anyone should have
 * to discover: an un-flattened transparent frame encodes onto BLACK, which is not a choice, just
 * what yuv420p does with an empty alpha channel.
 */
export function encode(frames, { outDir, name, fps, background, formats }) {
  mkdirSync(outDir, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'cubus-alg-'));
  try {
    frames.forEach((buf, i) => writeFileSync(join(dir, `${String(i).padStart(6, '0')}.png`), buf));
    const pattern = join(dir, '%06d.png');
    const out = (ext) => join(outDir, `${name}.${ext}`);
    // Paint the chosen background UNDER the frame, at whatever size the frame is. `drawbox` with
    // `w=iw:h=ih` avoids having to know the dimensions here, and without it a transparent frame
    // encodes onto black — which nobody chose, it is just what yuv420p does with an empty alpha.
    // `format=rgb24` at the end is load-bearing, not tidying. `drawbox` paints the colour but
    // leaves the ALPHA it found — zero, on a transparent capture — so the result is the right RGB
    // under a fully transparent channel. Encoders that discard alpha (mp4, webm via yuv420p) then
    // look perfectly correct, which is what made this hard to see: the bug only surfaced in the gif,
    // where palettegen met an all-transparent image and quantised the background to an arbitrary
    // brown. Dropping to rgb24 makes the flatten mean what it says everywhere.
    const flattened = (bg) =>
      `split[a][b];[a]drawbox=x=0:y=0:w=iw:h=ih:color=${bg}:t=fill[bg];[bg][b]overlay=format=auto,format=rgb24`;
    const written = [];

    if (formats.includes('mp4')) {
      // yuv420p and even dimensions, or half the world cannot play it.
      ffmpeg([
        '-framerate', String(fps), '-i', pattern,
        '-vf', `${flattened(background)},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
        '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', out('mp4'),
      ], 'mp4');
      written.push(out('mp4'));
    }
    if (formats.includes('webm')) {
      // FLATTENED, not alpha — measured, and contrary to what VP9 is supposed to manage. Asking
      // for `-pix_fmt yuva420p` is accepted, the encoder reports yuva420p on its input, and the
      // file that comes out still decodes to 0 transparent pixels (ffmpeg 9.0.1, libvpx-vp9).
      // Rather than ship a format that silently drops the transparency it advertises, webm gets
      // the same background as the mp4 and APNG is the transparent one.
      ffmpeg([
        '-framerate', String(fps), '-i', pattern,
        '-vf', `${flattened(background)},format=yuv420p`,
        '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', out('webm'),
      ], 'webm');
      written.push(out('webm'));
    }
    if (formats.includes('apng')) {
      ffmpeg(['-framerate', String(fps), '-i', pattern, '-plays', '0', '-f', 'apng', out('apng')], 'apng');
      written.push(out('apng'));
    }
    if (formats.includes('gif')) {
      // THREE passes, and the middle one is why: flatten to disk first, then quantise.
      //
      // Doing the flatten inside palettegen/paletteuse's filtergraph looks tidier and is wrong —
      // the same `split/drawbox/overlay` chain that works as a plain `-vf` for the mp4 does not
      // reach the palette when the graph also has the palette as a second input, and the gif comes
      // out with the cube correct and the background quantised to a brown nothing asked for
      // (measured: corner 117,75,37 against the mp4's 246,243,235). Flattened frames on disk have
      // no graph to get lost in.
      const flat = join(dir, 'flat');
      mkdirSync(flat, { recursive: true });
      const flatPattern = join(flat, '%06d.png');
      ffmpeg(['-i', pattern, '-vf', flattened(background), flatPattern], 'the flattened gif frames');
      const palette = join(dir, 'palette.png');
      // `reserve_transparent=0`, or the flatten is undone anyway: palettegen keeps a transparent
      // entry by DEFAULT and paletteuse spends it on inter-frame differencing, so a gif explicitly
      // composited onto a background still comes out with an alpha channel.
      ffmpeg(['-i', flatPattern, '-vf', 'palettegen=reserve_transparent=0', palette], 'the gif palette');
      ffmpeg([
        '-framerate', String(fps), '-i', flatPattern, '-i', palette,
        '-lavfi', 'paletteuse=dither=sierra2_4a', '-loop', '0', out('gif'),
      ], 'gif');
      written.push(out('gif'));
    }
    if (formats.includes('png')) {
      // The teaching stills: where it starts and where it ends.
      writeFileSync(out('start.png'), frames[0]);
      writeFileSync(out('end.png'), frames[frames.length - 1]);
      written.push(out('start.png'), out('end.png'));
    }
    return written;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** An ephemeral port from the OS — see apps/web/test/free-port.mjs for why this is not a constant. */
async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((ok, no) => {
    const s = createServer();
    s.on('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const ALL_FORMATS = ['mp4', 'webm', 'apng', 'gif', 'png'];

/* c8 ignore start — the CLI shell; capture() and encode() are what the tests drive. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? d : argv[i + 1];
  };
  const alg = arg('alg');
  if (!alg) {
    console.error(`usage: alg-video.mjs --alg "R U R' U'" [--out-dir DIR --name NAME | --out FILE]
       [--formats mp4,webm,apng,gif,png] [--fps ${DEFAULTS.fps}] [--size ${DEFAULTS.size}]
       [--hold ${DEFAULTS.hold}] [--tempo ${DEFAULTS.tempo}] [--background '${DEFAULTS.background}']
       [--scramble ALG | --facelets STR] [--ghosts ...] [--palette ...] [--camera-latitude N]`);
    process.exit(2);
  }
  const single = arg('out');
  const outDir = single ? dirname(resolve(single)) : resolve(arg('out-dir', 'dev-docs/artifacts/alg'));
  const name = single ? basename(single, extname(single)) : arg('name', 'alg');
  const formats = single
    ? [extname(single).slice(1)]
    : (arg('formats') ?? ALL_FORMATS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  for (const f of formats) {
    if (!ALL_FORMATS.includes(f)) {
      console.error(`unknown format "${f}" — one of ${ALL_FORMATS.join(', ')}`);
      process.exit(2);
    }
  }
  const opts = {
    alg,
    scramble: arg('scramble'),
    facelets: arg('facelets'),
    fps: Number(arg('fps', DEFAULTS.fps)),
    size: Number(arg('size', DEFAULTS.size)),
    hold: Number(arg('hold', DEFAULTS.hold)),
    tempo: Number(arg('tempo', DEFAULTS.tempo)),
    background: arg('background', DEFAULTS.background),
    cameraLatitude: arg('camera-latitude'),
    cameraLongitude: arg('camera-longitude'),
    ghosts: arg('ghosts'),
    palette: arg('palette'),
  };
  const t0 = Date.now();
  const { frames, moves } = await capture(opts);
  const written = encode(frames, { outDir, name, fps: opts.fps, background: opts.background, formats });
  console.log(
    `${moves} moves, ${frames.length} frames at ${opts.fps}fps ` +
      `(${(frames.length / opts.fps).toFixed(2)}s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  for (const f of written) console.log(`  ${f}`);
}
/* c8 ignore stop */
