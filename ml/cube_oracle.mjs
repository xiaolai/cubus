// The repo's OWN cube oracle, exposed to the Python simulations.
//
// Legality is not re-implemented here on purpose. `isCubeState` (apps/web/lib/cube-trust.js) is
// the full reachability round-trip the app already refuses forged states with — the registry and
// the reconnect readings are parsed with exactly it — so a string this accepts and a string the
// app accepts can never drift apart. A hand-rolled parity check in the simulation could.
//
//   node ml/cube_oracle.mjs gen 5000      -> JSON array of legal facelet strings
//   node ml/cube_oracle.mjs check < in    -> JSON array of booleans, one per input string
import { readFileSync } from 'node:fs';
import Cube from '../apps/web/vendor/cubejs.js';
import { isCubeState } from '../apps/web/lib/cube-trust.js';

const [, , cmd, arg] = process.argv;
if (cmd === 'gen') {
  const out = [];
  for (let i = 0; i < Number(arg); i++) out.push(Cube.random().asString());
  process.stdout.write(JSON.stringify(out));
} else if (cmd === 'check') {
  const strings = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify(strings.map((s) => isCubeState(s, Cube))));
} else {
  console.error('usage: cube_oracle.mjs gen <n> | check < strings.json');
  process.exit(2);
}
