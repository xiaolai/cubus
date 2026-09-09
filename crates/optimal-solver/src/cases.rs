//! What a last-layer CASE is, and which of its many minimal algorithms a table records.
//!
//! Plan B1 (dev-docs/method-solver-return-plan.md §9). A case table is memorised by humans, so it
//! has to be right the first time and it has to be REGENERABLE to the same bytes — a rebuild that
//! shifted an entry by one move would invalidate muscle memory built on it, and a rebuild that
//! merely reshuffled equally-minimal algorithms would diff dirty with no way to tell a regression
//! from noise. Three things are needed for that, and this module is two of them:
//!
//!   1. **Canonical case identity** — one key per case, so a table holds exactly one entry per
//!      case and a lookup cannot miss.
//!   2. **A stated deterministic tie-break** — several algorithms are commonly minimal for one
//!      case, and "whichever the search found" is not a choice, it is a race. (`search::prove_all`
//!      is the third: it returns EVERY minimal solution, so there is something to break the tie
//!      between.)
//!
//! ## The folding, computed rather than asserted
//!
//! §7a finding F8 corrected an earlier claim here: folding the input U alignment ALONE takes the
//! 288 PLL states to **72** orbits, not 21. This module reproduces that number in its own tests
//! and then states what does reach 22 (21 named perms plus the skip):
//!
//! | Folded by | PLL orbits | | Folded by | OLL orbits |
//! |---|---|---|---|---|
//! | pre-AUF alone | 72 | | AUF | **58** (57 + skip) |
//! | post-AUF alone | 72 | | | |
//! | pre-AUF + post-AUF | **22** | | | |
//! | pre-AUF + y-conjugation | **22** | | | |
//! | pre-AUF + post-AUF + y | **22** | | | |
//!
//! **A correction to the plan, and it is load-bearing.** F8 says reaching 21 "needs y-conjugation
//! as well". Computed here: pre-AUF plus post-AUF reaches 22 with no rotation at all, and adding
//! y-conjugation on top changes nothing — every AUF orbit is already closed under y. That is not a
//! quibble about method: it says the two candidate foldings agree on the PARTITION, so the only
//! thing left to choose is the representative, which the tie-break decides. Both facts are pinned
//! by tests below rather than left as prose.
//!
//! ## What a key asserts, and what it does not
//!
//! A case key names an ORBIT. The optimum of a canonical algorithm body and the optimum of a
//! specific state including its alignment are two different claims (§7), so a key travels with the
//! transform that reached it: `Case { key, pre, post }` says "this state is `pre`-AUF and
//! `post`-AUF away from the representative", and a certificate must say which of the two it is
//! about. Nothing here claims minimality; that is `search`'s word and `cases.rs` never says it.

use crate::cubie::{all_moves, compose, inverse, Cubie, SOLVED};
use std::cmp::Ordering;

/// A whole-cube turn about U, as a STATE — `apps/web/lib/cube-pieces.js`'s `Y_STATE`, verbatim.
///
/// Edge orientation is NOT invariant under this rotation: in this convention a flip is measured
/// against the F/B axis, and `F` flips edges where `R` does not, so the eight U/D-layer edges read
/// as flipped after the turn and the four middle ones do not. Reading a piece's slot in one frame
/// and its flip in another describes a situation that does not exist — it is exactly how the JS
/// solver's F2L stage once gave one case two different algorithms depending on the slot.
pub const Y_STATE: Cubie = Cubie {
    cp: [1, 2, 3, 0, 5, 6, 7, 4],
    co: [0; 8],
    ep: [1, 2, 3, 0, 5, 6, 7, 4, 9, 10, 11, 8],
    eo: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
};

/// `state` as seen after turning the whole cube one quarter turn about U.
pub fn rotate_y(state: &Cubie) -> Cubie {
    compose(&compose(&inverse(&Y_STATE), state), &Y_STATE)
}

/// The U quarter turn, as a state.
fn u_turn() -> Cubie {
    all_moves()[0].clone()
}

/// `state` with `n` U turns applied AFTER it — the alignment a learner makes before recognising
/// the case ("turn the top until it matches").
pub fn auf_pre(state: &Cubie, n: u8) -> Cubie {
    let u = u_turn();
    let mut out = state.clone();
    for _ in 0..(n % 4) {
        out = compose(&out, &u);
    }
    out
}

