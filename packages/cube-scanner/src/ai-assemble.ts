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
// A confirmation is a ROTATION measurement, not a colour measurement — the colours were already
// accepted from the first capture; the second look exists only to say which way up the side was.
// So it is matched by BEST rotation (minimum sticker disagreement), not sticker-for-sticker.
// Exact matching was the original sin here: the detector's held-out colour accuracy is ~90%, so
// the re-shown side routinely reads one sticker differently, exact match then fails at EVERY
// rotation, and a correctly-held look got blamed as "held the wrong way up". Measured against the
// panel's old drop-and-retry policy, a 2% per-sticker misread on the second look threw away 11%
// of once-turned scans; at 10% it threw away two thirds. Min-distance matching with one flipped
// sticker finds the unique true rotation in 93.5% of trials, ties (harmlessly — tied rotations
// are near-symmetries that mostly read the same) in the rest, and picked a WRONG rotation in 0 of
// 400. When no rotation comes within CONFIRM_TOLERANCE the two reads disagree about COLOURS, not
// about the hold — that is `reread`: the caller adopts the fresh, deliberately-held capture as the
// side's reading and re-assembles, rather than blaming the user for a read the camera changed.
//
// Tolerant or not, filtering alone is not enough, and the tempting argument that it is, is wrong:
// filtering keeps the answer inside the set of legal cubes, but a confirmation held 90 deg off can
// eliminate the TRUE reading and leave an impostor that is equally legal. Measured with every
// confirmation mis-held, that produced a confidently wrong cube in ~15% of ambiguous scans.
// Nothing in a single face image can distinguish a correctly held capture from one turned a
// quarter turn, because both are rotations of the same face — a mis-held look matches its wrong
// rotation at distance 0, so tolerance changes nothing about that case.
//
// So a confirmation is never trusted alone. Once confirmations narrow the set to one reading, we
// ask for one FURTHER side and require the surviving reading to predict it — a face whose
// orientation is actually determined, so the check can fail. Two independent looks must agree, and
// a mis-hold makes them disagree, which shows up as no surviving reading at all.
//
// Colour-class indices match ml/data.yaml: 0 white 1 red 2 green 3 yellow 4 orange 5 blue.

import Cube from 'cubejs';
import { isStructurallyValid, rotateFace } from './facelet-cube.js';
import { type MisreadDecode, decodeMisread } from './misread-decode.js';
import { FACES, type Face, type ScanResult } from './types.js';

export { rotateFace };

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

/**
 * A sticker a colour misread most plausibly landed on: flipping it to `to` makes the scan a legal
 * cube. `index` is into the capture AS SHOWN — what a host's tile displays — so a suspect maps
 * straight onto the sticker a user can tap.
 */
export interface StickerSuspect {
  face: Face;
  index: number;
  to: number;
}

/** ScanResult plus AI-path extras: a human reason, and how to make progress when it failed. */
export type AiScanResult = ScanResult & {
  reason?: string;
  ambiguous?: boolean;
  /** Set when one more look would help — to break a tie, to verify one, or to retry a mis-hold. */
  confirm?: ConfirmRequest;
  /** The confirmations contradict each other: one was mis-held, so they all have to be redone. */
  mismatch?: boolean;
  /**
   * This face's confirmation disagrees with its first capture about COLOURS (no rotation comes
   * within tolerance), so it cannot serve as a rotation measurement. The caller should adopt the
   * confirmation — the fresher, deliberately-held look — as the face's reading and re-assemble.
   */
  reread?: Face;
  /**
   * The sticker to point at. Populated ONLY when exactly one sticker is wrong, because that is the
   * only case where the answer is provable: two legal cubes are never closer than three stickers,
   * so a one-sticker repair is unique and correct. Above one, accusing a specific sticker would
   * sometimes accuse a correctly-read one, so this stays empty and `misreadCount` speaks instead.
   * See dev-docs/misread-decoding.md.
   */
  suspects?: StickerSuspect[];
  /**
   * How many stickers are wrong, as a proven LOWER BOUND — never an overstatement, so "at least N
   * stickers were misread" is always honest. At 1 it is exact, and only then may `suspects` point.
   */
  misreadCount?: number;
  /** The one side every minimal repair blames, when they agree on one — a hint for what to re-show. */
  misreadFace?: Face;
  /**
   * On success: the rotation applied to each as-shown capture (URFDLB order, quarter turns CW) to
   * reach the canonical layout — what a host needs to animate each tile turning the right way up.
   */
  rotations?: number[];
};

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

/**
 * How many stickers a confirmation may read differently from the first capture and still count as
 * a rotation measurement. 0 was the original behaviour and is the bug this constant exists to
 * name: it turned every second-look misread into "held the wrong way up". Past this many, the two
 * reads disagree about colours outright and the caller is told to adopt the fresh one (`reread`).
 */
