// The runtime under the name `WebDetector` actually reaches for.
//
// `load()` derives its runtime URL from the model URL — `<model dir>/ort.mjs` — so a fixture
// sitting at exactly that path is what lets the REAL load path run end to end with no wasm, no
// GPU and no 25 MB download: `createModelRunner` imports this, configures it, creates a session
// and warms it, exactly as it does in a browser.
//
// It re-exports the fake rather than being a second one. What these tests count is SESSIONS —
// whether two panel mounts build one InferenceSession or two — and every instance records that on
// the shared registry. Module IDENTITY per proxy mode is a different claim and model-runner.test.ts
// owns it, with its own per-case URLs.
export * from './fake-ort.mjs';
