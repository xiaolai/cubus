// The capability manifest — and the two ways it could lie.
//
// It exists so cubus-im can stop asking a bundle about its capabilities with a substring grep.
// A grep passes on a bundle that only MENTIONS an attribute in a comment, and it has to be
// hand-written once per feature; a list can be looped over, so the next dependency is checked for
// free rather than by hand. cubus-im's `docs/preflight.md` rule 23 is what this is serving.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const MANIFEST = new URL('../vendor/cubus-cube.manifest.json', import.meta.url);
const BUNDLE = new URL('../vendor/cubus-cube.js', import.meta.url);
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// THE LOAD-BEARING ONE. A manifest and a bundle travel as two files, so a fresh manifest can end
// up beside a stale bundle — advertising capabilities that are not there, which is the exact
// failure the manifest exists to prevent, reintroduced by the prevention. The digest is how a
// consumer refuses that pairing, so it has to be right here first.
test('the digest is of the bundle sitting beside it', () => {
  const actual = `sha256:${createHash('sha256').update(readFileSync(BUNDLE)).digest('hex')}`;
  assert.equal(manifest.digest, actual,
    'the manifest describes a different build from the bundle next to it — run `pnpm build:cube`');
});

test('it names the element, its bundle, and a schema a reader can check', () => {
  assert.equal(manifest.tag, 'cubus-cube');
  assert.equal(manifest.bundle, 'cubus-cube.js');
  assert.equal(manifest.schema, 1);
  // No release version, deliberately — see the renderer package's `build-cube-manifest.mjs`. A
  // number to compare is an invitation to compare numbers instead of asking whether the
  // capability is there.
  assert.equal('version' in manifest, false, 'a release version crept into the manifest');
});

test('it lists the attributes a lesson actually writes', () => {
  const attrs = new Set(manifest.attributes);
  // Every attribute cubus-im's pipeline sets on a cube today, plus the one this branch adds.
  for (const name of [
    'facelets', 'scramble', 'alg', 'highlight', 'focus', 'ghosts', 'ghost-elevation',
    'camera-latitude', 'camera-longitude', 'camera-fit', 'camera-up', 'facelet-scale',
    'tempo-scale', 'orientation',
  ]) {
    assert.equal(attrs.has(name), true, `${name} is missing from the manifest`);
  }
});

test('it lists the methods a lesson drives, and nothing private', () => {
  const methods = new Set(manifest.methods);
  for (const name of ['play', 'pause', 'step', 'stepBack', 'seek', 'reset', 'showTurn', 'turnTo']) {
    assert.equal(methods.has(name), true, `${name} is missing from the manifest`);
  }
  assert.deepEqual(manifest.methods.filter((m) => m.startsWith('_')), [],
    'a private method is being advertised as a capability');
  assert.deepEqual(manifest.methods.filter((m) => m.endsWith('Callback')), [],
    'a lifecycle callback is not a capability');
});

// THE GAP THE AUDIT FOUND. Every case above checks that required names are PRESENT and that no
// private ones leak — none of them checks that the list AGREES with the bundle. Injecting
// `nonexistent-attribute`, `nonexistentMethod` and `constructor` into the manifest passed all five.
// This reads the built bundle and demands exact equality, which is the claim the file is making.
test('the manifest is exactly what the bundle registers, name for name', async () => {
  const { readElement } = await import('../../../packages/cubus-cube/read-element.mjs');
  const live = await readElement();
  assert.equal(live.tag, manifest.tag);
  assert.deepEqual(manifest.attributes, live.attributes,
    'the manifest advertises capabilities the bundle does not have, or omits ones it does');
  assert.deepEqual(manifest.methods, live.methods);
  assert.equal(manifest.digest, live.digest);
});

// What the manifest CANNOT answer, written down so nobody mistakes it for an answer. Keeping an
// attribute in `observedAttributes` while deleting its handler leaves this file honest and the
// behaviour gone, so a consumer still needs a behavioural check of its own.
test('the manifest is a statement about what may be ASKED, not about what works', () => {
  assert.equal(typeof manifest.attributes.includes, 'function');
  assert.ok(manifest.attributes.includes('orientation'));
  // The behaviour behind it is proved in test/browser/orientation.test.mjs, not here.
});

// Reading the bundle TWICE, which nothing did until an audit pointed it out (2026-09-14). Node
// caches an ES module by URL, and a `data:` URL's identity is its content — so without the nonce
// `read-element.mjs` appends, a second read returns the cached module, nothing calls
// `customElements.define`, and the call fails with "defined no custom element". The safeguard was
// there with its reasoning written down; what was missing was anything that would notice it going.
test('the bundle can be read twice, and says the same thing both times', async () => {
  const { readElement } = await import('../../../packages/cubus-cube/read-element.mjs');
  const first = await readElement();
  const second = await readElement();
  assert.equal(second.tag, first.tag, 'a second read named a different element');
  assert.deepEqual(second.attributes, first.attributes, 'a second read found different attributes');
  assert.deepEqual(second.methods, first.methods, 'a second read found different methods');
  assert.equal(second.digest, first.digest, 'a second read hashed different bytes');
});

