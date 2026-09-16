// Trails — plan item 4.4 of dev-docs/tutorial-capability-plan.md.
//
// A trail's content is the ROUTE: which slots a piece passes through over a sequence, in order, and that it
// travels between them along the arc a turn really moves it on. The route is checked against cubejs's own
// piece tracking — an implementation that shares no code with the renderer's pose — and the arcs against
// the stops they join. How a trail LOOKS is the owner's to approve before a golden holds it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

import { slotVector } from '../../lib/cube-highlight.js';
import { installPublicCube } from './public-cube.mjs';
import { startBrowserFixture } from './harness.mjs';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');
const CORNERS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const COMMUTATOR = "R U R' U'";
const UPERM = "R U' R U R U R U' R' U' R2";
const EDGES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  await installPublicCube(page);
});

after(async () => { await fixture?.close(); });

const build = (attrs) => page.evaluate(async (a) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
  const cube = window.__publicCube(el);
  for (const [k, v] of Object.entries(a)) cube.setAttribute(k, v);
  el.clock = 1_000_000;
  document.body.appendChild(el);
  window.__cube = el;
  await new Promise((r) => requestAnimationFrame(() => r()));
}, attrs);
const trails = () => page.evaluate(() => (window.__cube._trailMeshes ?? []).filter((m) => m.userData.trail).map((m) => ({ ...m.userData })));

/** Where cubejs says a piece is after each prefix of `alg`, as slot positions, repeats collapsed. */
function route(piece, alg) {
  const names = piece.length === 3 ? CORNERS : EDGES;
  const id = names.findIndex((n) => [...n].sort().join('') === [...piece].sort().join(''));
  const cube = new Cube();
  const slotOf = () => names[(piece.length === 3 ? cube.cp : cube.ep).indexOf(id)];
  const out = [slotVector(slotOf())];
  for (const move of alg.split(' ').filter(Boolean)) {
    cube.move(move);
    const at = slotVector(slotOf());
    if (at.join() !== out[out.length - 1].join()) out.push(at);
  }
  return out;
}

test('a trail passes through the slots cubejs puts the piece in, in order', async () => {
  for (const [alg, piece] of [["R U R' U'", 'URF'], ["R U R' U'", 'UF'], ["R U' R U R U R U' R' U' R2", 'UF'], ["F R U R' U' F'", 'UR']]) {
    await build({ alg, trail: `piece:${piece}` });
    const [trail] = await trails();
    const expected = route(piece, alg);
    if (expected.length < 2) { assert.equal(trail, undefined, `${piece} does not move in "${alg}", and a trail was drawn`); continue; }
    assert.deepEqual(trail.stops, expected, `${piece} over "${alg}"`);
  }
});

test('between two stops the trail is the arc a turn moves the piece on, and lands on the next stop', async () => {
  // A regrip FIRST, so every later arc is about an axis the frame has turned — and a slice among the turns.
  await build({ alg: "x R U2 M'", trail: 'piece:UF,piece:DF' });
  for (const trail of await trails()) {
    const { stops, curve } = trail;
    // Every twelfth point of the curve is where a turn landed, and every point sits the piece's own distance
    // from the centre — an arc, not a chord through the cube.
    for (let k = 1; k < stops.length; k++) {
      assert.deepEqual(curve[k * 12].map((v) => Math.round(v * 1e6) / 1e6 + 0), stops[k], `${trail.trail}: turn ${k} did not land on its stop`);
    }
    const radius = Math.hypot(...stops[0]);
    for (const p of curve) assert.ok(Math.abs(Math.hypot(...p) - radius) < 1e-6, `${trail.trail}: a point of the curve left the sphere its cubie turns on`);
    // Drawn outside the stickers, where it can be seen: a trail lifted by a plain scale of its cubie's centre kept
    // a top-layer edge's path inside the cube, and a U permutation's whole trail drew hidden (found on the look sheet).
    assert.deepEqual(trail.lifted.filter((q) => Math.max(...q.map(Math.abs)) < 1.55), [], `${trail.trail}: part of the trail is inside the cube`);
  }
});

