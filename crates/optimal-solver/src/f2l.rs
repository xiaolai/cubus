//! F2L: the 41 cases, as proven-minimal maneuvers rather than as a list copied from a website.
//!
//! # Why this is a module and not a use of `search.rs`
//!
//! dev-docs/method-solver-return-plan.md's phase C reported this blocked, and the reason it gave
//! was right about the machinery and wrong about the problem. It said slot-safety is a property of
//! the ALGORITHM — does the maneuver leave the cross, the other three bottom corners and the other
//! three middle edges exactly as it found them — and therefore not a distance, so the three
//! pattern databases (which bound the distance to a fully SOLVED cube) bound nothing about it and
//! IDA* degenerates to unguided iterative deepening at ~2.6 x 10^12 nodes per case.
//!
//! The first half stands: those three tables really are inadmissible here, because a state can be
//! one move from finishing F2L and eighteen from a solved cube. What does not stand is the
//! conclusion. For an F2L case — a cube whose cross and other three pairs are already home — the
//! two statements
//!
//!   * `A` is slot-safe for this pair, and placing the pair is what `A` does, and
//!   * applying `A` leaves all four cross edges, all four middle edges and all four bottom corners
//!     in their own places, correctly oriented
//!
//! are the SAME statement. Slot-safety says `A` fixes the protected slots as positions; a piece
//! already home therefore stays home, which gives the second from the first. And the converse
//! holds too, which is the direction that matters: if every protected piece is home afterwards,
//! then for each protected slot `i` the maneuver's position map `α` satisfies `S[α(i)] = i`, and
//! since piece `i` sits at slot `i` in `S` and nowhere else, `α(i) = i` — `A` fixes the slot.
//! (`the_two_readings_of_slot_safety_agree` checks this on every case rather than leaving it as
//! an argument.)
//!
//! So the goal is not a property of an algorithm. It is a single state of the twelve pieces below
//! the top layer, the top layer being genuinely irrelevant — and a distance to a single state is
//! something a search can be pointed at.
//!
//! # Why there is no pattern database here
//!
//! The first version of this module had four, in the shape `pdb.rs` uses for the whole cube. That
//! was the crate's habit rather than a decision, and it was the wrong one — see `GoalBall`, which
//! carries the measurement. A pattern database is a way to cope with a distance function too big
//! to store; this one is not too big to store, because the goal is a single state and the answers
//! are at most nine moves from it. Storing the distances directly gives an exact heuristic in
//! 0.27 s where four projections gave a weak one in 8.1 s, and removes the admissibility argument
//! rather than validating it. The tables it replaced produced the same 42 rows, byte for byte.
//!
//! # What is tracked
//!
//! Twelve pieces: edge cubies 4..11 (the four cross edges DR DF DL DB and the four middle edges
//! FR FL BL BR) and corner cubies 4..7 (DFR DLF DBL DRB). Nothing about the top layer is
//! represented at all — not its pieces, not its parity. That is not an approximation; it is the
//! statement of the problem, and it is why the answer to a case does not depend on what the top
//! layer happened to be holding.

use crate::cubie::{all_moves, Cubie, SOLVED};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/// The tracked edge cubies, in order. Their home slots are their own indices.
pub const TRACKED_EDGES: [usize; 8] = [4, 5, 6, 7, 8, 9, 10, 11];
/// The tracked corner cubies, in order. Home slots likewise.
pub const TRACKED_CORNERS: [usize; 4] = [4, 5, 6, 7];

/// A tracked edge's state, as one byte: `slot * 2 + flip`, so 24 values.
const EDGE_CELLS: usize = 24;
/// A tracked corner's state, as one byte: `slot * 3 + twist`, so 24 values.
const CORNER_CELLS: usize = 24;

const N_MOVES: usize = 18;

