//! Turn a published algorithm into something our numbers can be compared against — and state, in
//! one place, what "how many moves" means when the two sides count differently.
//!
//! Plan B5 (dev-docs/method-solver-return-plan.md §9), and it exists because of §7a finding F5:
//! **the reference gate cannot consume its own inputs.** `apps/web/lib/optimal.js:29` refuses any
//! token outside `[URFDLB](2|')?` — deliberately, because a "proof" using slices or rotations
//! would solve while proving nothing in the claimed metric — and published OLL/PLL sets are full
//! of `M2'`, `r`, `U'`, `x`. Layer 4's comparison is impossible without a normalization step, and
//! F5's point is that the step is a PREREQUISITE, not an afterthought.
//!
//! ## The move-count convention, stated
//!
//! **HTM = the number of face-turn tokens after expanding every wide, slice and rotation token
//! into face turns and whole-cube rotations, pushing the rotations to the end, and merging
//! adjacent turns of the same face. Whole-cube rotations cost zero.**
//!
//! Each clause is load-bearing:
//!
//! - *expanding* — `M2` is `L2 R2` plus a rotation, so it costs 2 and not 1; `r` is `L` plus a
//!   rotation, so it costs 1. A set that counted a slice as one move would appear to beat an
//!   optimum it does not reach.
//! - *pushing rotations to the end* — a rotation in the middle relabels every later face, so an
//!   expansion that left it in place would produce a maneuver that does not do what the original
//!   did. This is the same conjugation `cube-pieces.js`'s `rotateAlg` performs.
//! - *merging adjacent same-face turns* — seams appear where two expansions meet: `M2 M2` is
//!   `L2 R2 L2 R2` before merging and nothing after it. Only ADJACENT turns are merged;
//!   reordering commuting turns would shorten it further and would stop the maneuver being the
//!   thing it said it was.
//! - *rotations cost zero* — HTM counts face turns. This is why a normalized maneuver can be
//!   SHORTER than the published token count, and it is why Layer 4's comparison is one-directional
//!   (§7): a published 14-HTM maneuver refutes a claimed 15-move optimum; a longer one proves
//!   nothing, because published sets are chosen for finger tricks rather than for length.
//!
//! ## What this is NOT
//!
//! It is not a relaxation of the app's grammar. `optimal.js` still refuses `M2'` and must: the
//! word "optimal" may reach a screen only through `prove()`, in face turns. This runs offline, on
//! a reference set held in a scratch path outside the repository, and what enters the repository
//! is a comparison report — never the set, and never a maneuver taken from it.

use crate::cubie::{compose, inverse, Cubie, MOVE_NAMES, SOLVED};

/// The three whole-cube rotations, as face relabellings applied to a maneuver.
///
/// `x` about R, `y` about U, `z` about F, each a quarter turn in the same direction as the face
/// it is named for. Written as the permutation of the six faces in `U R F D L B` order.
/// `π[f]` is **where the physical face `f` goes** — equivalently, what the move `f` is called
/// afterwards, which is the map `cube-pieces.js`'s `Y_FACES` states for y.
///
/// **Two of these three were written inverted, and nothing caught it for hours.** `derive_rotation`
/// builds a rotation FROM this table and then verifies it against itself, so an inverted entry
/// yields the inverse rotation, self-consistently; the reference interpreter in the tests shares
/// `wide_rotation` and `rotation_generator`, so it agreed too. Two implementations of one rule are
/// worth about one opinion, and this is what that costs. It surfaced only when a real published
/// set was pushed through: `r U R' U' r' F R F'` came out not preserving the first two layers, and
/// 100 of 192 maneuvers landed in a frame no cube can be in.
///
/// So the entries are now pinned against three physical facts that do not pass through any of the
/// code they define — see `the_face_maps_are_the_rotations_a_hand_would_make`.
const ROT_FACES: [[usize; 6]; 3] = [
    // x turns the cube the way R goes: F->U, U->B, B->D, D->F; R and L are fixed.
    [5, 1, 0, 2, 4, 3],
    // y turns the way U goes: F->R, R->B, B->L, L->F; U and D are fixed. `Y_FACES`, verbatim.
    [0, 5, 1, 3, 2, 4],
    // z turns the way F goes: U->R, R->D, D->L, L->U; F and B are fixed.
    [1, 3, 2, 4, 0, 5],
];

/// Which axis each rotation letter turns about.
fn rotation_index(c: char) -> Option<usize> {
    match c {
        'x' => Some(0),
        'y' => Some(1),
        'z' => Some(2),
        _ => None,
    }
}

/// A parsed token: how many quarter turns, and of what.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Token {
    /// A face turn: face index in `U R F D L B` order, and 1..=3 quarter turns.
    Face(usize, u8),
    /// A wide turn — the face layer AND the slice beside it. Expanded as the face turn plus the
    /// whole-cube rotation that carries the slice, which is exactly what a wide turn is.
    Wide(usize, u8),
    /// A slice: `M` follows L, `E` follows D, `S` follows F — the standard convention, and the
    /// one every published set uses.
    Slice(char, u8),
    /// A whole-cube rotation: axis index into `ROT_FACES`, and 1..=3 quarter turns.
    Rotation(usize, u8),
}

/// Face letters in the order `ROT_FACES` and `MOVE_NAMES` both use.
const FACES: [char; 6] = ['U', 'R', 'F', 'D', 'L', 'B'];

