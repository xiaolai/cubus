// What a centre resolution is ASKED and what it ANSWERS — one shape, and one implementation of the
// work behind it, shared by the worker (`centres-worker.ts`) and by the fallback that runs on the
// calling thread when a page has no worker (`centres-client.ts`).
//
// Its own module for the reason `misread-protocol.ts` gives: it is the only thing those two bundles
// have in common, and keeping it in the client would put the client's spawn logic inside the
// worker's bundle, where esbuild drops it — invisible to the staleness guard in
// `apps/web/test/vendor-bundles.test.mjs`.
//
// WHY IT IS OFF THE PAGE'S THREAD (D3, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3).
// `resolveCentres` enumerates every way the unnamed sides could fill the free slots and runs a
// whole assembly per filing. Measured on the dev Mac by the audit's own `dev-docs/scan-pipeline-audit-2026-09-23/verify.ts`: 26 ms, 54 ms,
// 148 ms and 509 ms for one to four unnamed sides, before any phone slowdown — half a second in
// which the page cannot draw, at the exact moment a child is waiting to be told their cube is done.
//
// Why a worker and not an idle-callback slice: the work is one enumeration with a whole assembly
// inside it and no yield point, exactly as `decodeMisread` is one DFS. Moving it is the only way it
// stops blocking.

import {
  type CentreResolution,
  type ColorFace,
  MAX_CENTRE_FILINGS,
  resolveCentres,
  type UnnamedSide,
} from '../src/ai-assemble.js';
import type { Face } from '../src/types.js';

/** A resolution to run: the sides in hand, named and not. */
export interface CentresRequest {
  /**
   * The caller's serial number for the scan this describes, returned unchanged in the reply.
   *
   * The resolution can outlive its subject — a correction, a re-shown side or a restart while it
   * runs leaves it describing a cube that is no longer in hand — so the answer carries enough for
   * the caller to recognise a stale one. The caller compares, not this module: only it knows what
   * has happened to the scan since. This IS the cancellation the audit asks for: there is nothing
   * to interrupt inside one enumeration, so what is cancelled is the answer's authority.
   */
  epoch: number;
  named: Partial<Record<Face, ColorFace>>;
  unnamed: UnnamedSide[];
  /** The most filings to assess before refusing. See `MAX_CENTRE_FILINGS`. */
  budget?: number;
}

/** One resolution's answer, tagged with the epoch of the scan it is about. */
export interface CentresReply {
  epoch: number;
  resolution: CentreResolution;
}

/**
 * Run one resolution.
 *
 * The whole of the worker is this call, and so is the whole of the fallback — which is what makes
 * "the worker's answer is the synchronous answer" a property of the code rather than a hope about
 * two copies.
 *
 * `diagnose: false` because the misread decode has a thread of its own already
 * (`misread-client.ts`), and running it here would put the two seconds it can spend inside this
 * worker instead of inside that one.
 */
export function handleCentresRequest(request: CentresRequest): CentresReply {
  return {
    epoch: request.epoch,
    resolution: resolveCentres(
      request.named,
      request.unnamed,
      undefined,
      { diagnose: false },
      {},
      request.budget ?? MAX_CENTRE_FILINGS,
    ),
  };
}
