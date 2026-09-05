//! IDA* with iterative deepening: the first solution found at the shallowest completed contour
//! is optimal, because the heuristic is admissible (max of three exhaustively validated
//! projections) and every move costs one. No transposition table — the plan's search-choice
//! row records that a short-hash TT can silently destroy completeness, and absence is the one
//! configuration that cannot.

use crate::coords::Coords;
use crate::Tables;
use rayon::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// Same face twice never helps; of a commuting opposite-face pair, keep one order only —
/// the same canonicalisation apps/web/lib/two-phase.js uses, checked by the ball shells.
#[inline]
fn move_allowed(prev: i8, m: usize) -> bool {
    if prev < 0 {
        return true;
    }
    let face = m / 3;
    let pf = prev as usize / 3;
    face != pf && (face % 3 != pf % 3 || face < pf)
}

pub struct Proof {
    /// The proven minimal length.
    pub length: u8,
    /// One minimal maneuver, as indices into cubie::MOVE_NAMES.
    pub solution: Vec<u8>,
    /// Search nodes visited across all contours and threads.
    pub nodes: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SearchEnd {
    Cancelled,
    /// The search exhausted `cap` without a solution: the distance is proven greater.
    BeyondCap,
    /// A shard tuple that is not a shard — refused before any expensive work.
    InvalidShard,
}

/// What a sharded certification concluded (a named outcome; the nested-Result version of this
/// API said `Ok(Ok(()))` and meant neither Ok clearly).
#[derive(Debug, PartialEq, Eq)]
pub enum Certification {
    /// This shard exhausted every bound without a solution.
    NoSolutionWithin,
    /// A solution of this length exists in this shard — for the superflip within 19 that is a
    /// broken table, and the caller says so.
    FoundAt(u8),
}

/// How many nodes a DFS visits between looks at the cancel flag — ~0.1 ms of work, so cancel and
/// contour-stop bite immediately. Public because it is the unit of the cancellation PROMISE:
/// after the flag flips, each active thread visits at most this many more nodes before it
/// unwinds, and `plan_checks.rs` asserts that bound in nodes rather than in milliseconds.
pub const CANCEL_STRIDE: u64 = 4096;

struct Dfs<'a> {
    tables: &'a Tables,
    cancel: &'a AtomicBool,
    /// Set when this CONTOUR is decided (a sibling found a solution, or a cancel landed):
    /// active subtrees unwind within a stride instead of finishing enormous root branches
    /// nobody will read.
    stop: &'a AtomicBool,
    /// The search-wide counter, flushed at every poll point rather than once per opening. A
    /// thread deep in a root branch used to hold millions of nodes locally until it finished,
    /// so a reader of the total — the progress callback, and the cancellation test — saw a
    /// number that lagged the work by whole subtrees. One atomic add per CANCEL_STRIDE nodes
    /// is the cost, which is nothing.
    total_nodes: &'a AtomicU64,
    nodes: u64,
    since_check: u64,
    path: Vec<u8>,
}

enum DfsOut {
    Found,
    Exhausted,
    /// Unwound early — by cancel or by a sibling's find. Never treated as a full exhaustion.
    Aborted,
}

impl Dfs<'_> {
    /// Publish the nodes counted since the last flush.
    fn flush(&mut self) {
        self.total_nodes.fetch_add(self.nodes, Ordering::Relaxed);
        self.nodes = 0;
    }

    fn run(&mut self, c: Coords, g: u8, bound: u8, prev: i8) -> DfsOut {
        self.nodes += 1;
        self.since_check += 1;
        if self.since_check >= CANCEL_STRIDE {
            self.since_check = 0;
            self.flush();
            if self.cancel.load(Ordering::Relaxed) || self.stop.load(Ordering::Relaxed) {
                return DfsOut::Aborted;
            }
        }
        if g == bound {
            return if c.is_solved() {
                DfsOut::Found
            } else {
                DfsOut::Exhausted
            };
        }
        // Admissible pruning: g + h > bound cannot contain a solution within this contour.
        if g + self.tables.heuristic(&c) > bound {
            return DfsOut::Exhausted;
        }
        for m in 0..18usize {
            if !move_allowed(prev, m) {
                continue;
            }
            self.path.push(m as u8);
            match self.run(c.step(&self.tables.moves, m), g + 1, bound, m as i8) {
                DfsOut::Found => return DfsOut::Found,
                DfsOut::Aborted => return DfsOut::Aborted,
                DfsOut::Exhausted => {
                    self.path.pop();
                }
            }
        }
        DfsOut::Exhausted
    }
}