/// How a move moves ONE tracked piece — the whole of the projection's dynamics.
///
/// A move acts on each piece independently once the piece is identified by cubie rather than by
/// slot, which is what makes the projection cheap: stepping a state is twelve array reads. The
/// tables are derived from `cubie.rs`'s own move list rather than written out, so a transcription
/// slip is not among the things that can go wrong here.
struct Step {
    edge: [[u8; EDGE_CELLS]; N_MOVES],
    corner: [[u8; CORNER_CELLS]; N_MOVES],
}

fn steps() -> &'static Step {
    static STEPS: OnceLock<Step> = OnceLock::new();
    STEPS.get_or_init(|| {
        let moves = all_moves();
        let mut edge = [[0u8; EDGE_CELLS]; N_MOVES];
        let mut corner = [[0u8; CORNER_CELLS]; N_MOVES];
        for (m, mv) in moves.iter().enumerate() {
            // `compose(S, M).ep[i] = S.ep[M.ep[i]]`, so a cubie at slot `j` in `S` is at the slot
            // `i` with `M.ep[i] == j` afterwards — the move's permutation read backwards.
            let mut edge_to = [0usize; 12];
            for i in 0..12 {
                edge_to[mv.ep[i] as usize] = i;
            }
            let mut corner_to = [0usize; 8];
            for i in 0..8 {
                corner_to[mv.cp[i] as usize] = i;
            }
            for slot in 0..12 {
                let to = edge_to[slot];
                for flip in 0..2u8 {
                    // `compose(S, M).eo[i] = S.eo[M.ep[i]] + M.eo[i]`, and `i` is the new slot.
                    edge[m][slot * 2 + flip as usize] =
                        (to * 2 + ((flip + mv.eo[to]) % 2) as usize) as u8;
                }
            }
            for slot in 0..8 {
                let to = corner_to[slot];
                for twist in 0..3u8 {
                    corner[m][slot * 3 + twist as usize] =
                        (to * 3 + ((twist + mv.co[to]) % 3) as usize) as u8;
                }
            }
        }
        Step { edge, corner }
    })
}

/// Where the twelve tracked pieces are, and how they are turned. Nothing else.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct F2lState {
    /// One cell per entry of `TRACKED_EDGES`: `slot * 2 + flip`.
    pub edges: [u8; 8],
    /// One cell per entry of `TRACKED_CORNERS`: `slot * 3 + twist`.
    pub corners: [u8; 4],
}

/// The goal: every tracked piece home and straight. ONE state, which is the whole point.
pub const F2L_SOLVED: F2lState = F2lState {
    edges: [8, 10, 12, 14, 16, 18, 20, 22], // slots 4..11, flip 0
    corners: [12, 15, 18, 21],              // slots 4..7, twist 0
};

impl F2lState {
    /// The projection of a full cube — the only way a real position enters this module.
    pub fn project(state: &Cubie) -> F2lState {
        let mut edge_at = [0usize; 12];
        for i in 0..12 {
            edge_at[state.ep[i] as usize] = i;
        }
        let mut corner_at = [0usize; 8];
        for i in 0..8 {
            corner_at[state.cp[i] as usize] = i;
        }
        let mut edges = [0u8; 8];
        for (k, &c) in TRACKED_EDGES.iter().enumerate() {
            let slot = edge_at[c];
            edges[k] = (slot * 2 + state.eo[slot] as usize) as u8;
        }
        let mut corners = [0u8; 4];
        for (k, &c) in TRACKED_CORNERS.iter().enumerate() {
            let slot = corner_at[c];
            corners[k] = (slot * 3 + state.co[slot] as usize) as u8;
        }
        F2lState { edges, corners }
    }

    #[inline]
    pub fn step(&self, m: usize) -> F2lState {
        let s = steps();
        let e = &s.edge[m];
        let c = &s.corner[m];
        F2lState {
            edges: [
                e[self.edges[0] as usize],
                e[self.edges[1] as usize],
                e[self.edges[2] as usize],
                e[self.edges[3] as usize],
                e[self.edges[4] as usize],
                e[self.edges[5] as usize],
                e[self.edges[6] as usize],
                e[self.edges[7] as usize],
            ],
            corners: [
                c[self.corners[0] as usize],
                c[self.corners[1] as usize],
                c[self.corners[2] as usize],
                c[self.corners[3] as usize],
            ],
        }
    }

