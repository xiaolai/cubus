// A shape's thumbnail wears THE APP'S OWN COLOURS — the claim `lib/shape-thumb.js` makes, held.
//
// WHY THIS FILE EXISTS. The claim was written down and nothing checked it: deleting both `palette`
// and `scheme` from the `netSvg` call left all eight Shapes-screen cases green (audit, 2026-10-04),
// while every thumbnail in the app silently reverted to `netSvg`'s default — the muted Western set.
// On a Japanese cube that puts yellow where the child's cube shows blue, which is ADR 0001's whole
// subject, and it had already shipped once as a menu that disagreed with the target beside it
// (audit, 2026-09-27). `cube-flat.test.mjs` tests `netSvg` directly and so cannot see this door at
// all; the only way to catch it is to go through `shapeThumb`.
//
// THE MUTATION-KILLING ASSERTION IS THE ONE ABOUT CHANGE, not the one about equality. A thumbnail
// whose colours are hard-wired still equals itself; what it cannot do is FOLLOW a setting. So the
// cases below change the setting and require the drawing to change with it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { netSvg } from '../lib/cube-flat.js';
import { settings } from '../lib/app-settings.js';
import { OFFERED_PATTERNS, patternById } from '../lib/patterns.js';
import { shapeLook, shapeThumb } from '../lib/shape-thumb.js';
import { STICKER_PALETTES } from '../lib/sticker-palettes.js';

const WIDTH = 72;
/** Every `fill="…"` the drawing uses, in order — the thing a child actually sees. */
const fills = (svg) => [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);

/** Run `body` with the app's colour settings set as given, then put the real ones back. */
function withColours({ palette, scheme }, body) {
  const was = { palette: settings.palette, scheme: settings.scheme };
  Object.assign(settings, { palette, scheme });
  try { return body(); } finally { Object.assign(settings, was); }
}

test('a thumbnail is drawn in the colours the app is set to, not in netSvg\'s defaults', () => {
  const pattern = patternById('checkerboard');
  for (const palette of Object.keys(STICKER_PALETTES)) {
    withColours({ palette, scheme: 'western' }, () => {
      assert.equal(shapeThumb(pattern, WIDTH), netSvg(shapeLook(pattern), {
        width: WIDTH, title: pattern.name, palette, scheme: 'western',
      }), `${palette}: the thumbnail is not what the app's own settings draw`);
    });
  }
});

// THE CASE THE DELETED FORWARDING SURVIVES. Equality above is satisfied by any drawing that happens
// to match today's default; only a drawing that MOVES when the setting moves proves the setting is
// being read. Both axes, because `palette` and `scheme` are two separate arguments and dropping
// either one alone would pass a check that only exercised the other.
test('changing the palette changes the thumbnail, and so does changing the scheme', () => {
  const pattern = patternById('checkerboard');
  const palettes = Object.keys(STICKER_PALETTES);
  assert.ok(palettes.length >= 2, 'precondition: two palettes to tell apart');

  const drawn = (palette, scheme) => withColours({ palette, scheme }, () => fills(shapeThumb(pattern, WIDTH)));

  const [first, second] = palettes;
  assert.notDeepEqual(drawn(first, 'western'), drawn(second, 'western'),
    'two different palettes drew the same thumbnail — the palette is not reaching netSvg');

  // ADR 0001: only D and B differ between the schemes, so a Japanese cube differs from a Western one
  // on exactly the faces a tumble brings round. That is a real difference and it must be drawn.
  assert.notDeepEqual(drawn(first, 'western'), drawn(first, 'japanese'),
    'the Western and Japanese schemes drew the same thumbnail — the scheme is not reaching netSvg');
});

test('every offered shape draws, in every palette and both schemes', () => {
  // A thumbnail that throws is a menu or a grid that does not open at all, and a SET pattern takes a
  // different path to its picture than a state pattern (`targetPicture` rather than `look`), so both
  // kinds have to be drawn rather than assumed drawable.
  for (const palette of Object.keys(STICKER_PALETTES)) {
    for (const scheme of ['western', 'japanese']) {
      withColours({ palette, scheme }, () => {
        for (const pattern of OFFERED_PATTERNS) {
          const svg = shapeThumb(pattern, WIDTH);
          assert.match(svg, /^<svg/, `${pattern.id} (${palette}/${scheme}): not an SVG`);
          assert.equal(fills(svg).length, 54, `${pattern.id} (${palette}/${scheme}): not 54 stickers`);
        }
      });
    }
  }
});

test('a name reaches the drawing as its accessible name, and cannot reach it as markup', () => {
  // The names are data from `lib/patterns.js` today, and that file is built to have rows appended.
  // `netSvg` escapes the title into `aria-label` — the drawing's accessible name, and the ONLY
  // channel a screen reader has for a picture whose caption the audience cannot read. This is the
  // case that fails if it stops being escaped, or stops being passed at all.
  const pattern = patternById('checkerboard');
  assert.match(shapeThumb(pattern, WIDTH), /aria-label="The Checkerboard"/,
    'the shape\'s name is not the drawing\'s accessible name');
  const hostile = { ...pattern, name: '"><script>bad()</script>' };
  const svg = shapeThumb(hostile, WIDTH);
  assert.doesNotMatch(svg, /<script>/, 'a name was drawn as markup');
  assert.match(svg, /&lt;script&gt;/, 'the name was not escaped');
});

test('shapeLook answers the picture each kind actually shows', () => {
  for (const pattern of OFFERED_PATTERNS) {
    const look = shapeLook(pattern);
    assert.match(look, /^[UDLRFB?]{54}$/, `${pattern.id}: not a drawable picture`);
    // A STATE pattern shows its own exact cube; a SET pattern must leave the pieces it does not
    // care about grey, which is what makes it a set rather than one cube wearing the cheap label.
    if (pattern.kind === 'state') assert.equal(look, pattern.look, `${pattern.id}: not its own look`);
    else assert.ok(look.includes('?'), `${pattern.id} is a set pattern that claims every sticker`);
  }
});
