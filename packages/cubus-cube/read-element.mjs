// What a built `<cubus-cube>` bundle can be ASKED to do — read from the bundle itself.
//
// THE BUNDLE, not the source. A manifest derived from source describes source; paired with a
// stale `vendor/` bundle it would happily advertise an attribute the bundle ignores, which is
// precisely the failure mode it exists to prevent. cubus-im inlines this exact file into every
// artifact it builds, so this is the artefact whose capabilities matter.
//
// Node can load it. The element imports three.js and calls `customElements.define` at module
// scope, which looks like it needs a browser, and three.js turns out not to be the obstacle: two
// stubs are enough, nothing is constructed, and no WebGL context is created. (The first draft of
// this work asserted the opposite and proposed extracting a module to work around it. Measured,
// then deleted.)
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUNDLE = new URL('../../apps/web/vendor/cubus-cube.js', import.meta.url);

// The read in progress, if any. Every call waits for the one before it to settle.
let turn = Promise.resolve();

/**
 * Import the bundle in a bare Node process and report what it registered.
 *
 * Stubs globals for the length of the import, so it is for a process where nothing else reads
 * `globalThis.HTMLElement` or `customElements` meanwhile: the build script and the suite that
 * checks it.
 *
 * ONE READ AT A TIME, because the stubs are process-wide. Two overlapping reads interleaved their
 * save and restore: the second saved the first's stubs as the "real" globals and put them back
 * after the first had restored the real ones, and the first read's `define` landed in the
 * second's capture. Three overlapping reads measured two refused as "defined no custom element"
 * and a process left holding the stubs (found by audit, 2026-09-14). Queued, each read's bracket
 * closes before the next one opens. A read that fails does not hold up the ones behind it.
 */
export function readElement(bundle = BUNDLE) {
  const mine = turn.then(() => readOnce(bundle));
  turn = mine.catch(() => {});
  return mine;
}

async function readOnce(bundle) {
  let captured = null;
  // Import a SNAPSHOT, and hash that same snapshot. Reading the file twice and comparing catches a
  // rebuild in the middle, but not an A→B→A replacement — and the whole point of the digest is
  // that the manifest describes the bytes it was generated from. Copying first removes the race
  // rather than narrowing it: there is only ever one set of bytes.
  const bytes = readFileSync(bundle);
  // Imported as a `data:` URL, from the very bytes being hashed. No temporary file, so nothing
  // here needs write access anywhere — the first attempt wrote beside the bundle and the second
  // into the temp directory, and BOTH made a read-only check fail with EPERM. Reading a manifest
  // should not require permission to write.
  //
  // The trailing nonce is load-bearing: Node caches an ES module by URL, and a `data:` URL's
  // identity IS its content, so a second call with identical bytes returned the cached module
  // without re-running it — nothing called `customElements.define` and the call failed with
  // "defined no custom element". A unique comment makes every call its own module.
  const source = Buffer.concat([bytes, Buffer.from(`\n//${randomUUID()}\n`)]);
  const snapshot = `data:text/javascript;base64,${source.toString('base64')}`;
  const priorElement = globalThis.HTMLElement;
  const priorCustom = globalThis.customElements;
  globalThis.HTMLElement = class {};
  globalThis.customElements = {
    define(name, cls) { captured = { name, cls }; },
    get() { return captured?.cls; },
  };
  try {
    await import(snapshot);
  } finally {
    globalThis.HTMLElement = priorElement;
    globalThis.customElements = priorCustom;
  }
  if (!captured) throw new Error(`${fileURLToPath(bundle)} defined no custom element`);
  const { name, cls } = captured;
  return {
    tag: name,
    attributes: [...(cls.observedAttributes ?? [])].sort(),
    methods: Object.getOwnPropertyNames(cls.prototype)
      // Anything starting with `_` is ours to change without telling anyone; `constructor` and the
      // lifecycle callbacks are the platform's, not a capability a consumer asks about.
      .filter((k) => !k.startsWith('_') && k !== 'constructor' && !k.endsWith('Callback'))
      .filter((k) => typeof Object.getOwnPropertyDescriptor(cls.prototype, k)?.value === 'function')
      .sort(),
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}