test('a slot names the piece standing in it where the sequence starts, and a word that is not one draws nothing', async () => {
  await build({ scramble: 'R', alg: "U R U'", trail: 'slot:UR' });
  const [bySlot] = await trails();
  // After the scramble `R`, the FR edge stands in UR: the trail is the FR edge's route over the sequence.
  const expected = (() => {
    const cube = new Cube(); cube.move('R');
    const id = cube.ep[EDGES.indexOf('UR')];
    const out = [slotVector('UR')];
    for (const move of ['U', 'R', "U'"]) {
      cube.move(move);
      const at = slotVector(EDGES[cube.ep.indexOf(id)]);
      if (at.join() !== out[out.length - 1].join()) out.push(at);
    }
    return out;
  })();
  assert.deepEqual(bySlot.stops, expected);
  await build({ alg: 'R', trail: 'layer:U' });
  assert.deepEqual(await trails(), [], 'a trail was drawn for a selector that names no single piece');
  await build({ alg: 'R', trail: 'piece:UF' });
  assert.deepEqual(await trails(), [], 'R does not move UF, and a trail was drawn');
});

test('a trail is drawn: the canvas changes when one is asked for', async () => {
  const shoot = () => page.evaluate(() => {
    const el = window.__cube;
    el._dirty = true; el._draw();
    const gl = el.renderer.getContext();
    const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Array.from(px);
  });
  // The U permutation's three edges: the case whose trail drew entirely hidden before its lift was fixed.
  const uperm = "R U' R U R U R U' R' U' R2";
  await build({ alg: uperm });
  const plain = await shoot();
  await build({ alg: uperm, trail: 'piece:UF,piece:UL,piece:UR' });
  const traced = await shoot();
  const changed = plain.filter((v, i) => Math.abs(v - traced[i]) > 8).length;
  assert.ok(changed > 3000, `a U permutation's trails changed only ${changed} channel values — they are not being seen`);
});

// `trail-style`, from the owner's reading of the look sheet on 2026-09-16: over `R U R' U'` the curve was
// hard to understand. It was one unbroken tube with one head at the very end, so it said where the piece
// ENDED and nothing about the order it got there in — and a commutator's path crosses itself, so at a
// crossing there was no way to tell which strand came first. Both styles answer that, differently; what
// neither may do is change the ROUTE, which is the only part of a trail that is a claim about the cube.
const meshes = () => page.evaluate(() => (window.__cube._trailMeshes ?? []).map((m) => ({
  kind: m.geometry.type, order: m.renderOrder, hasRecord: !!m.userData.trail,
})));

test('a style changes how the route is marked and never the route itself', async () => {
  const routeOf = async (style) => {
    await build({ alg: "R U R' U'", trail: 'piece:URF', 'trail-style': style });
    const [t] = await trails();
    return { stops: t.stops, curve: t.curve, lifted: t.lifted };
  };
  const steps = await routeOf('steps');
  const ribbon = await routeOf('ribbon');
  assert.deepEqual(steps, ribbon, 'the two styles disagree about where the piece went');
  // And the default is a style, not a third drawing: an element with no `trail-style` draws `steps`.
  await build({ alg: "R U R' U'", trail: 'piece:URF' });
  const [bare] = await trails();
  assert.deepEqual({ stops: bare.stops, curve: bare.curve, lifted: bare.lifted }, steps);
});

