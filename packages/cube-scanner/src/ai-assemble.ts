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
//     with confirmation 100%  100%  100%  100%   99%   99%  100%   99%
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
// THE COLOUR SCHEME IS A THIRD AMBIGUITY DIMENSION (2026-09-07, ADR 0001). A capture is identified
// by its centre COLOUR; where that colour SITS — which of blue/yellow is under white — is the
// cube's scheme, Western or Japanese (`scheme.ts`), and six face photographs carry no adjacency
// information that could say. Until this date the filing was the Western scheme stated as an
// identity (`FACES[centre]`), and a scrambled Japanese cube was refused as "at least 3 stickers
// misread" about a correct read. The obvious remedy — try both filings, exactly one is legal —
// is TRUE on random states (0 of 200 false positives each way) and FALSE on the near-solved,
// structured states a beginner hands over: a top-layer edge 3-cycle is valid under both filings
// as two DIFFERENT cubes, 196 of the 220 edge 3-cycles are readable under both, and two twisted
// corners are the same string under both. So the search below runs over every scheme and the
// scheme is decided by the same machinery that decides a rotation: a candidate carries its
// scheme, confirmations narrow across schemes (projected into each candidate's frame, because the
// same photograph of the blue side "red up" is canonical-rotated differently for a Western B and
// a Japanese D), a look is only ever requested for a hold that is possible in every surviving
// scheme, and a reading is accepted only when every alternative from EITHER scheme is gone. When
// two readings differ only by scheme and no permitted look separates them, the answer is the
// too-symmetric refusal with its reason named — "turn any one face" — never a setting's guess:
// accepting either is a confidently wrong cube for whichever child has the other kind.
// Search cost is one more 4^6 pass, 4–7 ms on every state class measured.
//
// EVERY COORDINATE IN A RESULT IS A CAPTURE COORDINATE. A `Record<Face, …>` of captures is keyed
// by SLOT — `FACES[colour]`, the colour's name, never its position (`scheme.ts`, `slotOf`) — and
// `rotations`, `suspects`, `misreadFace`, `undetermined` and `confirm` all name slots, so a host
// that draws tiles by colour never has a reference move under it when the scheme is decided.
// `facelets` is positional in the reported `scheme`.
//
// Colour-class indices match ml/data.yaml: 0 white 1 red 2 green 3 yellow 4 orange 5 blue.

import Cube from 'cubejs';
import { isStructurallyValid, rotateFace } from './facelet-cube.js';
import {
  type DecodedSticker,
  diagnoseAcrossSchemes,
  diagnoseMisread,
  type MisreadDiagnosis,
} from './misread-decode.js';
import { assignNineOfEach, NUM_COLORS, STICKERS } from './nine-of-each.js';
import { colorsFromPaint } from './paint-groups.js';
import {
  type Colour,
  colourOfSlot,
  commonNeighbours,
  heldUpColour,
  holdOffset,
  isColour,
  neighbourColour,
  positionOf,
  SCHEMES,
  type Scheme,
  schemeOfCentres,
  slotOf,
} from './scheme.js';
import { FACES, type Face, type ScanResult } from './types.js';

export { rotateFace };

/** One face as seen by the detector: 9 colour classes + 9 detection confidences, reading order. */
export interface ColorFace {
  colors: number[]; // 9 colour-class indices (0..5)
  confidence: number[]; // 9 per-sticker detector confidences (0..1)
  /**
   * 9 x 6 scores per sticker, when the detector supplied them. OPTIONAL, and every existing
   * consumer ignores it: `repairByCounts` below is the only reader, and it runs only after the
   * normal path has already refused.
   */
  scores?: number[][];
  /**
   * Median CIE Lab per sticker, from the pixels of the frame this capture came from. OPTIONAL: read
   * only by `recolourByPaint`, which runs after everything else has refused. Supplied by whoever
   * held the frame and the boxes at the same moment — the detector's caller — because nothing
   * downstream of that has the pixels any more.
   */
  lab?: [number, number, number][];
  /**
   * 9 flags: stickers a PERSON set, which no repair may change. OPTIONAL, and absent means none.
   *
   * Both fallbacks recolour stickers, and a correction the user typed in has to outrank them
   * unconditionally. Making the correction expensive for the count repair (a one-hot score row) is
   * not enough on its own: `resolveCentres` lifts the repair's cost ceiling to infinity, so a
   * finite cost is no barrier there. The flag is checked against the colours, not the costs, and so
   * holds whatever ceiling a caller passes.
   */
  locked?: boolean[];
}

/**
 * A request for the one extra look that breaks a tie: show the side in slot `face` again, held
 * with the side in slot `up` upwards. Both are SLOTS — colours — so the instruction reads "show
 * the blue side, red up", and `up` is always a colour adjacent to `face` in every scheme still in
 * play, so the cube in the hand can obey it whichever kind it is.
 */
export interface ConfirmRequest {
  face: Face;
  up: Face;
}

/**
 * A confirmation as it must be handed back: the capture, and the hold it was taken under. The
 * hold is not optional and not implied by the slot: the same photograph is a different rotation
 * of the canonical capture under each scheme, and only the request's `up` lets each candidate
 * project it into its own frame (`holdOffset`).
 */
export interface Confirmation {
  capture: ColorFace;
  up: Face;
}

