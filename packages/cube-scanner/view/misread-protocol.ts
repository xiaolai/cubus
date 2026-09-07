// What a misread decode is ASKED and what it ANSWERS — one shape, and one implementation of the
// work behind it, shared by the worker (`misread-worker.ts`) and by the fallback that runs on the
// calling thread when a page has no worker (`misread-client.ts`).
//
// Its own module, small as it is, because it is the only thing those two bundles have in common.
// Keeping it in the client would put the client's spawn logic inside the worker's bundle, where
// esbuild drops it — and a dropped declaration is invisible to the staleness guard in
// `apps/web/test/vendor-bundles.test.mjs`, which then needs a list of names it is allowed not to
// find. A list like that goes off for every private method anyone adds. One module both bundles
// keep whole needs no list at all.

import {
  type ColorFaces,
  diagnoseAcrossSchemes,
  diagnoseMisread,
  type SchemeDiagnosis,
} from '../src/misread-decode.js';
import type { Face } from '../src/types.js';

/** A decode to run: the six faces as read, and how they were read. */
export interface MisreadRequest {
  /**
   * The caller's serial number for the reading this describes, returned unchanged in the reply.
   *
   * The decode can outlive its subject — a correction, a re-shown side or a restart while it runs
   * leaves it describing a cube that is no longer on screen — so the answer has to carry enough
   * for the caller to recognise a stale one. The caller compares, not this module: only it knows
   * what has happened to the scan since.
   */
  epoch: number;
  /**
   * Keyed by SLOT for a camera reading (the colour's name, `scheme.ts`), by POSITION for a
   * painted one — the two callers' own conventions, and `fixedRotation` says which this is.
   */
  faces: Record<Face, ColorFaces>;
  /**
   * `false`: photographed at unknown rotations, filed by colour; decoded under every scheme,
   * because a refused reading says nothing about which the cube has (ADR 0001).
   * `true`: painted in place, positions known, centres already the scheme; decoded once, as
   * given — the rotation search would otherwise let the decoder turn a face back and report
   * "0 misreads" about a cube that was just refused.
   */
  fixedRotation: boolean;
}

/** One decode's answer, tagged with the epoch of the reading it is about. */
export interface MisreadReply {
  epoch: number;
  diagnosis: SchemeDiagnosis;
}

/**
 * Run one decode.
 *
 * The whole of the worker is this call, and so is the whole of the fallback — which is what makes
 * "the worker's answer is the synchronous answer" a property of the code rather than a hope about
 * two copies. Neither diagnosis throws, so neither does this.
 */
export function handleMisreadRequest(request: MisreadRequest): MisreadReply {
  return {
    epoch: request.epoch,
    diagnosis: request.fixedRotation
      ? diagnoseMisread(request.faces, { fixedRotation: true })
      : diagnoseAcrossSchemes(request.faces),
  };
}
