// The algorithm library, off the main thread (lib/drill/library-client.js says why, and what crosses).
//
// Deliberately thin: everything worth testing is `answerLibrary` and `catalogueOf` in library-client.js,
// which node runs. The library's rows are computed here once and kept for the worker's lifetime.

import { answerLibrary, postAnswer } from './library-client.js';

const load = () => import('../alg-library.js');

// `postAnswer`: an answer `postMessage` cannot clone is sent as a refusal, so the page hears at once rather
// than at its deadline, and nothing rejects in here where nobody listens.
self.addEventListener('message', async (event) => {
  postAnswer(await answerLibrary(load, event.data), (answer) => self.postMessage(answer));
});