/// `state` with `n` U turns applied BEFORE it — the final alignment an algorithm ends with.
pub fn auf_post(state: &Cubie, n: u8) -> Cubie {
    let u = u_turn();
    let mut out = state.clone();
    for _ in 0..(n % 4) {
        out = compose(&u, &out);
    }
    out
}

/// Which family of last-layer case a key belongs to. Kept in the key itself so an OLL record and
/// a PLL record can never be compared as if they were the same kind of claim.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// Orientation only: the twist of the four U corners and the flip of the four U edges.
    Oll,
    /// Permutation only: which of the four U corners and four U edges sits where.
    Pll,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Oll => "oll",
            Kind::Pll => "pll",
        }
    }
}

/// A case, and how the state that produced it sits relative to the case's representative.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Case {
    pub kind: Kind,
    /// The canonical representative's key — the smallest projection in the orbit.
    pub key: Vec<u8>,
    /// U turns applied to the state to reach the representative (`auf_pre`).
    pub pre: u8,
    /// U turns applied before it to reach the representative (`auf_post`). Always 0 for OLL —
    /// post-AUF acts trivially on an orientation pattern, so there is nothing for it to reach.
    pub post: u8,
}

impl Case {
    /// The key as the hex text a certificate carries. Short, fixed-width, and byte-comparable.
    pub fn key_hex(&self) -> String {
        self.key.iter().map(|b| format!("{b:x}")).collect()
    }
    /// `oll:00112233` — the whole identity in one token, for a record line.
    pub fn id(&self) -> String {
        format!("{}:{}", self.kind.as_str(), self.key_hex())
    }
}

/// The orientation projection: the twist of the four U corners then the flip of the four U edges.
fn oll_projection(s: &Cubie) -> Vec<u8> {
    let mut v = Vec::with_capacity(8);
    v.extend_from_slice(&s.co[0..4]);
    v.extend_from_slice(&s.eo[0..4]);
    v
}

/// The permutation projection: which cubie sits in each of the four U corner and U edge slots.
fn pll_projection(s: &Cubie) -> Vec<u8> {
    let mut v = Vec::with_capacity(8);
    v.extend_from_slice(&s.cp[0..4]);
    v.extend_from_slice(&s.ep[0..4]);
    v
}

/// The case a last-layer state belongs to: the smallest projection reachable by the folding, and
/// the transform that reaches it.
///
/// Ties in the projection are broken by the SMALLEST transform, so the answer does not depend on
/// the iteration order — two machines that enumerate `(pre, post)` differently still agree.
pub fn case_of(kind: Kind, s: &Cubie) -> Case {
    let project = match kind {
        Kind::Oll => oll_projection as fn(&Cubie) -> Vec<u8>,
        Kind::Pll => pll_projection as fn(&Cubie) -> Vec<u8>,
    };
    // OLL searches one alignment axis, PLL two. Not a claim about symmetry: post-AUF moves pieces
    // between slots while leaving each slot's TWIST where it is, so it acts trivially on an
    // orientation pattern and searching it would cost four times as much to find the same
    // representative. The test below proves that triviality rather than trusting this comment.
    // For PLL both axes are real, and folding both is what takes 72 orbits down to 22.
    let posts: &[u8] = match kind {
        Kind::Oll => &[0],
        Kind::Pll => &[0, 1, 2, 3],
    };
    let mut best: Option<(Vec<u8>, u8, u8)> = None;
    for pre in 0..4u8 {
        let a = auf_pre(s, pre);
        for &post in posts {
            let b = auf_post(&a, post);
            let p = project(&b);
            let better = match &best {
                None => true,
                Some((bp, bpre, bpost)) => match p.cmp(bp) {
                    Ordering::Less => true,
                    Ordering::Greater => false,
                    Ordering::Equal => (pre, post) < (*bpre, *bpost),
                },
            };
            if better {
                best = Some((p, pre, post));
            }
        }
    }
    let (key, pre, post) = best.expect("the folding is never empty");
    Case {
        kind,
        key,
        pre,
        post,
    }
}