test('steps gives every turn its own head; ribbon gives one path that grows', async () => {
  // URF over this commutator is moved by three of the four turns — asked of the RECORD, not assumed, so the
  // count below is a statement about this cube rather than about this string.
  await build({ alg: "R U R' U'", trail: 'piece:URF', 'trail-style': 'steps' });
  const [t] = await trails();
  const turns = t.stops.length - 1;
  assert.ok(turns >= 3, `precondition: URF should move at least three times, moved ${turns}`);
  const stepped = await meshes();
  const heads = (list) => list.filter((m) => m.kind === 'ConeGeometry' && m.order === 3).length;
  const tubes = (list) => list.filter((m) => m.kind === 'TubeGeometry' && m.order === 3).length;
  assert.equal(tubes(stepped), turns, 'steps did not draw one segment per turn');
  assert.equal(heads(stepped), turns, 'steps did not give every turn its own head');

  await build({ alg: "R U R' U'", trail: 'piece:URF', 'trail-style': 'ribbon' });
  const ribboned = await meshes();
  assert.equal(tubes(ribboned), 1, 'ribbon broke the path');
  // One head at the end, and a chevron at each stop it passes THROUGH — the ends are not passed through.
  assert.equal(heads(ribboned), 1 + (turns - 1), 'ribbon did not mark the stops it passes');

  // The record lives on exactly one mesh, whichever style drew it: `stops` is one statement about one piece,
  // and spread over the segments it would be something every reader had to reassemble for themselves.
  for (const list of [stepped, ribboned]) assert.equal(list.filter((m) => m.hasRecord).length, 1);
  // Every part has its rim under it, in both styles.
  for (const list of [stepped, ribboned]) {
    assert.equal(list.filter((m) => m.order === 2).length, list.filter((m) => m.order === 3).length,
      'a mark was drawn without its rim, or a rim without its mark');
  }
});

test('a ribbon really is thinner where the piece started than where it stopped', async () => {
  // The claim the style is FOR: width says how far along you are. Measured on the geometry — the first ring
  // of the tube against the last — because "it is tapered" is otherwise a thing the comment says and the
  // code could quietly stop doing. A ring's radius is its vertices' distance from its own spine point.
  await build({ alg: "R U R' U'", trail: 'piece:URF', 'trail-style': 'ribbon' });
  const [thin, thick] = await page.evaluate(() => {
    const tube = window.__cube._trailMeshes.find((m) => m.geometry.type === 'TubeGeometry' && m.renderOrder === 3);
    const pos = tube.geometry.attributes.position;
    const { path, tubularSegments, radialSegments } = tube.geometry.parameters;
    const V = window.__cube.camera.position.constructor;
    const ringRadius = (i) => {
      const at = path.getPointAt(i / tubularSegments, new V());
      let worst = 0;
      for (let j = 0; j <= radialSegments; j++) {
        worst = Math.max(worst, new V().fromBufferAttribute(pos, i * (radialSegments + 1) + j).sub(at).length());
      }
      return worst;
    };
    return [ringRadius(0), ringRadius(tubularSegments)];
  });
  assert.ok(thin < thick * 0.6, `the ribbon starts at ${thin.toFixed(3)} and ends at ${thick.toFixed(3)} — it is not tapered`);
  assert.ok(thin > 0, 'the ribbon starts at no width at all');
});

// ONE INK, AND NUMERALS (owner's call, 2026-09-16: "unify one colour, and then numbers"). Several trails
// used to be told apart by colour, which raises a question the picture cannot answer — why is this one
// purple? — and needs a legend that is nowhere on the page. `2.3` is the second piece's third hop: it needs
// no key, survives one-colour printing, and can be read by someone who cannot tell violet from teal.
const numerals = () => page.evaluate(() => (window.__cube._trailMeshes ?? [])
  .filter((m) => m.userData.billboard).map((m) => m.userData.text));