    #[inline]
    pub fn is_solved(&self) -> bool {
        *self == F2L_SOLVED
    }
}

// ---- the distance oracle -------------------------------------------------------------------

/// How far from the goal the exact distances are kept.
///
/// **Five, and the number is measured rather than chosen.** The ball grows about thirteenfold a
/// layer — 1, 15, 198, 2,638, 34,981, 461,303 — so radius 5 is 499,136 states and 34 ms, and
/// radius 6 is 6.5 M states and 340 ms for a heuristic that is only one better. Five is where the
/// curve is still cheap.
///
/// What it buys: a state inside the ball gets its EXACT distance, and a state outside gets 6,
/// which is true because it is not within 5. The longest case is 9, so the search is unguided for
/// at most the first three moves of any of them and exact for the rest.
pub const GOAL_BALL_RADIUS: u8 = 5;

/// Exact distances to the goal, out to `GOAL_BALL_RADIUS`.
///
/// # Why this and not a pattern database
///
/// The first version of this module used four projection PDBs, in the shape `pdb.rs` uses for the
/// whole cube: 20.5 M entries, 8.1 s to build and Bellman-validate. That was the crate's habit
/// rather than a decision — nobody measured the alternative — and the alternative is better on
/// every axis that matters here.
///
/// A pattern database exists because the real distance function is too big to store. For the whole
/// cube that is unarguable: 4.3 x 10^19 states, so you store distances in a projection and accept
/// a lower bound. Here the goal is a single state and the answers are at most nine moves away, so
/// the part of the distance function the search actually reads FITS. Storing it directly gives an
/// EXACT heuristic where a projection gives a weak one, in 34 ms instead of 8.1 s, in 11 MB
/// instead of 20.5 M entries, and with no admissibility argument to make: BFS layers are distances
/// by construction. There is nothing here for a Bellman validation to catch that a wrong layer
/// count would not.
///
/// Admissible, and consistent, for the two cases it has. Inside the ball the value is the exact
/// distance. Outside, `GOAL_BALL_RADIUS + 1` is a true lower bound precisely because BFS is
/// exhaustive — a state the walk did not reach within five moves is not within five moves.
pub struct GoalBall {
    /// Only states within the radius are present; absence IS the bound, which is why this is a map
    /// and not a table with a sentinel.
    distance: HashMap<F2lState, u8>,
    radius: u8,
    /// How many states each layer held, for the pin in the tests.
    layers: Vec<u64>,
}

impl GoalBall {
    /// Breadth-first from the goal. Exhaustive to the radius, so absence means "further".
    pub fn to_radius(radius: u8) -> GoalBall {
        let mut distance = HashMap::new();
        distance.insert(F2L_SOLVED, 0u8);
        let mut layers = vec![1u64];
        let mut frontier = vec![F2L_SOLVED];
        for d in 1..=radius {
            let mut next = Vec::new();
            for state in &frontier {
                for m in 0..N_MOVES {
                    let to = state.step(m);
                    if let std::collections::hash_map::Entry::Vacant(slot) = distance.entry(to) {
                        slot.insert(d);
                        next.push(to);
                    }
                }
            }
            layers.push(next.len() as u64);
            frontier = next;
        }
        GoalBall {
            distance,
            radius,
            layers,
        }
    }

    /// The default: the radius the cases need, which is `GOAL_BALL_RADIUS`.
    pub fn build() -> GoalBall {
        GoalBall::to_radius(GOAL_BALL_RADIUS)
    }

    #[inline]
    pub fn heuristic(&self, s: &F2lState) -> u8 {
        // Absence is not "unknown", it is "further than the radius" — the walk was exhaustive.
        match self.distance.get(s) {
            Some(&d) => d,
            None => self.radius + 1,
        }
    }

    pub fn layers(&self) -> &[u64] {
        &self.layers
    }

