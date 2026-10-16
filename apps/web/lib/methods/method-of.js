// A registry entry's method, BUILT: the engine's stage descriptors for the spec the entry declares.
//
// Separate from the registry because building is expensive and the registry is read on the UI thread:
// this module imports lib/methods/index.js, which builds every rung's repertoire when it loads. Only the
// lesson worker (lib/lesson-worker.js) and the tests load it.

import { methodFor } from './index.js';

const built = new Map();

/**
 * The method `entry` declares, as `methodFor` builds it — once per entry. Throws for an entry with no
 * stages, and for one whose built stages are not the ones it declares: a second list beside the method's
 * own would be free to drift, so the two are compared where the method is made.
 */
export function methodOf(entry) {
  if (entry?.engine !== 'method') throw new Error(`methodOf: "${entry?.id}" is not a method with stages`);
  const held = built.get(entry.id);
  if (held) return held;
  const method = methodFor(entry.method.rungs, { lastLayer: entry.method.lastLayer });
  const ids = method.stages.map((stage) => stage.id);
  if (ids.length !== entry.stages.length || ids.some((id, i) => id !== entry.stages[i])) {
    throw new Error(`methodOf: "${entry.id}" declares the stages ${entry.stages.join(', ')} and builds ${ids.join(', ')}`);
  }
  built.set(entry.id, method);
  return method;
}
