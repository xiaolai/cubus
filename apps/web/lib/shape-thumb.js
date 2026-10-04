// How a shape is drawn SMALL — the one picture the cube screen's menu and the Shapes screen share.
//
// A second screen drawing the pictures is why this exists. The menu had worked out for itself which
// facelet string a pattern shows, that the app's own palette has to be passed in, and that the name
// goes in as text rather than as markup; a grid of the same pictures on another screen would have
// been a second copy of all three, free to drift. That is the shape AGENTS.md records for the cube's
// 3D view — "how the app's cubes LOOK belongs to `applyCubeView`, never to one screen" — and it
// applies to the flat view for the same reason.
//
// A FLAT NET, NEVER `<cubus-cube>`. The page runs on ONE WebGL context on purpose (`parkCube` in
// lib/cube-drawing.js), so a grid of live renderers would be one context per thumbnail. A net costs
// nothing, scales by construction, and already draws a free sticker faint — which is exactly what a
// SET pattern needs: a plus on every face is a picture ABOUT the edges, and its corners must not
// look decided.

import { netSvg } from './cube-flat.js';
import { settings } from './app-settings.js';
import { targetPicture } from './stage-picture.js';

/**
 * The 54-sticker string a pattern shows.
 *
 * A state pattern carries its own `look`, computed from its algorithm. A set pattern is a real
 * target, so its picture comes from the engine's own drawing with the free pieces grey — never from
 * `look`, which it does not have.
 */
export const shapeLook = (pattern) =>
  (pattern.kind === 'state' ? pattern.look : targetPicture(pattern.target.id));

/**
 * One shape's picture, as SVG markup ready to insert.
 *
 * THE APP'S OWN COLOURS, because `netSvg` defaults to the muted Western set and a thumbnail is a
 * picture of the cube in front of the child. On the Japanese scheme the default put yellow where
 * their cube shows blue — ADR 0001's whole subject, arriving as a menu that disagreed with the
 * target beside it (audit, 2026-09-27, reproduced on Japanese + classic).
 *
 * THE NAME IS THE SVG'S TITLE AND NOTHING ELSE, which is about the rows this file is built to have
 * appended rather than about the twenty here. `netSvg` escapes its own title — the one place a flat
 * view escapes anything — and the look is `[UDLRFB?]` by construction, so the markup returned is
 * markup these two modules produced. A caller putting the name on screen writes it with
 * `textContent`, so a name is never parsed as markup at all, which is stronger than remembering to
 * escape it at each site.
 */
export const shapeThumb = (pattern, width) => netSvg(shapeLook(pattern), {
  width, title: pattern.name, palette: settings.palette, scheme: settings.scheme,
});