/// One contour, run root-parallel over the given openings (each a canonical move prefix).
/// Returns the found path if any thread found a solution at exactly this bound, whether a
/// cancel landed, and the nodes spent. A contour with no find and no cancel was FULLY
/// exhausted: the early-stop flag is only ever set by a find or a cancel.
fn run_contour(
    tables: &Tables,
    start: &Coords,
    bound: u8,
    openings: &[Vec<u8>],
    cancel: &AtomicBool,
    total_nodes: &AtomicU64,
) -> (Option<Vec<u8>>, bool) {
    let found: Mutex<Option<Vec<u8>>> = Mutex::new(None);
    let stop = AtomicBool::new(false);
    let cancelled = AtomicBool::new(false);
    openings.par_iter().for_each(|prefix| {
        // The cancel flag as well as the contour's stop: without it a cancel that lands between
        // openings started every remaining root, each of which then spent a full stride
        // discovering it — thousands of roots at four-move depth.
        if stop.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
            if cancel.load(Ordering::Relaxed) {
                cancelled.store(true, Ordering::Relaxed);
                stop.store(true, Ordering::Relaxed);
            }
            return;
        }
        let mut at = *start;
        for &m in prefix {
            at = at.step(&tables.moves, m as usize);
        }
        let g = prefix.len() as u8;
        if g > bound {
            return;
        }
        let mut dfs = Dfs {
            tables,
            cancel,
            stop: &stop,
            total_nodes,
            nodes: 0,
            since_check: 0,
            path: prefix.clone(),
        };
        let prev = *prefix.last().expect("openings are non-empty") as i8;
        // A prefix sitting exactly AT the bound is not a special case: `run`'s own `g == bound`
        // arm counts the node and evaluates the terminal, which is what the branch that used to
        // stand here did by hand — a second copy of the terminal rule, and the copy is what
        // drifts. The `g > bound` guard above is what keeps this call inside the contour.
        let out = dfs.run(at, g, bound, prev);
        dfs.flush();
        match out {
            DfsOut::Found => {
                let mut slot = found.lock().unwrap();
                if slot.is_none() {
                    *slot = Some(dfs.path.clone());
                }
                stop.store(true, Ordering::Relaxed);
            }
            DfsOut::Aborted => {
                if cancel.load(Ordering::Relaxed) {
                    cancelled.store(true, Ordering::Relaxed);
                }
                stop.store(true, Ordering::Relaxed);
            }
            DfsOut::Exhausted => {}
        }
    });
    (
        found.into_inner().unwrap(),
        cancelled.load(Ordering::Relaxed),
    )
}

/// The 18 canonical single-move openings.
fn root_openings() -> Vec<Vec<u8>> {
    (0..18u8).map(|m| vec![m]).collect()
}

/// Extend canonical prefixes to `target` moves — chains of `move_allowed`, which is Markov-1
/// (each link constrains only the next move), so extending every prefix by every allowed move
/// partitions its subtree EXACTLY: nothing dropped, nothing doubled. This is scheduling, not
/// semantics — the shard partition stays defined over the two-move openings, and a contour
/// covers the same maneuvers whatever the prefix length. What changes is the tail: ~27 tasks
/// per shard left the last giant subtrees grinding on three cores of twenty (measured,
/// 2026-08-30); at four-move roots a shard is ~5,000 tasks and the tail is minutes.
fn expand_openings(openings: Vec<Vec<u8>>, target: usize) -> Vec<Vec<u8>> {
    let mut out = openings;
    while out.first().is_some_and(|o| o.len() < target) {
        let mut next = Vec::with_capacity(out.len() * 15);
        for o in &out {
            let prev = *o.last().expect("openings are non-empty") as i8;
            for m in 0..18u8 {
                if move_allowed(prev, m as usize) {
                    let mut e = o.clone();
                    e.push(m);
                    next.push(e);
                }
            }
        }
        out = next;
    }
    out
}

/// How deep the parallel roots go at a given contour: as deep as four moves, never past the
/// bound itself (a maneuver of exactly the bound's length must surface as a prefix whose end
/// state is checked directly). Lengths below the ladder's first bound need no coverage — an
/// admissible heuristic above them IS the proof they hold no solution.
fn root_ply(bound: u8) -> usize {
    (bound as usize).min(4)
}

/// The partition's whole universe: the canonical two-move openings a shard is a subset of.
/// `certificate.rs` refuses the same ceiling when it collects, and the producer must refuse what
/// the collector will, or it mints certificates guaranteed to be rejected.
const SHARD_OPENINGS: u32 = 243;