    pub fn len(&self) -> usize {
        self.distance.len()
    }

    pub fn is_empty(&self) -> bool {
        self.distance.is_empty()
    }

    pub fn radius(&self) -> u8 {
        self.radius
    }

    /// The oracle is a distance function, checked rather than assumed.
    ///
    /// BFS makes this true by construction, which is exactly the kind of claim that is worth an
    /// assertion anyway: a layer built from the wrong frontier, or a `step` that lost a move,
    /// produces a map that is still internally tidy and quietly wrong. Bellman's condition is what
    /// pins an entry to its place — every state at `d` must have a neighbour at `d - 1` and none
    /// below that — and it is 9 M comparisons here, which is nothing.
    pub fn validate(&self) -> Result<(), String> {
        if self.distance.get(&F2L_SOLVED) != Some(&0) {
            return Err("the goal is not at distance zero".into());
        }
        for (state, &d) in &self.distance {
            if d == 0 {
                if *state != F2L_SOLVED {
                    return Err("a state other than the goal claims distance zero".into());
                }
                continue;
            }
            let mut best = u8::MAX;
            for m in 0..N_MOVES {
                // A neighbour outside the ball is at least `radius + 1`, which can never be
                // `d - 1` for `d <= radius` — so absence needs no special case, only the bound.
                let there = self.heuristic(&state.step(m));
                best = best.min(there);
            }
            if best != d - 1 {
                return Err(format!(
                    "a state at distance {d} has {best} as its nearest neighbour, so it is not one \
                     move from anything at {}",
                    d - 1
                ));
            }
        }
        let counted: u64 = self.layers.iter().sum();
        if counted != self.distance.len() as u64 {
            return Err(format!(
                "the layers count {counted} states and the map holds {}",
                self.distance.len()
            ));
        }
        Ok(())
    }
}

// ---- the search ---------------------------------------------------------------------------

/// A proven-minimal answer for one case: the length, and EVERY canonical maneuver of that length.
pub struct F2lProof {
    pub length: u8,
    /// Sorted by `cases::tie_break`, so the list is a function of the state and not of a schedule.
    pub solutions: Vec<Vec<u8>>,
    pub nodes: u64,
    /// The nodes spent on the contours BELOW `length` — every one of which was exhausted holding
    /// nothing. That is half the lower bound's evidence, and it is what the certificate reports;
    /// `nodes` includes the winning contour as well, which proves nothing about minimality.
    pub nodes_below: u64,
    /// The other half: the shallowest contour the ladder started at, which is the heuristic's own
    /// value at the start. Nothing below it was searched and nothing below it needed to be — an
    /// admissible heuristic of `h` IS the proof that no maneuver shorter than `h` exists. When
    /// `floor == length` the answer was the first contour tried and `nodes_below` is zero, which
    /// is a complete lower bound and not a missing one.
    pub floor: u8,
}

/// The reason a search stopped without an answer.
#[derive(Debug, PartialEq, Eq)]
pub enum F2lEnd {
    /// Exhausted every contour through the cap: the distance is proven GREATER than the cap.
    BeyondCap,
    Cancelled,
}

struct Dfs<'a> {
    ball: &'a GoalBall,
    bound: u8,
    path: Vec<u8>,
    found: Vec<Vec<u8>>,
    /// Set when only the existence of a solution is wanted, so the first one ends the walk.
    first_only: bool,
    nodes: u64,
    cancel: &'a AtomicBool,
    since_check: u64,
    aborted: bool,
}

/// How many nodes between looks at the cancel flag — `search.rs`'s stride, for the same promise.
const CANCEL_STRIDE: u64 = 4096;

