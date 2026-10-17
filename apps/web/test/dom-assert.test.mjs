// The DOM assertion helpers (test/dom-assert.mjs), and the rule that keeps queried nodes away from
// node:assert. A failing node:assert comparison on a happy-dom node took 145 s to throw, long enough
// to hide which case failed — so the helpers are held to failing fast, and the suite to using them.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { after, test } from 'node:test';

import { Window } from 'happy-dom';

import { describeNode, isAbsent, isNotSame, isSame } from './dom-assert.mjs';

const win = new Window({ url: 'http://localhost/' });
after(async () => { await win.happyDOM.close(); });
const doc = win.document;
const input = doc.createElement('input');
input.setAttribute('data-stamp', 'typing');
const para = doc.createElement('p');
para.id = 'p';
doc.body.append(input, para);

test('each helper passes on what it asserts, and fails fast naming what it found', () => {
  isAbsent(null, 'absent');
  isAbsent(undefined, 'absent');
  isSame(input, input, 'same');
  isNotSame(input, para, 'not the same');

  // What makes a failure slow is a NODE reaching node:assert, which inspects it to the whole page. So the
  // error must carry descriptions, never the node — asserted directly, where a wall-clock bound said it
  // indirectly and could fail on a machine that merely stalled (fast-tier flake hunt, 2026-10-17).
  const described = (e) => e instanceof assert.AssertionError && typeof e.actual === 'string' && typeof e.expected === 'string';
  assert.throws(() => isAbsent(input, 'the field is gone'),
    (e) => described(e) && /the field is gone/.test(e.message) && /<input data-stamp="typing">/.test(e.message));
  assert.throws(() => isSame(input, para, 'focus is on the field'),
    (e) => described(e) && /focus is on the field/.test(e.message) && /<input/.test(e.message) && /<p id="p">/.test(e.message));
  assert.throws(() => isNotSame(input, input, 'focus moved'), (e) => described(e) && /focus moved/.test(e.message));
  assert.equal(describeNode(doc.createTextNode('x')), '[#text]');
});

test('no test hands a queried DOM node to node:assert', () => {
  // The shapes a queried node takes in these suites. A node held in a variable first is invisible to a
  // source scan, which is the limit dom-assert.mjs states.
  const NODE = String.raw`\$\([^()]*\)|[A-Za-z_$][\w$.]*\.querySelector\([^()]*\)|[A-Za-z_$][\w$]*\(\)\.querySelector\([^()]*\)|(?:win\.)?document\.activeElement|[A-Za-z_$][\w$.]*\.closest\([^()]*\)\??(?:\.parentElement)?`;
  const CALL = String.raw`assert\.(?:equal|strictEqual|notEqual|notStrictEqual|deepEqual|deepStrictEqual)\(`;
  const first = new RegExp(String.raw`${CALL}\s*(?:${NODE})\s*,`);
  const second = new RegExp(String.raw`${CALL}[^;]*?,\s*(?:${NODE})\s*[,)]`);
  const dirs = [['test', ''], ['test/browser', 'browser/']];
  const offenders = [];
  for (const [dir, prefix] of dirs) {
    for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((n) => n.endsWith('.mjs'))) {
      if (prefix === '' && f.startsWith('dom-assert')) continue;
      const lines = readFileSync(new URL(`../${dir}/${f}`, import.meta.url), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.replace(/^\s*\/\/.*$/, '');
        if (first.test(code) || second.test(code)) offenders.push(`${prefix}${f}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, [], 'these compare a DOM node with node:assert — use isAbsent / isSame / isNotSame');
});