fn face_index(c: char) -> Option<usize> {
    FACES.iter().position(|&f| f == c)
}

/// Strip the decoration published sets wrap their maneuvers in, and nothing else.
///
/// Measured against a real set on 2026-09-09: its 276 OLL and PLL maneuvers use 88 distinct
/// tokens, and the ones that are not moves are **finger-trick grouping** — `(R U R')`, which says
/// how to hold the maneuver and changes nothing about it — and a **typographic apostrophe**
/// (U+2019), which a text editor produced. Both are noise around the notation.
///
/// Footnote markers like `*` and a bare `3` are NOT stripped. They are annotation whose meaning
/// lives in the surrounding page, and a normalizer that dropped them silently would be reading a
/// maneuver it did not understand and reporting a length for it. They are refused by name, and
/// the caller reports how many entries it could not read — the loud default this repository takes
/// everywhere else.
fn clean(tok: &str) -> String {
    tok.chars()
        .filter(|c| *c != '(' && *c != ')')
        .map(|c| match c {
            '\u{2019}' | '\u{2032}' | '\u{00b4}' => '\'',
            other => other,
        })
        .collect()
}

/// Parse one token. Anything unrecognised is an error, never skipped — a set with a token we do
/// not understand must not be silently compared as if it were shorter.
fn parse_token(raw: &str) -> Result<Token, String> {
    let tok = &clean(raw);
    if tok.is_empty() {
        return Err(format!("{raw}: nothing but decoration"));
    }
    let mut chars = tok.chars();
    let head = chars.next().ok_or("empty token")?;
    let tail: String = chars.collect();
    let quarters = match tail.as_str() {
        "" => 1u8,
        "2" | "2'" => 2,
        "'" => 3,
        _ => return Err(format!("{tok}: unknown suffix \"{tail}\"")),
    };
    // Uppercase face, or lowercase wide — `r` is the R layer plus the slice beside it.
    if let Some(f) = face_index(head) {
        return Ok(Token::Face(f, quarters));
    }
    let upper = head.to_ascii_uppercase();
    if head.is_ascii_lowercase() {
        if let Some(f) = face_index(upper) {
            return Ok(Token::Wide(f, quarters));
        }
        if let Some(axis) = rotation_index(head) {
            return Ok(Token::Rotation(axis, quarters));
        }
    }
    if matches!(head, 'M' | 'E' | 'S') {
        return Ok(Token::Slice(head, quarters));
    }
    Err(format!("{tok}: not a move this notation knows"))
}

/// A face turn as its `MOVE_NAMES` index.
fn move_index(face: usize, quarters: u8) -> usize {
    face * 3 + (quarters as usize - 1)
}

/// Relabel a face through `n` quarter turns of `axis` — the map π that `ROT_FACES` states.
///
/// Only the tests read this now; `normalize` accumulates `relabel_inv`. Kept because the
/// conjugation identity that DEFINES the rotations is stated in terms of π, and expressing it
/// through the inverse would make the definition read backwards from the thing it defines.
#[cfg(test)]
fn relabel(face: usize, axis: usize, n: u8) -> usize {
    let mut f = face;
    for _ in 0..(n % 4) {
        f = ROT_FACES[axis][f];
    }
    f
}

/// π⁻¹ — and this direction, not π, is what a FRAME accumulates, composed on the RIGHT.
///
/// The two are easy to swap and the swap is invisible until a maneuver is applied. The identity
/// that settles it: from `r⁻¹ m r = π(m)` it follows that `r · π(m) = m · r`, so the fixed-frame
/// face turn equivalent to "rotate, then turn the face now called f" is `π⁻¹(f)` — `y R` is `F y`,
/// not `B y`. `rotateAlg` in `cube-pieces.js` goes the other way because it answers a different
/// question ("what would I now call the turn I used to call F"), and reading one as the other is
/// exactly the mistake this note exists to stop.
fn relabel_inv(face: usize, axis: usize, n: u8) -> usize {
    let mut f = face;
    for _ in 0..(n % 4) {
        f = ROT_FACES[axis]
            .iter()
            .position(|&g| g == f)
            .expect("a face permutation is onto");
    }
    f
}

/// The normalized form of a published maneuver.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Normalized {
    /// Face turns only, as `MOVE_NAMES` indices — the maneuver as the app's grammar would have it.
    pub moves: Vec<u8>,
    /// The net whole-cube rotation the original left behind, as (axis, quarters) steps in order.
    /// Empty when the maneuver ends in the frame it started in.
    pub rotation: Vec<(usize, u8)>,
    /// The HTM cost under the convention stated at the top of this file.
    pub htm: usize,
}

