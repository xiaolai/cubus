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
import { Worker } from 'node:worker_threads';

const BUNDLE = new URL('../../apps/web/vendor/cubus-cube.js', import.meta.url);

/**
 * Import the bundle in a THROWAWAY WORKER and report what it registered.
 *
 * IN A WORKER, for two reasons that were one design mistake. Node caches an ES module by URL forever, and
 * each read imports the bundle under a URL of its own (see the nonce below) — so ten reads in one process
 * retained 46.2 MiB after garbage collection, and a long-lived process reading repeatedly would keep
 * every copy (Codex audit, 2026-09-16). And the import needs `HTMLElement` and `customElements` in scope,
 * which used to mean stubbing them on THIS process's globals: a bracket that had to be queued because it
 * was process-wide, and that left both names as own properties valued `undefined` on a process that never
 * had them. A worker's globals are its own and its module cache dies with it, so both problems are gone
 * rather than managed — no queue, no restore, nothing borrowed from the caller's process.
 */
export function readElement(bundle = BUNDLE) {
  return readOnce(bundle);
}

/** The reader, as the worker runs it: stub, import, describe, post back. Written here as source because
 *  it has to be a module of its own and a file beside this one would be one more thing to keep in step. */
const IN_WORKER = `
import { parentPort, workerData } from 'node:worker_threads';

let captured = null;
globalThis.HTMLElement = class {};
globalThis.customElements = {
  define(name, cls) { captured = { name, cls }; },
  get() { return captured?.cls; },
};

await import(workerData.snapshot);
if (!captured) { parentPort.postMessage({ error: 'defined no custom element' }); } else {
  const { name, cls } = captured;
  const own = Object.getOwnPropertyNames(cls.prototype)
    .filter((k) => !k.startsWith('_') && k !== 'constructor' && !k.endsWith('Callback'));
  const seams = new Set(cls.seams ?? []);
  const descriptorOf = (k) => Object.getOwnPropertyDescriptor(cls.prototype, k);
  parentPort.postMessage({ read: {
    tag: name,
    attributes: [...(cls.observedAttributes ?? [])].sort(),
    methods: own.filter((k) => typeof descriptorOf(k)?.value === 'function').sort(),
    properties: own
      .filter((k) => !seams.has(k) && (descriptorOf(k)?.get || descriptorOf(k)?.set))
      .sort()
      .map((k) => ({ name: k, read: !!descriptorOf(k).get, write: !!descriptorOf(k).set })),
    events: [...(cls.events ?? [])].sort(),
    operations: Object.fromEntries(Object.entries(cls.operations ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))),
  } });
}
`;

async function readOnce(bundle) {
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
  // The trailing nonce is load-bearing even now that each read has a module cache of its own: a worker
  // may read two DIFFERENT bundles, and a `data:` URL's identity IS its content, so identical bytes
  // would return the cached module without re-running it — nothing would call `customElements.define`
  // and the read would fail with "defined no custom element".
  const source = Buffer.concat([bytes, Buffer.from(`\n//${randomUUID()}\n`)]);
  const snapshot = `data:text/javascript;base64,${source.toString('base64')}`;
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const worker = new Worker(new URL(`data:text/javascript;base64,${Buffer.from(IN_WORKER).toString('base64')}`), {
    workerData: { snapshot },
    // Nothing the bundle prints is this reader's answer, and a bundle that writes to stdout would
    // otherwise land in the middle of the build script's own output.
    stdout: true,
    stderr: true,
  });
  try {
    const read = await new Promise((resolve, reject) => {
      worker.once('message', (msg) => (msg.error ? reject(new Error(`${fileURLToPath(bundle)} ${msg.error}`)) : resolve(msg.read)));
      worker.once('error', reject);
      worker.once('exit', (code) => reject(new Error(`read-element: the reader exited (${code}) before answering`)));
    });
    return { ...read, digest };
  } finally {
    // ALWAYS, and awaited: the point of the worker is that it goes away, and an orphan holds its copy
    // of the bundle for the life of the process — which is the leak this replaced.
    await worker.terminate();
  }
}