test('every trail is drawn in one colour, and the numerals say which trail and which hop', async () => {
  await build({ alg: UPERM, trail: 'piece:UF,piece:UL,piece:UR' });
  const drawn = await trails();
  assert.equal(drawn.length, 3, 'precondition: a U permutation moves three edges');

  // One colour: every BODY material is the same. Read off the meshes, so a second colour creeping back in
  // through the style builders is caught rather than assumed away.
  const inks = await page.evaluate(() => [...new Set((window.__cube._trailMeshes ?? [])
    .filter((m) => m.renderOrder === 3 && !m.userData.billboard)
    .map((m) => m.material.color.getHexString()))]);
  assert.equal(inks.length, 1, `three trails were drawn in ${inks.length} colours: ${inks.join(', ')}`);

  // And the numerals are exactly the hops, trail by trail, with no gaps and nothing invented.
  const expected = drawn.flatMap((t, n) => t.stops.slice(1).map((_, k) => `${n + 1}.${k + 1}`));
  assert.deepEqual((await numerals()).sort(), expected.sort(),
    'the numerals are not one per hop of each trail, numbered from 1');

  // A single trail is numbered the same way: one format for a reader to learn, not two.
  await build({ alg: COMMUTATOR, trail: 'piece:URF' });
  const [one] = await trails();
  assert.deepEqual(await numerals(), one.stops.slice(1).map((_, k) => `1.${k + 1}`));
});

// THE THING ACTUALLY ASKED FOR (owner, 2026-09-16, pointing at the U permutation's ribbon): how do two
// trails stop overlapping? Nesting them on separate shells was the first answer and it was the wrong axis —
// shells separate trails along the LINE OF SIGHT, which is exactly the direction a picture flattens, so two
// trails a shell apart running the same way still land on each other in the drawing. Sliding each sideways
// in the surface, perpendicular to its own travel, is the separation a reader can see.
//
// What it cannot fix, and the measurement is written to admit it: where two routes genuinely CROSS, they
// cross. No offset removes an intersection, it only moves it. So the claim is not "never within W" — it is
// that they no longer run ALONGSIDE each other, which is a length, not a point. Measured over a U
// permutation and a corner cycle: 43.5% and 56.7% of one trail's length lay within a mark's width of
// another before, 0% and 0.9% after, and the 0.9% is two crossings.
test('two trails no longer run alongside each other, and only meet where their routes cross', async () => {
  const W = 0.13;    // a mark's full drawn width, body plus shadow
  const TOUCHING = 5; // per cent of a trail's length; measured 0 and 0.9, against 43.5 and 56.7 unseparated
  for (const [alg, spec, pieces] of [
    [UPERM, 'piece:UF,piece:UL,piece:UR', 3],
    ["R U R' U' R' F R2 U' R' U' R U R' F'", 'piece:URF,piece:UFL,piece:ULB', 3],
  ]) {
    await build({ alg, trail: spec });
    const drawn = await trails();
    assert.equal(drawn.length, pieces, `precondition: ${spec} should draw ${pieces} trails`);
    let near = 0; let total = 0;
    for (let a = 0; a < drawn.length; a++) {
      for (let b = a + 1; b < drawn.length; b++) {
        for (const p of drawn[a].lifted) {
          total++;
          if (drawn[b].lifted.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < W)) near++;
        }
      }
    }
    const pct = (near / total) * 100;
    assert.ok(pct <= TOUCHING, `${spec}: ${pct.toFixed(1)}% of a trail runs within a mark's width of another`);
  }
  // And a LONE trail is not slid at all: the offset is centred, so one trail has no neighbour to open away
  // from, and a single route must still pass over the stickers its piece passes over.
  await build({ alg: COMMUTATOR, trail: 'piece:URF' });
  const [only] = await trails();
  const shells = only.lifted.map((q) => Math.max(...q.map(Math.abs)));
  assert.ok(Math.max(...shells) - Math.min(...shells) < 1e-9,
    'a single trail was slid off its own shell, for a neighbour it does not have');
});

