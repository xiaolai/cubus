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
//! - *merging adjacent same-face turns* — seams appear where two expansions meet: `L' L` between
//!   two tokens is nothing, and merging it is what makes the count the count of the maneuver
//!   rather than of the expansion. Only ADJACENT turns are merged, and the rule is deliberately
//!   no cleverer than that: `M2 M2` is the identity as a cube and still costs 4, because it comes
//!   out `L2 R2 L2 R2` and no two neighbours share a face. Reordering the commuting `R2 L2` pair
//!   would collapse it — and would stop the maneuver being the thing it said it was. The
//!   convention is at its least flattering here, and it is stated rather than smoothed over.
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
    // y turns the way U goes: R->F, F->L, L->B, B->R; U and D are fixed.
    [0, 2, 4, 3, 5, 1],
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

/// The apostrophes a text editor produces, mapped onto the one the notation uses.
///
/// Measured against a real set on 2026-09-09: its 276 OLL and PLL maneuvers use 88 distinct
/// tokens, and the ones that are not moves are **finger-trick grouping** — handled by
/// `expand_groups` — and a **typographic apostrophe** (U+2019). Both are noise around the
/// notation.
///
/// Footnote markers like `*` and a bare `3` are NOT stripped. They are annotation whose meaning
/// lives in the surrounding page, and a normalizer that dropped them silently would be reading a
/// maneuver it did not understand and reporting a length for it. They are refused by name, and
/// the caller reports how many entries it could not read — the loud default this repository takes
/// everywhere else.
fn clean(tok: &str) -> String {
    tok.chars()
        .map(|c| match c {
            '\u{2019}' | '\u{2032}' | '\u{00b4}' => '\'',
            other => other,
        })
        .collect()
}

/// A move token with its direction reversed — for expanding `(R U R')'`.
fn invert_token(tok: &str) -> Result<String, String> {
    let base = clean(tok);
    if base.is_empty() {
        return Err("an empty token cannot be inverted".to_string());
    }
    // Every suffix this notation admits, and its opposite. `2` is its own inverse.
    Ok(match () {
        _ if base.ends_with("2'") => base.trim_end_matches('\'').to_string(),
        _ if base.ends_with('2') => base,
        _ if base.ends_with('\'') => base.trim_end_matches('\'').to_string(),
        _ => format!("{base}'"),
    })
}

/// A group's contents repeated or inverted, per the suffix written after its `)`.
fn repeat_group(group: &[String], suffix: &str) -> Result<Vec<String>, String> {
    match suffix {
        "" => Ok(group.to_vec()),
        "2" | "2'" => Ok(group.iter().chain(group.iter()).cloned().collect()),
        "3" => Ok(group
            .iter()
            .chain(group.iter())
            .chain(group.iter())
            .cloned()
            .collect()),
        "'" => group.iter().rev().map(|t| invert_token(t)).collect(),
        other => Err(format!("(...){other}: unknown group suffix")),
    }
}