/// Every reachable last-layer permutation state: 4! corner perms x 4! edge perms of MATCHING
/// parity. An odd last layer on its own is unreachable by face turns, so counting those would be
/// counting states no cube can be in — 288, not 576.
pub fn pll_states() -> Vec<Cubie> {
    let mut out = Vec::with_capacity(288);
    for cp in permutations4() {
        for ep in permutations4() {
            if parity4(&cp) != parity4(&ep) {
                continue;
            }
            let mut s = SOLVED;
            s.cp[0..4].copy_from_slice(&cp);
            s.ep[0..4].copy_from_slice(&ep);
            out.push(s);
        }
    }
    out
}

/// Every last-layer ORIENTATION state: 3^3 corner twists x 2^3 edge flips = 216. The fourth of
/// each is forced — twists sum to 0 mod 3, flips to 0 mod 2 — so an unreachable pattern is never
/// constructed rather than constructed and rejected.
pub fn oll_states() -> Vec<Cubie> {
    let mut out = Vec::with_capacity(216);
    for a in 0..3u8 {
        for b in 0..3u8 {
            for c in 0..3u8 {
                let co = [a, b, c, (9 - a - b - c) % 3];
                for p in 0..2u8 {
                    for q in 0..2u8 {
                        for r in 0..2u8 {
                            let eo = [p, q, r, (p + q + r) % 2];
                            let mut s = SOLVED;
                            s.co[0..4].copy_from_slice(&co);
                            s.eo[0..4].copy_from_slice(&eo);
                            out.push(s);
                        }
                    }
                }
            }
        }
    }
    out
}

fn permutations4() -> Vec<[u8; 4]> {
    let mut out = Vec::with_capacity(24);
    for a in 0..4u8 {
        for b in 0..4u8 {
            for c in 0..4u8 {
                for d in 0..4u8 {
                    let p = [a, b, c, d];
                    let mut seen = [false; 4];
                    if p.iter().all(|&x| {
                        let fresh = !seen[x as usize];
                        seen[x as usize] = true;
                        fresh
                    }) {
                        out.push(p);
                    }
                }
            }
        }
    }
    out
}

fn parity4(p: &[u8; 4]) -> u32 {
    let mut n = 0;
    for i in 0..4 {
        for j in (i + 1)..4 {
            if p[i] > p[j] {
                n += 1;
            }
        }
    }
    n % 2
}

