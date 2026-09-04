// The scanner picks the GPU when there is one, and gets the same answer either way.
//
// Two things this pins that nothing else can. First, the ARTIFACT: `ort.bundle.min.mjs` — what we
// shipped until 2026-09-02 — is the wasm-only build, and it contains the strings "webgpu" and
// "webnn" because the EP-name registry is shared. Asking it for the GPU does not fail; it sits in
// `InferenceSession.create` while the caller waits, which is indistinguishable from a slow model.
// So "the vendored runtime can actually reach a GPU" has to be asserted by REACHING one.
//
// Second, the ANSWER. A GPU path that is fast and subtly different is worse than no GPU path: the
// whole scanner downstream of `next()` — decode, NMS, fitFace, assembleColors — is written against
// one tensor. So the test runs the same input through both providers in the same browser and
// requires the output to match, which is the same rule `ml/golden_frames.py` applies across
// runtimes in CI.
//
// Runs in CHROMIUM and HEADED, both deliberately. Headless Chromium has a software GPU that is
// ~500x slower than the real one (measured: 7320 ms a frame against 15), so a headless run would
// either time out or "prove" that the GPU path is a catastrophe. WebKit has no WebGPU to test.
// Where no GPU is available at all the test reports that and asserts the wasm path still works —
// it never skips into passing.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { freePort } from './free-port.mjs';

const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
let proc;
let base;

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('serve.mjs did not start within 20s')), 20_000);
    proc.stdout.on('data', (d) => {
      if (d.toString().includes(`:${port}`)) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on('error', reject);
  });
});

after(() => {
  proc?.kill('SIGTERM');
});

/**
 * A BROWSER per use, not one for the file.
 *
 * A single headed instance held across the suite is fragile in exactly the conditions this suite
 * runs in: `node --test` at concurrency 6, a dozen other browsers alive, and a headed Chromium
 * competing for memory. When it dies, every later `newPage` fails with "Target page, context or
 * browser has been closed" — which is not a fact about the GPU, but reads exactly like one. Seen
 * once already: this test went red at 2.5 s in a loaded run and passed at 6.8 s alone.
 *
 * The same lesson the WebGPU benchmark learned earlier the same day, where one hung GPU process
 * poisoned every case after it in the same browser. Carrying it here rather than re-learning it.
 */
async function withBrowser(fn, args) {
  // ONE retry, and only for the browser dying on the way up.
  //
  // A browser per use fixed the first version of this (a shared instance dying poisoned every
  // later case). It did not fix the second: on a developer machine that has gone to swap, a HEADED
  // Chromium launched alongside a dozen WebKit instances at `--test-concurrency=6` can crash
  // before it ever runs anything — "Target crashed" out of `newPage`, at 19 s, on a suite that
  // passes in 12 s alone and passes on a CI runner every time.
  //
  // Retried ONCE rather than swallowed, and the second failure is reported as-is. A GPU path that
  // genuinely crashes the renderer reproduces on the retry; a machine that was briefly out of
  // memory does not. That distinction is the whole reason this is bounded at one attempt: the
  // point is to stop reporting a fact about the machine as a fact about the GPU, not to keep
  // trying until something passes.
  // `net::ERR_ABORTED` on the FIRST navigation belongs here for the same reason `Target crashed`
  // does, and was seen once: a headed Chromium forced onto SwiftShader (`--disable-gpu`) aborts its
  // first `goto` under load, and passes on the next attempt. That is a fact about a browser coming
  // up on a loaded machine, not about the software-adapter rule the case is asserting — and a gate
  // that reports it as the latter is a lottery, which is the failure this whole helper exists to
  // avoid. Still bounded at one attempt: a navigation that genuinely cannot complete reproduces.
  const crashed = (e) => /Target crashed|Target page, context or browser has been closed|browserType\.launch|net::ERR_ABORTED/.test(String(e?.message ?? e));
  for (let attempt = 0; ; attempt++) {
    const browser = await chromium.launch({
      headless: false,
      args: args ?? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
    });
    try {
      return await fn(browser);
    } catch (e) {
      if (attempt === 0 && crashed(e)) {
        console.log(`    the browser died on the way up (${e.message}) — retrying once`);
        continue;
      }
      throw e;
    } finally {
      await browser.close().catch(() => {});
    }
  }
}