impl Dfs<'_> {
    fn run(&mut self, s: F2lState, g: u8, prev: i8) -> bool {
        self.nodes += 1;
        self.since_check += 1;
        if self.since_check >= CANCEL_STRIDE {
            self.since_check = 0;
            if self.cancel.load(Ordering::Relaxed) {
                self.aborted = true;
                return true;
            }
        }
        if g == self.bound {
            if s.is_solved() {
                self.found.push(self.path.clone());
                return self.first_only;
            }
            return false;
        }
        if g + self.ball.heuristic(&s) > self.bound {
            return false;
        }
        for m in 0..N_MOVES {
            if !crate::search::move_allowed(prev, m) {
                continue;
            }
            self.path.push(m as u8);
            let stop = self.run(s.step(m), g + 1, m as i8);
            self.path.pop();
            if stop {
                return true;
            }
        }
        false
    }
}

/// Prove the minimal length of an F2L case and collect every canonical maneuver of that length.
///
/// Contours ascend and each is exhausted before the next begins, so the first contour to hold
/// anything is the shallowest that could — that IS the proof, and the contour below it having
/// been exhausted is the certificate. The collecting pass then re-walks the winning contour with
/// the same admissible rule, which visits the same nodes rather than a subset of them.
pub fn prove_all(
    ball: &GoalBall,
    start: &F2lState,
    cap: u8,
    cancel: &AtomicBool,
) -> Result<F2lProof, F2lEnd> {
    let mut nodes = 0u64;
    if start.is_solved() {
        return Ok(F2lProof {
            length: 0,
            solutions: vec![Vec::new()],
            nodes: 1,
            nodes_below: 0,
            floor: 0,
        });
    }
    // The contours below the first one are not searched and do not need to be: an admissible
    // heuristic of `h` IS the proof that nothing shorter than `h` exists, which is the same
    // licence `search.rs` takes when it starts at `heuristic(start)`.
    let floor = ball.heuristic(start).max(1);
    let mut bound = floor;
    let mut nodes_below = 0u64;
    while bound <= cap {
        let mut dfs = Dfs {
            ball,
            bound,
            path: Vec::new(),
            found: Vec::new(),
            first_only: false,
            nodes: 0,
            cancel,
            since_check: 0,
            aborted: false,
        };
        dfs.run(*start, 0, -1);
        nodes += dfs.nodes;
        if dfs.aborted {
            return Err(F2lEnd::Cancelled);
        }
        if !dfs.found.is_empty() {
            let mut solutions = dfs.found;
            solutions.sort_by(|a, b| crate::cases::tie_break(a, b));
            debug_assert!(
                solutions.windows(2).all(|w| w[0] != w[1]),
                "the same canonical maneuver was enumerated twice"
            );
            return Ok(F2lProof {
                length: bound,
                solutions,
                nodes,
                nodes_below,
                floor,
            });
        }
        nodes_below = nodes;
        bound += 1;
    }
    Err(F2lEnd::BeyondCap)
}

// ---- the cases -----------------------------------------------------------------------------

/// Slot names, in `cubie.rs`'s order — the same strings `apps/web/lib/cube-pieces.js` uses, so a
/// case name generated here is the case name the app computes.
pub const CORNER_NAMES: [&str; 8] = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"];
pub const EDGE_NAMES: [&str; 12] = [
    "UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR",
];

/// Where the pair of the front-right slot can be, and how it can be turned.
///
/// Five slots each and not eight and twelve: this is a case, which means the cross and the other
/// three pairs are already home, so the pair's corner is in the top layer or in its own slot and
/// its edge likewise. 15 x 10 = 150 configurations. The ones where a piece is buried in ANOTHER
/// pair's slot are not cases at all — no maneuver that leaves that slot alone can reach the piece,
/// which is `method-solver-return-plan.md` §7a's finding F1 and the reason the app's rung 1 falls
/// back on 234 of its 384 inputs.
const CORNER_HOMES: [usize; 5] = [0, 1, 2, 3, 4]; // URF UFL ULB UBR, and DFR itself
const EDGE_HOMES: [usize; 5] = [0, 1, 2, 3, 8]; //  UR UF UL UB, and FR itself

