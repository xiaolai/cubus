// The stage chips a method's walk can stop at, as TARGETS — the Restore row's list (ADR 0011 decision 5;
// owner's call Q8, 2026-10-16: the row shows the CHOSEN method's stops).
//
// A method entry names its stops by target id (lib/methods/registry.js); the chips need the descriptors
// themselves — predicate, picture, hold and worker search — so this is the one place an entry's stops
// become targets. Quick declares no stops of its own: its walk to a chip is the repair race, which can
// reach any chip, so it shows the beginner's row, which is the row every install had before methods.
//
// Its own module because the registry is data beneath the target table and must not import it, and the
// target table is pure and must not know about methods.

import { methodById } from './methods/registry.js';
import { targetById } from './stage-targets.js';

/** The targets the Restore row offers while `methodId` is chosen, in the entry's order. Throws on an
 *  unknown method or an unknown stop — a row silently missing a chip is a stop nobody can press. */
export function stopTargets(methodId) {
  const entry = methodById(methodId);
  const ids = entry.stops.length > 0 ? entry.stops : methodById('beginner').stops;
  return Object.freeze(ids.map((id) => targetById(id)));
}