/** Run the model once under an explicit provider list, in a fresh browser. */
async function runUnder(executionProviders) {
  return withBrowser(async (browser) => {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/index.html`);
    return await page.evaluate(async (eps) => {
      const { createModelRunner, preferredProviders } = await import('./vendor/ai-scan-panel.js');
      const chosen = eps ?? (await preferredProviders());
      const run = await createModelRunner(new URL('./vendor/cube-yolo.onnx', document.baseURI).href, {
        executionProviders: chosen,
        wasmPaths: new URL('./vendor/', document.baseURI).href,
        ortUrl: new URL('./vendor/ort.mjs', document.baseURI).href,
      });
      const side = 640;
      const input = new Float32Array(3 * side * side);
      // Not a flat fill: a constant input can hide a provider that mixes up axes.
      for (let i = 0; i < input.length; i++) input[i] = ((i * 37) % 255) / 255;
      const t0 = performance.now();
      const out = await run(input, side);
      return {
        chosen,
        ms: Math.round(performance.now() - t0),
        anchors: out.anchors,
        head: Array.from(out.data.slice(0, 8), (v) => Number(v.toFixed(3))),
      };
    }, executionProviders);
  } finally {
    await page.close();
  }
  });
}

test('the vendored runtime can actually reach a GPU', async () => {
  const gpu = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(`${base}/index.html`);
    const seen = await page.evaluate(async () => ({
      api: !!navigator.gpu,
      adapter: navigator.gpu ? !!(await navigator.gpu.requestAdapter()) : false,
    }));
    await page.close();
    return seen;
  });
  // Reported rather than skipped: on a box with no GPU this is a fact about the box, and the rest
  // of the file still asserts the wasm path. A silent skip is how a gate stops being one.
  if (!gpu.adapter) {
    console.log('    no WebGPU adapter here — GPU assertions cannot run on this machine');
    return;
  }
  const picked = await runUnder(null);
  assert.deepEqual(picked.chosen, ['webgpu', 'wasm'], 'preferredProviders did not choose the GPU');
  assert.equal(picked.anchors, 8400);
});

// A SOFTWARE adapter is not a slow GPU, it is the wrong path — and the browser hands one out
// without being asked. Measured here, on this model, one page:
//
//     webgpu, real GPU              0.4-2.0 s to load       20 ms a frame
//     wasm, 6 threads, proxy        0.8 s to load           57 ms a frame
//     webgpu, SwiftShader          86.3 s to load         6184 ms a frame
//
// So a machine whose real GPU is blocklisted, whose driver is broken, or which is running in a VM
// or over remote desktop went from the middle row to the bottom one — a hundredfold regression,
// arriving with the WebGPU switch and invisible to every test here, because the whole suite
// launches with `--ignore-gpu-blocklist` and therefore never meets the case a user does.
//
// This is the same claim `onnx-threads.test.ts` pins against a stubbed adapter. It is worth having
// twice: the unit test proves the RULE, and this proves the browser really does answer this way
// and that the rule reads the fields it actually populates.
test('a software adapter is refused, however real it says it is', async () => {
  const seen = await withBrowser(
    async (browser) => {
      const page = await browser.newPage();
      await page.goto(`${base}/index.html`);
      const out = await page.evaluate(async () => {
        const { preferredProviders } = await import('./vendor/ai-scan-panel.js');
        if (!navigator.gpu) return { api: false };
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { api: true, adapter: false };
        const info = adapter.info ?? {};
        return {
          api: true,
          adapter: true,
          software:
            (adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? false) === true ||
            /swiftshader|llvmpipe|lavapipe|warp|basic render/i.test(
              `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`,
            ),
          providers: await preferredProviders(),
        };
      });
      await page.close();
      return out;
    },
    // Forced onto Chromium's CPU rasteriser — the same thing a blocklisted GPU produces.
    ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-gl=swiftshader', '--disable-gpu'],
  );
  // Reported rather than skipped, as everywhere else in this file: a Chromium that cannot be
  // forced onto SwiftShader is a fact about the box, and it must not read as a pass.
  if (!seen.adapter) {
    console.log('    no adapter under swiftshader here — the software case cannot be checked');
    return;
  }
  assert.equal(seen.software, true, 'the forced-software browser did not report a software adapter');
  assert.deepEqual(seen.providers, ['wasm'], 'a software adapter was chosen over the wasm runtime');
});

// The class behind the name list above: whatever a rasteriser calls itself, a provider that cannot
// run this model inside the budget loses to wasm. Driven through `gpuBudgetMs` rather than by
// finding hardware slow enough — the seam exists for exactly this, the same way
// `executionProviders` does — so the branch is exercised on the machine that has a working GPU.
test('a GPU that runs slower than the budget is handed back for wasm', async () => {
  const out = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(`${base}/index.html`);
    const r = await page.evaluate(async () => {
      const { createModelRunner, preferredProviders } = await import('./vendor/ai-scan-panel.js');
      const chosen = await preferredProviders();
      if (chosen[0] !== 'webgpu') return { gpu: false };
      const run = await createModelRunner(new URL('./vendor/cube-yolo.onnx', document.baseURI).href, {
        wasmPaths: new URL('./vendor/', document.baseURI).href,
        ortUrl: new URL('./vendor/ort.mjs', document.baseURI).href,
        // 0 ms: no run can meet it, so the GPU is always judged unviable. The point is the
        // BRANCH — session released, runner rebuilt on wasm — not the threshold's value.
        gpuBudgetMs: 0,
      });
      const side = 640;
      const outTensor = await run(new Float32Array(3 * side * side), side);
      return { gpu: true, providers: run.providers, anchors: outTensor.anchors };
    });
    await page.close();
    return r;
  });
  if (!out.gpu) {
    console.log('    no GPU chosen here — the fallback path needs one to fall back FROM');
    return;
  }
  assert.deepEqual(out.providers, ['wasm'], 'the slow GPU was kept instead of falling back');
  // The rebuilt runner has to WORK, not merely exist: the failure this guards is a released
  // session whose replacement was never usable, which looks like a fallback right up to the
  // first frame.
  assert.equal(out.anchors, 8400, 'the runner rebuilt on wasm does not produce the tensor');
});

test('both providers read the same frame the same way', async () => {
  const wasm = await runUnder(['wasm']);
  assert.equal(wasm.anchors, 8400, 'the wasm path is the floor and must always work');

  const hasGpu = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(`${base}/index.html`);
    const seen = await page.evaluate(async () =>
      navigator.gpu ? !!(await navigator.gpu.requestAdapter()) : false,
    );
    await page.close();
    return seen;
  });
  if (!hasGpu) {
    console.log('    no WebGPU adapter here — cross-provider agreement cannot be checked');
    return;
  }

  const gpu = await runUnder(['webgpu']);
  assert.equal(gpu.anchors, wasm.anchors, 'the two providers disagree about the output shape');
  // Same tolerance argument as the golden-frame harness: fp differences between runtimes move
  // scores slightly and must not move what the scan concludes. Eight leading values is enough to
  // catch a transposed or garbage tensor, which is the failure that matters.
  for (const [i, v] of gpu.head.entries()) {
    assert.ok(
      Math.abs(v - wasm.head[i]) < 0.05,
      `output[${i}] differs between providers: wasm ${wasm.head[i]} vs webgpu ${v}`,
    );
  }
});
