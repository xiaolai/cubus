// The detector's model runs in a worker the page owns, and releasing it ENDS that worker — the two
// claims the 2026-09-22 change rests on, checked against the real runtime and the real model.
//
// Why a worker of our own: onnxruntime has no way to unload itself and a WebAssembly memory never
// shrinks, so a runtime on the page (or in onnxruntime's own proxy worker) held its heap, its
// compiled code and its thread pool until the page went. Measured in Chromium with the shipped
// model before the change: after a scan, releasing the session gave back ~30 MB of the ~210 MB the
// wasm path had added. Terminating a worker that hosts it gives back 330–350 MB, and the page's own
// process returns to within 3 MB of its size before the scan. The unit tests pin the client and the
// entry against a fake runtime; what only a browser can say is that the SHIPPED bundle reads a real
// frame exactly as the page does, and that a release really takes every thread with it — a worker
// the page believes it released, still holding its threads, is the old defect wearing the new code.
//
// Headless in both engines. Chromium is the one that can hand the scan screen a camera (its own
// synthetic feed; no file, no ffmpeg), so it drives the app end to end; WebKit reads the golden
// frames, because it is the engine the desktop app is.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';

import { startBrowserFixture } from './harness.mjs';

const FRAMES = new URL('../../../../ml/golden/frames/', import.meta.url);
/** The workers the model lives in: the inference worker and onnxruntime's threads inside it. */
const MODEL_WORKER = /\/vendor\/inference-worker\.js$|\/ort-wasm-simd-threaded\.[\w.]*mjs/;

let wk;
let cr;
before(async () => {
  wk = await startBrowserFixture();
  cr = await startBrowserFixture({
    engine: 'chromium',
    launch: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  });
});
after(async () => {
  await wk?.close();
  await cr?.close();
});

/** Poll `probe` until it is true, or fail naming what was being waited for. */
async function until(probe, what, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`timed out after ${ms} ms waiting for ${what}`);
}

