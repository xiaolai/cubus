// What Roux costs as it ships: loading its tables, and a solve — in node, and in WebKit, the engine an iPhone runs.
//
//   node bench/roux-solve.mjs [n]     # n seeded scrambles, default 100
//
// The spike (bench/roux-spike.mjs) measured the searches with tables BUILT on the spot; since the owner's call
// of 2026-10-17 they ship, so the cost a learner meets is the load — read, check, and build the two small
// last-six-edges tables — and then the solve itself, measured here beside CFOP (full) on the same cubes.
// Node's figures are process CPU, because the machine this runs on is shared; WebKit's are wall time on the
// page, which is what is there to read.

import { solveByMethod } from '../lib/method-solver.js';
import { methodById } from '../lib/methods/registry.js';
import { methodOf, prepareMethod } from '../lib/methods/method-of.js';
import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { seededScrambles } from '../test/fixtures/seeded-scrambles.mjs';
import { startBrowserFixture } from '../test/browser/harness.mjs';

const N = Number(process.argv[2] ?? 100);
if (!Number.isInteger(N) || N < 1) throw new Error(`n must be a positive integer, not ${process.argv[2]}`);
const cpuMs = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); return { mean: s.reduce((a, b) => a + b, 0) / s.length, p50: s[Math.floor(s.length / 2)], max: s.at(-1) }; };
const line = (label, s) => `  ${label.padEnd(26)} mean ${s.mean.toFixed(1).padStart(7)}  p50 ${s.p50.toFixed(1).padStart(7)}  max ${s.max.toFixed(1).padStart(7)}`;

const scrambles = seededScrambles(N, 0x2005, 25);

let t = cpuMs();
await prepareMethod(methodById('roux'));
const prepared = cpuMs() - t;
const roux = methodOf(methodById('roux'));
const cfop = methodOf(methodById('cfop'));
const ms = { roux: [], cfop: [] };
const moves = [];
for (const s of scrambles) {
  const state = applyAlg(SOLVED, s);
  t = cpuMs(); const r = solveByMethod(state, roux); ms.roux.push(cpuMs() - t);
  moves.push(r.moveCount);
  t = cpuMs(); solveByMethod(state, cfop); ms.cfop.push(cpuMs() - t);
}
console.log(`node ${process.version}, n = ${N} — CPU ms`);
console.log(`  prepare (read, check, build the small tables): ${prepared.toFixed(0)} ms`);
console.log(line('Roux, one solve', stats(ms.roux)));
console.log(line('CFOP (full), one solve', stats(ms.cfop)));
console.log(line('Roux face turns', stats(moves)));

const fx = await startBrowserFixture({ engine: 'webkit' });
try {
  const page = await fx.browser.newPage();
  await page.goto(`${fx.base}/index.html`);
  const web = await page.evaluate(async (list) => {
    const [{ solveByMethod: solve }, { methodById: byId }, { methodOf: build, prepareMethod: prepare }, { SOLVED: S, applyAlg: apply }] = await Promise.all([
      import('/lib/method-solver.js'), import('/lib/methods/registry.js'), import('/lib/methods/method-of.js'), import('/lib/cube-pieces.js'),
    ]);
    let at = performance.now();
    await prepare(byId('roux'));
    const prep = performance.now() - at;
    const m = build(byId('roux'));
    const each = [];
    for (const s of list) { at = performance.now(); solve(apply(S, s), m); each.push(performance.now() - at); }
    return { prep, each };
  }, scrambles);
  console.log(`\nWebKit (Playwright) on this machine — wall ms`);
  console.log(`  prepare: ${web.prep.toFixed(0)} ms`);
  console.log(line('Roux, one solve', stats(web.each)));
} finally {
  await fx.close();
}
