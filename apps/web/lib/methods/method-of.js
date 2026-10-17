// A registry entry's method, BUILT: the engine's stage descriptors for the spec the entry declares.
//
// Separate from the registry because building is expensive and the registry is read on the UI thread:
// this module imports lib/methods/index.js, which builds every rung's repertoire when it loads. Only the
// lesson worker (lib/lesson-worker.js) and the tests load it.

import { methodFor } from './index.js';

/** By the ENTRY OBJECT, never its id: two entries sharing an id are two definitions, and the second must
 *  be checked and built on its own rather than handed the first one's method. */
const built = new WeakMap();

/**
 * The method `entry` declares, as `methodFor` builds it — once per entry object. Throws for an entry with no
 * stages, and for one whose built stages are not the ones it declares: a second list beside the method's
 * own would be free to drift, so the two are compared where the method is made.
 */
export function methodOf(entry) {
  if (entry?.engine !== 'method') throw new Error(`methodOf: "${entry?.id}" is not a method with stages`);
  const held = built.get(entry);
  if (held) return held;
  const made = methodFor(entry.method.rungs, { lastLayer: entry.method.lastLayer });
  const ids = made.stages.map((stage) => stage.id);
  if (ids.length !== entry.stages.length || ids.some((id, i) => id !== entry.stages[i])) {
    throw new Error(`methodOf: "${entry.id}" declares the stages ${entry.stages.join(', ')} and builds ${ids.join(', ')}`);
  }
  // THE HOLD RULE TRAVELS WITH THE METHOD: the driver reads it off what it is handed (`solveByMethod`), so a
  // rule declared in the entry and never carried would be a hold nobody executes. One rule per method.
  const { executable } = entry.holds;
  if (executable.length !== 1) throw new Error(`methodOf: "${entry.id}" declares ${executable.length} executable holds; the driver takes one`);
  const method = Object.freeze({ ...made, turns: executable[0].turns });
  built.set(entry, method);
  return method;
}
