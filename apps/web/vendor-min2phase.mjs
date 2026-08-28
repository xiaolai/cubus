// Vendor min2phase — the 3x3 solver — out of cubing's dist.
//
// The app used to solve through cubing's own API. It cannot any more: the feature is a solution
// LENGTH ("twenty moves or fewer"), improvements reported as they are found, and the ability to
// stop — and `solve333ToString(pattern)` has room for none of the three. So min2phase is taken
// directly, with its search bounds made settable, and cubing itself is no longer shipped.
//
// min2phase is also what TNoodle, the official WCA scramble program, uses for 3x3, so the one
// bundle serves both solving and scrambling.
//
// This reaches into a dependency's compiled internals, which is why every patch below asserts its
// match count. A patch that silently stopped applying would leave the app running min2phase's
// stock bounds while believing it had set them: solutions would keep coming, and every length
// target would be quietly ignored.
//
// The chunk itself has NO imports, so it needs no bundler — it is copied and patched, not built.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Resolve through an EXPORTED subpath: pnpm keeps the real files under .pnpm/ and symlinks them,
// so the layout is not ours to guess. It cannot be cubing/package.json — cubing's exports map does
// not expose it, and resolving it throws ERR_PACKAGE_PATH_NOT_EXPORTED.
const searchEntry = fileURLToPath(import.meta.resolve('cubing/search'));
const distRoot = dirname(dirname(searchEntry)); // <pkg>/dist/lib/cubing

const chunksDir = join(distRoot, 'chunks');
const min2phaseChunks = readdirSync(chunksDir).filter(
  (f) => f.endsWith('.js') && /function \$solution\(/.test(readFileSync(join(chunksDir, f), 'utf8')),
);
if (min2phaseChunks.length !== 1) {
  throw new Error(
    `vendor-min2phase: expected exactly one min2phase chunk under ${chunksDir}, found ` +
      `${min2phaseChunks.length}. cubing's layout changed; re-derive the patch before trusting it.`,
  );
}

function patch(text, from, to, expected) {
  const found = text.split(from).length - 1;
  if (found !== expected) {
    throw new Error(
      `vendor-min2phase: min2phase patch \`${from}\` matched ${found}x, expected ${expected}x.\n` +
        '  Its search bounds moved. Do NOT relax this check — the app would silently lose the\n' +
        '  ability to ask for a solution length, which is the entire point of vendoring it.',
    );
  }
  return text.split(from).join(to);
}

let min2phase = readFileSync(join(chunksDir, min2phaseChunks[0]), 'utf8');
min2phase = patch(min2phase, 'this$static.solLen = 22;', 'this$static.solLen = BOUNDS.solLen;', 1);
min2phase = patch(min2phase, 'this$static.probeMin = { l: 0, m: 0, h: 0 };', 'this$static.probeMin = BOUNDS.probeMin;', 1);
min2phase = patch(min2phase, 'this$static.probeMax = { l: 3531008, m: 23, h: 0 };', 'this$static.probeMax = BOUNDS.probeMax;', 1);
min2phase = patch(min2phase, 'init_0(false)', 'init_0(BOUNDS.fullInit)', 2);

const EXPORTS = 'export {\n  initialize,\n  solvePattern\n}';
if (!min2phase.includes(EXPORTS)) {
  throw new Error("vendor-min2phase: min2phase's export block is not the shape the patch expects.");
}
min2phase = min2phase.replace(
  EXPORTS,
  [
    '// Added by vendor-min2phase.mjs. min2phase is GWT-compiled and stores longs as {l,m,h} with',
    '// value = l + m*2^22 + h*2^44, which is why a probe budget goes through toLong().',
    'var BOUNDS = {',
    '  solLen: 22,',
    '  probeMin: { l: 0, m: 0, h: 0 },',
    '  probeMax: { l: 3531008, m: 23, h: 0 },',
    '  fullInit: true',
    '};',
    'var toLong = function (n) {',
    '  return { l: n % 4194304, m: Math.floor(n / 4194304) % 4194304, h: Math.floor(n / 17592186044416) };',
    '};',
    'var setBounds = function (b) {',
    '  if (b.solLen !== undefined) BOUNDS.solLen = b.solLen;',
    '  if (b.probeMax !== undefined) BOUNDS.probeMax = toLong(b.probeMax);',
    '  if (b.fullInit !== undefined) BOUNDS.fullInit = b.fullInit;',
    '};',
    'export {',
    '  initialize,',
    '  solvePattern,',
    '  setBounds',
    '}',
  ].join('\n'),
);

const min2phasePath = join(here, 'vendor', 'min2phase.js');
writeFileSync(min2phasePath, min2phase);

for (const f of ['min2phase.js']) {
  const p = join(here, 'vendor', f);
  if (!existsSync(p) || statSync(p).size === 0) {
    throw new Error(`vendor-min2phase: ${f} was not produced`);
  }
}

const mb = (f) => (statSync(join(here, 'vendor', f)).size / 1e6).toFixed(2);
console.log(
  `vendor-min2phase: wrote vendor/min2phase.js (${mb('min2phase.js')} MB, bounds settable, ` +
    `from ${min2phaseChunks[0]})`,
);