/**
 * A sticker a colour misread most plausibly landed on: flipping it to `to` makes the scan a legal
 * cube. `face` is the SLOT (the colour's capture) and `index` is into that capture AS SHOWN — what
 * a host's tile displays — so a suspect maps straight onto the sticker a user can tap.
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
   * the decode somewhere that is not the page's thread. Deferring is not a nicety: the decode is
   * 52-125 ms at distance 3 on an easy scramble, 2.7 s for a distance-3 answer on a 20-move
   * scramble, and 2.1-3.0 s when its 20M-node backstop is exhausted — seconds spent to claim
   * nothing, all of it blocking whatever called it (measured 2026-09-05), and since 2026-09-07 it
   * runs once per scheme.
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
  /**
   * With `ambiguous` and a `confirm`: how many legal cubes fit the readings, and which sides'
   * way-up those cubes disagree about — the sides a look can settle. The notice says both, because
   * "several readings fit" was read as a failed scan by a user whose every colour was right
   * (2026-09-06): the six sides had simply been held in ways the photos cannot tell apart.
   */
  readings?: number;
  undetermined?: Face[];
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
   * With `ambiguous` and no `confirm`: the readings left standing are different cubes that
   * differ ONLY in which of blue/yellow is under white, and no hold a child could be asked for
   * would tell them apart. The honest instruction is one turn and a fresh scan; the dishonest one
   * is to let a setting choose. See the header's scheme section.
   */
  schemeAmbiguous?: boolean;
  /**
   * Sides' centres read as the same colour, so they could not all be filed: `shared` is a slot two of
   * them claimed and `missing` a slot none did. A 3x3 has one centre of each colour, so one of the
   * sides claiming `shared` IS a missing colour. Set by `resolveCentres` only when it could not
   * decide, and `legalFilings` says why: 0 — no filing is a legal cube and the centres' confidence
   * could not say which was misread; 2 or more — that many are legal, and nothing in the captures
   * says which.
   */
  centreConflict?: { shared: Face; missing: Face; legalFilings: number };
  /**
   * On success: which arrangement the accepted `facelets` are positional in. `'undetermined'`
   * when the surviving readings are the SAME string under both schemes — the solved cube, two
   * twisted corners — so the STATE is known and the colours under white are not; a host paints
   * such a cube in whatever scheme it assumes and says that it assumed.
   */
  scheme?: Scheme | 'undetermined';
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
   * Since 2026-09-07 the decode runs under EVERY scheme and this is the smallest of the floors,
   * because the true scheme is one of them and the minimum of two lower bounds is still a lower
   * bound on the cube actually held — where before, a correctly read Japanese cube with one wrong
   * sticker was told "at least 4" (measured: 4 under the Western filing, 1 under the Japanese).
   * `misreadScheme` says which filing the count came from.
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
  /** The one side every minimal repair blames, when they agree on one — a hint for what to re-show. A slot. */
  misreadFace?: Face;
  /**
   * The scheme under which `misreadCount` (and any `suspects`) was found, when exactly one scheme
   * produced the smallest floor. Absent when the schemes tie — then the count holds under either
   * — or when no count could be given. A host words a count from a scheme its setting does not
   * hold as conditional, and says where the toggle is.
   */
  misreadScheme?: Scheme;
  /**
   * On success: the rotation applied to each as-shown capture to reach the canonical layout, in
   * SLOT order (index i is the colour-i capture — the capture keyed `FACES[i]`), quarter turns
   * CW — what a host needs to animate each tile turning the right way up. For an
   * `'undetermined'` scheme these are the Western filing's rotations.
   */
  rotations?: number[];
};

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

/**
 * Which colour to hold upwards, in order of preference, when more than one is permitted: white
 * first — "hold the white side up" is the instruction a child can follow — then the side colours,
 * then the two that trade places between schemes.
 */
const UP_PREFERENCE: readonly Colour[] = [0, 2, 1, 4, 3, 5];

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
 * PHYSICAL, and scheme-free: it relates two photographs of the same side. Which rotation is
 * CANONICAL for a candidate is the candidate's business (`holdOffset`), applied by the caller.
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
 * How many of the eight stickers around the centre must agree for two captures to be one side.
 *
 * Seven, not eight: one sticker flickering between orange and yellow is the detector's commonest
 * disagreement with itself, and a side re-shown with one sticker read differently used to count as a
 * DIFFERENT side — held back as a centre collision, or filed twice. Two different sides of a real
 * cube agreeing in seven of eight places under some quarter turn is not a case worth designing around:
 * a side's eight are mostly its own colour's neighbours, which no other side shares.
 */
export const SAME_SIDE_STICKERS = 7;

/**
 * Whether two captures show the same side of the cube, held any way up: the eight stickers around the
 * centre agree in SAME_SIDE_STICKERS places or more under some quarter turn.
 *
 * THE CENTRE IS LEFT OUT, AND THE CALLER DECIDES WHAT IT MEANS (2026-09-18). It is the one sticker a
 * logo misreads, and it reads differently from one showing of a side to the next — yellow on one, white
 * on another, measured on the same cap — so this compares only what a logo cannot touch. But the eight
 * alone do not name a side either: different sides can share them exactly (after U D R L F B the white
 * and yellow sides are the same eight stickers around different centres). So the panel recognises a
 * side again only when its centre also claims the same colour, lets the eight alone decide only when
 * they point to one side in hand and no other, and leaves two sides with the same eight under different
 * centres for the six to settle (`twinToDrop`).
 */
export function sameSide(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < 4; k++) {
    const turned = rotateFace(b, k);
    let agree = 0;
    for (let i = 0; i < 9; i++) if (i !== 4 && turned[i] === a[i]) agree += 1;
    if (agree >= SAME_SIDE_STICKERS) return true;
  }
  return false;
}

/**
 * One legal reading of the six captures under one scheme: the positional facelet string, and
 * EVERY rotation combo that produces it — not just the first — in SLOT order. A symmetric face (a
 * solved side is the extreme case) is read the same at several rotations, so one string
 * legitimately has many combos, and a later confirmation has to be able to match any of them.
 * The same string can also arise under both schemes; those are two candidates that a host sees
 * as one reading (`readingsOf`), because they are one STATE.
 */
interface Candidate {
  scheme: Scheme;
  facelets: string;
  combos: number[][];
}

/**
 * Six captures by the colour of their centre. The record's keys are slots and are REQUIRED to
 * name their capture's colour — a capture filed under a slot that is not its colour is a caller
 * that has confused a slot with a position, which is the confusion this whole file exists to
 * end, so it is refused in words rather than silently re-filed.
 */
type BySlot = Readonly<Record<Face, ColorFace>>;

/** The six captures laid out by POSITION under `scheme` — what the rotation search reads. */
function byPosition(bySlot: BySlot, scheme: Scheme): Record<Face, ColorFace> {
  const out = {} as Record<Face, ColorFace>;
  for (const slot of FACES) out[positionOf(colourOfSlot(slot), scheme)] = bySlot[slot];
  return out;
}

/** A combo in POSITION order under `scheme`, re-indexed to SLOT order. */
function comboToSlots(combo: readonly number[], scheme: Scheme): number[] {
  return FACES.map((slot) => combo[FACES.indexOf(positionOf(colourOfSlot(slot), scheme))]!);
}

/** The distinct facelet strings a list of candidates describes — what a host counts as readings. */
const readingsOf = (candidates: readonly Candidate[]): Set<string> =>
  new Set(candidates.map((c) => c.facelets));

/** The schemes some candidate in the list still stands under. */
const schemesOf = (candidates: readonly Candidate[]): Scheme[] =>
  SCHEMES.filter((s) => candidates.some((c) => c.scheme === s));

// A LOOK CAN ELIMINATE A SCHEME, and a guard here that assumed otherwise was reverted the day it
// was written (2026-09-07, refuted in verification).
//
// The argument for it went: the scanner only ever asks for a hold that BOTH arrangements can obey
// (`permittedHold` / `commonNeighbours`), so the answer must be consistent with both and can carry
// nothing that tells them apart. It measured well on the fixture it was built from — of the 20
// holds possible on both kinds of cube, none settles a cube with one reading per scheme — and it
// is false in general. A hold's being physically possible under both schemes does NOT mean both
// READINGS predict the same photograph of it: each candidate accepts a set of rotations for that
// side, and a truthful answer can miss one candidate's set entirely.
//
// The counterexample, reproduced: the solved cube with edge slots 1, 7 and 10 three-cycled scans
// as 9 Western readings and 1 Japanese one, and answering "the blue side, red up" leaves 8 — the
// Japanese reading is gone, and the scan carries on narrowing. The guard refused that cube outright
// with no look asked.
//
// What remains is the test that was already right: `undeterminedSlots` asks whether any
// unconfirmed side's answer could separate the survivors, in the physical frame (`holdsOf`), and
// `pickConfirm` returning nothing IS "no look can help". That is sound because it is measured
// against the candidates rather than assumed from the instruction, and it is where the refusal
// belongs.

