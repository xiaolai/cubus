// Writing attributes onto a `<cubus-cube>`, and only what changed.
//
// ONE CACHE, because there were two. The script runtime's writer (`lib/script-drive.js`) and the episode
// runtime's player (`lib/lesson-player.js`) each kept their own map of what they had last written, with
// the same rule spelled out twice — and they had already drifted: clearing a stale `facelets` before
// loading a segment was in one and not the other, which is a re-used element drawing the last screen's
// cube for a whole lesson (Codex audit, 2026-09-16, and it took two fixes on one day to see it).
//
// NOT THE TRANSPORT. What the two runtimes do with the cursor is genuinely different — one is a clock
// with a tempo, the other is stops a child presses through — and folding those together would be a
// shared function with a flag deciding which half runs. This is the part that is actually one rule.
//
// WHY A CACHE AT ALL: `focus` and `highlight` repaint 108 materials when written, and `scramble` rebuilds
// the cube. A write that changes nothing is not free, and a repaint of an unchanged frame should touch
// nothing at all.

/**
 * A write function for `cube`: `write(name, value)`, where `null` removes the attribute.
 *
 * Never reads the element back. The element moves on by itself as an animation completes, so comparing
 * against it would rewrite everything on every frame for a different reason; what this compares against
 * is what THIS writer last wrote. `force` is for the values that must be re-sent even when they have not
 * changed — a segment's `scramble` and `alg`, where two segments can load the same cube with different
 * sequences and the element only rebuilds when the attribute is written.
 */
export function createAttributeWriter(cube) {
  const written = new Map();
  return function write(name, value, { force = false } = {}) {
    if (!force && written.has(name) && written.get(name) === value) return;
    written.set(name, value);
    if (value === null) cube.removeAttribute(name);
    else cube.setAttribute(name, String(value));
  };
}