// Overlapping reads, which the build never makes and a caller easily could (`Promise.all` over two
// bundles). The stubs are process globals, and interleaved reads refused two of three and left the
// process holding the stubs. Each read must get the element, and the globals must come back.
test('overlapping reads each get the element, and leave the globals as they found them', async () => {
  const { readElement } = await import('../../../packages/cubus-cube/read-element.mjs');
  const realElement = class RealHTMLElement {};
  const realRegistry = { real: true };
  const [savedElement, savedRegistry] = [globalThis.HTMLElement, globalThis.customElements];
  globalThis.HTMLElement = realElement;
  globalThis.customElements = realRegistry;
  try {
    const settled = await Promise.allSettled([readElement(), readElement(), readElement()]);
    assert.deepEqual(settled.map((s) => (s.status === 'fulfilled' ? s.value.tag : String(s.reason))),
      ['cubus-cube', 'cubus-cube', 'cubus-cube'], 'an overlapping read lost its element to another');
    assert.equal(globalThis.HTMLElement, realElement, 'HTMLElement was left as a stub');
    assert.equal(globalThis.customElements, realRegistry, 'customElements was left as a stub');
  } finally {
    globalThis.HTMLElement = savedElement;
    globalThis.customElements = savedRegistry;
  }
});

test('a read that fails does not hold up the reads queued behind it', async () => {
  const { readElement } = await import('../../../packages/cubus-cube/read-element.mjs');
  const missing = new URL('./no-such-bundle.js', import.meta.url);
  const [failed, next] = await Promise.allSettled([readElement(missing), readElement()]);
  assert.equal(failed.status, 'rejected', 'precondition: a missing bundle is refused');
  assert.equal(next.status, 'fulfilled', `the read after a failure never ran: ${next.reason}`);
  assert.equal(next.value.tag, 'cubus-cube');
});

// The element reacts to attribute changes through a table keyed by attribute name, and a key that
// names no observed attribute is a reaction that can never run — a typo that fails silently. The
// bundle checks its table when it loads, so the typo throws there; this is that check going red.
test('a reaction to an attribute the element does not observe stops the bundle loading', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { readElement } = await import('../../../packages/cubus-cube/read-element.mjs');
  const original = readFileSync(BUNDLE, 'utf8');
  const anchor = '  scheme: (el) => el._paint(),\n';
  assert.equal(original.split(anchor).length, 2, 'precondition: the bundle has one `scheme` reaction to misspell');
  const dir = mkdtempSync(join(tmpdir(), 'cubus-reactions-'));
  try {
    const path = join(dir, 'cubus-cube.js');
    writeFileSync(path, original.replace(anchor, '  schemes: (el) => el._paint(),\n'));
    await assert.rejects(() => readElement(pathToFileURL(path)), /reacts to "schemes", which it does not observe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// What `read-element.mjs` guarantees, tested where it could fail: the capabilities it reports and
// the digest it reports describe the SAME bytes. It reads the bundle once and imports those exact
// bytes as a `data:` URL; an implementation that hashed the file but imported it by path would
// agree with itself right up until the bundle changed on disk — and then Node's module cache would
// hand back the OLD element under the NEW digest. That is the rebuild race the snapshot exists to
// close, and nothing noticed an in-memory mutation that reopened it (found by audit, 2026-09-14).
test('a bundle that changes between two reads is described by its new bytes, not a cached element', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { readElement } = await import('../../../packages/cubus-cube/read-element.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'cubus-read-element-'));
  try {
    const path = join(dir, 'cubus-cube.js');
    const original = readFileSync(BUNDLE, 'utf8');
    const anchor = '  static observedAttributes = [\n';
    assert.equal(original.split(anchor).length, 2, 'precondition: the bundle has one attribute list to extend');
    writeFileSync(path, original);
    const before = await readElement(pathToFileURL(path));
    // The same file, rebuilt with one more attribute: what a rebuild during a read would look like.
    writeFileSync(path, original.replace(anchor, `${anchor}    "only-in-the-rebuild",\n`));
    const after = await readElement(pathToFileURL(path));
    assert.notEqual(after.digest, before.digest, 'precondition: the second read hashed different bytes');
    assert.equal(before.attributes.includes('only-in-the-rebuild'), false, 'precondition: the first bytes do not have it');
    assert.equal(after.attributes.includes('only-in-the-rebuild'), true,
      'the digest describes the rebuilt bytes and the capabilities describe the old ones — a cached element under a new digest');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
