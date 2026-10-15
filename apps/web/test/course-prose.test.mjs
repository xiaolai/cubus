// The gate that keeps the course's voice out of this repository.
//
// ADR 0006 decision 7, and the first risk the plan names. The boundary is NOT "episodes are closed
// and drills are open" — that discriminator was refuted by reading what a drill actually contains.
// A drill is facts PLUS writing: `test/fixtures/cubus-im-drills.mjs` carried
// `say: 'Where does this piece live?'` and `say: 'It lives here.'`, and cubus-im's own
// `build-predict.py` carries "Called it. Watch." in the course's voice. The line is **the authored
// words, not the artefact**: a round's scramble, slot, piece, turn and computed answer are facts
// and are open; every `say` is the course's and is not.
//
// The leak this exists to catch looks exactly like ordinary work: someone ports a working drill,
// its prompts and verdicts attached, because it works. Nothing else would notice — the rounds would
// be correct, the tests would pass, and All-Rights-Reserved writing would be sitting in an MIT tree.
//
// So: every `say` in this repository's course content must be a PLACEHOLDER, the way
// `episode-structure.json` already writes them (`"line 0"`, `"line 1"`). A placeholder says where a
// sentence goes without being one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PREDICTION, predictionScript, RECOGNITION, recognitionScript } from './fixtures/cubus-im-drills.mjs';

/**
 * What a `say` in this repo may be: a numbered placeholder, or nothing at all.
 *
 * Deliberately narrow. "Anything short" or "anything without punctuation" would admit
 * "It lives here." on a Tuesday and refuse it on a Wednesday, and a boundary that depends on how a
 * sentence happens to be written is not a boundary.
 */
const PLACEHOLDER = /^(?:line \d+|section at \d+)?$/;

/**
 * Every field that carries AUTHORED TEXT, named once.
 *
 * `say` was the whole list at first, because plan §1.4 wrote the acceptance that way. An audit
 * pointed out that ADR 0006's boundary is the WORDS, not one field name: `section` is a heading a
 * person wrote, and restoring real chapter titles to the fixtures would have passed a gate whose
 * whole purpose is to stop authored text entering this repository. A field list that is narrower
 * than the rule it enforces is a gate with a hole in it.
 */
const TEXT_FIELDS = new Set(['say', 'section']);

/** Every authored string in a structure, with the path it sat at, so a failure names where to look. */
function saysIn(node, path = '$', found = []) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => saysIn(child, `${path}[${i}]`, found));
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  for (const [key, value] of Object.entries(node)) {
    if (TEXT_FIELDS.has(key) && typeof value === 'string') found.push({ path: `${path}.${key}`, text: value });
    else saysIn(value, `${path}.${key}`, found);
  }
  return found;
}

/** Assert every `say` in `subject` is a placeholder, naming the first that is not. */
function noProse(subject, what) {
  for (const { path, text } of saysIn(subject)) {
    assert.match(
      text,
      PLACEHOLDER,
      `${what} carries authored prose at ${path}: ${JSON.stringify(text)}. `
        + 'The words belong to cubus-im (ADR 0006 decision 7); keep the round and replace the line '
        + 'with a placeholder like "line 0".',
    );
  }
}

test('the episode fixture carries structure, not narration', () => {
  const episode = JSON.parse(
    readFileSync(new URL('./fixtures/episode-structure.json', import.meta.url), 'utf8'),
  );
  noProse(episode, 'episode-structure.json');
});

test('the drill records carry no authored words', () => {
  noProse(RECOGNITION, 'cubus-im-drills.mjs RECOGNITION');
  noProse(PREDICTION, 'cubus-im-drills.mjs PREDICTION');
});

test('the drill SCRIPTS carry no authored words', () => {
  // The scripts are where the prose actually lives: the records are facts, and the builders wrap
  // them in prompts and reveal lines. A gate that read only the records would pass over the leak.
  for (const r of RECOGNITION) noProse(recognitionScript(r), 'recognitionScript');
  for (const r of PREDICTION) noProse(predictionScript(r), 'predictionScript');
});

test('the gate can tell a placeholder from a sentence', () => {
  // The gate's own acceptance. Without this, a broken PLACEHOLDER that matched everything would
  // leave all three cases above green while checking nothing — the failure mode this whole file
  // exists to prevent, one level up.
  assert.throws(
    () => noProse({ steps: [{ say: 'Where does this piece live?' }] }, 'a sample'),
    /carries authored prose at \$\.steps\[0\]\.say/,
  );
  assert.throws(() => noProse({ round: { reveal: [{ say: 'It lives here.' }] } }, 'a sample'), /authored prose/);
  // A SECTION HEADING is authored text too — the field the gate used to walk straight past.
  assert.throws(() => noProse({ cues: [{ section: 'Getting the edges home' }] }, 'a sample'),
    /carries authored prose at \$\.cues\[0\]\.section/);
  noProse({ steps: [{ say: 'line 0' }, { say: '' }] }, 'placeholders'); // does not throw
  noProse({ cues: [{ section: 'section at 3' }] }, 'placeholders');
});