/// The 243 canonical two-move openings, in a fixed order every shard agrees on.
fn two_ply_openings() -> Vec<Vec<u8>> {
    let mut out = Vec::with_capacity(SHARD_OPENINGS as usize);
    for m1 in 0..18u8 {
        for m2 in 0..18u8 {
            if move_allowed(m1 as i8, m2 as usize) {
                out.push(vec![m1, m2]);
            }
        }
    }
    debug_assert_eq!(out.len() as u32, SHARD_OPENINGS);
    out
}

/// Is this tuple actually a shard? A predicate rather than an inline test, so it can be checked
/// without the seconds of table generation `certify_no_solution_within` needs — the unit test
/// that used to stand for this counted openings and would have passed with the validation
/// deleted (the audit's finding, 2026-09-05). More shards than openings would mint empty shards
/// whose "no solution" says nothing, and an unbounded count is an allocation lever.
fn is_shard(index: u32, count: u32) -> bool {
    count != 0 && index < count && count <= SHARD_OPENINGS
}

/// What a run of ascending contours ended in: some contour found a solution at its bound, or
/// every contour through the cap was exhausted with none.
enum ContourEnd {
    Found { bound: u8, solution: Vec<u8> },
    Exhausted,
}

/// Ascending contours over one set of base openings — the loop `prove_counted` and
/// `certify_no_solution_within` each carried a copy of until 2026-09-05. One copy, because the
/// two drift: cancellation, root expansion, result precedence, progress reporting and bound
/// advancement are the same rules for a proof and for a certification, and a fix that reached
/// one and missed the other would leave a distributed shard searching differently from the
/// proof it is supposed to be a piece of.
///
/// What the callers keep is what genuinely differs: where the openings come from, where the
/// first contour starts, and what a find or an exhaustion MEANS — "this is the minimum" and
/// "this shard holds nothing shorter" are different claims, and the conversion is the place
/// that says so.
fn run_contours(
    tables: &Tables,
    start: &Coords,
    bounds: std::ops::RangeInclusive<u8>,
    base_openings: &[Vec<u8>],
    cancel: &AtomicBool,
    total_nodes: &AtomicU64,
    progress: &mut dyn FnMut(u8, u64),
) -> Result<ContourEnd, SearchEnd> {
    let max_bound = *bounds.end();
    let mut bound = *bounds.start();
    while bound <= max_bound {
        if cancel.load(Ordering::Relaxed) {
            return Err(SearchEnd::Cancelled);
        }
        // Expanded per contour for scheduling only: the expansion partitions each opening's
        // subtree exactly and `root_ply` never goes below the base openings' own length, so the
        // maneuvers covered — and a shard's partition identity — are untouched.
        let roots = expand_openings(base_openings.to_vec(), root_ply(bound));
        let (found, cancelled) = run_contour(tables, start, bound, &roots, cancel, total_nodes);
        if let Some(solution) = found {
            return Ok(ContourEnd::Found { bound, solution });
        }
        if cancelled {
            return Err(SearchEnd::Cancelled);
        }
        progress(bound, total_nodes.load(Ordering::Relaxed));
        bound += 1;
    }
    Ok(ContourEnd::Exhausted)
}

/// Prove the distance of `start`, up to `cap` moves inclusive. Contours run in ascending
/// order and each is exhausted before the next begins, so the first solution is minimal —
/// that is the proof, not a heuristic claim. Root branches of each contour run in parallel
/// and a find stops the siblings within a stride; all solutions within one contour have the
/// same length, so which thread wins changes nothing about optimality.
pub fn prove(
    tables: &Tables,
    start: &Coords,
    cap: u8,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u8, u64),
) -> Result<Proof, SearchEnd> {
    let total_nodes = AtomicU64::new(0);
    prove_counted(tables, start, cap, cancel, &total_nodes, progress)
}

/// [prove], with the node counter supplied by the caller and kept current to within one
/// CANCEL_STRIDE per thread — so a caller that cancels can read how much work happened AFTER
/// it asked, which is the deterministic half of the cancellation promise and what
/// `plan_checks.rs` measures instead of a wall clock.
///
/// The roots are expanded to `root_ply(bound)` moves PER CONTOUR, exactly as
/// `certify_no_solution_within` does and for the reason its comment records: 18 one-move roots
/// left the last giant subtrees grinding on three cores of twenty at the deep contours
/// (measured 2026-08-30), and a proof at length 18–20 spends nearly all of its time there. The
/// partition is exact (`expand_openings`), so the maneuvers covered are the same; only the
/// scheduling changes.
pub fn prove_counted(
    tables: &Tables,
    start: &Coords,
    cap: u8,
    cancel: &AtomicBool,
    total_nodes: &AtomicU64,
    progress: &mut dyn FnMut(u8, u64),
) -> Result<Proof, SearchEnd> {
    if start.is_solved() {
        total_nodes.fetch_add(1, Ordering::Relaxed);
        return Ok(Proof {
            length: 0,
            solution: Vec::new(),
            nodes: 1,
        });
    }
    let first = tables.heuristic(start).max(1);
    match run_contours(
        tables,
        start,
        first..=cap,
        &root_openings(),
        cancel,
        total_nodes,
        progress,
    )? {
        // The first contour to find anything is the shallowest that could: every shallower one
        // was exhausted first. That is the proof.
        ContourEnd::Found { bound, solution } => Ok(Proof {
            length: bound,
            solution,
            nodes: total_nodes.load(Ordering::Relaxed),
        }),
        ContourEnd::Exhausted => Err(SearchEnd::BeyondCap),
    }
}