/**
 * Choose which side to ask about: one the surviving readings actually disagree over, held a way
 * that is possible in EVERY scheme still in play — preferring white up, so the instruction is the
 * easy one. Faces already confirmed are skipped, so a second round asks about something new
 * rather than looping on the same side.
 */
/**
 * The unconfirmed slots whose way-up the surviving candidates disagree about. Candidates that
 * give the same facelet string under the same scheme always allow the same rotations of a slot,
 * so two candidates differ on a slot exactly when their rotation sets for it differ — and those
 * are the slots a look can settle. Compared across schemes too: the same string under two schemes
 * can allow different rotations of the blue and yellow captures, and a look there settles the
 * SCHEME without changing the state.
 */
function undeterminedSlots(
  candidates: readonly Candidate[],
  confirmed: Partial<Record<Face, Confirmation>>,
): Face[] {
  return FACES.filter((slot, si) => {
    if (confirmed[slot]) return false;
    const perCandidate = candidates.map((c) => holdsOf(c, slot, si).join(','));
    return new Set(perCandidate).size > 1;
  });
}

/**
 * The holds a candidate says are possible for one slot, as UP-COLOURS — the physical frame
 * (`heldUpColour`), not the candidate's own canonical rotations.
 *
 * A rotation is a number in its scheme's frame, and 12 of the 24 (slot, rotation) pairs name a
 * different physical hold under the two schemes. Comparing raw rotations across candidates was
 * therefore comparing mixed frames wherever both schemes were still standing, and it decided
 * which side the scanner asked about and which sides it reported as undetermined (found by audit,
 * 2026-09-07). Two candidates now differ on a slot exactly when they disagree about what a child
 * would have been holding upwards, which is the question a look answers.
 */
function holdsOf(candidate: Candidate, slot: Face, si: number): number[] {
  const colour = colourOfSlot(slot);
  return [
    ...new Set(candidate.combos.map((combo) => heldUpColour(colour, combo[si]!, candidate.scheme))),
  ].sort();
}

/**
 * The hold to ask for on `slot`, if any colour may be held up on every scheme in play.
 *
 * The side's CANONICAL top neighbour first, when every scheme in play agrees on it and permits
 * it — that is the hold the assembler has always asked for ("white up" for a side face, "blue
 * up" for the white side of a Western cube), so a scan with one scheme left asks exactly what
 * it asked before this file knew about schemes. Only when the schemes disagree about what sits
 * above a side does the preference list choose among the colours they have in common.
 */
function permittedHold(slot: Face, schemes: readonly Scheme[]): ConfirmRequest | undefined {
  const colour = colourOfSlot(slot);
  const allowed = commonNeighbours(colour, schemes);
  const tops = new Set(schemes.map((s) => neighbourColour(colour, 'top', s)));
  const canonical = tops.size === 1 ? [...tops][0]! : undefined;
  const up =
    canonical !== undefined && allowed.includes(canonical)
      ? canonical
      : UP_PREFERENCE.find((c) => allowed.includes(c));
  return up === undefined ? undefined : { face: slot, up: slotOf(up) };
}

function pickConfirm(
  candidates: readonly Candidate[],
  confirmed: Partial<Record<Face, Confirmation>>,
): ConfirmRequest | undefined {
  const schemes = schemesOf(candidates);
  const holds = undeterminedSlots(candidates, confirmed)
    .map((slot) => permittedHold(slot, schemes))
    .filter((h): h is ConfirmRequest => h !== undefined);
  return holds.find((h) => h.up === 'U') ?? holds[0];
}

/**
 * Choose the side to ask about in order to rule out readings that are not yet ruled out TWICE:
 * one whose reading the survivor predicts differently from each of them. Candidates producing the
 * same facelet string under one scheme always predict the same reading of a slot, so "predicts
 * differently" is exactly "their rotation sets are disjoint".
 */
function pickVerification(
  survivors: readonly Candidate[],
  weak: readonly Candidate[],
  confirmed: Partial<Record<Face, Confirmation>>,
  schemes: readonly Scheme[],
): ConfirmRequest | undefined {
  let best: ConfirmRequest | undefined;
  let bestScore = 0;
  FACES.forEach((slot, si) => {
    if (confirmed[slot]) return;
    const hold = permittedHold(slot, schemes);
    if (!hold) return;
    // In UP-COLOURS, not rotations: the survivors can stand under different schemes (the same
    // state read both ways), so a set of their raw rotations would mix two frames. See `holdsOf`.
    const ours = new Set(survivors.flatMap((s) => holdsOf(s, slot, si)));
    // How many still-standing readings this slot would expose, plus a nudge towards a side that
    // can be held white-up so the instruction stays "hold the white side up".
    const score =
      weak.filter((w) => holdsOf(w, slot, si).every((up) => !ours.has(up))).length +
      (hold.up === 'U' ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = hold;
    }
  });
  return best === undefined || bestScore < 1 ? undefined : best;
}

/**
 * Every distinct solvable reading of six as-shown captures under ONE scheme. Each distinct string
 * is validated once; `null` marks one already rejected.
 */