/// **The tie-break, stated so two machines agree.**
///
/// Several algorithms are commonly minimal for one case, and `prove` returns whichever thread won
/// — a race, not a choice (§7a finding D, confirmed at `search.rs:198`). Ranking by arrival order
/// is the bug `solver-research.md` §6.1 already paid for once, where one case ended up with three
/// algorithms; the fix there was the same shape as this one, ranking in a single canonical frame.
///
/// **Shortest first, then lexicographic by move INDEX** in `cubie::MOVE_NAMES` order — that is,
/// `U U2 U' R R2 R' F F2 F' D D2 D' L L2 L' B B2 B'`. Index order rather than the printed name, so
/// the comparison does not depend on a locale's idea of how `'` sorts.
pub fn tie_break(a: &[u8], b: &[u8]) -> Ordering {
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

/// The one minimal algorithm a table records for a case, chosen from every minimal algorithm the
/// search found. Panics on an empty set: "no minimal solution" is not a choice to be made quietly.
pub fn pick(solutions: &[Vec<u8>]) -> &[u8] {
    solutions
        .iter()
        .min_by(|a, b| tie_break(a, b))
        .expect("a case with no minimal solution is a search failure, not a tie")
        .as_slice()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn key_of(s: &Cubie) -> String {
        format!("{:?}|{:?}|{:?}|{:?}", s.cp, s.co, s.ep, s.eo)
    }

    /// Orbits of `states` under the generators, counted by flood fill — identified by the
    /// PROJECTION, never by the whole state.
    ///
    /// That distinction is the whole subject. A generator moves a state out of the enumerated set
    /// (post-AUF permutes the corners of an orientation state, so the result is no longer one of
    /// the 216) while leaving the thing a case IS untouched. Flooding on the full state counts
    /// every state as its own orbit and reports 216 — which is what a first draft of this helper
    /// did, and it looked like a finding rather than like a bug in the helper.
    fn orbit_count(
        states: &[Cubie],
        gens: &[fn(&Cubie) -> Cubie],
        project: fn(&Cubie) -> Vec<u8>,
    ) -> usize {
        let mut seen: HashSet<Vec<u8>> = HashSet::new();
        let mut n = 0;
        for s in states {
            if seen.contains(&project(s)) {
                continue;
            }
            n += 1;
            let mut stack = vec![s.clone()];
            seen.insert(project(s));
            while let Some(cur) = stack.pop() {
                for g in gens {
                    let next = g(&cur);
                    if seen.insert(project(&next)) {
                        stack.push(next);
                    }
                }
            }
        }
        n
    }

    fn pre1(s: &Cubie) -> Cubie {
        auf_pre(s, 1)
    }
    fn post1(s: &Cubie) -> Cubie {
        auf_post(s, 1)
    }

    #[test]
    fn the_state_spaces_are_the_sizes_the_plan_counts() {
        // 4!x4!/2 and 3^3x2^3 — the same 288 and 216 whose product is the 62,208 the JS solver's
        // exhaustive sweep enumerates. A miscount here would silently shrink every table below.
        assert_eq!(pll_states().len(), 288);
        assert_eq!(oll_states().len(), 216);
        // Distinct, and every one legal (matching parity is enforced, not filtered afterwards).
        assert_eq!(
            pll_states()
                .iter()
                .map(key_of)
                .collect::<HashSet<_>>()
                .len(),
            288
        );
        assert_eq!(
            oll_states()
                .iter()
                .map(key_of)
                .collect::<HashSet<_>>()
                .len(),
            216
        );
    }

    /// §7a finding F8, reproduced rather than believed — and then carried one step further.
    #[test]
    fn folding_the_input_alignment_alone_gives_seventy_two_pll_orbits_not_twenty_one() {
        let states = pll_states();
        let p = pll_projection as fn(&Cubie) -> Vec<u8>;
        assert_eq!(
            orbit_count(&states, &[pre1], p),
            72,
            "F8: pre-AUF alone is 72 orbits, and a plan claiming 21 here would be wrong"
        );
        assert_eq!(
            orbit_count(&states, &[post1], p),
            72,
            "and post-AUF alone too"
        );
        // What actually reaches the 21 named perms plus the skip.
        assert_eq!(orbit_count(&states, &[pre1, post1], p), 22);
        assert_eq!(orbit_count(&states, &[pre1, rotate_y], p), 22);
        // THE CORRECTION TO F8: y-conjugation adds nothing on top of the two alignments. Every
        // AUF orbit is already closed under y, so the two candidate foldings agree on the
        // partition and only the representative is left to choose.
        assert_eq!(orbit_count(&states, &[pre1, post1, rotate_y], p), 22);
    }

    #[test]
    fn folding_the_alignment_gives_the_fifty_seven_olls_and_the_skip() {
        let p = oll_projection as fn(&Cubie) -> Vec<u8>;
        assert_eq!(orbit_count(&oll_states(), &[pre1], p), 58);
        // Post-AUF acts TRIVIALLY on an orientation pattern read by slot — it moves pieces between
        // slots and the twists stay where they are — so folding it neither merges cases nor
        // splits them. `case_of` leaves it out of OLL's search purely as a cost saving, and this
        // is what says that choice is free rather than a claim about symmetry.
        assert_eq!(orbit_count(&oll_states(), &[pre1, post1], p), 58);
        for s in oll_states() {
            for n in 0..4u8 {
                assert_eq!(
                    oll_projection(&auf_post(&s, n)),
                    oll_projection(&s),
                    "post-AUF changed an orientation pattern"
                );
            }
        }
        // y-conjugation, likewise, is already inside the AUF orbits.
        assert_eq!(orbit_count(&oll_states(), &[pre1, rotate_y], p), 58);
    }

    #[test]
    fn every_state_gets_exactly_one_key_and_the_keys_count_the_cases() {
        for (kind, states, want) in [
            (Kind::Pll, pll_states(), 22usize),
            (Kind::Oll, oll_states(), 58usize),
        ] {
            let keys: HashSet<String> = states.iter().map(|s| case_of(kind, s).id()).collect();
            assert_eq!(keys.len(), want, "{kind:?} did not resolve to {want} cases");
            // A key is a fact about the ORBIT: every state in one orbit must produce the same key,
            // or a lookup would miss for three states out of four.
            for s in &states {
                let base = case_of(kind, s);
                for pre in 0..4u8 {
                    let moved = auf_pre(s, pre);
                    assert_eq!(
                        case_of(kind, &moved).key,
                        base.key,
                        "an alignment changed the case"
                    );
                }
                if kind == Kind::Pll {
                    for post in 0..4u8 {
                        assert_eq!(case_of(kind, &auf_post(s, post)).key, base.key);
                    }
                    assert_eq!(case_of(kind, &rotate_y(s)).key, base.key);
                }
            }
        }
    }

    #[test]
    fn the_transform_a_key_carries_actually_reaches_the_representative() {
        // A key with a transform that does not reach it is worse than no transform: the record
        // would name a case and describe a different state.
        for (kind, states) in [(Kind::Pll, pll_states()), (Kind::Oll, oll_states())] {
            let project = match kind {
                Kind::Oll => oll_projection as fn(&Cubie) -> Vec<u8>,
                Kind::Pll => pll_projection as fn(&Cubie) -> Vec<u8>,
            };
            for s in &states {
                let c = case_of(kind, s);
                let rep = auf_post(&auf_pre(s, c.pre), c.post);
                assert_eq!(project(&rep), c.key);
            }
        }
    }

    #[test]
    fn the_solved_last_layer_is_a_case_of_its_own_the_skip() {
        // 21 perms + 1 skip, 57 olls + 1 skip. The skip is a case: a table that folded it into
        // another would emit an algorithm for a cube that needs none.
        let skip_pll = case_of(Kind::Pll, &SOLVED);
        assert_eq!(skip_pll.key, vec![0, 1, 2, 3, 0, 1, 2, 3]);
        let skip_oll = case_of(Kind::Oll, &SOLVED);
        assert_eq!(skip_oll.key, vec![0; 8]);
        let others = pll_states()
            .iter()
            .filter(|s| case_of(Kind::Pll, s).key == skip_pll.key)
            .count();
        assert_eq!(others, 4, "the skip's orbit is the four AUFs of solved");
    }

    #[test]
    fn the_tie_break_is_total_and_stated() {
        // Shorter wins, then move index. Written as assertions so "lexicographic by move index"
        // cannot quietly become "by printed name", where `U'` and `U2` sort the other way.
        assert_eq!(tie_break(&[0, 1], &[0, 1, 2]), Ordering::Less);
        assert_eq!(tie_break(&[0, 1], &[0, 2]), Ordering::Less);
        assert_eq!(tie_break(&[3, 0], &[0, 3]), Ordering::Greater);
        assert_eq!(tie_break(&[5, 5], &[5, 5]), Ordering::Equal);
        // `U2` is index 1 and `U'` is index 2, so U2 sorts first — the opposite of what comparing
        // the printed names would give.
        assert_eq!(crate::cubie::MOVE_NAMES[1], "U2");
        assert_eq!(crate::cubie::MOVE_NAMES[2], "U'");
        assert_eq!(tie_break(&[1], &[2]), Ordering::Less);
        assert!("U'" < "U2", "so a name comparison really would disagree");
    }

    #[test]
    fn pick_is_a_function_of_the_set_and_not_of_its_order() {
        let a = vec![vec![3u8, 0, 5], vec![0u8, 3, 5], vec![0u8, 3, 4]];
        let mut b = a.clone();
        b.reverse();
        assert_eq!(pick(&a), pick(&b));
        assert_eq!(pick(&a), &[0u8, 3, 4]);
    }

    #[test]
    fn the_y_state_is_the_rotation_it_claims_to_be() {
        // Four quarter turns is the identity, and conjugating U leaves U alone while it sends R
        // to B — the relabelling `rotateAlg` performs. Derived, not remembered.
        let mut s = SOLVED;
        for _ in 0..4 {
            s = rotate_y(&s);
        }
        assert_eq!(s, SOLVED);
        let moves = all_moves();
        // Conjugating the R quarter turn by y gives the B quarter turn.
        assert_eq!(rotate_y(&moves[3]), moves[15]);
        // And U is fixed.
        assert_eq!(rotate_y(&moves[0]), moves[0]);
    }
}
