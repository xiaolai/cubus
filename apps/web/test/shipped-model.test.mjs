// Which model the app actually serves, pinned — because the manifest said the wrong one for months
// and nothing contradicted it.
//
// ml/models/ holds four exports of the same detector: fp32 ONNX (the reference every other leg is
// judged against), int8 ONNX, fp16 CoreML, and int8 TFLite. MANIFEST.json described the int8 ONNX
// as the "web / Windows / Linux runtime". It is not: apps/web/vendor/cube-yolo.onnx is byte-
// identical to the fp32 graph, and the int8 file is referenced nowhere outside CI job names.
//
// That label was not a harmless inaccuracy. int8 is the one export that MISREADS — measured on the
// golden fixtures, 4 of 20 come back with a different face, and two of those are frames the fp32
// graph correctly refuses (abstain-00, abstain-02). A misread is the failure this app cannot
// tolerate: a wrong sticker becomes a wrong cube, and a beginner is walked through solving
// something that is not in their hands. So the question "which file does the browser get" deserves
// an assertion and not a sentence in a document.
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
      'and MANIFEST.json must move with it — and if it is now int8, read that export\'s ' +
      'quantisation_note first: it misreads 4 of 20 golden fixtures.');
});

test('and specifically not the int8 export, which misreads', () => {
  // Named separately from the equality above so the failure says WHICH wrong file arrived. The
  // int8 export is the one plausible mistake here: same architecture, same input, one third the
  // size, and it fails only on inputs no smoke test uses.
  if (!existsSync(INT8)) return; // nothing to confuse it with on this machine
  assert.notEqual(sha256(SHIPPED), sha256(INT8),
    'the int8 export is being served to the browser. It commits to a face on frames the fp32 graph ' +
      'refuses (abstain-00.png, abstain-02.png) and reads two stickers wrong on photo-00.png.');
});
