// Which model the app actually serves, pinned — because the manifest said the wrong one for months
// and nothing contradicted it.
//
// ml/models/ holds four exports of the same detector: fp32 ONNX (the reference every other leg is
// judged against), int8 ONNX, fp16 CoreML, and int8 TFLite. MANIFEST.json described the int8 ONNX
// as the "web / Windows / Linux runtime". It is not: apps/web/vendor/cube-yolo.onnx is byte-
// identical to the fp32 graph, and the int8 file is referenced nowhere outside CI job names.
//
// That label was not a harmless inaccuracy. int8 is the one export that MISREADS — measured on the
// golden fixtures and recorded in ml/golden/expected.json, 4 of 20 read differently from the fp32
// graph: a different face on photo-00 and render-02, a commit to a face on abstain-02 that fp32
// correctly refuses, and a refusal on render-07 that fp32 reads. Every one of those is the failure
// this app cannot tolerate — a wrong sticker becomes a wrong cube, and a beginner is walked
// through solving something that is not in their hands; a refusal is merely annoying, and a false
// commit is the dangerous half. So the question "which file does the browser get" deserves an
// assertion and not a sentence in a document. (The counts and frame names here are read off
// expected.json rather than remembered — see the test at the bottom, which asserts they agree.)
//
// It pins the FILE, by content, not the filename. Swapping the vendored bundle for the int8 export
// keeps the name `cube-yolo.onnx` and changes nothing else a test would notice.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const sha256 = (url) => createHash('sha256').update(readFileSync(url)).digest('hex');

const SHIPPED = new URL('../vendor/cube-yolo.onnx', import.meta.url);
const REFERENCE = new URL('../../../ml/models/cube-yolo.onnx', import.meta.url);
const INT8 = new URL('../../../ml/models/cube-yolo.int8.onnx', import.meta.url);

test('the browser is served the fp32 reference graph, byte for byte', () => {
  assert.ok(existsSync(SHIPPED), 'apps/web/vendor/cube-yolo.onnx is missing — the scanner has no model');
  if (!existsSync(REFERENCE)) {
    // ml/models is present in a clone, so this is a real absence rather than a gitignored one.
    assert.fail('ml/models/cube-yolo.onnx is missing — cannot verify which export is shipped');
  }
  assert.equal(sha256(SHIPPED), sha256(REFERENCE),
    'the vendored model is not the fp32 reference. If this was deliberate, the golden-frame pins ' +
      'and MANIFEST.json must move with it — and if it is now int8, read ml/golden/expected.json ' +
      'first: it reads 4 of 20 golden fixtures differently from the graph being replaced.');
});

test('and specifically not the int8 export, which misreads', () => {
  // Named separately from the equality above so the failure says WHICH wrong file arrived. The
  // int8 export is the one plausible mistake here: same architecture, same input, one third the
  // size, and it fails only on inputs no smoke test uses.
  if (!existsSync(INT8)) return; // nothing to confuse it with on this machine
  assert.notEqual(sha256(SHIPPED), sha256(INT8),
    'the int8 export is being served to the browser. It commits to a face on abstain-02.png, which ' +
      'the fp32 graph refuses, and reads photo-00.png and render-02.png differently.');
});

// A model the plugin resolves but the bundler never ships is a native path that cannot run.
//
// This is the assertion left behind by a real defect rather than an imagined one. `windows.rs`
// resolved `cube-yolo.onnx` and `tauri.windows.conf.json` declared no `bundle.resources` at all,
// so `probe()` answered false in EVERY build and the whole DirectML module was unreachable code
// that compiled, passed clippy, and was described in a commit message as verified. Nothing
// contradicted it because a native path that is never selected looks exactly like one that is not
// preferred — the app just uses WebDetector and says nothing.
//
// It reads the Rust constant rather than repeating the string, so renaming the resource on one
// side and not the other fails here instead of at runtime on a user's machine.
const NATIVE_MODEL_PLUGINS = [
  { rust: '../../../crates/cube-vision/src/apple.rs', confs: ['tauri.macos.conf.json', 'tauri.ios.conf.json'] },
  { rust: '../../../crates/cube-vision/src/windows.rs', confs: ['tauri.windows.conf.json'] },
];

