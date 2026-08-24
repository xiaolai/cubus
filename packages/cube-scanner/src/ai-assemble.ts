// Assemble a validated ScanResult from the AI detector's per-sticker COLOUR CLASSES
// (0..5). The guided scan gives us 6 faces (identified by their centre colour) but each face is
// captured at an ARBITRARY rotation — the camera doesn't know which way is "up". A wrong per-face
// rotation lands the 8 outer stickers in the wrong facelet slots, so the cube reads as unsolvable.
//
// We recover the rotations by search: the user's real cube IS solvable, so the true rotation combo
// is always among the solvable ones. Try all 4^6 per-face rotations and keep the DISTINCT solvable
// facelet strings. Exactly one means it must be the true cube. None means no rotation fixes it, so
// the failure is a COLOUR misread.
//
// MORE THAN ONE IS NOT A FAILURE, AND IS NOT RARE. Six face photographs with no known up-direction
// genuinely do not determine the cube. A cube one U turn from solved reads identically to the same
// cube one D turn from solved — rotate the four side faces 180° and one becomes the other, both
// legal, both solvable. Measured over random rotations of states at a known distance from solved,
// the share of scans with a unique reading is:
//
//     moves from solved   0     1     2     3     4     5    10    20+
//     unique reading    100%    0%   10%   34%   50%   70%   96%   100%
//     with confirmation 100%  100%  100%  100%   99%   99%  100%    99%
//
// which is the worst possible shape for a beginner's tutor: a nearly-solved cube — exactly what a
// child hands it — is the case that cannot be read. Re-scanning cannot help either, because the
// ambiguity is a property of the cube's state, not of how the faces happened to be held.
//
// So when the reading is ambiguous we ask for the one missing bit instead of giving up: show ONE
// named side again, held a known way up. `confirmed` feeds that capture back in and FILTERS the
// already-verified candidates — it never adds one.
//
// That is not enough on its own, and the tempting argument that it is, is wrong: filtering keeps
// the answer inside the set of legal cubes, but a confirmation held 90 deg off can eliminate the
// TRUE reading and leave an impostor that is equally legal. Measured with every confirmation
// mis-held, that produced a confidently wrong cube in ~15% of ambiguous scans. Nothing in a single
// face image can distinguish a correctly held capture from one turned a quarter turn, because both
// are rotations of the same face.
//
// So a confirmation is never trusted alone. Once confirmations narrow the set to one reading, we
// ask for one FURTHER side and require the surviving reading to predict it — a face whose
// orientation is actually determined, so the check can fail. Two independent looks must agree, and
// a mis-hold makes them disagree, which shows up as no surviving reading at all.
//
// Colour-class indices match ml/data.yaml: 0 white 1 red 2 green 3 yellow 4 orange 5 blue.

import Cube from 'cubejs';
import { isStructurallyValid } from './facelet-cube.js';
import { FACES, type Face, type ScanResult } from './types.js';

/** One face as seen by the detector: 9 colour classes + 9 detection confidences, reading order. */
export interface ColorFace {
  colors: number[]; // 9 colour-class indices (0..5)
  confidence: number[]; // 9 per-sticker detector confidences (0..1)
}

/**
 * A request for the one extra look that breaks a tie: show `face` again, held with `up` facing
 * upwards. That fixes the captured rotation, because a face plus the face above it pins the cube.
 */
export interface ConfirmRequest {
  face: Face;
  up: Face;
}

/** ScanResult plus AI-path extras: a human reason, and how to make progress when it failed. */
export type AiScanResult = ScanResult & {
  reason?: string;
  ambiguous?: boolean;
  /** Set when one more look would help — to break a tie, to verify one, or to retry a mis-hold. */
  confirm?: ConfirmRequest;
  /** The confirmations contradict each other: one was mis-held, so they all have to be redone. */
  mismatch?: boolean;
};

/** 90° clockwise position map for a 3x3 face in reading order; the centre (index 4) is fixed. */
const ROT90 = [6, 3, 0, 7, 4, 1, 8, 5, 2] as const;

/**
 * The face that sits directly ABOVE each face in the URFDLB facelet layout — i.e. the side that
 * must point up for a capture of that face to be in canonical rotation. Four of the six answer
 * "U", which is why a side face is the one to ask about when there is a choice: "hold white up"
 * is an instruction a child can follow.
 */
const TOP_NEIGHBOUR: Readonly<Record<Face, Face>> = {
  U: 'B',
  R: 'U',
  F: 'U',
  D: 'F',
  L: 'U',
  B: 'U',
};

/** Rotate a 9-element face array 90° CW, `k` times (k is taken mod 4). */
function rotateFace<T>(a: T[], k: number): T[] {
  let out = a;
  for (let t = 0; t < ((k % 4) + 4) % 4; t++) out = ROT90.map((i) => out[i]!);
  return out;
}

