// Every method the method solver can walk, for a sweep that claims "every method".
//
// `allMethods()` is the LADDER's: every rung combination on both last-layer routes. A registry entry of
// another family (Roux, lib/methods/roux.js) is built whole and is in no rung combination, so a sweep over
// `allMethods()` alone stayed green while never solving one cube with it (Codex refute pass, 2026-10-17).
// This list is both, and `every-method.test.mjs` holds it to the registry: every entry the method engine
// runs is in it, by the method its entry builds.
//
// Awaited at load, because a family's tables may have to be read first.

import { allMethods } from '../../lib/method-solver.js';
import { METHODS } from '../../lib/methods/registry.js';
import { methodOf, prepareMethod } from '../../lib/methods/method-of.js';

/** The registry entries built whole by a family of their own, not read off the ladder. */
export const FAMILY_ENTRIES = Object.freeze(METHODS.filter((e) => e.engine === 'method' && (e.method.family ?? 'ladder') !== 'ladder'));

for (const entry of FAMILY_ENTRIES) await prepareMethod(entry);

/** The ladder's every combination, then every family's method. */
export const EVERY_METHOD = Object.freeze([...allMethods(), ...FAMILY_ENTRIES.map(methodOf)]);
