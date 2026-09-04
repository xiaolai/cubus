// The claims dev-docs/misread-decoding.md rests on. Each test here fails if one stops being true.

import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import { SOLVED_FACELETS, isStructurallyValid, rotateFace } from '../src/facelet-cube.js';
import { type ColorFaces, decodeMisread } from '../src/misread-decode.js';
import { FACES, type Face } from '../src/types.js';
import { scrambleFacelets } from './helpers.js';

const CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const RED = CLASS.R;
const ORANGE = CLASS.L;

const faces = (facelets: string): Record<Face, ColorFaces> => {
  const out = {} as Record<Face, ColorFaces>;
  FACES.forEach((face, fi) => {
    const colors: number[] = [];
    for (let k = 0; k < 9; k++) colors.push(CLASS[facelets[fi * 9 + k] as Face]!);
    out[face] = { colors };
  });
  return out;
};
/** The six faces as a user held them: each turned by `rotations[i]` quarter turns. */
const shownAs = (facelets: string, rotations: number[]): Record<Face, ColorFaces> => {
  const f = faces(facelets);
  FACES.forEach((face, fi) => {
    f[face]!.colors = rotateFace(f[face]!.colors, rotations[fi]!);
  });
  return f;
};
const centreOwner = (f: Record<Face, ColorFaces>): Map<number, Face> => {
  const m = new Map<number, Face>();
  for (const face of FACES) m.set(f[face]!.colors[4]!, face);
  return m;
};
const decode = (f: Record<Face, ColorFaces>, max?: number) =>
  decodeMisread(f, centreOwner(f), max === undefined ? {} : { maxDistance: max });

/** Change `n` distinct non-centre stickers of colour `from` to `to`. Returns what it touched. */
function misread(
  f: Record<Face, ColorFaces>,
  from: number,
  to: number,
  n: number,
): { face: Face; index: number }[] {
  const done: { face: Face; index: number }[] = [];
  for (const face of FACES) {
    for (let i = 0; i < 9 && done.length < n; i++) {
      if (i === 4 || f[face]!.colors[i] !== from) continue;
      f[face]!.colors[i] = to;
      done.push({ face, index: i });
    }
    if (done.length === n) break;
  }
  return done;
}

const legal = (s: string): boolean => {
  if (!isStructurallyValid(s)) return false;
  try {
    return Cube.fromString(s).asString() === s;
  } catch {
    return false;
  }
};

const DEEP = scrambleFacelets("R U F2 D' L B R2 F D U2 L2 B'");
const HELD = [0, 1, 0, 2, 0, 3];

