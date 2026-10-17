// The algorithm library, off the main thread (lib/drill/library-client.js says why, and what crosses).
//
// Deliberately thin: everything worth testing is `answerLibrary` and `catalogueOf` in library-client.js,
// which node runs. The library's rows are computed here once and kept for the worker's lifetime.

import { answerLibrary } from './library-client.js';

const load = () => import('../alg-library.js');

self.addEventListener('message', async (event) => {
  self.postMessage(await answerLibrary(load, event.data));
});