/// Flatten a maneuver's parenthesised groups into a plain token list.
///
/// **Stripping the parentheses is not the same thing, and the difference is silent.** `(R U)2` is
/// `R U R U`; dropping the brackets first makes it the token `U2`, so a four-move maneuver is read
/// as a two-move one and reported as beating an optimum it never reaches. `(R U R')'` is
/// `R U' R'`, and stripping made it `R U R''`, refused for the wrong reason. Grouping is a
/// construct with meaning, so it is parsed rather than filtered out — and an unknown group suffix
/// is an error, never a silent drop.
///
/// The overwhelmingly common case in a published set is a group with NO suffix — finger-trick
/// grouping, which says how to hold the maneuver and changes nothing about it. That still costs
/// nothing here: an empty suffix expands to the group's own tokens.
fn expand_groups(alg: &str) -> Result<Vec<String>, String> {
    let mut stack: Vec<Vec<String>> = vec![Vec::new()];
    let mut buf = String::new();
    let flush = |buf: &mut String, stack: &mut Vec<Vec<String>>| {
        if !buf.is_empty() {
            stack
                .last_mut()
                .expect("the outermost group is never popped")
                .push(std::mem::take(buf));
        }
    };
    for raw in alg.split_whitespace() {
        let mut chars = raw.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '(' => {
                    flush(&mut buf, &mut stack);
                    stack.push(Vec::new());
                }
                ')' => {
                    flush(&mut buf, &mut stack);
                    let mut suffix = String::new();
                    while let Some(&next) = chars.peek() {
                        if next == '2' || next == '3' || next == '\'' || matches!(next, '\u{2019}' | '\u{2032}' | '\u{00b4}') {
                            suffix.push(next);
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    if stack.len() < 2 {
                        return Err(format!("{alg}: a `)` with no `(` before it"));
                    }
                    let group = stack.pop().expect("checked just above");
                    if group.is_empty() {
                        // `()` is decoration with no move in it. Reading it as "nothing" would
                        // mean reporting a length for a maneuver that was never understood.
                        return Err(format!("{alg}: an empty group `()`"));
                    }
                    let expanded = repeat_group(&group, &clean(&suffix))?;
                    stack
                        .last_mut()
                        .expect("the outermost group is never popped")
                        .extend(expanded);
                }
                other => buf.push(other),
            }
        }
        flush(&mut buf, &mut stack);
    }
    if stack.len() != 1 {
        return Err(format!("{alg}: a `(` with no `)` after it"));
    }
    Ok(stack.pop().expect("the outermost group"))
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

/// The frame a maneuver starts in: every face still called what it was called.
const IDENTITY_FRAME: [usize; 6] = [0, 1, 2, 3, 4, 5];

/// Fold `n` quarter turns of `axis` into a frame.
///
/// One helper rather than the same four lines in the rotation, wide and slice branches. They were
/// three copies of a composition whose DIRECTION is the subtle part (`relabel_inv`, composed on
/// the right — see its note), so a correction to one that missed the others would have been a
/// maneuver that does not do what it said, in exactly one of the three token kinds.
fn turn_frame(frame: [usize; 6], axis: usize, n: u8) -> [usize; 6] {
    let mut next = frame;
    for f in 0..6 {
        next[f] = frame[relabel_inv(f, axis, n)];
    }
    next
}

/// Every net rotation, as the shortest canonical sequence of axis turns that reaches it.
///
/// The 24 orientations of a cube, flooded from the identity by the nine (axis, quarters)
/// generators in a fixed order — so the sequence a frame maps to is the shortest, and among equally
/// short ones the first in that order. Built once.
type NetRotations = std::collections::BTreeMap<[usize; 6], Vec<(usize, u8)>>;

fn net_rotations() -> &'static NetRotations {
    static NETS: std::sync::OnceLock<NetRotations> = std::sync::OnceLock::new();
    NETS.get_or_init(|| {
        use std::collections::btree_map::Entry;
        let mut out = NetRotations::new();
        out.insert(IDENTITY_FRAME, Vec::new());
        let mut frontier = vec![IDENTITY_FRAME];
        while !frontier.is_empty() {
            let mut next = Vec::new();
            for frame in frontier {
                let steps = out[&frame].clone();
                for axis in 0..3usize {
                    for q in 1..=3u8 {
                        let moved = turn_frame(frame, axis, q);
                        if let Entry::Vacant(slot) = out.entry(moved) {
                            let mut path = steps.clone();
                            path.push((axis, q));
                            slot.insert(path);
                            next.push(moved);
                        }
                    }
                }
            }
            frontier = next;
        }
        debug_assert_eq!(out.len(), 24, "a cube has 24 orientations");
        out
    })
}

