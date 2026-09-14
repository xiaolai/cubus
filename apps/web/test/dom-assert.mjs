// Assertions about DOM nodes that stay fast when they fail.
//
// node:assert builds its failure message by inspecting both values to a great depth, and it ignores a
// custom inspect hook. A happy-dom node reaches its window, and through it the whole page, so the
// inspection walks all of it. Measured 2026-09-13: one failing `assert.equal(element, null, msg)` took
// 145 s to throw, where the same check written as a boolean fails in well under a second. Inside a
// suite that stalls long enough for the runner to give up on the whole file, and the failure never
// names the case that caught it — which is how a mutation check first reported a caught mutant as a
// survivor.
//
// So a DOM node never reaches node:assert. Each helper compares identity itself and fails with a short
// description of what it found. `dom-assert.test.mjs` fails if a test hands a queried node to
// node:assert again; it reads the source, so it cannot see a node held in a variable first — use these
// helpers for any node.

import assert from 'node:assert/strict';

/** `<input data-rename-cube="…">`, `[#text]`, `null` — enough to say what was found, and cheap. */
export function describeNode(node) {
  if (node === null) return 'null';
  if (node === undefined) return 'undefined';
  if (typeof node !== 'object') return String(node);
  if (node.nodeType === 1) {
    const attrs = [...node.attributes].slice(0, 4)
      .map((a) => ` ${a.name}="${String(a.value).slice(0, 40)}"`).join('');
    return `<${node.localName}${attrs}>`;
  }
  if (typeof node.nodeName === 'string') return `[${node.nodeName}]`;
  return Object.prototype.toString.call(node);
}

function fail(message, actual, expected, operator) {
  throw new assert.AssertionError({
    message: `${message ?? 'DOM assertion failed'} (found ${actual}, expected ${expected})`,
    actual,
    expected,
    operator,
  });
}

/** The node is not there: `null` or `undefined`. */
export function isAbsent(node, message) {
  if (node !== null && node !== undefined) fail(message, describeNode(node), 'no node', 'isAbsent');
}

/** The same node — identity, never structure. */
export function isSame(actual, expected, message) {
  if (actual !== expected) fail(message, describeNode(actual), describeNode(expected), 'isSame');
}

/** Not the same node. */
export function isNotSame(actual, expected, message) {
  if (actual === expected) fail(message, describeNode(actual), `anything but ${describeNode(expected)}`, 'isNotSame');
}
