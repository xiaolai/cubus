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
// So it is matched by TOLERANCE — every rotation within CONFIRM_TOLERANCE stickers — not
// sticker-for-sticker, and not by the closest one either. Exact matching was the original sin
// here: the detector's held-out colour accuracy is ~90%, so the re-shown side routinely reads one
// sticker differently, exact match then fails at EVERY rotation, and a correctly-held look got
// blamed as "held the wrong way up". Measured against the panel's old drop-and-retry policy, a 2%
// per-sticker misread on the second look threw away 11% of once-turned scans; at 10% it threw
// away two thirds. Distance-based matching with one flipped sticker finds the unique true rotation
// in 93.5% of trials, ties (harmlessly — tied rotations are near-symmetries that mostly read the
// same) in the rest, and picked a WRONG rotation in 0 of 400.
// Keeping only the MINIMUM-distance rotations was a second, unstated rule on top of the tolerance,
// and it undid the first: with distances [2, 8, 1, 8] the true rotation sits at 2 — inside the
// tolerance this constant exists to grant — and was discarded for one that collides on a single
// sticker by chance, leaving no candidate reading at all and telling a user who did everything
// right that they held it wrong. A filter here can only be safely widened; see matchingRotations. When no rotation comes within CONFIRM_TOLERANCE the two reads disagree about COLOURS, not
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
import { FACE_NEIGHBOURS, isStructurallyValid, rotateFace } from './facelet-cube.js';
import { type DecodedSticker, diagnoseMisread, type MisreadDiagnosis } from './misread-decode.js';
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
 *
 * An ALIAS of the decoder's own `DecodedSticker`, not a second declaration of the same shape: this
 * is the name the app's hosts import, and the sticker they receive is the one the search named.
 */
export type StickerSuspect = DecodedSticker;

