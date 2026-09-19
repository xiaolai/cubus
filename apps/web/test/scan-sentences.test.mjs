// No sentence the scan can show names a cause the scanner never measured (2026-09-18).
//
// "Hold it flatter and steadier." was on screen in six half-second flashes of a twenty-second scan,
// every one of them while the person was turning to the next side or had a finger over a column —
// the scanner had measured neither a tilt nor a shake. "Get the whole side in the frame" had been the
// same kind of sentence: usually false, and asking a child to do the scanner's job. So the words that
// carried those claims are refused anywhere in the scanner's and the scan screen's literals, and each
// sentence that remains rests on what `dev-docs/scan-guidance-plan.md` §1.1 records for it.
//
// A word list cannot catch every paraphrase; it catches the ones built from the same words, which is
// how a removed claim usually comes back. The audit table is the record of the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { walk } from './app-source.mjs';

const read = (url) => readFileSync(url, 'utf8');

/**
 * Every file whose words can reach the scan screen: the scanner's panel, the scan screen, and every
 * module either of them imports, followed onwards.
 *
 * Read from the imports rather than from a folder: a sentence moved one module further away — into a
 * service, a shared helper, the notices — is the same sentence on screen, and a folder read stopped
 * at the screen's own parts (audit, 2026-09-19). Package imports are not followed: a dependency's
 * words are not ours to hold to this, and the scanner's own tree is reached through its entry.
 */
function reachable(entries) {
  const seen = new Set();
  const queue = entries.map((rel) => new URL(rel, import.meta.url));
  while (queue.length) {
    const url = queue.pop();
    if (seen.has(url.href)) continue;
    let src;
    try { src = read(url); } catch { continue; }
    seen.add(url.href);
    // Every shape an import can take: a `from` clause however many lines its names span, a
    // side-effect import with no names at all, and a dynamic one inside a call — a one-line `from`
    // pattern saw only the first of the three (audit, 2026-09-19). Written without an example path,
    // because a relative path in a comment is a pointer the repository checks (no-dangling-pointers).
    for (const m of src.matchAll(/from\s*['"](\.[^'"]+)['"]|\bimport\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      queue.push(new URL(m[1] ?? m[2], url));
    }
  }
  return [...seen];
}

const SOURCES = [
  // The bundle the app actually loads, as well as the sources it was built from: a bundle that has
  // drifted from them ships words nobody scanned (audit, 2026-09-19). `vendor-bundles.test.mjs`
  // holds the two to each other; this holds what is SERVED.
  new URL('../vendor/ai-scan-panel.js', import.meta.url).href,
  ...reachable(['../../../packages/cube-scanner/view/ai-scan-panel.ts', '../lib/screens/scan.js']),
];

/** Each refused wording, a sentence that carries it, and the claim nothing measured. Spaces match any
 *  run of whitespace, because a hole closed up (`will ${qualifier} settle`) leaves more than one. */
const UNMEASURED = [
  [/\bflat(ter)?\b/i, ' Hold it flatter and steadier.', "a tilt: nothing measures a side's angle"],
  [/\bsteadier\b/i, 'Hold the cube steadier.', 'a shake: the stillness gate counts identical reads, it does not see a hand'],
  [/\bcentred\b/i, 'Keep the side centred in the frame.', 'a position in a picture nobody is shown'],
  [/\bwill\s+settle\b|\bsettles\s+itself\b|\bsaved\s+once\b|\bas\s+soon\s+as\s+it\s+holds\s+still\b/i,
    'More light will settle it, and it is saved once it holds still.',
    'a promise the capture rule does not make: a still read can still be refused'],
  [/\bmore\s+light\b/i, 'Try more light on the cube.',
    'brightness: what is measured is that WARM light confuses red, orange and yellow'],
  [/\busual(ly)?\b|\bworks\s+well\b|\bcommon\b|\bstandard\s+colours\b|\bmost\s+cubes\b/i,
    'This usually works well on most cubes with standard colours.', 'a frequency nobody counted'],
  [/nothing\s+more\s+from\s+you/i, 'Hold it there — nothing more from you.',
    'that a hold settles the scan: the assembly never prefers the hold a side was shown in'],
];

/** What a file can put on screen: every sentence, holes and concatenations closed up (`walk`). */
const sentencesOf = (href) => walk(read(new URL(href))).sentences;

test('no sentence the scan can show names a cause the scanner never measured', () => {
  assert.ok(SOURCES.some((f) => f.endsWith('/spoken.js')), "the import walk found none of the screen's modules");
  assert.ok(SOURCES.some((f) => f.endsWith('/solving-hold.js')), 'the import walk stopped at the screen’s own folder');
  assert.ok(SOURCES.length > 20, `the import walk reached only ${SOURCES.length} files`);
  const found = [];
  for (const file of SOURCES) {
    for (const sentence of sentencesOf(file)) {
      for (const [word, , claim] of UNMEASURED) {
        if (word.test(sentence)) found.push(`${file}: "${sentence.trim()}" — ${claim}`);
      }
    }
  }
  assert.deepEqual(found, []);
});

test('the guard sees every sentence it exists to refuse — written whole, split by a hole, or built by adding up', () => {
  const hits = (src) => walk(src).sentences.filter((l) => UNMEASURED.some(([w]) => w.test(l)));
  // Each refused wording has a sentence of its own here, so an entry cannot be deleted or mistyped
  // and go on "passing" until some production copy happens to carry it again (audit, 2026-09-19).
  for (const [word, sentence, claim] of UNMEASURED) {
    assert.equal(hits(`const line = ${JSON.stringify(sentence)};`).length, 1, `${claim}: the guard does not see "${sentence}"`);
    assert.ok(word.test(sentence), `${claim}: its own example does not carry the wording`);
  }
  // The same claim split across a hole or an addition is the same sentence on screen.
  assert.equal(hits('const line = `the ${cell} sticker will settle it`;').length, 1);
  assert.equal(hits('const line = `it will ${adverb} settle now`;').length, 1, 'a claim split by a hole was read as two');
  assert.equal(hits("const line = 'hold it ' + how + ' flatter';").length, 1, 'a claim added up from pieces was read as two');
  assert.equal(hits("const line = t('hold it') + ' flatter';").length, 1, 'a claim added to a translated piece was read as two');
  // …and neither a comment nor two unrelated neighbours is a sentence.
  assert.equal(hits('// held flat and centred\nconst ok = "Show any side of your cube to the camera.";').length, 0);
  assert.equal(hits("const words = ['it will', 'settle'];").length, 0, 'two unrelated strings were read as one sentence');
});
