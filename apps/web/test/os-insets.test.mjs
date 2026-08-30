// The .app box pads by the OS insets, and where those come from is platform-specific in a way that
// is easy to "simplify" away. On iOS env(safe-area-inset-bottom) covers the home indicator; in
// Chromium env(safe-area-inset-*) reports the DISPLAY CUTOUT only, so Android's gesture navigation
// bar is invisible to it and reads 0 — measured on a Pixel 8 emulator (API 36, 2026-08-30), where
// the bottom tab row consequently ran flush to the viewport edge, under the pill.
//
// The fix is a fallback chain: --os-inset-* (written by the Android activity) then env(). These
// hold that chain in place, because collapsing it back to a bare env() looks like a tidy-up and
// silently returns the bug on one platform only.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const kotlin = readFileSync(
  path.resolve(
    root,
    '../desktop/src-tauri/gen/android/app/src/main/java/im/cubus/app/MainActivity.kt',
  ),
  'utf8',
);

const SIDES = [
  ['t', 'top'],
  ['r', 'right'],
  ['b', 'bottom'],
  ['l', 'left'],
];

test('every inset falls back through --os-inset-* to env()', () => {
  for (const [side, edge] of SIDES) {
    const want = `--inset-${side}: var(--os-inset-${side}, env(safe-area-inset-${edge}, 0px))`;
    assert.ok(
      html.includes(want),
      `index.html should declare "${want}" — the platform layer must be able to supply an inset env() cannot see`,
    );
  }
});

test('no inset is left reading env() directly', () => {
  // A bare `--inset-b: env(...)` is exactly the regression this guards: it works on iOS and puts
  // the tab row under the gesture bar on Android.
  for (const [side, edge] of SIDES) {
    const bare = `--inset-${side}: env(safe-area-inset-${edge}`;
    assert.ok(
      !html.includes(bare),
      `index.html still declares --inset-${side} straight from env(); it must go through --os-inset-${side} first`,
    );
  }
});

test('the Android activity writes all four --os-inset-* properties', () => {
  for (const [side] of SIDES) {
    assert.ok(
      kotlin.includes(`'--os-inset-${side}'`),
      `MainActivity.kt should set --os-inset-${side}; a partial set leaves one edge wrong`,
    );
  }
});

test('the Android activity asks for system bars, not just the cutout', () => {
  // The whole point: the gesture bar is a system-bar inset. Asking only for displayCutout() would
  // reproduce exactly the zero that env() already reports.
  assert.match(kotlin, /WindowInsetsCompat\.Type\.systemBars\(\)/);
  assert.match(kotlin, /WindowInsetsCompat\.Type\.displayCutout\(\)/);
});

test('the Android activity re-pushes after the document can exist', () => {
  // Insets are dispatched on attach, possibly before there is a document to write to; a dropped
  // first write would leave the first screen with the wrong bottom edge for the whole session.
  assert.match(kotlin, /postDelayed/, 'MainActivity.kt should re-push the insets after page load');
});