/** How a caller wants a refusal explained. */
export interface AssembleOptions {
  /**
   * Run the misread diagnosis on THIS thread (the default), or defer it.
   *
   * `false` returns the refusal with `misreadCount: null` — "checking", never "nothing is wrong" —
   * and no `suspects` or `misreadFace`, so a caller can paint the refusal within a tick and put
   * `diagnoseMisread` somewhere that is not the page's thread. Deferring is not a nicety: the
   * decode is 52-125 ms at distance 3 on an easy scramble, 2.7 s for a distance-3 answer on a
   * 20-move scramble, and 2.1-3.0 s when its 20M-node backstop is exhausted — seconds spent to
   * claim nothing, all of it blocking whatever called it (measured 2026-09-05).
   *
   * The default is deliberately the synchronous one. A caller with nowhere to run the decode still
   * gets the count, in one call, exactly as before.
   */
  diagnose?: boolean;
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
   * The sticker to point at: changing it to `to` makes the reading a legal cube. Populated ONLY
   * where the search itself says the repair is unambiguous — the READING is one change from legal,
   * that legal cube is unique, and exactly one sticker is named — because that is the only case
   * where a single sticker can be MEANT at all. Above one change the nearest legal cube need not
   * be the user's, so this stays empty and `misreadCount` speaks instead.
   *
   * IT IS NOT A PROOF THAT THIS STICKER WAS MISREAD, though this docstring claimed exactly that
   * until 2026-09-05 ("populated ONLY when exactly one sticker is wrong … so a one-sticker repair
   * is unique and correct"). "One sticker is wrong" is a claim about the TRUE count, which nothing
   * observable carries; uniqueness is a property of the READING. A reading
   * two stickers from the cube in the user's hand can sit one sticker from a legal cube they never
   * held, and the search then names — uniquely — a sticker the camera read correctly. Pinned by
   * `tests/ai-assemble.test.ts` ("a lone suspect is a sticker to CHECK"), which builds two legal
   * cubes three apart and reads two of the three differences from the wrong one. So a host may say
   * "changing this makes the cube solvable" and may never say "this one is wrong".
   * See dev-docs/misread-decoding.md §1.
   */
  suspects?: StickerSuspect[];
  /**
   * How many stickers are wrong, as a proven LOWER BOUND — never an overstatement, so "at least N
   * stickers were misread" is always honest. It is a floor at EVERY N including 1, and the
   * sentence this used to carry — "at 1 it is exact" — was false (corrected 2026-09-05): it
   * contradicted both `misread-decode.ts`'s header and dev-docs/misread-decoding.md §1, which
   * construct the counterexample by hand. The same two tests that pin `suspects` above pin this:
   * a genuinely two-sticker misread comes back as 1.
   *
   * `null` is the DEFERRED state and not a count: the caller passed `{ diagnose: false }` and the
   * decode is running somewhere else (see AssembleOptions). ABSENT means the decode ran and could
   * claim nothing. A host must not collapse the two — "checking…" and "too much of the cube was
   * read wrong to say where" are opposite sentences about the same field.
   *
   * PRESUMING THE SIX CENTRES WERE READ RIGHT. The bound is proved against the colouring implied
   * by the centres, because the centres are what name the faces — so a misread CENTRE is not one
   * wrong sticker, it is a relabelling of every sticker of that colour, and the count reported is
   * about a cube nobody has. Two swapped centres are the reachable case and they inflate the
   * count well past their own two (measured, and pinned in misread-decode.test.ts). The decoder
   * cannot detect it, so this is a limit of the guarantee rather than a bug in it —
   * dev-docs/misread-decoding.md has the argument.
   */
  misreadCount?: number | null;
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
 *
 * DERIVED, not written out (2026-09-05). This was a hand-written table of the same six answers
 * `FACE_NEIGHBOURS` already computes from `EDGE_FACELET` — the cube's own geometry — so the
 * instruction a user is given to hold their cube by had a second, independent source that nothing
 * checked against the first. The two agreeing was a fact about whoever typed the table.
 */
const TOP_NEIGHBOUR: Readonly<Record<Face, Face>> = Object.freeze(
  Object.fromEntries(FACES.map((face) => [face, FACE_NEIGHBOURS[face].top])),
) as Readonly<Record<Face, Face>>;

/**
 * How many stickers a confirmation may read differently from the first capture and still count as
 * a rotation measurement. 0 was the original behaviour and is the bug this constant exists to
 * name: it turned every second-look misread into "held the wrong way up". Past this many, the two
 * reads disagree about colours outright and the caller is told to adopt the fresh one (`reread`).
 */
const CONFIRM_TOLERANCE = 2;

/**
 * Below this a sticker's detector score is reported as too faint to trust.
 *
 * The other half of an invariant that spans two files: `MIN_STICKER_CONFIDENCE` (0.25) in
 * onnx-postprocess sits ABOVE it, and `fitFace` builds no face out of a sticker below that — so a
 * camera capture can never carry a sticker under this bar, and "a valid cube with low-confidence
 * stickers" is unreachable rather than merely unlikely. `onnx-postprocess.test.ts` pins the
 * ordering; `ai-scan-panel` still has a branch for the state, because a threshold is a number
 * someone can change and the app must say something true if the two ever cross.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.15;

function cubejsRoundTrips(facelets: string): boolean {
  try {
    return Cube.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}

/**
 * A refusal, carrying only what was actually established.
 *
 * NO `confidence` AND NO `lowConfidence`. It used to report `confidence: 0` and all 54 indices as
 * low-confidence, and both were fiction: the detector's per-sticker scores are whatever they
 * were, and a scan refused because no rotation is solvable — or because two looks disagreed about
 * a hold — has measured nothing whatever about them. "Never invent data" applies hardest to the
 * numbers that look most harmless, and a caller reading `confidence` off a refusal was being told
 * every sticker was unreadable when the real answer is that nobody asked. They are optional on
 * `ScanResult` so their absence is a fact the type carries rather than a convention.
 */
function reject(reason: string, extra: Partial<AiScanResult> = {}): AiScanResult {
  return { facelets: '', valid: false, reason, ...extra };
}

/**
 * The rotations of `face` under which the original capture matches `confirmed` to within
 * CONFIRM_TOLERANCE — EVERY such rotation, not only the closest. Tolerant rather than exact,
 * because a confirmation only carries rotation information (see the header): one sticker read
 * differently on the second look must not turn into "held the wrong way up".
 * Empty means the two reads disagree about colours (or are of different faces entirely), so the
 * confirmation cannot measure the rotation at all.
 *
 * It used to keep only the rotations at MINIMUM disagreement, which is a narrowing — and this
 * docstring already said, one line above where it happened, that a filter here can only be safely
 * widened. The two claims cannot both hold, and the code was the one that was wrong: with
 * distances [2, 8, 1, 8], the true rotation is discarded at 2 — inside the tolerance the constant
 * exists to grant — in favour of one that happens to collide on a single sticker, and the caller
 * then finds no reading at all and tells a user who did everything right that they held it wrong.
 * The tolerance is the rule; the minimum was a second, unstated, stricter one on top of it.
 *
 * Exported for tests only. The failure it exists to prevent needs a face that is two stickers from
 * its OWN quarter-turn, which is a property of the colouring rather than of the scan — searching
 * legal cubes for one is a worse test than stating the pair outright, and a worse test is how a
 * rule with no red-when-broken case comes back.
 */
export function matchingRotations(original: ColorFace, confirmed: ColorFace): Set<number> {
  // Centres never move under rotation, so differing centres mean a different face, not a hold.
  if (original.colors[4] !== confirmed.colors[4]) return new Set();
  const dist = [0, 1, 2, 3].map((k) =>
    rotateFace(original.colors, k).reduce((s, c, i) => s + (c === confirmed.colors[i] ? 0 : 1), 0),
  );
  return new Set([0, 1, 2, 3].filter((k) => dist[k]! <= CONFIRM_TOLERANCE));
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
 * The diagnosis a refusal carries: run it here, or hand the caller the "checking" marker.
 *
 * The decode itself moved to `misread-decode.ts` (2026-09-05), beside the search whose guarantees
 * it spends and where the misread worker can reach it without the assembler. What stays here is
 * the one decision this module owns — WHETHER to spend seconds of the calling thread on it.
 */
function refusalDiagnosis(
  faces: Record<Face, ColorFace>,
  options: AssembleOptions & { fixedRotation?: boolean },
): MisreadDiagnosis {
  // `null`, never an absent field: absent already means "the decode ran and could claim nothing",
  // and a caller that reads the two the same way says "too much of the cube was read wrong to say
  // where" about a cube nothing has looked at yet. See AiScanResult.misreadCount.
  if (options.diagnose === false) return { misreadCount: null };
  return diagnoseMisread(faces, { fixedRotation: options.fixedRotation });
}

/**
 * One capture, checked to be a capture at all, and handed back so the caller may stop asking.
 *
 * Malformed input THROWS rather than rejecting, because a reject is a sentence shown to a child
 * about their cube and none of these is about the cube. What is checked is what the rest of this
 * module then assumes without asking again: nine colours and nine confidences, and every
 * confidence a real number in [0, 1]. That last one is not pedantry — `NaN` compares false against
 * every threshold, so 54 of them used to sail through as `confidence: 1` with no low-confidence
 * stickers, which is a number this module invented.
 *
 * It takes the LABEL rather than a face letter because two different kinds of capture arrive here:
 * one of the six sides, and a confirmation of one. The second was never checked at all until
 * 2026-09-05 — `matchingRotations` compares nine positions against whatever array it is given, and
 * a short one simply reads `undefined` at the missing indices, which counts as at most two
 * differences and so passes CONFIRM_TOLERANCE. Measured: seven colours and no confidences at all,
 * fed as every answer, narrowed a once-turned cube to `valid: true` on six of six algs — a
 * rotation measured from a capture that does not exist.
 *
 * `f?.colors.length !== 9` carries a missing capture as well as a short one: a `confirmed` entry
 * that is `undefined` fails the first comparison, so the second access is only reached once the
 * first has proved `f` present.
 */
function checkedCapture(label: string, f: ColorFace | undefined): ColorFace {
  if (f?.colors.length !== 9 || f.confidence.length !== 9) {
    throw new Error(`${label}: expected 9 colours + 9 confidences`);
  }
  // Colours are deliberately NOT range-checked here. A sticker that is not one of the six centre
  // colours is a statement about the CUBE — `assemblePainted` already refuses it with a sentence
  // a child can act on — so making it throw would replace an answer with a crash.
  for (const c of f.confidence) {
    if (!Number.isFinite(c) || c < 0 || c > 1) {
      throw new Error(`${label}: confidence ${c} is not a number in [0, 1]`);
    }
  }
  return f;
}

/**
 * Validate six faces and build the centre-colour → face map, for both entry points.
 *
 * Returns the map, or the rejection to hand straight back — the caller discriminates on
 * `instanceof Map`. It was written twice, comment included, once in each of the two public
 * functions; two lifetimes of one validation rule is how a caller comes to be trusted on one path
 * and not the other.
 */
function buildCentreOwner(faces: Record<Face, ColorFace>): Map<number, Face> | AiScanResult {
  const centreOwner = new Map<number, Face>();
  for (const face of FACES) {
    const f = checkedCapture(`face ${face}`, faces[face]);
    const centre = f.colors[4]!;
    // A CENTRE IS A COLOUR THE DETECTOR CAN PRODUCE, and this is where that is checked
    // (2026-09-05). Ordinary stickers are deliberately not range-checked — an unknown colour there
    // is a statement about the cube and `assemblePainted` refuses it in words — but a CENTRE names
    // a face, so an out-of-range one is silently accepted as the name of one: nine stickers of
    // class 17 on U built the map `17 -> U`, every one of them then resolved through it, and both
    // assemblers returned `valid: true` for a facelet string assembled out of a colour class no
    // model emits. NaN was worse, because `Map` matches it to itself. That is detector data this
    // module cannot read, not a cube it can describe, so it is refused rather than named.
    if (!Number.isInteger(centre) || centre < 0 || centre >= FACES.length) {
      return reject(`face ${face} has centre colour ${centre}, which is not one of the six`);
    }
    // Unreachable from either host path, and kept as a guard on the public API rather than a
    // case with a UI: the camera files every capture under FACES[centre] (so a second face with
    // the same centre overwrites the first rather than joining it), and a painted side is seeded
    // with its own colour while setSticker refuses index 4. A caller feeding faces directly can
    // still hit it, which is why it stays a loud refusal instead of an assumption.
    if (centreOwner.has(centre)) return reject(`two faces share centre colour ${centre}`);
    centreOwner.set(centre, face);
  }
  // No `size !== 6` check follows. Six iterations that each return on a duplicate leave a map of
  // exactly six; the check that used to be here was unreachable in both callers, and an
  // unreachable guard reads as a second, weaker line of defence that is not there.
  return centreOwner;
}

/** The reported confidence of a facelet string: its weakest sticker, and every one below the bar. */
function summariseConfidence(
  conf: readonly number[],
  threshold: number,
): { confidence: number; lowConfidence: number[] } {
  let min = 1;
  const lowConfidence: number[] = [];
  conf.forEach((c, i) => {
    if (c < min) min = c;
    if (c < threshold) lowConfidence.push(i);
  });
  return { confidence: min, lowConfidence };
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
export function assemblePainted(
  faces: Record<Face, ColorFace>,
  threshold = LOW_CONFIDENCE_THRESHOLD,
  options: AssembleOptions = {},
): AiScanResult {
  const centreOwner = buildCentreOwner(faces);
  if (!(centreOwner instanceof Map)) return centreOwner;

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
    // fixedRotation, because a painted face is authored in place. Without it the decoder is free
    // to rotate a face back and report "0 misreads" about a cube this function has just refused —
    // measured on nine scrambles with one face turned 90°, all nine. See DecodeOptions.
    return reject(
      'not a solvable cube yet',
      refusalDiagnosis(faces, { ...options, fixedRotation: true }),
    );
  }

  const conf = FACES.flatMap((f) => faces[f]!.confidence);
  return { facelets, valid: true, ...summariseConfidence(conf, threshold) };
}

/** The confirmations applied: what each one measures, and which readings are left standing. */
interface Narrowed {
  ok: true;
  confirmedFaces: Face[];
  /** Per confirmed face, the rotations of the original capture that confirmation is consistent with. */
  allowed: Map<Face, Set<number>>;
  candidates: [string, number[][]][];
}
/** …or the refusal to hand straight back, which is a sentence about a hold rather than a cube. */
type Narrowing = Narrowed | { ok: false; refusal: AiScanResult };

/**
 * Apply the confirmations: keep a reading only if at least one of ITS combos rotates the original
 * capture into what the confirmation saw, at tolerance match (see matchingRotations).
 *
 * This is a FILTER over strings the solvability gate has already passed, so no confirmation —
 * however badly held or read — can introduce a cube that was not already verified.
 *
 * Lifted out of `assembleColors` (2026-09-05), which had grown to cover validation, the rotation
 * search, this narrowing, the ambiguity branches, the redundancy check and the result — six
 * decisions sharing one scope, where the middle two are the ones a mis-held look can corrupt.
 * Nothing here decides differently from the code it replaces; the tests in
 * `tests/ai-assemble.test.ts` that pin `reread`, `mismatch` and the never-a-wrong-cube property
 * are the ones that say so.
 */
function narrowByConfirmations(
  faces: Record<Face, ColorFace>,
  all: [string, number[][]][],
  confirmed: Partial<Record<Face, ColorFace>>,
): Narrowing {
  const confirmedFaces = FACES.filter((f) => confirmed[f]);
  const allowed = new Map<Face, Set<number>>();
  for (const face of confirmedFaces) {
    // CHECKED FIRST, like every other capture this module reads. A confirmation is user input that
    // arrives through the same public argument as the six sides and was the one capture nobody
    // validated — see `checkedCapture` for what a short one does to the tolerance match.
    const capture = checkedCapture(`confirmation of ${face}`, confirmed[face]);
    const rots = matchingRotations(faces[face]!, capture);
    // No rotation comes close: the two looks disagree about COLOURS, so this capture measures
    // nothing about the hold. Hand it back as `reread` — the caller adopts the fresh look (taken
    // under instruction, held a known way up) as the side's reading and re-assembles, instead of
    // telling a user who did everything right that they held it wrong.
    if (rots.size === 0) {
      return {
        ok: false,
        refusal: reject(
          'that side read differently this time — checking again with the fresh read',
          {
            reread: face,
            confirm: { face, up: TOP_NEIGHBOUR[face] },
          },
        ),
      };
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
    return {
      ok: false,
      refusal: reject('those two looks disagree — one was held the wrong way up; try again', {
        mismatch: true,
        confirm: { face: last, up: TOP_NEIGHBOUR[last] },
      }),
    };
  }
  return { ok: true, confirmedFaces, allowed, candidates };
}

/**
 * The lone survivor, put to a further test — or null when it needs none and may be accepted.
 *
 * If a confirmation is what removed the other readings, that confirmation is load-bearing and a
 * mis-held one would have removed the TRUTH and kept an impostor. So demand redundancy: every
 * eliminated reading must be contradicted by at least TWO separate looks. A truthful look can never
 * contradict the real cube, so under that rule a single mis-hold can no longer eliminate the truth
 * on its own — the worst it can do is leave the scan ambiguous, which is safe, instead of
 * confidently wrong.
 *
 * Counting looks instead of contradictions is NOT enough and was the first thing tried: when a
 * scan needs two looks just to narrow down, both get spent narrowing and nothing checks anything.
 * Measured, that returned a wrong cube in 5% of scans where the user mis-held one look.
 */
function verifySurvivor(
  all: [string, number[][]][],
  facelets: string,
  narrowed: Narrowed,
  confirmed: Partial<Record<Face, ColorFace>>,
): AiScanResult | null {
  const { confirmedFaces, allowed } = narrowed;
  const contradictions = (candidate: number[][]): number =>
    confirmedFaces.filter((face) => {
      const fi = FACES.indexOf(face);
      return candidate.every((c) => !allowed.get(face)!.has(c[fi]!));
    }).length;
  const weak = all.filter(([fl, c]) => fl !== facelets && contradictions(c) < 2);
  if (weak.length === 0) return null;
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
    {
      ambiguous: true,
    },
  );
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
  threshold = LOW_CONFIDENCE_THRESHOLD,
  confirmed: Partial<Record<Face, ColorFace>> = {},
  options: AssembleOptions = {},
): AiScanResult {
  // Centre colour → face letter. Centres don't move under rotation, so this is fixed. Two faces
  // sharing a centre colour is impossible on a real cube, so bail out loudly.
  const centreOwner = buildCentreOwner(faces);
  if (!(centreOwner instanceof Map)) return centreOwner;

  const all = solvableReadings(faces, centreOwner);

  if (all.length === 0) {
    // Before refusing, do the diagnosis a refusal makes possible: how many stickers are wrong is
    // always answerable, and when it is exactly one, WHICH one is answerable too.
    return reject(
      'no orientation of the faces is solvable — a colour was misread',
      refusalDiagnosis(faces, options),
    );
  }

  const narrowed = narrowByConfirmations(faces, all, confirmed);
  if (!narrowed.ok) return narrowed.refusal;
  const candidates = narrowed.candidates;

  if (candidates.length > 1) {
    const confirm = pickConfirm(candidates, confirmed);
    if (confirm) {
      return reject(`${candidates.length} readings fit — another look narrows them`, {
        ambiguous: true,
        confirm,
      });
    }
    // No unconfirmed side can tell the surviving readings apart (their rotation sets agree on
    // every face we could still ask about) — the same dead end as the too-symmetric case in
    // `verifySurvivor`, so say the same thing rather than promising a deciding look that cannot
    // be asked for.
    return reject(
      'this cube is too symmetric to read for certain — turn any one face, then scan again',
      { ambiguous: true },
    );
  }

  const [facelets, combos] = candidates[0]!;

  // Exactly one reading survives — but a confirmation that removed the others is load-bearing, and
  // a look nothing checks can be a mis-hold. See `verifySurvivor`.
  const unverified = verifySurvivor(all, facelets, narrowed, confirmed);
  if (unverified) return unverified;

  // Rotate the confidences the same way for the report, using a combo that satisfies every
  // confirmation. The combo itself rides along as `rotations`, so a host can turn each tile the
  // way the search turned the capture, and the caller can settle its captures into canonical.
  const chosen = combos[0]!;
  const conf: number[] = [];
  for (let fi = 0; fi < 6; fi++) {
    for (const c of rotateFace(faces[FACES[fi]!]!.confidence, chosen[fi]!)) conf.push(c);
  }
  return {
    facelets,
    valid: true,
    ...summariseConfidence(conf, threshold),
    rotations: [...chosen],
  };
}