/// The normalized form of a published maneuver.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Normalized {
    /// Face turns only, as `MOVE_NAMES` indices — the maneuver as the app's grammar would have it.
    pub moves: Vec<u8>,
    /// The NET whole-cube rotation the original left behind, as (axis, quarters) steps.
    /// Empty exactly when the maneuver ends in the frame it started in.
    ///
    /// **Net, not the history.** This used to be the list of rotation tokens encountered, so
    /// `x x'` and `r r'` came back with two entries apiece despite ending in the original frame —
    /// and every caller asking "did this maneuver leave the cube rotated?" with `is_empty()` got
    /// the wrong answer. `case-cross-check` counted 102 of 192 published maneuvers as ending
    /// rotated on that basis. The value is now derived from the accumulated frame, so the
    /// question `is_empty()` asks is the question it answers.
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
    let mut frame: [usize; 6] = IDENTITY_FRAME;

    let emit = |face: usize, quarters: u8, frame: &[usize; 6], out: &mut Vec<u8>| {
        out.push(move_index(frame[face], quarters) as u8);
    };

    for tok in expand_groups(alg)? {
        match parse_token(&tok)? {
            Token::Face(f, q) => emit(f, q, &frame, &mut out),
            Token::Rotation(axis, q) => {
                // The rotation applies to everything AFTER it, so it is folded into the frame and
                // never emitted. What the maneuver ends rotated BY is read off the finished frame,
                // which is the only thing that answers it — for a case algorithm that is a real
                // fact, not a rounding error.
                frame = turn_frame(frame, axis, q);
            }
            // A wide turn is the whole-cube rotation with the OPPOSITE layer turned back: `r`
            // comes out `L` followed by `x`, not `R` followed by anything. Written per face rather
            // than by a rule, because the rule has three signs in it and the tests below check
            // every one.
            // `r^q = L^q x^q` read left to right, and its five siblings. Derived rather than
            // remembered: the whole
            // cube turned the way R goes moves the R layer, the M slice AND the L layer, so
            // turning L back leaves exactly the R layer and the slice — which is what a wide turn
            // is. The rotation therefore CARRIES the face layer; emitting the face turn as well
            // (as a first draft did) turns it twice, and the faithfulness check catches it.
            Token::Wide(f, q) => {
                // `q` is 1, 2 or 3 — `parse_token` admits no other suffix — so both the rotation
                // and the emitted turn always happen. The `if n != 0` and `if q % 4 != 0` guards
                // that used to stand here could not reject anything, and a branch nothing can take
                // is a branch nothing tests and every reader has to step over.
                let (axis, dir) = wide_rotation(f);
                let n = if dir > 0 { q } else { 4 - q };
                frame = turn_frame(frame, axis, n);
                // The opposite face is fixed by this rotation, so it does not matter whether this
                // is read in the frame before or after — but it is emitted after, because that is
                // the order the identity is written in.
                emit(opposite_face(f), q, &frame, &mut out);
            }
            // A slice is the rotation with both outer layers turned back.
            Token::Slice(letter, q) => {
                // Which face the slice moves with, the axis it turns about, and whether that
                // axis's generator already points the way that face goes.
                //
                // **`E` was `-1` and is `+1`, and nothing caught it for a long time.** With the
                // wrong sign `E` expanded to `D' U y'`, whose net effect moves all eight corners
                // — it is not a slice at all. Every test the module had was blind to it: the
                // faithfulness check runs the token through a reference interpreter that reads
                // this same table, and the inverse and order identities (`E E'` is nothing, four
                // `E` is nothing) hold for a wrong rotation exactly as they do for the right one.
                // The published sets are full of `M` and `r` and contain no `E` at all, so the
                // one check with an outside opinion never exercised it either. What finds it is
                // asking the physical question — a slice moves four edges and NOTHING else —
                // which `the_wide_and_slice_letters_are_pinned_without_the_table_that_defines_them`
                // now asks of all nine letters.
                let (follows, axis, dir) = match letter {
                    'M' => (4usize, 0usize, -1i8), // M follows L, about the x axis
                    'E' => (3usize, 1usize, -1i8), // E follows D, about the y axis
                    'S' => (2usize, 2usize, 1i8),  // S follows F, about the z axis
                    _ => unreachable!("parse_token admits only M, E and S"),
                };
                let n = if dir > 0 { q } else { 4 - q };
                // Turn the two outer layers the way the slice does NOT go, then rotate the cube:
                // the net effect is the slice alone. `follows` is the face the slice moves with,
                // so that one turns with the rotation and its opposite turns against it.
                emit(follows, 4 - q, &frame, &mut out);
                emit(opposite_face(follows), q, &frame, &mut out);
                frame = turn_frame(frame, axis, n);
            }
        }
    }

    let merged = merge_adjacent(&out);
    let htm = merged.len();
    Ok(Normalized {
        moves: merged,
        // The NET rotation, read off the frame the maneuver finished in — so `x x'` and `r r'`
        // come back empty, which is what "ends in the frame it started in" means.
        rotation: net_rotations()
            .get(&frame)
            .cloned()
            .expect("every frame a composition of rotations reaches is one of the 24"),
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
/// solved for rather than remembered — the same discipline `cube-pieces.js` states for `Y_STATE`.
/// The relationship to that value is stated exactly in
/// `cube_pieces_y_state_is_this_modules_y_inverted_and_globally_edge_flipped`: it is this y's
/// INVERSE, with a global edge flip on top. Reading it as equal is what put an inverted row in
/// `ROT_FACES` and made `y`, `u`, `d` and `E` mean their opposites.
fn rotation_generator(axis: usize) -> &'static Cubie {
    static ROTATIONS: std::sync::OnceLock<[Cubie; 3]> = std::sync::OnceLock::new();
    &ROTATIONS.get_or_init(|| [derive_rotation(0), derive_rotation(1), derive_rotation(2)])[axis]
}

// The corner and edge slot names come from `cubie`, which already had them and is where the index
// ORDER they define is the crate's own. This file used to carry its own copies.
use crate::cubie::{CORNER_NAMES, EDGE_NAMES};

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

/// The slot PERMUTATION a rotation performs, read off the face map.
///
/// The piece now in slot `i` is the one that used to be in the slot whose name is `π⁻¹(name(i))`.
/// Orientations are not determined by this and are solved for separately.
fn rotation_permutation(inv: &[usize; 6]) -> Cubie {
    let mut r = SOLVED;
    let letters = |name: &str| -> Vec<usize> {
        name.chars()
            .map(|c| inv[face_index(c).expect("a slot name is face letters")])
            .collect()
    };
    for (i, name) in CORNER_NAMES.iter().enumerate() {
        r.cp[i] = slot_named(&CORNER_NAMES, &letters(name)) as u8;
    }
    for (i, name) in EDGE_NAMES.iter().enumerate() {
        r.ep[i] = slot_named(&EDGE_NAMES, &letters(name)) as u8;
    }
    r
}

/// Every orientation assignment that satisfies the conjugation identity.
///
/// **The conjugation identity does not determine them, and the survivors are not a rounding
/// error.** Adding the same twist to every corner, or flipping every edge, cancels between `r` and
/// `r⁻¹` — so those variants conjugate exactly as the true rotation does. Measured: three corner
/// solutions and two edge solutions, six states in all.
///
/// That matters here and does not matter in `cases::rotate_y`, and the difference is worth
/// stating. Conjugation is all `rotate_y` does, so any of the six gives it the same answer; this
/// module composes the rotation DIRECTLY — the final cube after `x R U R'` really is rotated — and
/// there the six differ.
///
/// Corners and edges are enumerated separately because they are independent under `compose`: `co`
/// reads only corner data, `eo` only edge data. 6561 and 4096 candidates, both exhaustive.
fn orientation_candidates(axis: usize, r: &Cubie) -> (Vec<[u8; 8]>, Vec<[u8; 12]>) {
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
    (corner_options, edge_options)
}

/// The one candidate that reads as a rotated SOLVED CUBE — the physical discriminator.
///
/// Conjugation cannot separate the six, so the question is asked of the cube instead: **turning a
/// solved cube leaves it solved**, and reading it in the fixed frame gives one definite facelet
/// string. Verified against cubejs, the independent oracle, on 2026-09-09: for `y` it picks the
/// state whose FOUR MIDDLE edges read as flipped, not the eight U/D ones.
fn physical_state(
    axis: usize,
    r: &Cubie,
    inv: &[usize; 6],
    corner_options: &[[u8; 8]],
    edge_options: &[[u8; 12]],
) -> Cubie {
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
    for co in corner_options {
        for eo in edge_options {
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
    solutions.into_iter().next().expect("exactly one")
}

/// The rotation about `axis`, solved for from its face map.
///
/// Three steps, each its own claim: the slot permutation the face map forces, the orientation
/// assignments the conjugation identity admits, and the one of those that reads as a rotated
/// solved cube. They were one 121-line function, and the middle step's "the identity does not
/// determine this" is the subtlety the whole construction turns on.
fn derive_rotation(axis: usize) -> Cubie {
    // π⁻¹, as a face map.
    let mut inv = [0usize; 6];
    for f in 0..6 {
        inv[ROT_FACES[axis][f]] = f;
    }
    let r = rotation_permutation(&inv);
    let (corner_options, edge_options) = orientation_candidates(axis, &r);
    assert!(
        !corner_options.is_empty() && !edge_options.is_empty(),
        "rotation {axis}: the conjugation identity has no solution, so the face map is wrong"
    );
    let r = physical_state(axis, &r, &inv, &corner_options, &edge_options);
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
        // `B`, not `F`. `y R` means "rotate, then turn the face now called R". `y` carries R to
        // F, F to L, L to B and B to R — measured on this crate's own move table, where a solved
        // cube after `U` reads `RRR` across the top of F — so the face standing at the R position
        // afterwards is the physical B. `rotateAlg` in `cube-pieces.js` maps F to R because it
        // answers the inverse question, and reading one as the other is the swap this test exists
        // to pin. It used to assert `F`, which is that swap.
        assert_eq!(n.to_alg(), "B", "y R is B y, not F y");
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

    /// How this module's `y` relates to `cases::Y_STATE`, stated exactly — because for a long time
    /// it was stated wrongly, and the wrong statement is what put the inverted row in `ROT_FACES`.
    ///
    /// **They are inverses of each other, and they differ by a global edge flip on top of that.**
    /// `Y_STATE` is `cube-pieces.js`'s value, and that file uses it for CONJUGATION only — where
    /// neither difference can be seen. Six states conjugate alike (three corner variants times two
    /// edge variants), so calling one of them "the only" such state is imprecise and harmless
    /// there; and an orbit closed under a rotation is closed under its inverse, so
    /// `cases::rotate_y` folds exactly the same orbits either way. Nothing in either file is
    /// wrong.
    ///
    /// What is not harmless is copying that value's face map into a table whose entries mean
    /// "where the physical face goes". `Y_STATE` conjugates R to B; a rotation the way U goes
    /// carries R to F. `ROT_FACES[1]` was the former, so `y`, `u`, `d` and `E` all came out
    /// inverted — and `E` was not a slice at all, because its expansion turned the cube the wrong
    /// way and the two outer layers no longer cancelled.
    #[test]
    fn cube_pieces_y_state_is_this_modules_y_inverted_and_globally_edge_flipped() {
        let derived = rotation_generator(1);
        let pieces = inverse(&crate::cases::Y_STATE);
        assert_eq!(derived.cp, pieces.cp, "the permutation is the inverse, exactly");
        assert_eq!(derived.ep, pieces.ep);
        assert_eq!(derived.co, pieces.co);
        for i in 0..12 {
            assert_eq!(
                derived.eo[i] ^ 1,
                pieces.eo[i],
                "they differ by more than a global flip"
            );
        }
        // And the direction, said out loud on both sides: this module's y carries R to F, and
        // conjugating by `Y_STATE` carries it to B.
        let table = crate::cubie::all_moves();
        let faces = ["U", "R", "F", "D", "L", "B"];
        let name = |s: &Cubie| {
            (0..18)
                .find(|&i| table[i] == *s)
                .map(|i| MOVE_NAMES[i])
                .expect("a conjugated face turn is a face turn")
        };
        for (f, want_derived, want_pieces) in [(1usize, "F", "B"), (2, "L", "R"), (0, "U", "U")] {
            let by_derived = compose(&compose(&inverse(derived), &table[f * 3]), derived);
            let by_pieces = compose(
                &compose(&inverse(&crate::cases::Y_STATE), &table[f * 3]),
                &crate::cases::Y_STATE,
            );
            assert_eq!(name(&by_derived), want_derived, "y conjugates {}", faces[f]);
            assert_eq!(name(&by_pieces), want_pieces, "Y_STATE conjugates {}", faces[f]);
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
        // y spins it the way a U turn goes, and THAT DIRECTION IS THE ONE THIS ROW GOT WRONG.
        // Measured on this crate's own move table: a solved cube after `U` reads `RRR` across the
        // top row of F, so U carries the R face's stickers onto F — R to F, F to L, L to B, B to
        // R. The row here was `cube-pieces.js`'s `Y_FACES` copied verbatim, and that value answers
        // the INVERSE question (see `relabel_inv`), so it made `y` mean `y'`. Nothing noticed
        // because the only consumers of the y axis are `y`, `u`, `d` and `E`, and the published
        // sets the module was tested against contain none of them.
        assert_eq!(ROT_FACES[1][R], F, "y must send R to F, the way U carries it");
        assert_eq!(ROT_FACES[1][F], L);
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

    /// GROUPING IS A CONSTRUCT, and stripping the brackets is not the same as reading it.
    ///
    /// `(R U)2` is four moves. Filtering the parentheses out first made it the two tokens `R` and
    /// `U2`, so the maneuver was read as two moves and compared against our optima at that
    /// length — a published set could then "refute" an optimum with a maneuver it never contains.
    #[test]
    fn a_group_is_expanded_rather_than_having_its_brackets_dropped() {
        let repeated = normalize("(R U)2").expect("a repeated group");
        assert_eq!(repeated.to_alg(), "R U R U");
        assert_eq!(repeated.htm, 4);
        // The old behaviour, written out so the difference cannot be mistaken for a nuance.
        assert_ne!(repeated.to_alg(), normalize("R U2").unwrap().to_alg());

        let inverted = normalize("(R U R')'").expect("an inverted group");
        assert_eq!(inverted.to_alg(), "R U' R'");
        assert_eq!(normalize("(R U2 R')'").unwrap().to_alg(), "R U2 R'");
        assert_eq!(normalize("(R U)3").unwrap().to_alg(), "R U R U R U");

        // Finger-trick grouping — the overwhelmingly common case — still changes nothing.
        assert_eq!(normalize("(R U R') U'").unwrap().to_alg(), "R U R' U'");
        assert_eq!(normalize("((R U) R')").unwrap().to_alg(), "R U R'");

        // A group is a construct, so its failures are named rather than swallowed.
        for bad in ["(R U", "R U)", "(R U)4", "()"] {
            assert!(normalize(bad).is_err(), "{bad} was accepted");
        }
        // A group's suffix is `2`, `3` or `'` and nothing else, so anything else after the `)`
        // begins the next token — which is what makes `(R U R')(U R U')` work without a space.
        assert_eq!(normalize("(R U)x").unwrap().to_alg(), normalize("R U x").unwrap().to_alg());
        assert_eq!(normalize("(R U)(R' U')").unwrap().to_alg(), "R U R' U'");

        // And an expanded group really is the maneuver it expands to — checked against the
        // written-out form, since the reference interpreter reads plain tokens by design.
        for (grouped, flat) in [
            ("(R U)2", "R U R U"),
            ("(R U R')'", "R U' R'"),
            ("(r U)2", "r U r U"),
            ("(x R)2", "x R x R"),
            ("(R' U')'", "U R"),
        ] {
            assert_eq!(normalize(grouped).unwrap(), normalize(flat).unwrap(), "{grouped}");
            assert_faithful(flat);
        }
    }

    /// The rotation a maneuver leaves behind is its NET rotation, not the tokens it passed through.
    ///
    /// `x x'` ends where it started, and every caller asking "did this end rotated?" asks with
    /// `is_empty()`. Reporting the history made that question unanswerable — `case-cross-check`
    /// counted 102 of 192 published maneuvers as ending rotated on the strength of it.
    #[test]
    fn the_recorded_rotation_is_the_net_one_and_is_empty_for_the_identity() {
        for round_trip in [
            "x x'", "y y'", "z z'", "r r'", "M M'", "u u'", "S S'", "x x x x", "y2 y2",
            "x y x' y'  y x y' x'",
        ] {
            let n = normalize(round_trip).unwrap_or_else(|e| panic!("{round_trip}: {e}"));
            assert!(
                n.rotation.is_empty(),
                "{round_trip} ends in its own frame, and reported {:?}",
                n.rotation
            );
        }
        for rotated in ["x", "y2", "r", "M", "x y"] {
            assert!(
                !normalize(rotated).unwrap().rotation.is_empty(),
                "{rotated} really does end rotated"
            );
        }

        // The net rotation must be the SAME rotation, not merely a shorter description of one.
        // Checked over every sequence of up to three rotation tokens — 9 + 81 + 729 of them.
        let letters = ["x", "y", "z"];
        let suffixes = ["", "2", "'"];
        let mut tokens = Vec::new();
        for l in letters {
            for q in suffixes {
                tokens.push(format!("{l}{q}"));
            }
        }
        let mut checked = 0usize;
        for a in &tokens {
            for b in &tokens {
                for c in &tokens {
                    for alg in [a.clone(), format!("{a} {b}"), format!("{a} {b} {c}")] {
                        let n = normalize(&alg).unwrap();
                        assert_eq!(
                            rotation_state(&n.rotation),
                            reference_apply(&alg).unwrap(),
                            "{alg} normalized to the rotation {:?}, which is a different one",
                            n.rotation
                        );
                        assert!(n.rotation.len() <= 2, "{alg}: {:?} is not canonical", n.rotation);
                        checked += 1;
                    }
                }
            }
        }
        assert_eq!(checked, 9 * 9 * 9 * 3);
        // All 24 orientations are reachable, so the decomposition table is complete rather than
        // complete-looking.
        assert_eq!(net_rotations().len(), 24);
    }

    /// What the wide and slice letters are, checked WITHOUT `wide_rotation`.
    ///
    /// The faithfulness tests run each maneuver through a reference interpreter that shares
    /// `wide_rotation` and `rotation_generator` with the code it checks — so an inverted entry
    /// there is self-consistent and passes, which is exactly how two of the three `ROT_FACES` rows
    /// stayed inverted for hours. The inverse and order identities have the same blind spot: they
    /// hold for a letter and for its inverse alike.
    ///
    /// These do not. Each is a fact about which physical pieces a turn moves, or a relation
    /// between two DIFFERENT branches of `normalize` (the wide branch, the slice branch and the
    /// rotation branch each build their expansion from their own table):
    ///
    /// - a wide turn agrees with its face turn on that face's own layer, and fixes the opposite
    ///   layer entirely — that is what "the face layer and the slice beside it" means;
    /// - a slice moves the four edges of its slice and NOTHING else;
    /// - `wide = face · slice`, the standard definition, which crosses the two branches;
    /// - `x = r l'`, `y = u d'`, `z = f b'`, which ties the wide branch to `ROT_FACES` — and
    ///   `ROT_FACES` is itself pinned against three physical facts in the test above.
    ///
    /// Together they determine each letter: a wrong axis, a wrong direction or a swapped pair
    /// fails at least one of them. What they are NOT is an external oracle; the module has none,
    /// and this comment says so rather than implying the checks are one.
    #[test]
    fn the_wide_and_slice_letters_are_pinned_without_the_table_that_defines_them() {
        let state = |alg: &str| {
            let n = normalize(alg).unwrap_or_else(|e| panic!("{alg}: {e}"));
            compose(&apply_indices(&n.moves), &rotation_state(&n.rotation))
        };
        // Which cubie slots each face's layer owns, by NAME rather than by index arithmetic.
        let layer = |face: char| -> (Vec<usize>, Vec<usize>) {
            let corners = CORNER_NAMES
                .iter()
                .enumerate()
                .filter(|(_, n)| n.contains(face))
                .map(|(i, _)| i)
                .collect();
            let edges = EDGE_NAMES
                .iter()
                .enumerate()
                .filter(|(_, n)| n.contains(face))
                .map(|(i, _)| i)
                .collect();
            (corners, edges)
        };

        for (wide, face, opposite, slice) in [
            ('u', 'U', 'D', "E'"),
            ('d', 'D', 'U', "E"),
            ('r', 'R', 'L', "M'"),
            ('l', 'L', 'R', "M"),
            ('f', 'F', 'B', "S"),
            ('b', 'B', 'F', "S'"),
        ] {
            let w = state(&wide.to_string());
            let f = state(&face.to_string());
            // The wide turn does to its OWN layer exactly what the face turn does.
            let (corners, edges) = layer(face);
            for c in &corners {
                assert_eq!(w.cp[*c], f.cp[*c], "{wide}: corner slot {c} is not {face}'s");
                assert_eq!(w.co[*c], f.co[*c], "{wide}: corner twist {c} is not {face}'s");
            }
            for e in &edges {
                assert_eq!(w.ep[*e], f.ep[*e], "{wide}: edge slot {e} is not {face}'s");
                assert_eq!(w.eo[*e], f.eo[*e], "{wide}: edge flip {e} is not {face}'s");
            }
            // And it leaves the OPPOSITE layer exactly where it found it.
            let (far_corners, far_edges) = layer(opposite);
            for c in &far_corners {
                assert_eq!(w.cp[*c], SOLVED.cp[*c], "{wide} moved a {opposite}-layer corner");
                assert_eq!(w.co[*c], 0, "{wide} twisted a {opposite}-layer corner");
            }
            for e in &far_edges {
                assert_eq!(w.ep[*e], SOLVED.ep[*e], "{wide} moved a {opposite}-layer edge");
                assert_eq!(w.eo[*e], 0, "{wide} flipped a {opposite}-layer edge");
            }
            // wide = face + the slice beside it — the two branches, agreeing.
            assert_eq!(
                w,
                state(&format!("{face} {slice}")),
                "{wide} is not {face} {slice}"
            );
        }

        // A slice moves its four edges and nothing else at all.
        for (letter, between) in [('M', ('L', 'R')), ('E', ('D', 'U')), ('S', ('F', 'B'))] {
            let s = state(&letter.to_string());
            assert_eq!(s.cp, SOLVED.cp, "{letter} moved a corner");
            assert_eq!(s.co, [0; 8], "{letter} twisted a corner");
            let (left, right) = between;
            let moved: Vec<usize> = (0..12)
                .filter(|&e| s.ep[e] != SOLVED.ep[e] || s.eo[e] != 0)
                .collect();
            let expect: Vec<usize> = EDGE_NAMES
                .iter()
                .enumerate()
                .filter(|(_, n)| !n.contains(left) && !n.contains(right))
                .map(|(i, _)| i)
                .collect();
            assert_eq!(moved, expect, "{letter} does not move exactly its own slice");
        }

        // A wide turn plus the opposite FACE turned back is the whole-cube rotation — which ties
        // the wide branch to `ROT_FACES`, itself pinned against physical facts above. (The
        // opposite FACE, not the opposite wide turn: `r l'` would turn the M slice twice.)
        for (rotation, wide, face) in [('x', "r", "L'"), ('y', "u", "D'"), ('z', "f", "B'")] {
            assert_eq!(
                state(&rotation.to_string()),
                state(&format!("{wide} {face}")),
                "{rotation} is not {wide} {face}"
            );
        }
    }
}