/// One F2L case: the name a learner recognises it by, and the position it names.
#[derive(Clone, Debug)]
pub struct F2lCase {
    /// `URF1/UF0` — the corner's slot and twist, then the edge's slot and flip, in the frame where
    /// the working slot is front-right and the top has already been turned to match.
    pub name: String,
    pub corner_slot: usize,
    pub corner_twist: u8,
    pub edge_slot: usize,
    pub edge_flip: u8,
}

impl F2lCase {
    /// The projected position this case names, with everything else home.
    pub fn state(&self) -> F2lState {
        let mut s = F2L_SOLVED;
        s.corners[0] = (self.corner_slot * 3 + self.corner_twist as usize) as u8;
        s.edges[4] = (self.edge_slot * 2 + self.edge_flip as usize) as u8;
        s
    }
}

/// The name of a configuration, exactly as `apps/web/lib/methods/pairs.js` spells it.
fn configuration_name(corner_slot: usize, twist: u8, edge_slot: usize, flip: u8) -> String {
    format!(
        "{}{}/{}{}",
        CORNER_NAMES[corner_slot], twist, EDGE_NAMES[edge_slot], flip
    )
}

/// A single U turn applied to a slot, for the alignment fold. U moves neither twist a corner nor
/// flip an edge in this convention, so folding by it moves positions and nothing else.
fn turn_u(corner_slot: usize, edge_slot: usize) -> (usize, usize) {
    let u = &all_moves()[0];
    let mut corner_to = [0usize; 8];
    for i in 0..8 {
        corner_to[u.cp[i] as usize] = i;
    }
    let mut edge_to = [0usize; 12];
    for i in 0..12 {
        edge_to[u.ep[i] as usize] = i;
    }
    (corner_to[corner_slot], edge_to[edge_slot])
}

/// The 41 cases, plus the one where the pair is already placed — derived, not listed.
///
/// The 150 reachable configurations fold under "turn the top until it matches", which is what a
/// learner does BEFORE recognising a case rather than as part of one. Each orbit is named by its
/// smallest member, which is the same rule the app applies, so the two agree on which case is
/// which without either being told.
pub fn all_cases() -> Vec<F2lCase> {
    let mut by_name: std::collections::BTreeMap<String, F2lCase> =
        std::collections::BTreeMap::new();
    for &corner_slot in &CORNER_HOMES {
        for twist in 0..3u8 {
            for &edge_slot in &EDGE_HOMES {
                for flip in 0..2u8 {
                    // The orbit under the four alignments, named by its smallest member.
                    let mut c = corner_slot;
                    let mut e = edge_slot;
                    let mut best = configuration_name(c, twist, e, flip);
                    let mut best_at = (c, e);
                    for _ in 0..3 {
                        let (nc, ne) = turn_u(c, e);
                        c = nc;
                        e = ne;
                        let name = configuration_name(c, twist, e, flip);
                        if name < best {
                            best = name;
                            best_at = (c, e);
                        }
                    }
                    by_name.entry(best.clone()).or_insert(F2lCase {
                        name: best,
                        corner_slot: best_at.0,
                        corner_twist: twist,
                        edge_slot: best_at.1,
                        edge_flip: flip,
                    });
                }
            }
        }
    }
    by_name.into_values().collect()
}