/// Certify that `start` has NO solution within `max_bound` moves, over one shard of the
/// canonical search space — the distribution primitive. The 243 canonical two-move openings
/// partition every canonical maneuver of length ≥ 2 exactly once, so shard `i of n` (openings
/// with index ≡ i mod n) can be exhausted on a different machine with no coordination at all:
/// if every shard reports NoSolutionWithin for bounds up to 19, the superflip's proven 20 is
/// certified. Depths 0 and 1 have no two-move opening, so every shard checks them directly —
/// a solved or one-move state is reported found, never falsely certified.
pub fn certify_no_solution_within(
    tables: &Tables,
    start: &Coords,
    max_bound: u8,
    shard: (u32, u32),
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u8, u64),
) -> Result<Certification, SearchEnd> {
    let (index, count) = shard;
    // Before any expensive work, and before the tables are touched at all.
    if !is_shard(index, count) {
        return Err(SearchEnd::InvalidShard);
    }
    if start.is_solved() {
        return Ok(Certification::FoundAt(0));
    }
    if max_bound >= 1 {
        for m in 0..18usize {
            if start.step(&tables.moves, m).is_solved() {
                return Ok(Certification::FoundAt(1));
            }
        }
    }
    let mine: Vec<Vec<u8>> = two_ply_openings()
        .into_iter()
        .enumerate()
        .filter(|(k, _)| *k as u32 % count == index)
        .map(|(_, o)| o)
        .collect();

    // The shard IS its two-move openings, so this contour run covers exactly this shard's
    // maneuvers — the same loop `prove` runs, over a slice of the space instead of all of it.
    let total_nodes = AtomicU64::new(0);
    let first = tables.heuristic(start).max(2);
    match run_contours(
        tables,
        start,
        first..=max_bound,
        &mine,
        cancel,
        &total_nodes,
        progress,
    )? {
        ContourEnd::Found { bound, .. } => Ok(Certification::FoundAt(bound)),
        ContourEnd::Exhausted => Ok(Certification::NoSolutionWithin),
    }
}

/// Render a solution as the app's move notation. Defensive on release, loud on debug: a move
/// index above 17 is a bug, and a formatter is the wrong place to crash a report over it.
pub fn solution_string(solution: &[u8]) -> String {
    solution
        .iter()
        .map(|&m| {
            debug_assert!((m as usize) < 18);
            crate::cubie::MOVE_NAMES
                .get(m as usize)
                .copied()
                .unwrap_or("?")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_rule_keeps_exactly_one_order_of_a_commuting_pair() {
        // After U (face 0), D (face 3, same axis) is banned; after D, U is allowed.
        assert!(!move_allowed(0, 9));
        assert!(move_allowed(9, 0));
        // Same face twice never.
        assert!(!move_allowed(0, 1));
        // Different axes always.
        assert!(move_allowed(0, 3));
    }

    #[test]
    fn every_tuple_that_is_not_a_shard_is_refused() {
        // The cap and the partition are ONE number, so a change to the openings cannot leave a
        // stale ceiling behind.
        assert_eq!(two_ply_openings().len() as u32, SHARD_OPENINGS);
        assert!(is_shard(0, 1), "the whole space is a shard of one");
        assert!(is_shard(242, SHARD_OPENINGS), "the last index of the last");
        // Every way a tuple fails, one per clause — the predicate this replaces was asserted by
        // a test that counted openings and would have passed with the validation deleted.
        assert!(!is_shard(0, 0), "no shards at all divides nothing");
        assert!(!is_shard(3, 3), "an index outside its own count");
        assert!(
            !is_shard(0, SHARD_OPENINGS + 1),
            "more shards than openings mints empty shards, which certify nothing"
        );
        assert!(!is_shard(0, u32::MAX), "and an unbounded count allocates");
        // That the SEARCH asks this, before any work, is pinned through the public API in
        // tests/plan_checks.rs — the tables it needs are generated once there.
    }
}