test('a numeral faces the reader, like the face letters', async () => {
  // The same mechanism, so the same claim: a numeral lying in some fixed plane is unreadable from most of
  // the angles the cube is actually drawn at, and a trail's whole job here is to be read.
  await build({ alg: COMMUTATOR, trail: 'piece:URF' });
  const off = await page.evaluate(() => {
    const el = window.__cube;
    el._dirty = true; el._draw();
    el.scene.updateMatrixWorld(true);
    const Q = el.camera.quaternion.constructor;
    return el._trailMeshes.filter((m) => m.userData.billboard)
      .map((m) => m.getWorldQuaternion(new Q()).angleTo(el.camera.quaternion));
  });
  assert.ok(off.length > 0, 'precondition: the trail is numbered');
  for (const a of off) assert.ok(a < 1e-6, `a numeral is ${a.toFixed(3)} rad off facing the reader`);
});

test('a style nobody recognises draws nothing, and says so', async () => {
  // Refused WHOLE, as a malformed selector is: a trail drawn in some other style than the one asked for is a
  // picture the author cannot check, and here — unlike an ink — the style IS how the route reads.
  await build({ alg: "R U R' U'", trail: 'piece:URF', 'trail-style': 'dotted' });
  assert.deepEqual(await trails(), [], 'an unknown trail-style drew a trail anyway');
  assert.deepEqual(await meshes(), [], 'an unknown trail-style left meshes behind');
});

// EVERY VERTEX THE RENDERER ACTUALLY DRAWS, not the path points the fit was computed from. Checking the
// recorded points was one implementation checking itself: the fit read `userData.lifted` and so did this,
// so the two agreed about a picture that was clipped — a tube is a few hundredths thick, a head is a cone
// past the end of the line, and a numeral is a plane beside it, none of which are on the path (audit and
// its verify pass, 2026-09-16). Read AFTER a draw, because `_faceCamera` turns the billboards then, and a
// billboard's orientation at fit time is not the one it is drawn in.
test('every vertex of every mark the renderer draws lands inside the canvas', async () => {
  for (const [attrs, why] of [
    [{ alg: COMMUTATOR, trail: 'piece:URF' }, "the commutator's corner loop, which once ran off the bottom"],
    [{ alg: UPERM, trail: 'piece:UF,piece:UL,piece:UR' }, 'three nested trails and their numerals'],
    [{ alg: 'R', trail: 'piece:UR' }, "an arrowhead on a tall frame — the audit's reproduction"],
    [{ alg: 'U', trail: 'piece:UF', 'camera-latitude': '85', 'camera-longitude': '90' }, 'a billboarded numeral seen from almost overhead'],
    [{ alg: COMMUTATOR, trail: 'piece:URF', 'trail-style': 'ribbon', arrow: 'next' }, 'a ribbon and an arrow together'],
  ]) {
    for (const [w, h] of [[240, 240], [320, 640], [640, 240]]) {
      const worst = await page.evaluate(async ([a, width, height]) => {
        if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
        const el = document.createElement('cubus-cube');
        el.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;z-index:99999`;
        for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
        el.clock = 1_000_000;
        document.body.appendChild(el);
        window.__cube = el;
        await new Promise((r) => requestAnimationFrame(() => r()));
        el._dirty = true; el._draw();
        el.root.updateMatrixWorld(true); el.camera.updateMatrixWorld(true);
        const V = el.camera.position.constructor;
        const marks = [...(el._trailMeshes ?? []), ...(el._arrow?.visible ? el._arrow.children : [])];
        let out = 0;
        for (const m of marks) {
          const pos = m.geometry?.attributes?.position;
          if (!pos) continue;
          m.updateMatrixWorld(true);
          for (let i = 0; i < pos.count; i++) {
            const p = new V().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(el.camera);
            out = Math.max(out, Math.abs(p.x), Math.abs(p.y));
          }
        }
        return Math.round(out * 10000) / 10000;
      }, [attrs, w, h]);
      assert.ok(worst <= 1, `${why} at ${w}x${h}: a drawn vertex reaches ${worst} of the frame`);
    }
  }
});