test('the shipped inference worker reads every golden frame exactly as the page runner does', async () => {
  const names = readdirSync(FRAMES).filter((f) => f.endsWith('.png')).sort();
  assert.ok(names.length >= 20, `only ${names.length} golden frames found`);
  const frames = names.map((name) => ({ name, b64: readFileSync(new URL(name, FRAMES)).toString('base64') }));
  const page = await wk.browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${wk.base}/index.html`);
    const got = await page.evaluate(async ({ origin, frames: fixtures }) => {
      const { createModelRunner, decodeDetections, fitFace, nms, preprocess } = await import(
        `${origin}/vendor/ai-scan-panel.js`
      );
      const verdict = (data, rows, anchors) => {
        const fit = fitFace(nms(decodeDetections(data, rows - 4, anchors)));
        return fit.ok ? `OK ${fit.face.colors.join('')}` : fit.reason;
      };
      const tensors = [];
      for (const f of fixtures) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        tensors.push({ name: f.name, pre: preprocess({ data: img.data, width: img.width, height: img.height }) });
      }

      // The WORKER, spoken to over its own wire exactly as the client speaks to it.
      const worker = new Worker(`${origin}/vendor/inference-worker.js`, { type: 'module' });
      const reply = () =>
        new Promise((resolve) => {
          worker.onmessage = (e) => resolve(e.data);
          worker.onerror = (e) => resolve({ kind: 'error', error: e.message });
        });
      let answer = reply();
      worker.postMessage({
        kind: 'load',
        modelUrl: `${origin}/vendor/cubedet.onnx`,
        wasmPaths: `${origin}/vendor/`,
        ortUrl: `${origin}/vendor/ort.mjs`,
        hidden: false,
      });
      const loaded = await answer;
      if (loaded.kind !== 'loaded') return { loaded };
      const inWorker = {};
      let id = 0;
      for (const { name, pre } of tensors) {
        answer = reply();
        const input = new Float32Array(pre.data); // a copy: the page runner below needs the original
        worker.postMessage({ kind: 'run', id: ++id, input, imgsz: pre.imgsz }, [input.buffer]);
        const out = await answer;
        inWorker[name] = out.kind === 'ran' ? verdict(out.data, out.rows, out.anchors) : `FAILED ${out.error}`;
      }
      worker.terminate();

      // The PAGE runner, on the same machine and so the same provider choice.
      const run = await createModelRunner(`${origin}/vendor/cubedet.onnx`, {
        wasmPaths: `${origin}/vendor/`,
        ortUrl: `${origin}/vendor/ort.mjs`,
      });
      const onPage = {};
      for (const { name, pre } of tensors) {
        const out = await run(pre.data, pre.imgsz);
        onPage[name] = verdict(out.data, out.rows, out.anchors);
      }
      await run.dispose();
      return { loaded, inWorker, onPage, pageProviders: run.providers };
    }, { origin: wk.base, frames });

    assert.equal(got.loaded.kind, 'loaded', `the worker did not load the model: ${JSON.stringify(got.loaded)}`);
    assert.deepEqual(got.loaded.providers, got.pageProviders, 'the worker chose a different provider from the page');
    const differing = names
      .filter((n) => got.inWorker[n] !== got.onPage[n])
      .map((n) => `${n}: worker ${got.inWorker[n]} vs page ${got.onPage[n]}`);
    assert.deepEqual(differing, [], 'a frame reads differently in the worker');
    // Not vacuous: most frames must actually produce a reading, or two identical refusals would pass.
    const ok = names.filter((n) => got.inWorker[n].startsWith('OK '));
    assert.ok(ok.length >= 15, `only ${ok.length} fixtures produced a reading — the comparison is near-vacuous`);
    assert.deepEqual(errors, [], 'the page threw');
  } finally {
    await page.close();
  }
});

test('the scan screen runs its model in the inference worker, keeps it parked, and a release ends every thread of it', async () => {
  const context = await cr.browser.newContext({ viewport: { width: 1024, height: 768 }, permissions: ['camera'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The panel says which runtime it scans on once a model has LOADED — a worker merely spawned is
  // not a model in it.
  const said = [];
  page.on('console', (m) => said.push(m.text()));
  const modelWorkers = () => page.workers().filter((w) => MODEL_WORKER.test(w.url()));
  try {
    await page.goto(`${cr.base}/?platform=macos#/scan`);
    await until(() => said.some((t) => t.includes('scanner runtime: web')), 'the scan screen to load its model');
    assert.ok(
      page.workers().some((w) => w.url().endsWith('/vendor/inference-worker.js')),
      'the model loaded, and not in the inference worker',
    );
    // …and not on the page: onnxruntime's own proxy worker is the page path, and it must not appear.
    assert.ok(
      !page.workers().some((w) => /ort(\.proxied)?\.mjs\?cubus-runtime=proxied|\/ort\.proxied\.mjs/.test(w.url())),
      'the model was loaded on the page as well as in the worker',
    );

    // Leaving the scan screen PARKS the detector: the model is kept for a quick way back.
    await page.evaluate(() => { location.hash = '#/home'; });
    await new Promise((r) => setTimeout(r, 1000));
    const parked = await page.evaluate(async () => {
      const { parkedDetector } = await import('/vendor/ai-scan-panel.js');
      return parkedDetector()?.runtime ?? null;
    });
    assert.equal(parked, 'web', 'leaving the scan screen did not park the browser detector');
    assert.ok(modelWorkers().length > 0, 'the parked model was dropped before its release');

    // The release PARKED_RELEASE_MS calls, called now: the worker and every thread in it must go.
    await page.evaluate(async () => {
      const { disposeParkedDetector } = await import('/vendor/ai-scan-panel.js');
      disposeParkedDetector();
    });
    await until(() => modelWorkers().length === 0, 'the inference worker and its threads to end', 10_000);
    assert.deepEqual(errors, [], 'the page threw');
  } finally {
    await context.close();
  }
});