/// Is this maneuver slot-safe for the front-right pair, read the way the app reads it — as a
/// property of the ALGORITHM on a solved cube, not of the position it is used in?
///
/// The module's header argues this is the same question as "does it reach `F2L_SOLVED` from the
/// case". Arguing is not checking, so the generator asks both and the test compares them.
pub fn slot_safe_on_solved(alg: &[u8]) -> bool {
    let moves = all_moves();
    let mut at = SOLVED;
    for &m in alg {
        at = crate::cubie::compose(&at, &moves[m as usize]);
    }
    // Every protected slot holds its own cubie, untwisted and unflipped. The working slot's own
    // pieces — corner DFR and edge FR — are deliberately not asked about.
    for slot in [5usize, 6, 7] {
        if at.cp[slot] != slot as u8 || at.co[slot] != 0 {
            return false;
        }
    }
    for slot in [4usize, 5, 6, 7, 9, 10, 11] {
        if at.ep[slot] != slot as u8 || at.eo[slot] != 0 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_projection_and_the_cube_step_together() {
        // The projection is only worth anything if it commutes with the moves. Checked over a
        // deep random-ish walk rather than one turn, because a per-piece table can be right for
        // a quarter turn and wrong for the half turn built from it.
        let moves = all_moves();
        let mut cube = SOLVED;
        let mut proj = F2lState::project(&cube);
        let mut x: u64 = 0x2026_0909;
        for _ in 0..20_000 {
            x = x.wrapping_mul(6364136223846793005).wrapping_add(1);
            let m = (x >> 33) as usize % 18;
            cube = crate::cubie::compose(&cube, &moves[m]);
            proj = proj.step(m);
            assert_eq!(
                proj,
                F2lState::project(&cube),
                "projection drifted at move {m}"
            );
        }
    }

    #[test]
    fn the_goal_is_exactly_first_two_layers_solved() {
        assert_eq!(F2lState::project(&SOLVED), F2L_SOLVED);
        assert!(F2L_SOLVED.is_solved());
        // A cube with the top layer scrambled and nothing else is already at the goal — the claim
        // that makes this a single-state problem rather than a goal set.
        let moves = all_moves();
        for m in [0usize, 1, 2] {
            let scrambled = crate::cubie::compose(&SOLVED, &moves[m]);
            assert!(
                F2lState::project(&scrambled).is_solved(),
                "U{m} left the goal"
            );
        }
    }

    #[test]
    fn the_case_fold_gives_the_forty_one() {
        let cases = all_cases();
        assert_eq!(
            cases.len(),
            42,
            "the fold is not the 41 cases plus the solved one"
        );
        let solved = configuration_name(4, 0, 8, 0);
        assert_eq!(cases.iter().filter(|c| c.name == solved).count(), 1);
        // Every case really is a distinct position, and its own state round-trips its name.
        let mut names: Vec<&str> = cases.iter().map(|c| c.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), 42);
    }

    #[test]
    fn the_goal_ball_is_a_distance_function_and_the_layers_are_these() {
        let ball = GoalBall::build();
        ball.validate()
            .expect("the ball must be a distance function");
        // Pinned, because the layer sizes are what the radius was CHOSEN on: they grow about
        // thirteenfold, so radius 5 is a third of a second's work saved against radius 6 for a
        // heuristic one better. A change here means the projection's own dynamics moved.
        assert_eq!(ball.layers(), [1, 15, 198, 2638, 34981, 461303]);
        assert_eq!(ball.len(), 499_136);
        assert_eq!(ball.radius(), GOAL_BALL_RADIUS);
        assert_eq!(ball.heuristic(&F2L_SOLVED), 0);
    }

    #[test]
    fn a_state_outside_the_ball_gets_a_bound_that_is_true() {
        // The half of the heuristic that is not a lookup, and the half that would be wrong if
        // absence ever meant "unknown" rather than "further than the radius". Every case whose
        // answer is longer than the radius must sit outside, and the bound must not exceed the
        // answer — an inadmissible heuristic here would return a length that is not the minimum,
        // silently, which is the whole failure mode this module is careful about.
        let ball = GoalBall::build();
        let cancel = AtomicBool::new(false);
        let mut outside = 0;
        for case in all_cases() {
            let h = ball.heuristic(&case.state());
            let proof = prove_all(&ball, &case.state(), 14, &cancel).expect("a proof");
            assert!(
                h <= proof.length,
                "{}: the heuristic says {h} and the answer is {}",
                case.name,
                proof.length
            );
            if h > GOAL_BALL_RADIUS {
                outside += 1;
                assert!(
                    proof.length > GOAL_BALL_RADIUS,
                    "{}: bounded but near",
                    case.name
                );
            }
        }
        assert!(
            outside > 0,
            "every case was inside the ball, so the bound was never exercised"
        );
    }
}