function cubejsRoundTrips(facelets: string): boolean {
  try {
    return Cube.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}

function reject(reason: string, extra: Partial<AiScanResult> = {}): AiScanResult {
  return {
    facelets: '',
    valid: false,
    confidence: 0,
    lowConfidence: [...Array(54).keys()],
    reason,
    ...extra,
  };
}

/** The rotations of `face` under which the original capture reads exactly as `confirmed` does. */
function matchingRotations(original: ColorFace, confirmed: ColorFace): Set<number> {
  const want = confirmed.colors.join(',');
  const out = new Set<number>();
  for (let k = 0; k < 4; k++) {
    if (rotateFace(original.colors, k).join(',') === want) out.add(k);
  }
  return out;
}

/**
 * Choose which side to ask about: one the surviving readings actually disagree over, preferring a
 * side face so the instruction is "hold the white side up". Faces already confirmed are skipped,
 * so a second round asks about something new rather than looping on the same side.
 */
function pickConfirm(
  candidates: [string, number[][]][],
  confirmed: Partial<Record<Face, ColorFace>>,
): ConfirmRequest | undefined {
  const useful = FACES.filter((face, fi) => {
    if (confirmed[face]) return false;
    const perCandidate = candidates.map(([, combos]) =>
      [...new Set(combos.map((c) => c[fi]!))].sort().join(','),
    );
    return new Set(perCandidate).size > 1;
  });
  const face = useful.find((f) => TOP_NEIGHBOUR[f] === 'U') ?? useful[0];
  return face === undefined ? undefined : { face, up: TOP_NEIGHBOUR[face] };
}

/**
 * Choose the side to ask about in order to rule out readings that are not yet ruled out TWICE:
 * one whose reading the survivor predicts differently from each of them. Candidates producing the
 * same facelet string always predict the same reading of a face, so "predicts differently" is
 * exactly "their rotation sets are disjoint".
 */
function pickVerification(
  survivorCombos: number[][],
  weak: [string, number[][]][],
  confirmed: Partial<Record<Face, ColorFace>>,
): ConfirmRequest | undefined {
  let best: Face | undefined;
  let bestScore = 0;
  FACES.forEach((face, fi) => {
    if (confirmed[face]) return;
    const ours = new Set(survivorCombos.map((c) => c[fi]!));
    // How many still-standing readings this face would expose, plus a nudge towards a side face
    // so the instruction stays "hold the white side up".
    const score =
      weak.filter(([, combos]) => combos.every((c) => !ours.has(c[fi]!))).length +
      (TOP_NEIGHBOUR[face] === 'U' ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = face;
    }
  });
  return best === undefined || bestScore < 1 ? undefined : { face: best, up: TOP_NEIGHBOUR[best] };
}

/**
 * Turn 6 detected faces (colour classes, any rotation) into a validated ScanResult by solving each
 * face's rotation. Rejects a scan whose 6 centres are not 6 distinct colours (not a real cube) and
 * a colour misread (no rotation is solvable). When several readings survive, returns a `confirm`
 * request naming the one side to show again and the way up to hold it.
 *
 * @param confirmed Captures already known to be in canonical rotation, from answering a previous
 *   `confirm` request. These only narrow the candidates the search already validated.
 */
export function assembleColors(
  faces: Record<Face, ColorFace>,
  threshold = 0.15,
  confirmed: Partial<Record<Face, ColorFace>> = {},
): AiScanResult {
  // Centre colour → face letter. Centres don't move under rotation, so this is fixed. Two faces
  // sharing a centre colour is impossible on a real cube, so bail out loudly.
  const centreOwner = new Map<number, Face>();
  for (const face of FACES) {
    const f = faces[face];
    if (!f || f.colors.length !== 9 || f.confidence.length !== 9) {
      throw new Error(`face ${face}: expected 9 colours + 9 confidences`);
    }
    const centre = f.colors[4]!;
    if (centreOwner.has(centre)) return reject(`two faces share centre colour ${centre}`);
    centreOwner.set(centre, face);
  }
  if (centreOwner.size !== 6) return reject('the 6 centres are not 6 distinct colours');

  // Build the 54-char facelet string for one per-face rotation combo, or null if any sticker's
  // colour isn't one of the 6 centre colours (can't be placed on a real cube).
  const buildFacelets = (rots: number[]): string | null => {
    const letters: string[] = [];
    for (let fi = 0; fi < 6; fi++) {
      const rc = rotateFace(faces[FACES[fi]!]!.colors, rots[fi]!);
      for (let i = 0; i < 9; i++) {
        const owner = centreOwner.get(rc[i]!);
        if (owner === undefined) return null;
        letters.push(owner);
      }
    }
    return letters.join('');
  };

  // Search all 4^6 rotation combos, keeping EVERY combo that produces each distinct solvable
  // string — not just the first. A symmetric face (a solved side is the extreme case) is read the
  // same at several rotations, so one string legitimately has many combos, and a later
  // confirmation has to be able to match any of them. Each distinct string is validated once;
  // `null` marks one already rejected.
  const seen = new Map<string, number[][] | null>();
  const rots = [0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 4096; n++) {
    for (let i = 0; i < 6; i++) rots[i] = (n >> (2 * i)) & 3;
    const fl = buildFacelets(rots);
    if (fl === null) continue;
    let combos = seen.get(fl);
    if (combos === undefined) {
      combos = isStructurallyValid(fl) && cubejsRoundTrips(fl) ? [] : null;
      seen.set(fl, combos);
    }
    if (combos !== null) combos.push([...rots]);
  }
  const all = [...seen].filter((e): e is [string, number[][]] => e[1] !== null);

  if (all.length === 0) {
    return reject('no orientation of the faces is solvable — a colour was misread; re-scan');
  }

  // Narrow by any confirmed capture: keep a reading only if at least one of ITS combos rotates the
  // original capture into exactly what the confirmation saw. This is a filter over strings the
  // solvability gate already passed, so no confirmation — however badly held — can introduce a
  // cube that was not already verified.
  const confirmedFaces = FACES.filter((f) => confirmed[f]);
  const allowed = new Map<Face, Set<number>>();
  for (const face of confirmedFaces) {
    allowed.set(face, matchingRotations(faces[face]!, confirmed[face]!));
  }
  const candidates = all
    .map(([fl, combos]): [string, number[][]] => [
      fl,
      combos.filter((c) =>
        confirmedFaces.every((face) => allowed.get(face)!.has(c[FACES.indexOf(face)]!)),
      ),
    ])
    .filter(([, combos]) => combos.length > 0);

  if (candidates.length === 0) {
    // The scan itself was fine; the confirmation is what ruled everything out, so it was held the
    // wrong way up (or a sticker read differently the second time). Ask for the same side again
    // rather than throwing away five good faces.
    // Which confirmation was mis-held is not knowable from here, so re-asking only the last one
    // would loop forever when it was an earlier one. The caller drops them all and starts over.
    const last = confirmedFaces[confirmedFaces.length - 1]!;
    return reject('those two looks disagree — one was held the wrong way up; try again', {
      mismatch: true,
      confirm: { face: last, up: TOP_NEIGHBOUR[last] },
    });
  }

  if (candidates.length > 1) {
    const confirm = pickConfirm(candidates, confirmed);
    return reject(
      `${candidates.length} readings fit — this cube is close to solved, so one more look decides it`,
      { ambiguous: true, ...(confirm ? { confirm } : {}) },
    );
  }

  const [facelets, combos] = candidates[0]!;

  // Exactly one reading survives — but if a confirmation is what removed the others, that
  // confirmation is load-bearing and a mis-held one would have removed the TRUTH and kept an
  // impostor. So demand redundancy: every eliminated reading must be contradicted by at least TWO
  // separate looks. A truthful look can never contradict the real cube, so under that rule a
  // single mis-hold can no longer eliminate the truth on its own — the worst it can do is leave
  // the scan ambiguous, which is safe, instead of confidently wrong.
  //
  // Counting looks instead of contradictions is NOT enough and was the first thing tried: when a
  // scan needs two looks just to narrow down, both get spent narrowing and nothing checks anything.
  // Measured, that returned a wrong cube in 5% of scans where the user mis-held one look.
  const contradictions = (candidate: number[][]): number =>
    confirmedFaces.filter((face) => {
      const fi = FACES.indexOf(face);
      return candidate.every((c) => !allowed.get(face)!.has(c[fi]!));
    }).length;
  const weak = all.filter(([fl, c]) => fl !== facelets && contradictions(c) < 2);
  if (weak.length > 0) {
    const check = pickVerification(all.find(([fl]) => fl === facelets)![1], weak, confirmed);
    if (check) {
      return reject('one more look to be sure — a single look could be held wrong', {
        confirm: check,
      });
    }
    // No remaining side can tell the readings apart, so the answer would rest on one look that
    // nothing can check. Accepting here was measured leaking wrong cubes, so say so instead: a
    // single turn of any face breaks the symmetry and makes the next scan readable.
    return reject(
      'this cube is too symmetric to read for certain — turn any one face, then scan again',
      { ambiguous: true },
    );
  }

  // Rotate the confidences the same way for the report, using a combo that satisfies every
  // confirmation.
  const chosen = combos[0]!;
  const conf: number[] = [];
  for (let fi = 0; fi < 6; fi++) {
    for (const c of rotateFace(faces[FACES[fi]!]!.confidence, chosen[fi]!)) conf.push(c);
  }
  let min = 1;
  const lowConfidence: number[] = [];
  conf.forEach((c, i) => {
    if (c < min) min = c;
    if (c < threshold) lowConfidence.push(i);
  });
  return { facelets, valid: true, confidence: min, lowConfidence };
}
