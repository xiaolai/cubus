// Threading the scanner must not change a single reading.
//
// This is the safety gate for wasm threads, and it has to live here because ml/golden_frames.py
// cannot provide one: its ALL_LEGS are onnx, onnx-int8, coreml, tflite and the native plugin —
// every runtime EXCEPT onnxruntime-web, which is the one Windows, Linux, Android and every
// browser actually run. A harness that does not cover the runtime being changed is not a gate.
//
// The bar is the harness's own, quoted from its header: "the nine sticker classes — not raw
// scores: quantisation and fp16 move scores a little, and a class is what the app acts on."
// That distinction is load-bearing here. Threading a wasm build partitions the same arithmetic
// across workers and floating-point addition is not associative, so the raw tensor DOES move:
// measured, 39211 of 84000 values differ, worst |diff| 3.4e-4. Asserting bit-equality would
// therefore fail for a reason that tells us nothing about whether a cube is read correctly.
// What must not move is the verdict — `OK <nine classes>` or the refusal reason — and that is
// what expected.json pins per fixture and what this asserts, across all 20 golden frames.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { freePort } from './free-port.mjs';

const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
const FRAMES = new URL('../../../ml/golden/frames/', import.meta.url);
let proc;
let browser;
let base;

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`serve.mjs did not start within 20s. It said: ${said.trim() || '(nothing)'}`)),
      20_000,
    );
    proc.stdout.on('data', (d) => { said += d.toString(); if (said.includes(`:${port}`)) { clearTimeout(timeout); resolve(); } });
    proc.stderr.on('data', (d) => { said += d.toString(); });
    proc.on('error', reject);
  });
  try {
    browser = await webkit.launch();
  } catch (cause) {
    throw new Error('WebKit for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install webkit', { cause });
  }
});

after(async () => {
  await browser?.close();
  proc?.kill('SIGTERM');
});

