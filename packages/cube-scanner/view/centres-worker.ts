// The centre resolution, on its own thread.
//
// Bundled separately from `ai-scan-panel.js` because a worker is a separate script by definition,
// and deliberately thin: everything it knows is `handleCentresRequest`, which the panel's fallback
// also calls, so the two answers cannot come to differ. It carries its own copy of cubejs (the
// assembly's second legality oracle) — the same duplication `misread-worker.ts` pays, and the price
// of the panel's thread not being the one that spends half a second placing six centres.
//
// No try/catch here, and that is not an omission. `resolveCentres` answers with a refusal rather
// than throwing for every condition it anticipates; a catch here would be a second, weaker copy of
// that rule, and one that answered nothing at all — a worker that swallows an error still owes its
// caller a reply. What a genuine defect must do is reach the client's error handler, which has one
// (`onerror`), so that the scan falls back to this thread rather than waiting for ever.

import { type CentresRequest, handleCentresRequest } from './centres-protocol.js';

self.addEventListener('message', (ev: MessageEvent) => {
  self.postMessage(handleCentresRequest(ev.data as CentresRequest));
});