for (const { rust, confs } of NATIVE_MODEL_PLUGINS) {
  for (const conf of confs) {
    test(`${conf} bundles the model its plugin resolves`, () => {
      const src = readFileSync(new URL(rust, import.meta.url), 'utf8');
      const declared = /const MODEL_RESOURCE: &str = "([^"]+)";/.exec(src);
      assert.ok(declared, `${rust} no longer declares MODEL_RESOURCE — this test cannot check what it resolves`);

      const url = new URL(`../../desktop/src-tauri/${conf}`, import.meta.url);
      assert.ok(existsSync(url), `${conf} is missing`);
      const resources = JSON.parse(readFileSync(url, 'utf8'))?.bundle?.resources;
      assert.ok(
        resources && typeof resources === 'object',
        `${conf} declares no bundle.resources, so the model is never staged — the plugin will ` +
          `resolve nothing and probe false on every build of this platform`,
      );
      assert.ok(
        Object.values(resources).includes(declared[1]),
        `${conf} does not stage anything to "${declared[1]}", which is what ${rust} resolves ` +
          `from the Resource dir. Declared destinations: ${JSON.stringify(Object.values(resources))}`,
      );
    });
  }
}

// THE COMMITTED iOS COPY, byte for byte against ml/models/.
//
// `gen/apple/assets/models/cube-yolo.mlpackage` is a copy of `ml/models/cube-yolo.mlpackage` that
// lives in the repository — the Android side deliberately refuses to do this, and iOS does it
// because Xcode stages what the project declares rather than what a build script fetches. A
// committed copy of a generated artefact is only safe while something checks it is still the same
// artefact, and nothing did: a re-export could update ml/models/ and leave the iPhone shipping the
// previous detector, which reads as a model that has quietly got worse rather than as a stale file.
//
// Every file, not the manifest alone: `weight.bin` is where a re-export actually shows up, and it
// is the one file a diff of the .mlpackage's metadata would not notice.
const IOS_MODEL = '../../desktop/src-tauri/gen/apple/assets/models/cube-yolo.mlpackage';
const ML_MODEL = '../../../ml/models/cube-yolo.mlpackage';
const MLPACKAGE_FILES = [
  'Manifest.json',
  'Data/com.apple.CoreML/model.mlmodel',
  'Data/com.apple.CoreML/weights/weight.bin',
];

test('the committed iOS model is the one in ml/models, file for file', () => {
  const source = new URL(`${ML_MODEL}/`, import.meta.url);
  const shipped = new URL(`${IOS_MODEL}/`, import.meta.url);
  assert.ok(existsSync(source), 'ml/models/cube-yolo.mlpackage is missing');
  assert.ok(existsSync(shipped), `${IOS_MODEL} is missing — the iOS build has no model to stage`);
  const drifted = MLPACKAGE_FILES.filter((f) => {
    const a = new URL(f, source);
    const b = new URL(f, shipped);
    assert.ok(existsSync(a), `ml/models/cube-yolo.mlpackage/${f} is missing`);
    assert.ok(existsSync(b), `the committed iOS copy is missing ${f}`);
    return sha256(a) !== sha256(b);
  });
  assert.deepEqual(drifted, [],
    'the committed iOS copy of the model has drifted from ml/models/. Re-copy the .mlpackage: an ' +
      'iPhone shipping a different detector from every other platform is a difference nothing else ' +
      'in this repository would notice.');
});

// The comments above quote how many golden fixtures the int8 export reads differently. That number
// is the reason the fp32 graph is the one that ships, and it was written down once and then went
// stale twice — a re-export changes it, and nothing pointed the prose at the data.
test('the int8 divergence this file talks about is the one expected.json records', () => {
  const url = new URL('../../../ml/golden/expected.json', import.meta.url);
  if (!existsSync(url)) return; // ml/ is present in a clone; skip rather than fail if it is not
  const pinned = JSON.parse(readFileSync(url, 'utf8'));
  const differing = Object.entries(pinned.frames)
    .filter(([, v]) => v.legs['onnx-int8'] !== undefined && v.legs['onnx-int8'] !== v.legs.onnx)
    .map(([name]) => name.replace(/\.png$/, ''))
    .sort();
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const claimed = source.match(/(\d+) of (\d+) read differently from the fp32/);
  assert.ok(claimed, 'this file no longer states the divergence — update this test with it');
  assert.equal(Number(claimed[1]), differing.length,
    `this file says ${claimed[1]} fixtures diverge; expected.json records ${differing.length} ` +
      `(${differing.join(', ')})`);
  assert.equal(Number(claimed[2]), Object.keys(pinned.frames).length);
  for (const name of differing) {
    assert.ok(source.includes(name),
      `${name} reads differently under int8 and this file does not mention it`);
  }
});
