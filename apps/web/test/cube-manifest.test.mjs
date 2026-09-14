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