function solvableReadings(bySlot: BySlot, scheme: Scheme): Candidate[] {
  const faces = byPosition(bySlot, scheme);
  // Colour → position, under this scheme's filing.
  const owner = new Map<number, Face>();
  for (const position of FACES) owner.set(faces[position].colors[4]!, position);

  // Build the 54-char facelet string for one per-face rotation combo, or null if any sticker's
  // colour isn't one of the 6 centre colours (can't be placed on a real cube).
  const buildFacelets = (rots: number[]): string | null => {
    const letters: string[] = [];
    for (let fi = 0; fi < 6; fi++) {
      const rc = rotateFace(faces[FACES[fi]!].colors, rots[fi]!);
      for (let i = 0; i < 9; i++) {
        const position = owner.get(rc[i]!);
        if (position === undefined) return null;
        letters.push(position);
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
    if (combos !== null) combos.push(comboToSlots(rots, scheme));
  }
  return [...seen]
    .filter((e): e is [string, number[][]] => e[1] !== null)
    .map(([facelets, combos]) => ({ scheme, facelets, combos }));
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
 * The six centres, validated — the rule both entry points share, in one place.
 *
 * Every key must hold a capture (nine colours, nine real confidences), every centre must be a
 * colour class the detector can emit, and the six must be distinct. The centre-class check is
 * where "a centre is a colour the detector can produce" is enforced (2026-09-05): ordinary
 * stickers are deliberately not range-checked — an unknown colour there is a statement about the
 * cube — but a CENTRE names a face, so an out-of-range one is silently accepted as the name of
 * one: nine stickers of class 17 on U built the map `17 -> U`, every one of them then resolved
 * through it, and the assembler returned `valid: true` for a facelet string assembled out of a
 * colour class no model emits. NaN was worse, because `Map` matches it to itself.
 *
 * ONE implementation, for the two callers (2026-09-07, found by audit). It was written twice, and
 * the copies were already drifting: the same three rules, the same three sentences, one of them
 * with an extra rule bolted on. Two lifetimes of one validation is how a caller comes to be
 * trusted on one path and not the other — the reason `buildCentreOwner` was factored out in the
 * first place, undone by the branch that added a second path.
 *
 * Returns the centre colour under each key, or the rejection to hand straight back; the caller
 * discriminates on `instanceof Map`. What the KEYS mean is the caller's: a slot on the camera
 * path, a position on the painted one.
 */
function checkedCentres(faces: Record<Face, ColorFace>): Map<Face, Colour> | AiScanResult {
  const centres = new Map<Face, Colour>();
  const seen = new Set<number>();
  for (const key of FACES) {
    const f = checkedCapture(`face ${key}`, faces[key]);
    const centre = f.colors[4]!;
    if (!isColour(centre)) {
      return reject(`face ${key} has centre colour ${centre}, which is not one of the six`);
    }
    // Unreachable from either host path, and kept as a guard on the public API rather than a
    // case with a UI: the camera files every capture under its centre's slot (so a second capture
    // of the same colour overwrites the first rather than joining it), and a painted side is
    // seeded with its own colour while setSticker refuses index 4. A caller feeding captures
    // directly can still hit it, which is why it stays a loud refusal instead of an assumption.
    if (seen.has(centre)) return reject(`two faces share centre colour ${centre}`);
    seen.add(centre);
    centres.set(key, centre);
  }
  // No `size !== 6` check follows. Six iterations that each return on a duplicate leave a map of
  // exactly six; the check that used to be here was unreachable in both callers, and an
  // unreachable guard reads as a second, weaker line of defence that is not there.
  return centres;
}

/**
 * Validate six captures for the CAMERA path, where a key is a SLOT: the shared centre rules, plus
 * the one this path adds — a capture must be filed under the slot that names its colour.
 */
function checkedBySlot(faces: Record<Face, ColorFace>): BySlot | AiScanResult {
  const centres = checkedCentres(faces);
  if (!(centres instanceof Map)) return centres;
  for (const [slot, centre] of centres) {
    if (slotOf(centre) !== slot) {
      return reject(
        `face ${slot} has centre colour ${centre}, which files under ${slotOf(centre)} — a slot names a colour, not a position`,
      );
    }
  }
  return faces;
}

/**
 * Validate six faces and build the centre-colour → POSITION map, for the painted path, whose keys
 * are positions authored by the user rather than slots. The inverse of `checkedCentres`, which is
 * a bijection by construction: it has already refused two faces sharing a centre.
 */
function buildCentreOwner(faces: Record<Face, ColorFace>): Map<number, Face> | AiScanResult {
  const centres = checkedCentres(faces);
  if (!(centres instanceof Map)) return centres;
  return new Map([...centres].map(([position, centre]) => [centre as number, position]));
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
 * canonical net rather than shown to a camera. The keys are POSITIONS: the user authored each
 * sticker in place, and the centres are whatever the user put there, so the scheme is read off
 * them (`schemeOfCentres`) rather than searched for.
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
    // One scheme only: the centres ARE the scheme here, so there is nothing to search across.
    const diagnosis: MisreadDiagnosis =
      options.diagnose === false
        ? { misreadCount: null }
        : diagnoseMisread(faces, { fixedRotation: true });
    return reject('not a solvable cube yet', diagnosis);
  }

  const conf = FACES.flatMap((f) => faces[f]!.confidence);
  const centres = Object.fromEntries(FACES.map((f) => [f, faces[f]!.colors[4]!])) as Record<
    Face,
    number
  >;
  return {
    facelets,
    valid: true,
    ...summariseConfidence(conf, threshold),
    ...(schemeOfCentres(centres) ? { scheme: schemeOfCentres(centres) } : {}),
  };
}

/** The confirmations applied: what each one measures, and which candidates are left standing. */
interface Narrowed {
  ok: true;
  confirmedSlots: Face[];
  /** Per confirmed slot and scheme, the canonical rotations of the original capture the confirmation allows. */
  allowed: Map<Face, Map<Scheme, Set<number>>>;
  candidates: Candidate[];
}
/** …or the refusal to hand straight back, which is a sentence about a hold rather than a cube. */
type Narrowing = Narrowed | { ok: false; refusal: AiScanResult };

/**
 * Apply the confirmations: keep a candidate only if at least one of ITS combos rotates the
 * original capture into what the confirmation saw, at tolerance match (see matchingRotations) —
 * PROJECTED INTO THE CANDIDATE'S FRAME. `matchingRotations` gives the physical rotations `k`
 * between the two photographs; the hold the confirmation was taken under is canonical turned by
 * `holdOffset` under the candidate's scheme; so the canonical rotations it allows are `k - offset`.
 * A hold the candidate's scheme calls impossible allows nothing, and the candidate falls.
 *
 * This is a FILTER over strings the solvability gate has already passed, so no confirmation —
 * however badly held or read — can introduce a cube that was not already verified.
 */
function narrowByConfirmations(
  bySlot: BySlot,
  all: readonly Candidate[],
  confirmed: Partial<Record<Face, Confirmation>>,
): Narrowing {
  const confirmedSlots = FACES.filter((slot) => confirmed[slot]);
  const allowed = new Map<Face, Map<Scheme, Set<number>>>();
  for (const slot of confirmedSlots) {
    // CHECKED FIRST, like every other capture this module reads. A confirmation is user input that
    // arrives through the same public argument as the six sides and was the one capture nobody
    // validated — see `checkedCapture` for what a short one does to the tolerance match.
    const { capture, up } = confirmed[slot]!;
    const checked = checkedCapture(`confirmation of ${slot}`, capture);
    if (!FACES.includes(up))
      throw new Error(`confirmation of ${slot}: up ${String(up)} is not a slot`);
    const physical = matchingRotations(bySlot[slot], checked);
    // No rotation comes close: the two looks disagree about COLOURS, so this capture measures
    // nothing about the hold. Hand it back as `reread` — the caller adopts the fresh look (taken
    // under instruction, held a known way up) as the side's reading and re-assembles, instead of
    // telling a user who did everything right that they held it wrong.
    if (physical.size === 0) {
      return {
        ok: false,
        refusal: reject(
          'that side read differently this time — checking again with the fresh read',
          { reread: slot, confirm: { face: slot, up } },
        ),
      };
    }
    const perScheme = new Map<Scheme, Set<number>>();
    for (const scheme of SCHEMES) {
      const offset = holdOffset(colourOfSlot(slot), colourOfSlot(up), scheme);
      perScheme.set(
        scheme,
        offset === null ? new Set() : new Set([...physical].map((k) => (k - offset + 4) % 4)),
      );
    }
    allowed.set(slot, perScheme);
  }
  const candidates = all
    .map(
      (c): Candidate => ({
        ...c,
        combos: c.combos.filter((combo) =>
          confirmedSlots.every((slot) =>
            allowed.get(slot)!.get(c.scheme)!.has(combo[FACES.indexOf(slot)]!),
          ),
        ),
      }),
    )
    .filter((c) => c.combos.length > 0);

  if (candidates.length === 0) {
    // The scan itself was fine; the confirmation is what ruled everything out, so it was held the
    // wrong way up (or a sticker read differently the second time). Ask for the same side again
    // rather than throwing away five good faces.
    // Which confirmation was mis-held is not knowable from here, so re-asking only the last one
    // would loop forever when it was an earlier one. The caller drops them all and starts over.
    const last = confirmedSlots[confirmedSlots.length - 1]!;
    return {
      ok: false,
      refusal: reject('those two looks disagree — one was held the wrong way up; try again', {
        mismatch: true,
        confirm: { face: last, up: confirmed[last]!.up },
      }),
    };
  }
  return { ok: true, confirmedSlots, allowed, candidates };
}

/**
 * The lone reading, put to a further test — or null when it needs none and may be accepted.
 *
 * If a confirmation is what removed the other readings, that confirmation is load-bearing and a
 * mis-held one would have removed the TRUTH and kept an impostor. So demand redundancy: every
 * eliminated reading must be contradicted by at least TWO separate looks. A truthful look can never
 * contradict the real cube, so under that rule a single mis-hold can no longer eliminate the truth
 * on its own — the worst it can do is leave the scan ambiguous, which is safe, instead of
 * confidently wrong. Across schemes too: a candidate under the other scheme is an alternative
 * cube like any other, and it is projected into its own frame before it is counted contradicted.
 *
 * Counting looks instead of contradictions is NOT enough and was the first thing tried: when a
 * scan needs two looks just to narrow down, both get spent narrowing and nothing checks anything.
 * Measured, that returned a wrong cube in 5% of scans where the user mis-held one look.
 */
function verifySurvivor(
  all: readonly Candidate[],
  survivors: readonly Candidate[],
  narrowed: Narrowed,
  confirmed: Partial<Record<Face, Confirmation>>,
): AiScanResult | null {
  const { confirmedSlots, allowed } = narrowed;
  const facelets = survivors[0]!.facelets;
  const contradictions = (candidate: Candidate): number =>
    confirmedSlots.filter((slot) => {
      const si = FACES.indexOf(slot);
      const ok = allowed.get(slot)!.get(candidate.scheme)!;
      return candidate.combos.every((c) => !ok.has(c[si]!));
    }).length;
  const weak = all.filter((c) => c.facelets !== facelets && contradictions(c) < 2);
  if (weak.length === 0) return null;
  const schemes = schemesOf([...survivors, ...weak]);
  const check = pickVerification(survivors, weak, confirmed, schemes);
  if (check) {
    return reject('one more look to be sure — a single look could be held wrong', {
      confirm: check,
    });
  }
  // No remaining side can tell the readings apart, so the answer would rest on one look that
  // nothing can check. Accepting here was measured leaking wrong cubes, so say so instead: a
  // single turn of any face breaks the symmetry and makes the next scan readable.
  return symmetricRefusal(survivors, weak);
}

/**
 * The dead end, named for what it is: the readings left standing cannot be told apart by any
 * hold a child could be asked for. When they differ ONLY by scheme — each survivor and each
 * alternative is a different cube under a different arrangement — the reason is that nothing in
 * six photographs says which colour is under white, and the sentence says so; otherwise it is
 * the cube's own symmetry. Both end the same way: one turn, and a fresh scan.
 */
function symmetricRefusal(
  survivors: readonly Candidate[],
  alternatives: readonly Candidate[],
): AiScanResult {
  const survivorSchemes = new Set(survivors.map((c) => c.scheme));
  const onlyScheme =
    alternatives.length > 0 && alternatives.every((c) => !survivorSchemes.has(c.scheme));
  if (onlyScheme) {
    return reject(
      'these readings differ only in which colour is under white, and no hold can tell them apart — turn any one face, then scan again',
      { ambiguous: true, schemeAmbiguous: true },
    );
  }
  return reject(
    'this cube is too symmetric to read for certain — turn any one face, then scan again',
    { ambiguous: true },
  );
}

/**
 * A last resort before refusing: the cheapest recolouring that gives the cube nine of each colour.
 *
 * WHY IT SITS HERE AND NOT EARLIER. Applied to every scan it would MOVE stickers on cubes that were
 * already read correctly -- `ml/assign_sim.py` measured that breaking 0.5% of the shipped model's
 * cubes and 3.2% of a weaker model's. It amplifies a good detector and endangers a bad one. Run
 * only after `solvableReadings` has found nothing, it cannot damage a scan that was going to
 * succeed: the alternative at this point is a refusal.
 *
 * The gain it is here for, same measurement: whole cubes read perfectly 80.0% -> 98.7%, repairing
 * 592 of 636 sticker errors.
 *
 * Returns null when the detector gave no scores, when the repair changes nothing, or when it would
 * have to overrule the detector so hard that the reading is better refused than rewritten --
 * `MAX_REPAIR_COST` is that line, and a reading past it is not one misread but a bad capture.
 * The one caller that lifts it is `resolveCentres`, which replaces it with a stricter gate
 * of its own — see there.
 */
const MAX_REPAIR_COST = 12;

/** Would `colors` (54, in FACES order) change a sticker that a person locked? */
function movesALockedSticker(faces: Record<Face, ColorFace>, colors: readonly number[]): boolean {
  return FACES.some((face, fi) =>
    (faces[face]?.locked ?? []).some(
      (on, k) => on && colors[fi * 9 + k] !== faces[face]!.colors[k],
    ),
  );
}

function repairByCounts(
  faces: Record<Face, ColorFace>,
  maxCost: number,
): Record<Face, ColorFace> | null {
  const scores: number[][] = [];
  for (const face of FACES) {
    const s = faces[face]?.scores;
    if (s?.length !== 9 || s.some((row) => row.length !== NUM_COLORS)) return null;
    for (const row of s) scores.push(row);
  }
  if (scores.length !== STICKERS) return null;
  let result: ReturnType<typeof assignNineOfEach>;
  try {
    result = assignNineOfEach(scores);
  } catch {
    return null; // malformed scores are the detector's problem, not something to guess through
  }
  if (result.changed.length === 0 || result.cost > maxCost) return null;
  if (movesALockedSticker(faces, result.colors)) return null;
  const out = {} as Record<Face, ColorFace>;
  FACES.forEach((face, i) => {
    // `confidence` stays the DETECTOR's, for the class it picked -- so for a repaired sticker it
    // describes a colour the cube no longer says. That is a known inaccuracy, kept on purpose until
    // it is decided what a repaired sticker should MEAN to the user. Rewriting it to the chosen
    // class's score is not neutral: that score is whatever the detector gave its second choice, and
    // whenever it falls under LOW_CONFIDENCE_THRESHOLD, `ai-scan-panel`'s `finish` sends the cube to
    // `finishUnsure` and it is not accepted -- a path that is unreachable today by design. How many
    // of the measured repairs (592 of 636 sticker fixes, `ml/assign_sim.py`) would cross that line
    // has not been measured. The repair itself is licensed by the constraint (nine of each, and a
    // solvable reading), not by a per-sticker probability.
    out[face] = {
      ...faces[face]!,
      colors: result.colors.slice(i * 9, i * 9 + 9),
    };
  });
  return out;
}

/**
 * The colouring the PIXELS imply, when the scores' own colouring has been refused.
 *
 * `paint-groups.ts` carries the measurement and the reasoning; the short version is that stickers in
 * one frame share an illuminant, so which of them carry the same paint survives lighting that the
 * absolute question does not. Used only here, only after `repairByCounts` has failed too, and
 * accepted only if the result passes the same two gates: six distinct centres that match their
 * slots, and a reading that is actually solvable.
 *
 * The pixels regroup the stickers; the CENTRES name the groups, which is what keeps this from
 * inventing a cube — see `colorsFromPaint`. So it can repair any misread except a centre's, and a
 * misread centre is the one case the assembly already has a resolver for.
 *
 * Returns null unless every face carried its Lab — an app that does not supply it never reaches this,
 * and behaves exactly as it did before.
 */
function recolourByPaint(faces: Record<Face, ColorFace>): Record<Face, ColorFace> | null {
  const lab: [number, number, number][] = [];
  const centres: number[] = [];
  for (const face of FACES) {
    const capture = faces[face];
    if (capture?.lab?.length !== 9) return null;
    for (const row of capture.lab) lab.push(row);
    centres.push(capture.colors[4]!);
  }
  const colors = colorsFromPaint(lab, centres);
  if (!colors || movesALockedSticker(faces, colors)) return null;
  const out = {} as Record<Face, ColorFace>;
  FACES.forEach((face, i) => {
    out[face] = { ...faces[face]!, colors: colors.slice(i * 9, i * 9 + 9) };
  });
  return out;
}

/**
 * Turn 6 detected faces (colour classes, any rotation) into a validated ScanResult by solving each
 * face's rotation and the cube's colour scheme together. Rejects a scan whose 6 centres are not 6
 * distinct colours (not a real cube) and a colour misread (no rotation is solvable under any
 * scheme). When several readings survive, returns a `confirm` request naming the one side to show
 * again and the colour to hold up.
 *
 * @param faces The six captures, keyed by SLOT — `FACES[colour]`, the colour's name.
 * @param confirmed Captures already taken under a `confirm` request, keyed by the slot they show,
 *   each with the `up` it was held with. These only narrow the candidates the search already
 *   validated.
 */
export function assembleColors(
  faces: Record<Face, ColorFace>,
  threshold = LOW_CONFIDENCE_THRESHOLD,
  confirmed: Partial<Record<Face, Confirmation>> = {},
  options: AssembleOptions = {},
): AiScanResult {
  return assembleWithin(faces, threshold, confirmed, options, MAX_REPAIR_COST);
}

/**
 * `assembleColors` with the repair's cost ceiling as a parameter. Exactly one caller passes anything
 * but MAX_REPAIR_COST: `resolveCentres`, which gates on legality and uniqueness instead.
 */
function assembleWithin(
  faces: Record<Face, ColorFace>,
  threshold: number,
  confirmed: Partial<Record<Face, Confirmation>>,
  options: AssembleOptions,
  maxRepairCost: number,
  allowPaint = true,
): AiScanResult {
  const bySlot = checkedBySlot(faces);
  if ('valid' in bySlot) return bySlot;

  /**
   * The gate both fallbacks are accepted on, written once: a recolouring is worth having only if
   * it still checks out by slot AND some scheme finds it solvable. Null means "not this one, try
   * the next"; anything else is the verdict for the recoloured cube, refusal included -- reaching
   * this point at all means the reading as detected was going to be refused.
   */
  const accept = (candidate: Record<Face, ColorFace> | null): AiScanResult | null => {
    if (!candidate) return null;
    const bySlotCandidate = checkedBySlot(candidate);
    if ('valid' in bySlotCandidate) return null;
    const solvable = SCHEMES.flatMap((scheme) => solvableReadings(bySlotCandidate, scheme));
    if (solvable.length === 0) return null;
    return assembleWithin(candidate, threshold, confirmed, options, maxRepairCost, allowPaint);
  };

  const all = SCHEMES.flatMap((scheme) => solvableReadings(bySlot, scheme));

  if (all.length === 0) {
    // The reading is not solvable as read. Before refusing, try the one repair that is justified
    // here and nowhere else: the cheapest recolouring with nine of each colour. Accepted ONLY if
    // the repaired reading is itself solvable, so this can turn a refusal into a scan and can
    // never turn a scan into something worse.
    const byCounts = accept(repairByCounts(faces, maxRepairCost));
    if (byCounts) return byCounts;
    // Still nothing. One more source of evidence exists and has not been used: the pixels. The
    // scores answered "what colour is each sticker" and were refused; the pixels answer "which
    // stickers share a paint", which a shared illuminant makes answerable when the other is not.
    // Same two gates, so this can turn a refusal into a read and cannot turn a read into anything.
    const byPaint = accept(allowPaint ? recolourByPaint(faces) : null);
    if (byPaint) return byPaint;

    // Before refusing, do the diagnosis a refusal makes possible: how many stickers are wrong is
    // always answerable, and when it is exactly one, WHICH one is answerable too. Under every
    // scheme, because the refused reading says nothing about which the cube has.
    return reject(
      'no orientation of the faces is solvable — a colour was misread',
      options.diagnose === false ? { misreadCount: null } : diagnoseAcrossSchemes(bySlot),
    );
  }

  const narrowed = narrowByConfirmations(bySlot, all, confirmed);
  if (!narrowed.ok) return narrowed.refusal;
  const candidates = narrowed.candidates;
  const readings = readingsOf(candidates);

  if (readings.size > 1) {
    const confirm = pickConfirm(candidates, confirmed);
    if (confirm) {
      return reject(`${readings.size} readings fit — another look narrows them`, {
        ambiguous: true,
        confirm,
        readings: readings.size,
        undetermined: undeterminedSlots(candidates, confirmed),
      });
    }
    // No unconfirmed side can tell the surviving readings apart (their rotation sets agree on
    // every slot we could still ask about) — the same dead end as the too-symmetric case in
    // `verifySurvivor`, so say the same thing rather than promising a deciding look that cannot
    // be asked for. Survivors and alternatives here are the first string's candidates against
    // the rest; which string counts as "the survivor" is immaterial to the wording.
    const [first] = readings;
    return symmetricRefusal(
      candidates.filter((c) => c.facelets === first),
      candidates.filter((c) => c.facelets !== first),
    );
  }

  // Exactly one STATE survives, under one scheme or under both. A confirmation that removed the
  // others is load-bearing, and a look nothing checks can be a mis-hold. See `verifySurvivor`.
  const survivors = candidates;
  const unverified = verifySurvivor(all, survivors, narrowed, confirmed);
  if (unverified) return unverified;

  const facelets = survivors[0]!.facelets;
  const schemes = schemesOf(survivors);
  // Rotate the confidences the same way for the report, using a combo that satisfies every
  // confirmation. The combo itself rides along as `rotations`, so a host can turn each tile the
  // way the search turned the capture, and the caller can settle its captures into canonical.
  // Slot order throughout: the confidences and the captures are both keyed by slot.
  const chosen = survivors.find((c) => c.scheme === schemes[0])!.combos[0]!;
  const conf: number[] = [];
  FACES.forEach((slot, si) => {
    for (const c of rotateFace(bySlot[slot].confidence, chosen[si]!)) conf.push(c);
  });
  return {
    facelets,
    valid: true,
    scheme: schemes.length === 1 ? schemes[0]! : 'undetermined',
    ...summariseConfidence(conf, threshold),
    rotations: [...chosen],
  };
}

/** What `resolveCentres` decided: the verdict, and the filing it was reached on. */
export interface CentreResolution {
  result: AiScanResult;
  /**
   * The six captures filed as the resolution decided, every unnamed side now carrying its slot's
   * centre colour. Present when one filing was chosen — by legality, or by the centres' confidence
   * when no filing is legal — and absent when nothing decided, where no filing is the right one to keep.
   */
  faces?: Record<Face, ColorFace>;
  /** What chose `faces`: the one legal filing, the centres' confidence when none is legal, or
   *  `counting` when one unnamed side and one free slot left no choice to make. */
  decidedBy?: 'legality' | 'confidence' | 'counting';
}

/** A side the scan could not name by its centre, and how surely its centre read the colour it claims. */
export interface UnnamedSide {
  capture: ColorFace;
  /**
   * The colour this side's centre CLAIMS, or null when no run ever agreed on one.
   *
   * THE TWO REASONS A SIDE IS UNNAMED ARE NOT THE SAME (2026-09-20). A collision is two sides
   * reading the same colour surely — there is a claim, and whose is weaker decides. A centre that
   * never settled makes no claim at all, and the last frame's colour is an accident of which frame
   * happened to be filed. Deriving one from the other let an arbitrary colour into the confidence
   * ranking below, which is the one place a wrong claim picks the wrong cube.
   *
   * Absent means "claims its capture's centre" — how every caller before this field behaved.
   */
  centreClaim?: Colour | null;
  /**
   * The centre's confidence in the colour it reads as — for a side seen many times, typical over its
   * reads rather than the one frame that happened to be filed. On a real clip (2026-09-18) single
   * frames of a logo centre and of a plain one overlapped (0.756 to 0.776 read on both), while their
   * medians did not (0.728 against 0.783).
   */
  centreConfidence: number;
}

/** `capture` filed as the side whose centre is `colour`: that colour at the centre, and certain. */
export function withCentre(capture: ColorFace, colour: number): ColorFace {
  if (capture.colors[4] === colour) return capture;
  const colors = [...capture.colors];
  colors[4] = colour;
  if (!capture.scores) return { ...capture, colors };
  const scores = capture.scores.map((row) => [...row]);
  scores[4] = scores[4]!.map((_, c) => (c === colour ? 1 : 0));
  return { ...capture, colors, scores };
}

/** Every ordering of `items` — n! of them, for the at most six sides a scan can hold. */
function orderings<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    orderings([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/**
 * Sides whose centres the scan could not name — two or more read as one colour — decided once all
 * six are in: which slot each of them fills, without trying to read those centres again.
 *
 * WHY THIS EXISTS. Brands print their logo on the white centre, and a logo reads as whatever colour
 * its ink and the light make it — blue on one scan, yellow on another. On seven real cubes photographed
 * side by side (2026-09-13), four of the seven centre collisions were a blue logo on a white cap read as
 * blue; the other three were a red centre read as orange. A side is filed under its centre's colour,
 * so the second side claiming that colour has nowhere to go. It used to be turned away while the user
 * held the white side, which would only read as blue again, and the scan could never finish.
 *
 * THE MECHANISM IS COUNTING, NOT SEEING. A 3x3 has exactly one centre of each colour, in either
 * scheme. So the unnamed sides fill exactly the slots no named side holds, one each, and every way of
 * doing that is tried — including the single-side case, where one slot is free and the colour is
 * therefore forced — two for the common case of one pair, more when several centres collided,
 * which the one-contest design this replaces could not take. Each side that changes colour has its
 * centre made certain (`withCentre`), so the nine-of-each repair cannot quietly hand the old colour back.
 *
 * LEGALITY DECIDES FIRST, AND ONLY WHEN IT IS UNIQUE. A real cube is legal, so a filing is kept when it
 * has a legal reading — accepted outright, or legal but needing a look (`confirm`, `ambiguous`). On all
 * seven measured collisions exactly one filing fitted, and it was the cube as it physically was. The
 * cheaper nine-of-each repair was NOT the evidence to use instead: in none of the seven was it the true
 * filing's (six went the other way, one tied). When several filings fit this refuses rather than
 * choosing — two legal colourings of one set of captures do exist near each other (a measured pair
 * stood four stickers apart), and a confident wrong cube is the failure this package treats as the worst.
 *
 * WHEN NO FILING IS LEGAL, THE CENTRES' CONFIDENCE CHOOSES WHICH READING TO FIX (2026-09-18). That is
 * the case where something besides a centre was misread too — on a real clip, the sticker beside a
 * blue logo read blue as well — and it used to end the scan with "start over". But the question left is
 * narrower than the one legality answers: not "which cube is this" but "which of these centres was
 * misread". Of the sides claiming one colour, the one whose centre read it less surely is the misread
 * one. On all seven measured collisions that rule named the misread centre (logos by a wide margin,
 * 0.55-0.71 against 0.90-0.92; red read as orange by 0.014-0.047), and on the clip by 0.728 to 0.783.
 * It chooses a READING, never a cube: what comes back is still refused, and the misread stickers are
 * what the person is then shown. It decides only when it is unambiguous — one side per colour to keep,
 * a strict difference, and exactly one side left over to take the one unclaimed colour. Otherwise it
 * refuses as before.
 *
 * THE REPAIR CEILING IS LIFTED HERE, AND ONLY HERE. MAX_REPAIR_COST refused five of the seven true
 * filings — their costs ran from 13 to 36 — because a misread logo cap rarely comes alone: the cool
 * tint that turned the centre blue turned the white stickers around it blue too. The ceiling guards
 * one reading against being rewritten into a cube nobody held; here that job is done by the rule
 * above, which is stricter — a legal cube required, exactly one allowed.
 *
 * THE LIMIT, stated so it is not rediscovered: when a misread side's OUTER stickers read as another
 * side's too — a near-solved white face read as nine blues — the two captures are the same picture,
 * the panel cannot tell them apart, and nothing here is ever reached.
 */
export function resolveCentres(
  named: Partial<Record<Face, ColorFace>>,
  unnamed: readonly UnnamedSide[],
  threshold = LOW_CONFIDENCE_THRESHOLD,
  options: AssembleOptions = {},
): CentreResolution {
  const free = FACES.filter((face) => !named[face]);
  // ONE UNNAMED SIDE IS ENOUGH (2026-09-20). It used to take two, because the only way to be unnamed
  // was to collide with another side over a colour. Since the panel also holds back a side whose
  // centre never settled — a logo cap alternating between two colours — the common case is a single
  // unnamed side and a single free slot, and there the answer is forced: six centres, five taken.
  // Forced is not the same as unchecked; the filing still has to assemble into a legal cube below,
  // and a cube that does not is still refused.
  if (unnamed.length < 1 || unnamed.length !== free.length) {
    return {
      result: reject(
        'a centre resolution needs at least one unnamed side, exactly as many as the slots no side holds',
      ),
    };
  }
  // What each unnamed side claims: its explicit claim where it has one, its capture's centre where
  // the field is absent, and null where the run never agreed. A null never becomes a colour here.
  const claimed: Array<Colour | null> = [];
  for (const side of unnamed) {
    if (side.centreClaim === null) {
      claimed.push(null);
      continue;
    }
    const centre = side.centreClaim ?? side.capture.colors[4];
    if (centre === undefined || !isColour(centre)) {
      return {
        result: reject(`an unnamed capture's centre colour ${centre} is not one of the six`),
      };
    }
    claimed.push(centre);
  }
  const filings = orderings(free).map((slots) => {
    const faces = { ...named } as Record<Face, ColorFace>;
    slots.forEach((slot, i) => {
      faces[slot] = withCentre(unnamed[i]!.capture, colourOfSlot(slot));
    });
    return { slots, faces };
  });
  const assessed = filings.map((f) => ({
    ...f,
    result: assembleWithin(
      f.faces,
      threshold,
      {},
      { ...options, diagnose: false },
      Number.POSITIVE_INFINITY,
      // NO PIXEL PATH HERE. It names its groups from the centres, and this is the one situation
      // where a centre is already known to be wrong — the filings differ by which centre was
      // misread. Left on, it makes a WRONG filing assemble too: measured 2026-09-17 on the 140
      // community sets, it turned one of v3's refusals into a legal cube that was not the user's,
      // which is the failure this whole file exists to prevent.
      false,
    ),
  }));
  // ONE UNNAMED SIDE MAKES NO CHOICE, SO IT CANNOT FALL INTO CHOOSING LOGIC. With a single free slot
  // there is exactly one filing; legality has nothing to pick between and the confidence ranking has
  // nobody to rank. Returning `faces` even when the cube comes back invalid is what keeps the scan at
  // SIX captures: the panel adopts the filing and reports the refusal against it, where before it
  // cleared the unnamed side and restored it only if its arbitrary last-frame centre happened to name
  // a free slot — so a refused scan silently became five sides (audit, 2026-09-20).
  if (unnamed.length === 1) {
    const only = assessed[0]!;
    return { result: only.result, faces: only.faces, decidedBy: 'counting' };
  }
  const fits = assessed.filter(
    ({ result }) => result.valid || result.ambiguous === true || result.confirm !== undefined,
  );
  if (fits.length === 1) {
    const [fit] = fits;
    return { result: fit!.result, faces: fit!.faces, decidedBy: 'legality' };
  }
  // The pair a refusal names: the first colour two sides claimed, and the first slot nobody claimed.
  const claims = claimed.filter((c): c is Colour => c !== null);
  const shared = slotOf(
    claims.find((c, i) => claims.indexOf(c) !== i) ?? claims[0] ?? colourOfSlot(free[0]!),
  );
  const missing = free.find((slot) => !claims.includes(colourOfSlot(slot))) ?? free[0]!;
  const conflict = (legalFilings: number): CentreResolution => ({
    result: reject(
      legalFilings === 0
        ? 'sides read with the same centre colour, and no way of filing them is a legal cube'
        : 'sides read with the same centre colour, and more than one way of filing them is a legal cube',
      { centreConflict: { shared, missing, legalFilings } },
    ),
  });
  if (fits.length > 1) return conflict(fits.length);

  // No filing is legal. For each colour the unnamed sides claim, the side that read it most surely
  // keeps it; every other side is a misread centre. Only a unique answer is used.
  // A SIDE THAT CLAIMS NOTHING CANNOT BE RANKED, AND MUST NOT BE GUESSED. Its confidence is a figure
  // about a colour it never settled on, so feeding it here would let an accident of framing decide
  // which reading to call misread. Where any side is unread and more than one remains, this refuses.
  if (claimed.some((c) => c === null)) return conflict(0);
  const keeps = new Map<Colour, number>(); // colour -> index of the side that keeps it
  for (const colour of new Set(claims)) {
    const claimants = claims.flatMap((c, i) => (c === colour ? [i] : []));
    const ranked = [...claimants].sort(
      (a, b) => unnamed[b]!.centreConfidence - unnamed[a]!.centreConfidence,
    );
    const [top, next] = ranked;
    if (next !== undefined && unnamed[top!]!.centreConfidence === unnamed[next]!.centreConfidence) {
      return conflict(0);
    }
    keeps.set(colour, top!);
  }
  const movers = unnamed.map((_, i) => i).filter((i) => keeps.get(claims[i]!) !== i);
  const open = free.filter((slot) => !keeps.has(colourOfSlot(slot)));
  if (movers.length !== 1 || open.length !== 1) return conflict(0);
  const chosen = assessed.find(({ slots }) =>
    slots.every((slot, i) => (i === movers[0] ? slot === open[0] : slot === slotOf(claims[i]!))),
  );
  if (!chosen) return conflict(0);
  return { result: chosen.result, faces: chosen.faces, decidedBy: 'confidence' };
}
