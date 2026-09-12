// Write `vendor/cubus-cube.manifest.json`: what the bundle beside it can be asked to do.
//
// WHY IT EXISTS. cubus-im inlines the bundle into every artifact it builds, and it has to know
// whether the bundle understands what it is about to write. Its instrument for that today is
// `'camera-up' not in text` — a substring grep, which passes on a bundle that only MENTIONS the
// attribute in a comment, and which has to be hand-written once per feature. This turns that into
// a list it can loop over, so the next dependency gets its check for free instead of by hand.
//
// WHAT IT DOES NOT PROMISE. A declared attribute is not an implemented one: leaving `orientation`
// in `observedAttributes` while deleting its `_set()` branch keeps this manifest honest and the
// behaviour gone. It answers "is this build allowed to be asked", never "does it work" — and it
// must not be mistaken for the second, which needs a behavioural check on the consumer's side.
//
// THE DIGEST IS THE LOAD-BEARING FIELD. A manifest and a bundle are two files that travel
// separately, and a fresh manifest beside a stale bundle would advertise capabilities that are not
// there — the exact failure this is meant to prevent, reintroduced by the prevention. A consumer
// that checks the digest against the bytes it is about to inline cannot be fooled that way.
//
// NO RELEASE VERSION, deliberately. A version number invites comparing numbers instead of asking
// the question, and the question is what stays true when the upstream reorganises — cubus-im's
// `docs/preflight.md` rule 24, paid for by three places that told readers to check out a branch
// that had already merged. It would also be an eleventh site for `pnpm bump` to keep in step.
// `schema` is here because the SHAPE of this file may change and a reader needs to know it can
// still parse it; that is a different question from which release produced it.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readElement } from './read-element.mjs';

const OUT = new URL('./vendor/cubus-cube.manifest.json', import.meta.url);

const element = await readElement();
const manifest = {
  schema: 1,
  tag: element.tag,
  bundle: 'cubus-cube.js',
  digest: element.digest,
  attributes: element.attributes,
  methods: element.methods,
};
writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `${fileURLToPath(OUT)}: ${manifest.attributes.length} attributes, ${manifest.methods.length} methods`,
);
