// The detector is this repository's own, and nothing in the tree says otherwise.
//
// The shipped sticker detector is `ml/cubedet`'s: a timm MobileNetV4-small backbone, a PAN neck
// and an anchor-free head, trained here (`ml/MODEL_CARD.md`, `ml/DETECTOR_PROVENANCE.md`). It is
// not derived from any third-party detector, and as of 2026-09-20 the name of the model family it
// used to be confused with appears nowhere in this repository — not in a path, not in a comment,
// not in a commit message, and not anywhere in the history, which was rewritten to remove it.
//
// WHY A GATE. The licence claim is deliberately CHECKABLE rather than asserted
// (`DETECTOR_PROVENANCE.md`'s opening). A purge that nothing enforces comes back the first time
// somebody pastes a command out of an old note, and then the tree quietly disagrees with the
// claim again. This is the assertion that keeps it gone.
//
// THE WORD IS NEVER WRITTEN IN THIS FILE. It is assembled from fragments, because a gate that
// spells the thing it forbids is a gate that fails on its own source — and every workaround for
// that (excluding this file, tagging a line) is a hole someone else can climb through.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const STEM = 'cubedet';
/** The forbidden word, never written whole. */
const FORBIDDEN = ['yo', 'lo'].join('');
/** The vendor of the removed trainer, never written whole either. */
const VENDOR = ['ultra', 'lytics'].join('');
/** Roboflow's export-format value, assembled the same way `ml/fetch_roboflow.py` assembles it. */
const ROBOFLOW_FORMAT = ['yo', 'lo', 'v8'].join('');

const ARTEFACTS = [
  'ml/models/cubedet.onnx',
  'ml/models/cubedet.tflite',
  'ml/models/cubedet.mlpackage/Manifest.json',
  'apps/web/vendor/cubedet.onnx',
  'apps/desktop/src-tauri/gen/apple/assets/models/cubedet.mlpackage/Manifest.json',
];

const REPO_FILES = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1 << 26,
})
  .split('\n')
  .filter((f) => f && existsSync(ROOT + f));

/** Text only: a model's weights holding those bytes by chance is not a reference to anything. */
const TEXT = /\.(mjs|js|ts|tsx|rs|py|swift|kt|kts|json|jsonc|toml|yml|yaml|md|sh|gradle|html|css|txt|cfg)$/;

test('every shipped artefact carries the detector name', () => {
  for (const path of ARTEFACTS) {
    assert.ok(existsSync(ROOT + path), `${path} is missing — run ml/export.py`);
  }
});

test('one constant names all four exports, and the manifest agrees with it', () => {
  const exportPy = readFileSync(`${ROOT}ml/export.py`, 'utf8');
  assert.match(exportPy, new RegExp(`^NAME = "${STEM}"$`, 'm'));
  const manifest = JSON.parse(readFileSync(`${ROOT}ml/models/MANIFEST.json`, 'utf8'));
  const keys = Object.keys(manifest.artefacts);
  assert.ok(keys.length > 0, 'MANIFEST.json records no artefacts at all');
  for (const key of keys) assert.ok(key.startsWith(`${STEM}.`), `MANIFEST.json names "${key}"`);
});

test('the word appears nowhere in the repository', () => {
  const stray = [];
  for (const file of REPO_FILES) {
    if (!TEXT.test(file)) continue;
    const text = readFileSync(ROOT + file, 'utf8');
    if (!text.toLowerCase().includes(FORBIDDEN)) continue;
    text.split('\n').forEach((line, i) => {
      if (line.toLowerCase().includes(FORBIDDEN)) stray.push(`${file}:${i + 1} — ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(stray, [], 'the removed model family is named again — the tree disagrees with the provenance record');
});

test('the vendor of the removed trainer is named nowhere in the repository', () => {
  const stray = [];
  for (const file of REPO_FILES) {
    if (!TEXT.test(file)) continue;
    const text = readFileSync(ROOT + file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (line.toLowerCase().includes(VENDOR)) stray.push(`${file}:${i + 1} — ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(stray, [], 'the removed trainer is named again');
});

test('no shipped artefact carries the removed trainer inside its bytes', () => {
  // WHERE IT ACTUALLY HID (2026-09-21). A third-party exporter writes its own name into a model's
  // metadata, and three such binaries survived a history rewrite by sitting STAGED in two stale
  // worktrees, where no text scan and no `git log -S` could see them — pickaxe does not search
  // binary blobs. So the bytes of every artefact this repository ships are read here, whole.
  for (const path of ARTEFACTS) {
    const artefact = path.endsWith('Manifest.json') ? path.replace('Manifest.json', '') : path;
    const files = artefact.endsWith('/')
      ? REPO_FILES.filter((f) => f.startsWith(artefact))
      : [artefact];
    assert.ok(files.length > 0, `${artefact} holds nothing to read`);
    for (const file of files) {
      const bytes = readFileSync(ROOT + file).toString('latin1').toLowerCase();
      assert.ok(!bytes.includes(VENDOR), `${file} carries the removed trainer's name in its bytes`);
    }
  }
});

test('the one value an external API demands is assembled, never spelled', () => {
  // ml/fetch_roboflow.py must keep BOTH properties: it may not write the word, and it must still
  // send the exact string Roboflow's API takes. An "obvious simplification" that inlines the
  // literal satisfies the second and breaks the first, which is why this asserts the shape too.
  const source = readFileSync(`${ROOT}ml/fetch_roboflow.py`, 'utf8');
  assert.match(
    source,
    /ROBOFLOW_EXPORT_FORMAT = ""\.join\(/,
    'the export-format constant must be assembled from parts, with the comment saying why',
  );
  const value = execFileSync('python3', ['-c', 'import sys; sys.path.insert(0, "ml"); import fetch_roboflow as f; print(f.ROBOFLOW_EXPORT_FORMAT)'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  assert.equal(value, ROBOFLOW_FORMAT, 'the assembled constant no longer equals what the API expects');
});