const CONFIRM_TOLERANCE = 2;

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

/**
 * The rotations of `face` under which the original capture best matches `confirmed` — the ones at
 * MINIMUM sticker disagreement, provided that minimum is within CONFIRM_TOLERANCE. Best-rotation
 * rather than exact, because a confirmation only carries rotation information (see the header):
 * one sticker read differently on the second look must not turn into "held the wrong way up".
 * A tie returns every tied rotation — a filter can only be safely widened, never narrowed.
 * Empty means the two reads disagree about colours (or are of different faces entirely), so the
 * confirmation cannot measure the rotation at all.
 */
function matchingRotations(original: ColorFace, confirmed: ColorFace): Set<number> {
  // Centres never move under rotation, so differing centres mean a different face, not a hold.
  if (original.colors[4] !== confirmed.colors[4]) return new Set();
  const dist = [0, 1, 2, 3].map((k) =>
    rotateFace(original.colors, k).reduce((s, c, i) => s + (c === confirmed.colors[i] ? 0 : 1), 0),
  );
  const min = Math.min(...dist);
  if (min > CONFIRM_TOLERANCE) return new Set();
  return new Set([0, 1, 2, 3].filter((k) => dist[k] === min));
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
 * Every distinct solvable reading of six as-shown faces: facelet string → EVERY rotation combo
 * that produces it — not just the first. A symmetric face (a solved side is the extreme case) is
 * read the same at several rotations, so one string legitimately has many combos, and a later
 * confirmation has to be able to match any of them. Each distinct string is validated once;
 * `null` marks one already rejected.
 */
function solvableReadings(
  faces: Record<Face, ColorFace>,
  centreOwner: Map<number, Face>,
): [string, number[][]][] {
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
  return [...seen].filter((e): e is [string, number[][]] => e[1] !== null);
}

/**
 * Turn a failed scan into what can honestly be said about it.
 *
 * This replaced a colour-COUNTING diagnosis, which could only ever speak when exactly one sticker
 * was wrong — and was blind in two ways that mattered for this detector, whose weak pair is
 * red/orange: a balanced swap (one red read as orange AND one orange read as red) leaves every
 * colour count at nine, and partial cancellation makes the counts UNDERSTATE the damage, sending
 * the search after a single-sticker repair that does not exist.
 *
 * The decoder answers both, and reports a count that is a proven lower bound. What it does NOT
 * license is pointing: above one misread the nearest legal cube is not necessarily the user's
 * cube, so only `distance === 1` becomes a suspect. dev-docs/misread-decoding.md has the whole
 * argument and the measurements.
 */
function diagnose(
  faces: Record<Face, ColorFace>,
  centreOwner: Map<number, Face>,
): Partial<AiScanResult> {
  const decoded: MisreadDecode = decodeMisread(faces, centreOwner);
  if (decoded.kind === 'unknown') return {};
  // No repair within the cap means strictly more than the cap are wrong, which is still a floor.
  if (decoded.kind === 'beyond') return { misreadCount: decoded.distance + 1 };
  // One wrong sticker is the only case a repair is unique, hence the only case worth accusing.
  const suspects: StickerSuspect[] =
    decoded.distance === 1
      ? decoded.stickers.map((s) => ({ face: s.face, index: s.index, to: s.to }))
      : [];
  // A side to re-show, but only when every minimal repair blames that one side. Otherwise the
  // honest instruction is "show the sides again", not a guess dressed as a lead.
  const blamed = new Set(decoded.stickers.map((s) => s.face));
  return {
    misreadCount: decoded.distance,
    ...(suspects.length > 0 ? { suspects } : {}),
    ...(blamed.size === 1 ? { misreadFace: [...blamed][0]! } : {}),
  };
}

/**
 * Validate six faces whose orientation is already KNOWN — painted by hand straight into the
 * canonical net rather than shown to a camera.
 *
 * No rotation search, deliberately. The 4^6 search exists because a camera cannot see which way up
 * a face is; someone painting a net has already answered that, and running the search anyway would
 * be worse than pointless — it could find a second legal reading of the same paint and start asking
 * to be shown a side, in a mode where the camera is off. The painted layout IS the answer; the only
 * question left is whether it is a legal cube.
 */
export function assemblePainted(faces: Record<Face, ColorFace>, threshold = 0.15): AiScanResult {
  const centreOwner = new Map<number, Face>();
  for (const face of FACES) {
    const f = faces[face];
    if (!f || f.colors.length !== 9 || f.confidence.length !== 9) {
      throw new Error(`face ${face}: expected 9 colours + 9 confidences`);
    }
    const centre = f.colors[4]!;
    // Unreachable from either host path, and kept as a guard on the public API rather than a
    // case with a UI: the camera files every capture under FACES[centre] (so a second face with
    // the same centre overwrites the first rather than joining it), and a painted side is seeded
    // with its own colour while setSticker refuses index 4. A caller feeding faces directly can
    // still hit it, which is why it stays a loud refusal instead of an assumption.
    if (centreOwner.has(centre)) return reject(`two faces share centre colour ${centre}`);
    centreOwner.set(centre, face);
  }
  if (centreOwner.size !== 6) return reject('the 6 centres are not 6 distinct colours');

  const letters: string[] = [];
  for (const face of FACES) {
    for (const colour of faces[face]!.colors) {
      const owner = centreOwner.get(colour);
      if (owner === undefined) return reject('a sticker is not one of the six centre colours');
      letters.push(owner);
    }
  }
  const facelets = letters.join('');
  if (!isStructurallyValid(facelets) || !cubejsRoundTrips(facelets)) {
    // Diagnose a painted cube exactly as a scanned one. decodeMisread's guarantee is about the
    // COLOURING, not about who produced it — two legal colourings are never closer than three
    // stickers, so at distance 1 the repair is provably unique however the colours got there.
    //
    // It matters more here than for a scan, because the guidance it replaces was wrong in the
    // commonest case: a hand-painted cube very often has nine of every colour and is still
    // unsolvable (a twisted corner, a flipped edge), and the old advice — keep painting until the
    // counts are nine — sends someone to recount stickers that are already right.
    //
    // Only reached with all six centres distinct and every sticker a centre colour, which the
    // guards above have already established; decodeMisread needs both to say anything.
    return reject('not a solvable cube yet', diagnose(faces, centreOwner));
  }

  const conf = FACES.flatMap((f) => faces[f]!.confidence);
  let min = 1;
  const lowConfidence: number[] = [];
  conf.forEach((c, i) => {
    if (c < min) min = c;
    if (c < threshold) lowConfidence.push(i);
  });
  return { facelets, valid: true, confidence: min, lowConfidence };
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
    // Unreachable from either host path, and kept as a guard on the public API rather than a
    // case with a UI: the camera files every capture under FACES[centre] (so a second face with
    // the same centre overwrites the first rather than joining it), and a painted side is seeded
    // with its own colour while setSticker refuses index 4. A caller feeding faces directly can
    // still hit it, which is why it stays a loud refusal instead of an assumption.
    if (centreOwner.has(centre)) return reject(`two faces share centre colour ${centre}`);
    centreOwner.set(centre, face);
  }
  if (centreOwner.size !== 6) return reject('the 6 centres are not 6 distinct colours');

  const all = solvableReadings(faces, centreOwner);

  if (all.length === 0) {
    // Before refusing, do the diagnosis a refusal makes possible: how many stickers are wrong is
    // always answerable, and when it is exactly one, WHICH one is answerable too.
    return reject(
      'no orientation of the faces is solvable — a colour was misread',
      diagnose(faces, centreOwner),
    );
  }

  // Narrow by any confirmed capture: keep a reading only if at least one of ITS combos rotates the
  // original capture into what the confirmation saw, at best-rotation match (see matchingRotations).
  // This is a filter over strings the solvability gate already passed, so no confirmation —
  // however badly held or read — can introduce a cube that was not already verified.
  const confirmedFaces = FACES.filter((f) => confirmed[f]);
  const allowed = new Map<Face, Set<number>>();
  for (const face of confirmedFaces) {
    const rots = matchingRotations(faces[face]!, confirmed[face]!);
    // No rotation comes close: the two looks disagree about COLOURS, so this capture measures
    // nothing about the hold. Hand it back as `reread` — the caller adopts the fresh look (taken
    // under instruction, held a known way up) as the side's reading and re-assembles, instead of
    // telling a user who did everything right that they held it wrong.
    if (rots.size === 0) {
      return reject('that side read differently this time — checking again with the fresh read', {
        reread: face,
        confirm: { face, up: TOP_NEIGHBOUR[face] },
      });
    }
    allowed.set(face, rots);
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
    if (confirm) {
      return reject(
        `${candidates.length} readings fit — this cube is close to solved, so one more look decides it`,
        { ambiguous: true, confirm },
      );
    }
    // No unconfirmed side can tell the surviving readings apart (their rotation sets agree on
    // every face we could still ask about) — the same dead end as the too-symmetric case below,
    // so say the same thing rather than promising a deciding look that cannot be asked for.
    return reject(
      'this cube is too symmetric to read for certain — turn any one face, then scan again',
      { ambiguous: true },
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
  // confirmation. The combo itself rides along as `rotations`, so a host can turn each tile the
  // way the search turned the capture, and the caller can settle its captures into canonical.
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
  return { facelets, valid: true, confidence: min, lowConfidence, rotations: [...chosen] };
}