test('every golden fixture reads the same at one thread and at six', async () => {
  const names = readdirSync(FRAMES).filter((f) => f.endsWith('.png')).sort();
  assert.ok(names.length >= 20, `only ${names.length} golden frames found`);
  const frames = names.map((name) => ({
    name,
    b64: readFileSync(new URL(name, FRAMES)).toString('base64'),
  }));

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/index.html`);
    const verdicts = await page.evaluate(async ({ origin, frames: fixtures }) => {
      const { preprocess, decodeDetections, nms, fitFace } = await import(`${origin}/vendor/ai-scan-panel.js`);

      // Decode each PNG once, to the same RGBA a camera frame arrives as.
      const decoded = [];
      for (const f of fixtures) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        decoded.push({ name: f.name, frame: { data: img.data, width: img.width, height: img.height } });
      }

      // The verdict string is the harness's own: OK + the nine classes, or the refusal reason.
      // Boxes are passed through UNTOUCHED, for the reason golden_frames.py states at its own
      // decode: the read is invariant to a global scale on the boxes, because every gap in the
      // grid fit is compared to the mean sticker size. An earlier draft here scaled them by
      // imgsz and turned every box into NaN, which read as 20 refusals — caught only because
      // the assertion below refuses a comparison in which nothing was actually read.
      const verdict = (out) => {
        const numAnchors = out.dims[2];
        const numClasses = out.dims[1] - 4;
        // decode -> NMS -> fit, the app's chain and the harness's. Skipping NMS is not a
        // shortcut that costs precision, it changes the answer outright: a photo decodes to
        // ~1900 overlapping boxes, and fitFace takes the nine LARGEST, so without NMS those
        // nine are nine copies of one sticker and every frame reads BAD_GEOMETRY.
        const fit = fitFace(nms(decodeDetections(out.data, numClasses, numAnchors)));
        return fit.ok ? `OK ${fit.face.colors.join('')}` : fit.reason;
      };

      const runAll = async (threads) => {
        const ort = await import(`${origin}/vendor/ort.mjs?threads=${threads}`);
        ort.env.wasm.numThreads = threads;
        ort.env.wasm.wasmPaths = `${origin}/vendor/`;
        const session = await ort.InferenceSession.create(`${origin}/vendor/cube-yolo.onnx`, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        const inName = session.inputNames[0];
        const outName = session.outputNames[0];
        const results = {};
        for (const { name, frame } of decoded) {
          const pre = preprocess(frame);
          const feeds = { [inName]: new ort.Tensor('float32', pre.data, [1, 3, pre.imgsz, pre.imgsz]) };
          const out = (await session.run(feeds))[outName];
          results[name] = verdict(out);
        }
        return { threads: ort.env.wasm.numThreads, results };
      };

      const one = await runAll(1);
      const six = await runAll(6);
      return { one, six };
    }, { origin: base, frames });

    assert.equal(verdicts.one.threads, 1, 'the single-thread run did not use one thread');
    assert.equal(verdicts.six.threads, 6, `the multi-thread run used ${verdicts.six.threads} — the comparison proves nothing`);

    const differing = names.filter((n) => verdicts.one.results[n] !== verdicts.six.results[n]);
    assert.deepEqual(
      differing.map((n) => `${n}: ${verdicts.one.results[n]} -> ${verdicts.six.results[n]}`),
      [],
      'threading changed how a fixture reads',
    );
    // Not vacuous: at least some fixtures must actually produce a reading, or this would pass
    // by every frame refusing identically for an unrelated reason.
    const ok = names.filter((n) => verdicts.one.results[n].startsWith('OK '));
    assert.ok(ok.length >= 15, `only ${ok.length} fixtures produced a reading — the comparison is near-vacuous`);
    assert.deepEqual(errors, [], 'the page threw');
  } finally {
    await page.close();
  }
});

test('the web runtime reads the golden fixtures the way the pinned reference does', async () => {
  // The leg ml/golden_frames.py does not have. Its ALL_LEGS pin onnx, onnx-int8, coreml, tflite
  // and the native plugin — so the runtime that Windows, Linux, Android and every browser
  // actually run has never been compared to anything. This is that comparison: the same 20
  // fixtures, the same decode chain, against the `onnx` fp32 leg the harness treats as the
  // reference. Both are fp32, so they should agree exactly; a disagreement is a real finding
  // about the shipped runtime rather than a tolerance to widen.
  const names = readdirSync(FRAMES).filter((f) => f.endsWith('.png')).sort();
  const pinned = JSON.parse(readFileSync(new URL('../../../ml/golden/expected.json', import.meta.url), 'utf8'));
  const frames = names.map((name) => ({ name, b64: readFileSync(new URL(name, FRAMES)).toString('base64') }));

  const page = await browser.newPage();
  try {
    await page.goto(`${base}/index.html`);
    const got = await page.evaluate(async ({ origin, frames: fixtures }) => {
      const { preprocess, decodeDetections, nms, fitFace } = await import(`${origin}/vendor/ai-scan-panel.js`);
      const ort = await import(`${origin}/vendor/ort.mjs`);
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = `${origin}/vendor/`;
      const session = await ort.InferenceSession.create(`${origin}/vendor/cube-yolo.onnx`, {
        executionProviders: ['wasm'], graphOptimizationLevel: 'all',
      });
      const results = {};
      for (const f of fixtures) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        const pre = preprocess({ data: img.data, width: img.width, height: img.height });
        const out = (await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', pre.data, [1, 3, pre.imgsz, pre.imgsz]) }))[session.outputNames[0]];
        const fit = fitFace(nms(decodeDetections(out.data, out.dims[1] - 4, out.dims[2])));
        results[f.name] = fit.ok ? `OK ${fit.face.colors.join('')}` : fit.reason;
      }
      return results;
    }, { origin: base, frames });

    const disagree = names
      .filter((n) => got[n] !== pinned.frames[n].legs.onnx)
      .map((n) => `${n}: web ${got[n]} vs pinned ${pinned.frames[n].legs.onnx}`);
    assert.deepEqual(disagree, [], 'the shipped web runtime does not read the fixtures like the reference');
  } finally {
    await page.close();
  }
});