// ---------------------------------------------------------------------------------------------
// The fact everything else rests on: two legal colourings are never closer than three stickers.
// ---------------------------------------------------------------------------------------------
describe('the code has minimum distance 3', () => {
  const LETTERS = ['U', 'R', 'F', 'D', 'L', 'B'];

  it('no legal colouring is one sticker from another', () => {
    let found = 0;
    for (let i = 0; i < 54; i++) {
      for (const c of LETTERS) {
        if (c === SOLVED_FACELETS[i]) continue;
        if (legal(SOLVED_FACELETS.slice(0, i) + c + SOLVED_FACELETS.slice(i + 1))) found++;
      }
    }
    expect(found).toBe(0);
  });

  it('no legal colouring is two stickers from another', () => {
    let found = 0;
    for (let a = 0; a < 54; a++) {
      for (let b = a + 1; b < 54; b++) {
        for (const ca of LETTERS) {
          if (ca === SOLVED_FACELETS[a]) continue;
          for (const cb of LETTERS) {
            if (cb === SOLVED_FACELETS[b]) continue;
            const arr = [...SOLVED_FACELETS];
            arr[a] = ca;
            arr[b] = cb;
            if (legal(arr.join(''))) found++;
          }
        }
      }
    }
    expect(found).toBe(0);
  });

  it('but three is reachable — the U-layer edge 3-cycle, white kept up', () => {
    // UR -> UF -> UL -> UR. Each moved edge keeps its white sticker on top and shows a different
    // side colour, so exactly the three side facelets change.
    const arr = [...SOLVED_FACELETS];
    arr[19] = 'R'; // UF slot now shows the UR piece's red sticker
    arr[37] = 'F'; // UL slot shows the UF piece's green sticker
    arr[10] = 'L'; // UR slot shows the UL piece's orange sticker
    const witness = arr.join('');
    let d = 0;
    for (let i = 0; i < 54; i++) if (witness[i] !== SOLVED_FACELETS[i]) d++;
    expect(d).toBe(3);
    expect(legal(witness)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('decodeMisread', () => {
  it('a clean scan needs no repair at all', () => {
    const r = decode(shownAs(DEEP, HELD));
    expect(r).toMatchObject({ kind: 'repair', distance: 0 });
  });

  it('one misread sticker: found, named in as-shown coordinates, and provably unique', () => {
    const shown = shownAs(DEEP, HELD);
    const was = shown.F!.colors[2]!;
    shown.F!.colors[2] = (was + 1) % 6;
    const r = decode(shown);
    expect(r).toMatchObject({ kind: 'repair', distance: 1, unique: true });
    if (r.kind !== 'repair') throw new Error('unreachable');
    // The index is into the capture AS SHOWN, because that is the sticker a user taps.
    expect(r.stickers).toEqual([{ face: 'F', index: 2, to: was }]);
  });

  it('the work budget covers the pairing, not only the two searches', () => {
    // `nodeBudget` is documented as a hard backstop on the WORK. It used to bound only the two DFS
    // walks, leaving |corners| x |edges| pairings — each with a `realise` and a cubejs `isLegal` —
    // outside it and on the main thread, quadratic in the quantity being bounded.
    //
    // This reading is the witness. Its DFS costs 3,404 nodes and its pairing loop then wants 3,968
    // more, so a budget of 3,500 must come back `unknown`: the search cannot finish for the work
    // it was lent. Uncharged, the same call returns a distance-4 repair — an answer bought with
    // work the caller refused. Three misreads on a scrambled cube do not show this at any budget;
    // the DFS dominates there, which is why an earlier search for a witness came back empty.
    const rows: Record<Face, string> = {
      U: '000000000',
      R: '111211131',
      F: '222222222',
      D: '313333533',
      L: '444443444',
      B: '555555535',
    };
    const shown = {} as Record<Face, ColorFaces>;
    for (const f of FACES) shown[f] = { colors: [...rows[f]].map(Number) };
    const own = new Map<number, Face>();
    FACES.forEach((f, i) => own.set(i, f));
    const opts = { fixedRotation: true, maxDistance: 4 };

    expect(decodeMisread(shown, own, { ...opts, nodeBudget: 3500 })).toEqual({ kind: 'unknown' });
    // …and lent enough, it answers. A backstop that refuses everything would pass the line above
    // while proving nothing.
    expect(decodeMisread(shown, own, { ...opts, nodeBudget: 20_000 })).toMatchObject({
      kind: 'repair',
      distance: 4,
    });
  });

  it('refuses a budget that cannot mean anything, rather than answering from it', () => {
    // `maxDistance` walks straight into every `<=` in the search. A NaN or a negative came back
    // as `{ kind: 'beyond', distance: NaN }` or `distance: -1`, which `diagnose` turns into a
    // misread COUNT and the panel puts in a sentence to a child — a number invented out of a
    // caller's typo, in the module whose whole discipline is never to invent one.
    const f = faces(SOLVED_FACELETS);
    const own = centreOwner(f);
    for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => decodeMisread(f, own, { maxDistance: bad })).toThrow(/maxDistance/);
      expect(() => decodeMisread(f, own, { nodeBudget: bad })).toThrow(/nodeBudget/);
    }
    // Absent still means "use the default", which is the whole point of them being optional.
    expect(decodeMisread(f, own, {})).toMatchObject({ kind: 'repair', distance: 0 });
  });

  it('a decoded distance of 1 is NOT a proof that one sticker was misread', () => {
    // The limit of minimum-distance decoding, pinned so it stays a known fact rather than a
    // surprise. `distance` is what the READING is worth, never what the user did.
    //
    // Take the solved cube and the 3-cycle witness three stickers away from it (above), then read
    // TWO of those three the witness's way. The reading is two stickers from the cube in the
    // user's hand and one from a legal cube they never held — so the decoder reports distance 1,
    // uniquely, and names the third sticker, which was read CORRECTLY. It cannot do better: on
    // this input there is no evidence anywhere that distinguishes the two cubes.
    //
    // Nothing here is a defect to fix; it is why the accusation the app makes is "fixing the
    // marked sticker makes this a solvable cube" — provable — and never "you misread this one".
    const arr = [...SOLVED_FACELETS];
    arr[19] = 'R';
    arr[37] = 'F'; // two of the witness's three, so the third (index 10) still reads correctly
    const reading = faces(arr.join(''));
    expect(legal(arr.join(''))).toBe(false); // two misreads: not a cube
    const r = decode(reading);
    expect(r.kind).toBe('repair');
    if (r.kind !== 'repair') throw new Error('unreachable');
    // ONE change away from legal, though two stickers were actually misread. The distance is a
    // property of the reading, and it is still an honest lower bound — just a loose one.
    expect(r.distance).toBe(1);
    // And it is not even one candidate. `unique` is false and four stickers are named: the search
    // runs over 4^6 rotations, and the R face's reading here is symmetric under a quarter turn, so
    // the same canonical repair lands on a different as-shown index under each of its four turns.
    // R1 — the sticker the camera read RIGHT — is one of the four.
    expect(r.unique).toBe(false);
    expect(r.stickers.map((s) => `${s.face}${s.index}`).sort()).toEqual(['R1', 'R3', 'R5', 'R7']);
    // And the four are not even interchangeable. Applied to the reading AS GIVEN, exactly ONE
    // yields a legal cube; the other three are legal only under the rotation combo that found
    // them, because `stickers` is in as-shown coordinates. So the list is not "four equally good
    // repairs" — it is one repair of an ambiguous reading plus three coordinates that only mean
    // anything alongside a rotation the caller never receives. A second, independent reason it
    // must never be shown as "fix this and you are done"; `ai-assemble.test.ts` pins what the app
    // now says instead.
    const legalAsGiven = r.stickers.filter((st) => {
      const repaired = [...arr];
      repaired[FACES.indexOf(st.face) * 9 + st.index] = FACES[st.to]!;
      return legal(repaired.join(''));
    });
    expect(legalAsGiven).toHaveLength(1);
    // The one that works is R1 — and it repairs the reading into the WITNESS, not into the solved
    // cube the user was holding. Being right about the colouring is not being right about the cube.
    expect(legalAsGiven[0]).toMatchObject({ face: 'R', index: 1 });
  });

  it('minimum distance 3 makes a single-sticker repair unique — never a list to choose from', () => {
    // Two legal cubes both one sticker from the same reading would be at most two apart, and the
    // suite above proves no such pair exists. Checked over many cubes, holds, and misreads.
    for (const alg of ["R U R' U' F2 L D'", "F R U' B2 L' D R2", "D' R2 F U L' B2 R"]) {
      for (const rot of [
        [0, 0, 0, 0, 0, 0],
        [0, 1, 2, 3, 0, 1],
        [1, 2, 3, 0, 2, 1],
      ]) {
        for (const [face, index] of [
          ['U', 0],
          ['R', 5],
          ['F', 7],
          ['B', 3],
        ] as [Face, number][]) {
          const shown = shownAs(scrambleFacelets(alg), rot);
          shown[face]!.colors[index] = (shown[face]!.colors[index]! + 3) % 6;
          const r = decode(shown);
          // Unconditionally. `if (r.kind !== 'repair' || r.distance !== 1) continue` skipped
          // exactly the failure this test names — a single misread the decoder does not find, or
          // finds at the wrong distance — and left it asserting uniqueness only where uniqueness
          // was already certain.
          expect(r.kind).toBe('repair');
          expect(r).toMatchObject({ kind: 'repair', distance: 1, unique: true });
          if (r.kind === 'repair') expect(r.stickers).toHaveLength(1);
        }
      }
    }
  });

  it('the distance is never an overstatement — the true cube is always a legal repair', () => {
    // The property that makes "at least N stickers were misread" honest. A single overstatement
    // here would make the app claim more damage than exists.
    // A fixed generator, so a failure here is always reproducible.
    let claimed = 0;
    let seed = 20260828;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const ALGS = [
      "R U R' U' F2 L D'",
      "R U F2 D' L B R2 F D U2 L2 B'",
      "F R U' B2 L' D R2",
      "D' R2 F U L' B2 R",
    ];
    let checked = 0;
    for (const k of [1, 2, 3, 4]) {
      for (let trial = 0; trial < 6; trial++) {
        const alg = ALGS[Math.floor(rnd() * ALGS.length)]!;
        const shown = shownAs(
          scrambleFacelets(alg),
          [0, 1, 2, 3, 4, 5].map(() => Math.floor(rnd() * 4)),
        );
        const cells: [Face, number][] = [];
        for (const f of FACES) for (let i = 0; i < 9; i++) if (i !== 4) cells.push([f, i]);
        const hit = new Set<string>();
        while (hit.size < k) {
          const [f, i] = cells[Math.floor(rnd() * cells.length)]!;
          hit.add(`${f},${i}`);
        }
        for (const key of hit) {
          const f = key.split(',')[0] as Face;
          const i = Number(key.split(',')[1]);
          const was = shown[f]!.colors[i]!;
          let to = was;
          while (to === was) to = Math.floor(rnd() * 6);
          shown[f]!.colors[i] = to;
        }
        if (centreOwner(shown).size !== 6) continue;
        const r = decode(shown, 5);
        checked++;
        if (r.kind === 'repair') expect(r.distance).toBeLessThanOrEqual(k);
        else if (r.kind === 'beyond') expect(r.distance).toBeLessThanOrEqual(k);
        else continue; // 'unknown' claims nothing, so it cannot overstate — but see below
        claimed++;
      }
    }
    expect(checked).toBeGreaterThan(15);
    // `unknown` is the one verdict this property cannot be tested against, so a decoder that
    // returned it every time would pass the loop above without ever being examined. Require that
    // the runs mostly produced a claim.
    expect(claimed).toBeGreaterThan(checked / 2);
  });

  it('a balanced red/orange swap — invisible to colour counting — is found', () => {
    // One red read as orange AND one orange read as red leaves all six counts at exactly 9, so
    // the old count-guided search never even started. This is the detector's documented weak pair.
    const shown = shownAs(DEEP, HELD);
    const red = misread(shown, RED, ORANGE, 1);
    const orange = shown.R!.colors.findIndex((c, i) => i !== 4 && c === ORANGE);
    expect(orange).toBeGreaterThanOrEqual(0);
    shown.R!.colors[orange] = RED;

    const counts = new Map<number, number>();
    for (const f of FACES)
      for (const c of shown[f]!.colors) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect([...counts.values()]).toEqual([9, 9, 9, 9, 9, 9]); // no imbalance to count

    const r = decode(shown);
    expect(r).toMatchObject({ kind: 'repair', distance: 2 });
    if (r.kind !== 'repair') throw new Error('unreachable');
    expect(r.stickers).toHaveLength(2);
    expect(r.stickers).toContainEqual({ face: 'R', index: orange, to: ORANGE });
    expect(r.stickers).toContainEqual({ face: red[0]!.face, index: red[0]!.index, to: RED });
  });

  it('partial cancellation: counting infers one misread, the decoder reports three', () => {
    // Two oranges read as red plus one red read as orange shows up as a 10/8 imbalance — exactly
    // what one misread looks like — so the old search hunted a single-sticker repair that does
    // not exist and found nothing.
    const shown = shownAs(DEEP, HELD);
    misread(shown, ORANGE, RED, 2);
    const back = shown.U!.colors.findIndex((c, i) => i !== 4 && c === RED);
    if (back >= 0) shown.U!.colors[back] = ORANGE;
    const counts = new Map<number, number>();
    for (const f of FACES)
      for (const c of shown[f]!.colors) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.get(RED)).toBe(10); // reads as a single misread…
    expect(counts.get(ORANGE)).toBe(8);
    const r = decode(shown);
    expect(r.kind).toBe('repair');
    if (r.kind !== 'repair') throw new Error('unreachable');
    expect(r.distance).toBeGreaterThan(1); // …but is not one
  });

  it('reports `beyond` rather than guessing when the damage exceeds the cap', () => {
    const shown = shownAs(DEEP, HELD);
    misread(shown, ORANGE, RED, 4);
    misread(shown, CLASS.U, CLASS.B, 3);
    const r = decode(shown, 2);
    expect(r).toEqual({ kind: 'beyond', distance: 2 });
  });

  it('refuses rather than answering from a truncated search when the node budget runs out', () => {
    const shown = shownAs(DEEP, HELD);
    misread(shown, ORANGE, RED, 3);
    const r = decodeMisread(shown, centreOwner(shown), { maxDistance: 4, nodeBudget: 500 });
    expect(r).toEqual({ kind: 'unknown' });
  });

  it('stays inside the checking budget for the failures it is meant to handle', () => {
    // scheduleCheck stops the camera and shows "Checking" before this runs, so it fills a
    // labelled wait — but it is still the main thread, and a phone is several times slower.
    //
    // Measured in NODES, not milliseconds. This asserted `elapsed < 1000` against a case that
    // takes ~58 ms on an idle machine — a 17x margin — and still went red on a laptop busy with
    // other work, which is a gate that reports the machine rather than the code. A node is
    // deterministic and proportional to time, so the budget travels: it is the same substitution
    // the solver already made for `probeMax`, for the same reason.
    //
    // 40,000 against a measured need between 10,000 and 25,000: loose enough that a fair
    // implementation change does not trip it, tight enough that the ~14x blow-up the old
    // count-guided search had would.
    const shown = shownAs(DEEP, HELD);
    misread(shown, ORANGE, RED, 3);
    const r = decodeMisread(shown, centreOwner(shown), { maxDistance: 4, nodeBudget: 40_000 });
    expect(r.kind).toBe('repair');
    // And the budget is doing work: the same call at a quarter of it must refuse rather than
    // answer, or this test would pass against any cost at all.
    const again = shownAs(DEEP, HELD);
    misread(again, ORANGE, RED, 3);
    expect(
      decodeMisread(again, centreOwner(again), { maxDistance: 4, nodeBudget: 10_000 }),
    ).toEqual({ kind: 'unknown' });
  });
});

describe('the lower bound presumes the centres were read right', () => {
  it('two swapped centres are reported as far more damage than the two they are', () => {
    // THE LIMIT OF THE GUARANTEE, pinned so the docstring cannot quietly become false.
    //
    // "The distance is never an OVERSTATEMENT" is proved against the colouring the CENTRES define:
    // `centreOwner` turns a colour into the face that owns it, so a centre read as another face's
    // colour does not add one wrong sticker — it RENAMES every sticker of that colour, on all six
    // sides, and the "true cube" the proof leans on is a cube nobody held. The true damage here is
    // two stickers; what comes back is a number several times larger, and the app would put it in
    // "at least N stickers were misread".
    //
    // Nothing in a reading can see this: the six centres are still six distinct colours, which is
    // the only property a reading lets us check. So it is a stated limit, and this test is what
    // keeps the statement honest — if a future decoder learns to detect it, this goes red and the
    // docstring is updated with it rather than after it.
    const f = faces(DEEP);
    const u = f.U.colors[4]!;
    const r = f.R.colors[4]!;
    f.U.colors[4] = r;
    f.R.colors[4] = u;
    const owner = centreOwner(f);
    expect(owner.size).toBe(6); // still six distinct centres — nothing looks wrong
    const got = decodeMisread(f, owner);
    const reported = got.kind === 'unknown' ? Number.POSITIVE_INFINITY : got.distance;
    expect(reported).toBeGreaterThan(2);
  });
});
