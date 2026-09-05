// The misread decoder, on its own thread.
//
// Bundled separately from `ai-scan-panel.js` because a worker is a separate script by definition,
// and deliberately thin: everything it knows is `handleMisreadRequest`, which the panel's fallback
// also calls, so the two answers cannot come to differ. It carries its own copy of cubejs (the
// decoder's second legality oracle) — duplication the audit already flags, and the price of the
// panel's thread not being the one that spends three seconds proving a scan unreadable.
//
// Why a worker and not an idle-callback slice: `decodeMisread` is one DFS under a node budget with
// no yield point, so there is nothing to slice. Moving it is the only way it stops blocking.
//
// No try/catch here, and that is not an omission: `diagnoseMisread` is documented as never
// throwing, and it logs and claims nothing where a defect would otherwise escape. A catch here
// would be a second, weaker copy of that rule — and one that answered nothing at all, since a
// worker that swallows an error still owes its caller a reply.

import { handleMisreadRequest, type MisreadRequest } from './misread-protocol.js';

self.addEventListener('message', (ev: MessageEvent) => {
  self.postMessage(handleMisreadRequest(ev.data as MisreadRequest));
});