impl Normalized {
    /// The maneuver in the app's notation, space separated.
    pub fn to_alg(&self) -> String {
        self.moves
            .iter()
            .map(|&m| MOVE_NAMES[m as usize])
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Normalize a published maneuver into face turns plus a net rotation.
///
/// The algorithm is one left-to-right pass carrying the rotation accumulated so far. Every token
/// is first expanded into (face turns, rotation), then each of those face turns is relabelled
/// through the rotation already accumulated — which is what "pushing the rotations to the end"
/// means operationally, and it is the same conjugation `rotateAlg` performs on the JS side.
pub fn normalize(alg: &str) -> Result<Normalized, String> {
    let mut out: Vec<u8> = Vec::new();
    // The accumulated rotation, as a face relabelling. Composed rather than kept as a list of
    // axis turns, because two rotations about different axes are not a list, they are a
    // permutation — and a list would have to be replayed to relabel anything.
    let mut frame: [usize; 6] = [0, 1, 2, 3, 4, 5];
    let mut rotation: Vec<(usize, u8)> = Vec::new();

    let emit = |face: usize, quarters: u8, frame: &[usize; 6], out: &mut Vec<u8>| {
        out.push(move_index(frame[face], quarters) as u8);
    };

    for tok in alg.split_whitespace() {
        match parse_token(tok)? {
            Token::Face(f, q) => emit(f, q, &frame, &mut out),
            Token::Rotation(axis, q) => {
                // The rotation applies to everything AFTER it, so it is folded into the frame and
                // never emitted. Recorded, so a caller can say what orientation the maneuver ends
                // the cube in — for a case algorithm that is a real fact, not a rounding error.
                let mut next = frame;
                for f in 0..6 {
                    next[f] = frame[relabel_inv(f, axis, q)];
                }
                frame = next;
                rotation.push((axis, q));
            }
            // A wide turn is the face turn plus the rotation that carries the slice with it: `r`
            // is `R` then `x'`-ish depending on the face. Written per face rather than by a rule,
            // because the rule has three signs in it and the tests below check every one.
            // `r^q = x^q L^q`, and its five siblings. Derived rather than remembered: the whole
            // cube turned the way R goes moves the R layer, the M slice AND the L layer, so
            // turning L back leaves exactly the R layer and the slice — which is what a wide turn
            // is. The rotation therefore CARRIES the face layer; emitting the face turn as well
            // (as a first draft did) turns it twice, and the faithfulness check catches it.
            Token::Wide(f, q) => {
                let (axis, dir) = wide_rotation(f);
                let n = if dir > 0 { q % 4 } else { (4 - q % 4) % 4 };
                if n != 0 {
                    let mut next = frame;
                    for k in 0..6 {
                        next[k] = frame[relabel_inv(k, axis, n)];
                    }
                    frame = next;
                    rotation.push((axis, n));
                }
                // The opposite face is fixed by this rotation, so it does not matter whether this
                // is read in the frame before or after — but it is emitted after, because that is
                // the order the identity is written in.
                if q % 4 != 0 {
                    emit(opposite_face(f), q, &frame, &mut out);
                }
            }
            // A slice is the rotation with both outer layers turned back.
            Token::Slice(letter, q) => {
                let (follows, axis, dir) = match letter {
                    'M' => (4usize, 0usize, -1i8), // M follows L, about the x axis
                    'E' => (3usize, 1usize, -1i8), // E follows D, about the y axis
                    'S' => (2usize, 2usize, 1i8),  // S follows F, about the z axis
                    _ => unreachable!("parse_token admits only M, E and S"),
                };
                let n = if dir > 0 { q } else { (4 - q % 4) % 4 };
                // Turn the two outer layers the way the slice does NOT go, then rotate the cube:
                // the net effect is the slice alone. `follows` is the face the slice moves with,
                // so that one turns with the rotation and its opposite turns against it.
                emit(follows, (4 - q % 4) % 4, &frame, &mut out);
                emit(opposite_face(follows), q, &frame, &mut out);
                let mut next = frame;
                for k in 0..6 {
                    next[k] = frame[relabel_inv(k, axis, n)];
                }
                frame = next;
                rotation.push((axis, n));
            }
        }
    }

    let merged = merge_adjacent(&out);
    let htm = merged.len();
    Ok(Normalized {
        moves: merged,
        rotation,
        htm,
    })
}

/// Which whole-cube rotation a wide turn of `face` carries, and in which direction.
fn wide_rotation(face: usize) -> (usize, i8) {
    match face {
        0 => (1, 1),  // u carries y
        3 => (1, -1), // d carries y'
        1 => (0, 1),  // r carries x
        4 => (0, -1), // l carries x'
        2 => (2, 1),  // f carries z
        5 => (2, -1), // b carries z'
        _ => unreachable!("six faces"),
    }
}

fn opposite_face(f: usize) -> usize {
    (f + 3) % 6
}

/// Merge adjacent turns of the same face, dropping any that cancel. Adjacent only — reordering
/// commuting turns would shorten it further and would stop the maneuver being what it said.
fn merge_adjacent(moves: &[u8]) -> Vec<u8> {
    let mut runs: Vec<(usize, u8)> = Vec::new();
    for &m in moves {
        let face = m as usize / 3;
        let quarters = (m as usize % 3) as u8 + 1;
        match runs.last_mut() {
            Some((f, q)) if *f == face => {
                *q = (*q + quarters) % 4;
                if *q == 0 {
                    runs.pop();
                }
            }
            _ => runs.push((face, quarters)),
        }
    }
    runs.into_iter()
        .map(|(f, q)| move_index(f, q) as u8)
        .collect()
}

/// The state a normalized maneuver reaches from solved — for checking that the normalization
/// preserved what the original did.
pub fn apply_indices(moves: &[u8]) -> Cubie {
    let table = crate::cubie::all_moves();
    let mut s = SOLVED;
    for &m in moves {
        s = compose(&s, &table[m as usize]);
    }
    s
}

/// The whole-cube rotation a `Normalized` ended in, as a state — so "did the normalization keep
/// the permutation" can be asked as an equality rather than by eye.
pub fn rotation_state(steps: &[(usize, u8)]) -> Cubie {
    // Each rotation as a cubie permutation, built from the face relabelling it performs. Rather
    // than a second table, it is derived: conjugating every face turn by the rotation must
    // reproduce the relabelling, and that is what the test asserts.
    let mut s = SOLVED;
    for &(axis, q) in steps {
        for _ in 0..(q % 4) {
            s = compose(&s, rotation_generator(axis));
        }
    }
    s
}

/// `x`, `y` and `z` as cube states — DERIVED, never typed.
///
/// A whole-cube rotation is not in the group the face turns generate, so it cannot be composed out
/// of them and there is nothing to check a typed constant against by inspection. What defines it
/// is the CONJUGATION IDENTITY: `r⁻¹ · move[f] · r == move[π(f)]` for every face `f`, where π is
/// the relabelling the rotation performs. That is a complete specification, so the values are
/// solved for rather than remembered — the same discipline `cube-pieces.js` states for `Y_STATE`,
/// and the derived `y` is asserted equal to it, which cross-checks this whole construction against
/// a value a different codebase verified independently.
fn rotation_generator(axis: usize) -> &'static Cubie {
    static ROTATIONS: std::sync::OnceLock<[Cubie; 3]> = std::sync::OnceLock::new();
    &ROTATIONS.get_or_init(|| [derive_rotation(0), derive_rotation(1), derive_rotation(2)])[axis]
}

/// The corner and edge slot names, in this crate's (cubejs's) order.
const CORNER_NAMES: [&str; 8] = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"];
const EDGE_NAMES: [&str; 12] = [
    "UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR",
];

/// Which slot is named by this set of face letters, whatever order they are written in.
fn slot_named(names: &[&str], letters: &[usize]) -> usize {
    let mut want: Vec<char> = letters.iter().map(|&f| FACES[f]).collect();
    want.sort_unstable();
    names
        .iter()
        .position(|n| {
            let mut have: Vec<char> = n.chars().collect();
            have.sort_unstable();
            have == want
        })
        .expect("every relabelled slot name is a slot")
}

fn derive_rotation(axis: usize) -> Cubie {
    // π⁻¹, as a face map: the piece now in slot `i` is the one that used to be in the slot whose
    // name is π⁻¹(name(i)).
    let mut inv = [0usize; 6];
    for f in 0..6 {
        inv[ROT_FACES[axis][f]] = f;
    }
    let mut r = SOLVED;
    for (i, name) in CORNER_NAMES.iter().enumerate() {
        let letters: Vec<usize> = name
            .chars()
            .map(|c| inv[face_index(c).expect("a slot name is face letters")])
            .collect();
        r.cp[i] = slot_named(&CORNER_NAMES, &letters) as u8;
    }
    for (i, name) in EDGE_NAMES.iter().enumerate() {
        let letters: Vec<usize> = name
            .chars()
            .map(|c| inv[face_index(c).expect("a slot name is face letters")])
            .collect();
        r.ep[i] = slot_named(&EDGE_NAMES, &letters) as u8;
    }
    // Orientations are the only unknowns left, and corners and edges are independent under
    // `compose` — `co` reads only corner data, `eo` only edge data — so they are enumerated
    // separately. 6561 and 4096 candidates, both exhaustive.
    //
    // **The conjugation identity does not determine them, and the six survivors are not a
    // rounding error.** Adding the same twist to every corner, or flipping every edge, cancels
    // between `r` and `r⁻¹` — so those variants conjugate exactly as the true rotation does.
    // Measured: three corner solutions and two edge solutions, six states in all.
    //
    // That matters here and does not matter in `cases::rotate_y`, and the difference is worth
    // stating. Conjugation is all `rotate_y` does, so any of the six gives it the same answer;
    // `cube-pieces.js` picks one on that basis and its comment calls it "the only" such state,
    // which is imprecise but harmless for what it is used for. This module composes the rotation
    // DIRECTLY — the final cube after `x R U R'` really is rotated — and there the six differ.
    //
    // So the discriminator is physical rather than algebraic: **turning a solved cube leaves it
    // solved**, and reading it in the fixed frame gives one definite facelet string. Verified
    // against cubejs, the independent oracle, on 2026-09-09: for `y` it picks the state whose
    // FOUR MIDDLE edges read as flipped, not the eight U/D ones.
    let table = crate::cubie::all_moves();
    let conjugates = |cand: &Cubie, corners: bool| -> bool {
        let ci = inverse(cand);
        (0..6).all(|f| {
            let conj = compose(&compose(&ci, &table[f * 3]), cand);
            let want = &table[ROT_FACES[axis][f] * 3];
            if corners {
                conj.cp == want.cp && conj.co == want.co
            } else {
                conj.ep == want.ep && conj.eo == want.eo
            }
        })
    };
    let mut corner_options = Vec::new();
    for bits in 0..3u32.pow(8) {
        let mut cand = r.clone();
        let mut n = bits;
        for i in 0..8 {
            cand.co[i] = (n % 3) as u8;
            n /= 3;
        }
        if conjugates(&cand, true) {
            corner_options.push(cand.co);
        }
    }
    let mut edge_options = Vec::new();
    for bits in 0..1u32 << 12 {
        let mut cand = r.clone();
        for i in 0..12 {
            cand.eo[i] = ((bits >> i) & 1) as u8;
        }
        if conjugates(&cand, false) {
            edge_options.push(cand.eo);
        }
    }
    assert!(
        !corner_options.is_empty() && !edge_options.is_empty(),
        "rotation {axis}: the conjugation identity has no solution, so the face map is wrong"
    );

    // The solved cube after this rotation, read in the FIXED frame: every facelet of face `f` now
    // shows the colour of the physical face that moved there, which is `π⁻¹(f)`.
    let target: Vec<char> = (0..6)
        .flat_map(|f| std::iter::repeat_n(FACES[inv[f]], 9))
        .collect();
    // Centres excluded from the comparison, and only centres: `to_facelets` always writes the
    // fixed frame's own centre letters, while the target's centres have moved with the cube. The
    // other 48 stickers are the whole of the claim.
    let agrees = |cand: &Cubie| -> bool {
        let got: Vec<char> = crate::cubie::to_facelets(cand).chars().collect();
        (0..54).all(|p| p % 9 == 4 || got[p] == target[p])
    };
    let mut solutions = Vec::new();
    for co in &corner_options {
        for eo in &edge_options {
            let mut cand = r.clone();
            cand.co = *co;
            cand.eo = *eo;
            if agrees(&cand) {
                solutions.push(cand);
            }
        }
    }
    assert_eq!(
        solutions.len(),
        1,
        "rotation {axis}: {} of the {} conjugating states read as a rotated solved cube — the specification does not determine one",
        solutions.len(),
        corner_options.len() * edge_options.len()
    );
    let r = solutions.into_iter().next().expect("exactly one");
    // Order 4, because a quarter turn four times is where you started. Free, and it catches a face
    // map that permutes the faces in a cycle of the wrong length.
    let mut back = SOLVED;
    for _ in 0..4 {
        back = compose(&back, &r);
    }
    assert_eq!(back, SOLVED, "rotation {axis} is not order 4");
    r
}

/// The inverse of a normalization's rotation, for undoing it.
pub fn undo_rotation(steps: &[(usize, u8)]) -> Cubie {
    inverse(&rotation_state(steps))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cubie::apply_alg;

    /// The maneuver a published token string performs, computed WITHOUT this module — by turning
    /// the cube one token at a time with a tiny independent interpreter. If the two agree, the
    /// normalization preserved the permutation; if only this module existed, it would be agreeing
    /// with itself.
    fn reference_apply(alg: &str) -> Result<Cubie, String> {
        let table = crate::cubie::all_moves();
        let mut s = SOLVED;
        for tok in alg.split_whitespace() {
            let (head, tail) = tok.split_at(1);
            let q = match tail {
                "" => 1u8,
                "2" | "2'" => 2,
                "'" => 3,
                _ => return Err(format!("bad suffix {tail}")),
            };
            let c = head.chars().next().unwrap();
            // A wide turn is the face AND its slice: equivalently the opposite face's turn
            // composed with the whole-cube rotation. A slice is the rotation with both outer
            // layers turned back. Both written here as compositions of things this crate already
            // has, so the interpreter shares no code with `normalize`.
            let apply = |s: &Cubie, m: usize, n: u8| {
                let mut out = s.clone();
                for _ in 0..n {
                    out = compose(&out, &table[m * 3]);
                }
                out
            };
            match c {
                'U' | 'R' | 'F' | 'D' | 'L' | 'B' => {
                    s = apply(&s, face_index(c).unwrap(), q);
                }
                'u' | 'r' | 'f' | 'd' | 'l' | 'b' => {
                    // The wide turn written the other way round from `normalize`'s: turn the
                    // OPPOSITE face back first, then rotate. They commute (the rotation fixes both
                    // faces on its own axis), so agreeing is a real check rather than a copy.
                    let f = face_index(c.to_ascii_uppercase()).unwrap();
                    let (axis, dir) = wide_rotation(f);
                    let n = if dir > 0 { q % 4 } else { (4 - q % 4) % 4 };
                    s = apply(&s, opposite_face(f), q);
                    for _ in 0..n {
                        s = compose(&s, rotation_generator(axis));
                    }
                }
                'x' | 'y' | 'z' => {
                    let axis = rotation_index(c).unwrap();
                    for _ in 0..q {
                        s = compose(&s, rotation_generator(axis));
                    }
                }
                'M' | 'E' | 'S' => {
                    let (follows, axis, dir) = match c {
                        'M' => (4usize, 0usize, -1i8),
                        'E' => (3usize, 1usize, -1i8),
                        _ => (2usize, 2usize, 1i8),
                    };
                    let n = if dir > 0 { q } else { (4 - q % 4) % 4 };
                    s = apply(&s, follows, (4 - q % 4) % 4);
                    s = apply(&s, opposite_face(follows), q);
                    for _ in 0..n {
                        s = compose(&s, rotation_generator(axis));
                    }
                }
                _ => return Err(format!("unknown token {tok}")),
            }
        }
        Ok(s)
    }

    /// A normalization is faithful when the face turns, followed by the net rotation, reach the
    /// same cube the original did.
    fn assert_faithful(alg: &str) {
        let want = reference_apply(alg).unwrap_or_else(|e| panic!("{alg}: {e}"));
        let n = normalize(alg).unwrap_or_else(|e| panic!("{alg}: {e}"));
        let got = compose(&apply_indices(&n.moves), &rotation_state(&n.rotation));
        assert_eq!(
            got,
            want,
            "{alg} normalized to '{}' + {:?}",
            n.to_alg(),
            n.rotation
        );
    }

    #[test]
    fn face_turns_pass_through_unchanged_and_cost_what_they_look_like() {
        let n = normalize("R U R' U'").unwrap();
        assert_eq!(n.to_alg(), "R U R' U'");
        assert_eq!(n.htm, 4);
        assert!(n.rotation.is_empty());
        assert_faithful("R U R' U'");
    }

    #[test]
    fn a_rotation_relabels_everything_after_it_and_costs_nothing() {
        // The clause the convention is most likely to be got wrong on: leaving the rotation in
        // place would produce a maneuver that does not do what the original did.
        let n = normalize("y R").unwrap();
        assert_eq!(n.htm, 1, "a rotation costs zero");
        // `F`, not `B`. `y R` means "rotate, then turn the face now called R" — which is the
        // physical F face. `rotateAlg` maps F to B for a different question, and reading one as
        // the other is the swap this test exists to pin.
        assert_eq!(n.to_alg(), "F", "y R is F y, not B y");
        assert_faithful("y R");
        assert_faithful("x R U R' U'");
        assert_faithful("z2 F R U");
        assert_faithful("y' L D2 B'");
    }

    #[test]
    fn slices_and_wide_turns_expand_and_are_faithful() {
        for alg in [
            "M2",
            "M2'",
            "M'",
            "E",
            "E2",
            "S",
            "S'",
            "r U R'",
            "l' U L",
            "u R u'",
            "d2 F",
            "f R f'",
            "b' U b",
            "M2 U M2 U2 M2 U M2",         // H-perm as published
            "R U R' U' M' U R U' r'",     // a published OLL with both kinds
            "x R2 F R F' R U2 r' U r U2", // a published PLL opening with a rotation
        ] {
            assert_faithful(alg);
        }
    }

    #[test]
    fn the_stated_move_count_is_what_the_convention_says() {
        // M2 is TWO face turns, not one. A set counting it as one would appear to beat an
        // optimum it does not reach, which is the whole reason Layer 4's comparison is
        // one-directional.
        assert_eq!(normalize("M2").unwrap().htm, 2);
        // The H-perm as published is 7 tokens: four M2 at two face turns each, plus three
        // U-layer turns, and no two of them adjacent on the same face — so 11, not 7 and not 14.
        // This is the exact arithmetic Layer 4's one-directional comparison rests on.
        let h = normalize("M2 U M2 U2 M2 U M2").unwrap();
        assert_eq!(h.htm, 4 * 2 + 3, "got '{}'", h.to_alg());
        // A wide turn is ONE face turn and a free rotation: `r = x L`, and x costs nothing. A
        // first draft emitted the R turn as well and made it two, which the faithfulness check
        // caught — the rotation already carries the R layer.
        assert_eq!(normalize("r").unwrap().htm, 1);
        assert_eq!(normalize("r").unwrap().to_alg(), "L");
        // Adjacent same-face turns merge across an expansion seam, and cancelling ones vanish.
        assert_eq!(normalize("R R'").unwrap().htm, 0);
        assert_eq!(normalize("R R").unwrap().to_alg(), "R2");
        assert_eq!(normalize("U U U").unwrap().to_alg(), "U'");
    }

    #[test]
    fn published_decoration_is_stripped_and_annotation_is_not() {
        // The shapes a real set actually uses, written here rather than copied from one: grouping
        // parentheses and a typographic apostrophe are decoration; a footnote marker is not.
        assert_eq!(normalize("(R U R')").unwrap().to_alg(), "R U R'");
        assert_eq!(normalize("R\u{2019}").unwrap().to_alg(), "R'");
        assert_eq!(normalize("R2'").unwrap().to_alg(), "R2");
        assert_eq!(normalize("(R U) (R' U')").unwrap().htm, 4);
        // Grouping cannot change what a maneuver does, so the two forms must agree exactly.
        assert_eq!(
            normalize("(R U R') (F R F')").unwrap(),
            normalize("R U R' F R F'").unwrap()
        );
        // Annotation is refused by name. Dropping it would mean reporting a length for a maneuver
        // we did not read.
        for annotation in ["*", "3", "(*)", "†"] {
            assert!(
                normalize(&format!("R U {annotation}")).is_err(),
                "{annotation} was swallowed"
            );
        }
        // And decoration alone is a token with no move in it, which is also a refusal.
        assert!(normalize("()").is_err());
    }

    #[test]
    fn an_unknown_token_is_refused_rather_than_skipped() {
        // A set with a token we do not understand must not be compared as if it were shorter.
        for bad in ["Rw", "R3", "2R", "R''", "Q", "u3"] {
            assert!(normalize(bad).is_err(), "{bad} was accepted");
        }
        // And a refusal names the token.
        assert!(normalize("R Q U").unwrap_err().contains('Q'));
    }

    #[test]
    fn a_normalized_maneuver_is_something_the_apps_grammar_would_accept() {
        // The point of the whole module: the output has to pass the gate `optimal.js` applies.
        let n = normalize("M2 U M2 U2 M2 U M2").unwrap();
        for tok in n.to_alg().split_whitespace() {
            assert!(
                MOVE_NAMES.contains(&tok),
                "{tok} is not a face turn — the normalization did not do its job"
            );
        }
        // And it really is the H-perm: the last layer permuted, the rest of the cube home.
        let end = compose(&apply_indices(&n.moves), &rotation_state(&n.rotation));
        assert_eq!(end.co, [0; 8], "the H-perm twists nothing");
        assert_eq!(end.cp, SOLVED.cp, "the H-perm permutes no corners");
        assert_ne!(end.ep, SOLVED.ep, "it does permute edges");
    }

    /// The finding this module had to make before it could compose a rotation at all.
    ///
    /// `cases::Y_STATE` is `cube-pieces.js`'s value, and that file calls it "the only" state whose
    /// conjugation reproduces `rotateAlg`. There are six — three corner variants times two edge
    /// variants — and they are indistinguishable under conjugation, which is all that file does
    /// with it. So nothing there is wrong. But composing a rotation DIRECTLY, as this module must,
    /// separates them, and the two edge variants differ by a global flip: `Y_STATE` reads the
    /// eight U/D edges as flipped, the physically true rotation reads the four middle ones.
    ///
    /// Verified against cubejs on 2026-09-09 by reading a y-rotated solved cube's facelets through
    /// an independent implementation, which is the check the derivation now performs itself.
    #[test]
    fn the_derived_y_and_cube_pieces_y_state_differ_by_a_global_edge_flip_and_conjugate_alike() {
        let derived = rotation_generator(1);
        let pieces = &crate::cases::Y_STATE;
        assert_eq!(derived.cp, pieces.cp, "the permutation is not in doubt");
        assert_eq!(derived.ep, pieces.ep);
        assert_eq!(derived.co, pieces.co);
        assert_ne!(
            derived.eo, pieces.eo,
            "if these ever agree, one of the two moved"
        );
        for i in 0..12 {
            assert_eq!(
                derived.eo[i] ^ 1,
                pieces.eo[i],
                "they differ by more than a global flip"
            );
        }
        // And the thing that makes both defensible: conjugation cannot tell them apart.
        let table = crate::cubie::all_moves();
        for f in 0..6usize {
            let by_derived = compose(&compose(&inverse(derived), &table[f * 3]), derived);
            let by_pieces = compose(&compose(&inverse(pieces), &table[f * 3]), pieces);
            assert_eq!(by_derived, by_pieces);
        }
    }

    /// The three physical facts that fix the face maps, asserted on the TABLE rather than on
    /// anything derived from it.
    ///
    /// This is the test that was missing. Everything else in this module is built out of
    /// `ROT_FACES`, so everything else agrees with it whichever way round it is written — and two
    /// of the three were written backwards. Each line below is a thing you can check by picking up
    /// a cube, and none of them reads any function this file defines.
    #[test]
    fn the_face_maps_are_the_rotations_a_hand_would_make() {
        const U: usize = 0;
        const R: usize = 1;
        const F: usize = 2;
        const D: usize = 3;
        const L: usize = 4;
        const B: usize = 5;
        // x tips the cube away from you, the way an R turn goes: the front face ends up on top.
        assert_eq!(ROT_FACES[0][F], U, "x must send F to U");
        assert_eq!(ROT_FACES[0][U], B, "and U to B");
        assert_eq!(
            ROT_FACES[0][R], R,
            "x turns about the R-L axis, so R is fixed"
        );
        assert_eq!(ROT_FACES[0][L], L);
        // y spins it the way a U turn goes: the front face ends up on the right. This is
        // `cube-pieces.js`'s Y_FACES, which a different codebase derived and tests.
        assert_eq!(ROT_FACES[1][F], R, "y must send F to R");
        assert_eq!(ROT_FACES[1][R], B);
        assert_eq!(
            ROT_FACES[1][U], U,
            "y turns about the U-D axis, so U is fixed"
        );
        assert_eq!(ROT_FACES[1][D], D);
        // z rolls it the way an F turn goes: the top face ends up on the right.
        assert_eq!(ROT_FACES[2][U], R, "z must send U to R");
        assert_eq!(ROT_FACES[2][R], D);
        assert_eq!(
            ROT_FACES[2][F], F,
            "z turns about the F-B axis, so F is fixed"
        );
        assert_eq!(ROT_FACES[2][B], B);
        // Each is a permutation of the six faces — no face may vanish or double.
        for (axis, map) in ROT_FACES.iter().enumerate() {
            let mut seen = *map;
            seen.sort_unstable();
            assert_eq!(
                seen,
                [0, 1, 2, 3, 4, 5],
                "rotation {axis} is not a permutation"
            );
        }
    }

    /// A published maneuver that does what a published maneuver must: leave the first two layers
    /// exactly as it found them.
    ///
    /// The check the whole reference comparison rests on, and the one that caught the inverted
    /// face maps. `r U R' U' r' F R F'` is an ordinary OLL shape — a wide turn, its inverse, and
    /// a trigger — written here rather than copied, and its DEFINING property is structural: a
    /// last-layer algorithm touches the last layer and nothing else.
    #[test]
    fn a_wide_turn_maneuver_leaves_the_first_two_layers_alone() {
        for alg in [
            // Standard last-layer shapes, written out rather than copied from a set: two OLLs
            // built on a wide turn, the H-perm built on slices, and one wrapped in a rotation.
            "r U R' U' r' F R F'",
            "R U R' U' M' U R U' r'",
            "M2 U M2 U2 M2 U M2",
            "x R2 F R F' R U2 r' U r U2 x'",
        ] {
            let n = normalize(alg).unwrap_or_else(|e| panic!("{alg}: {e}"));
            let s = apply_indices(&n.moves);
            for i in 4..8 {
                assert_eq!(s.cp[i], i as u8, "{alg} moved a first-layer corner");
                assert_eq!(s.co[i], 0, "{alg} twisted a first-layer corner");
            }
            for i in 4..12 {
                assert_eq!(s.ep[i], i as u8, "{alg} moved a cross or middle edge");
                assert_eq!(s.eo[i], 0, "{alg} flipped a cross or middle edge");
            }
        }
    }

    /// The algebra every wide and slice turn must satisfy, whatever it means.
    ///
    /// The maneuver test above exercises `r` and `M` and nothing else, because those are the
    /// letters standard algorithms happen to use. These identities cover all nine, and they need
    /// no known algorithm to check against: a turn followed by its inverse is nothing, a turn
    /// twice is the half turn, and four times is nothing. A letter whose AXIS is wrong fails the
    /// first of them immediately — which is what the inverted `x` and `z` maps did.
    ///
    /// Asserted on the STATE, not on the token list. `M M'` normalizes to `L' R L R'`, which is
    /// the identity as a cube and four tokens as text, because the merging rule is deliberately
    /// adjacent-only — reordering commuting turns would shorten it further and would stop the
    /// maneuver being the thing it said it was. The convention is stated at the top of this file
    /// and this is what it looks like at its least flattering.
    #[test]
    fn every_wide_and_slice_letter_is_its_own_group() {
        for letter in ["u", "r", "f", "d", "l", "b", "M", "E", "S"] {
            let none = normalize(&format!("{letter} {letter}'")).unwrap();
            assert_eq!(
                compose(&apply_indices(&none.moves), &rotation_state(&none.rotation)),
                SOLVED,
                "{letter} {letter}' is not the identity: {}",
                none.to_alg()
            );
            let twice = normalize(&format!("{letter} {letter}")).unwrap();
            let half = normalize(&format!("{letter}2")).unwrap();
            assert_eq!(
                compose(
                    &apply_indices(&twice.moves),
                    &rotation_state(&twice.rotation)
                ),
                compose(&apply_indices(&half.moves), &rotation_state(&half.rotation)),
                "{letter} twice is not {letter}2"
            );
            let four = normalize(&format!("{letter} {letter} {letter} {letter}")).unwrap();
            assert_eq!(
                compose(&apply_indices(&four.moves), &rotation_state(&four.rotation)),
                SOLVED,
                "four {letter} is not the identity: {}",
                four.to_alg()
            );
        }
    }

    #[test]
    fn the_rotation_states_are_the_rotations_they_claim_to_be() {
        // Derived, not remembered — the same discipline `cube-pieces.js` states for Y_STATE.
        // Conjugating every face turn by the rotation must reproduce the face relabelling.
        let table = crate::cubie::all_moves();
        for axis in 0..3 {
            let r = rotation_generator(axis);
            let ri = inverse(r);
            // Four quarter turns is the identity.
            let mut s = SOLVED;
            for _ in 0..4 {
                s = compose(&s, r);
            }
            assert_eq!(s, SOLVED, "rotation {axis} is not order 4");
            for f in 0..6usize {
                let conj = compose(&compose(&ri, &table[f * 3]), r);
                let want = &table[relabel(f, axis, 1) * 3];
                assert_eq!(&conj, want, "rotation {axis} sends face {f} somewhere else");
            }
        }
    }

    #[test]
    fn the_reference_interpreter_and_the_normalizer_agree_over_a_wide_sample() {
        // Every token, in every suffix, alone and in short combinations. Two implementations
        // agreeing is worth about one opinion — but they were written from different directions
        // (one accumulates a frame, the other turns the cube), so a shared misreading of the
        // notation is the only way they agree while both being wrong, and the published-maneuver
        // cases above are what rules that out.
        let tokens = [
            "U", "R", "F", "D", "L", "B", "u", "r", "f", "d", "l", "b", "M", "E", "S", "x", "y",
            "z",
        ];
        for a in tokens {
            for suffix in ["", "'", "2"] {
                assert_faithful(&format!("{a}{suffix}"));
                for b in tokens {
                    assert_faithful(&format!("{a}{suffix} {b}"));
                }
            }
        }
    }

    #[test]
    fn normalizing_agrees_with_the_crates_own_alg_parser_on_plain_face_turns() {
        // A bridge to the code the rest of the crate uses, so this module cannot drift into its
        // own dialect of the same notation.
        for alg in ["R U R' U'", "F2 D L' B", "U2 R2 F2", ""] {
            let n = normalize(alg).unwrap();
            assert_eq!(
                apply_indices(&n.moves),
                apply_alg(&SOLVED, alg).unwrap(),
                "{alg}"
            );
        }
    }
}
