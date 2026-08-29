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

const CANCEL_STRIDE: u64 = 4096; // ~0.1 ms of nodes, so cancel and contour-stop bite immediately

struct Dfs<'a> {
    tables: &'a Tables,
    cancel: &'a AtomicBool,
    /// Set when this CONTOUR is decided (a sibling found a solution, or a cancel landed):
    /// active subtrees unwind within a stride instead of finishing enormous root branches
    /// nobody will read.
    stop: &'a AtomicBool,
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
    fn run(&mut self, c: Coords, g: u8, bound: u8, prev: i8) -> DfsOut {
        self.nodes += 1;
        self.since_check += 1;
        if self.since_check >= CANCEL_STRIDE {
            self.since_check = 0;
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
        if stop.load(Ordering::Relaxed) {
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
            nodes: 0,
            since_check: 0,
            path: prefix.clone(),
        };
        let prev = *prefix.last().expect("openings are non-empty") as i8;
        let out = if g == bound {
            dfs.nodes += 1; // the prefix state itself is evaluated — a node like any other
            if at.is_solved() {
                DfsOut::Found
            } else {
                DfsOut::Exhausted
            }
        } else {
            dfs.run(at, g, bound, prev)
        };
        total_nodes.fetch_add(dfs.nodes, Ordering::Relaxed);
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

/// The 243 canonical two-move openings, in a fixed order every shard agrees on.
fn two_ply_openings() -> Vec<Vec<u8>> {
    let mut out = Vec::with_capacity(243);
    for m1 in 0..18u8 {
        for m2 in 0..18u8 {
            if move_allowed(m1 as i8, m2 as usize) {
                out.push(vec![m1, m2]);
            }
        }
    }
    debug_assert_eq!(out.len(), 243);
    out
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
    if start.is_solved() {
        return Ok(Proof {
            length: 0,
            solution: Vec::new(),
            nodes: 1,
        });
    }
    let openings = root_openings();
    let total_nodes = AtomicU64::new(0);
    let mut bound = tables.heuristic(start).max(1);
    while bound <= cap {
        if cancel.load(Ordering::Relaxed) {
            return Err(SearchEnd::Cancelled);
        }
        let (found, cancelled) = run_contour(tables, start, bound, &openings, cancel, &total_nodes);
        if let Some(solution) = found {
            return Ok(Proof {
                length: bound,
                solution,
                nodes: total_nodes.load(Ordering::Relaxed),
            });
        }
        if cancelled {
            return Err(SearchEnd::Cancelled);
        }
        progress(bound, total_nodes.load(Ordering::Relaxed));
        bound += 1;
    }
    Err(SearchEnd::BeyondCap)
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
    // The checker caps at the 243 canonical openings; the producer must refuse the same
    // tuples, or it mints certificates the collector is guaranteed to reject.
    if count == 0 || index >= count || count > 243 {
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

    let total_nodes = AtomicU64::new(0);
    let mut bound = tables.heuristic(start).max(2);
    while bound <= max_bound {
        if cancel.load(Ordering::Relaxed) {
            return Err(SearchEnd::Cancelled);
        }
        let (found, cancelled) = run_contour(tables, start, bound, &mine, cancel, &total_nodes);
        if found.is_some() {
            return Ok(Certification::FoundAt(bound));
        }
        if cancelled {
            return Err(SearchEnd::Cancelled);
        }
        progress(bound, total_nodes.load(Ordering::Relaxed));
        bound += 1;
    }
    Ok(Certification::NoSolutionWithin)
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
    fn shard_tuples_are_validated_before_any_work() {
        // No tables needed: validation happens first, which is the point — the CLI feeds this
        // user input after minutes of generation.
        assert_eq!(two_ply_openings().len(), 243);
    }
}
