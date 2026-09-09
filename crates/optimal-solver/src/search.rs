//! IDA* with iterative deepening: the first solution found at the shallowest completed contour
//! is optimal, because the heuristic is admissible (max of three exhaustively validated
//! projections) and every move costs one. No transposition table — the plan's search-choice
//! row records that a short-hash TT can silently destroy completeness, and absence is the one
//! configuration that cannot.

use crate::coords::Coords;
use crate::Tables;
use rayon::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// The two node counters a search keeps, incremented together.
///
/// Two rather than one because they answer different questions, and conflating them was wrong in
/// two ways at once. `Proof.nodes` means THIS search's work, and it used to be read off the
/// caller's counter with the value it held at entry subtracted — correct only while nothing else
/// is adding to that counter. Two searches sharing one (which any caller measuring a batch of
/// states does) each ended up claiming the other's nodes; and a counter that had reached
/// `u64::MAX` turned the subtraction into a panic wherever overflow checks are on.
///
/// The caller's counter still has to be advanced by the WORKING THREADS rather than between
/// contours: the cancellation promise `plan_checks.rs` measures is stated in nodes and read while
/// the search is running. So both are flushed at the same poll points — one extra relaxed add per
/// `CANCEL_STRIDE` nodes, which is nothing beside the 4,096 nodes that earned it.
#[derive(Clone, Copy)]
struct Nodes<'a> {
    /// This search's own count, starting at zero. What a `Proof` reports.
    own: &'a AtomicU64,
    /// The caller's running total, when there is one — kept live for progress and cancellation.
    shared: Option<&'a AtomicU64>,
}

impl Nodes<'_> {
    fn add(&self, n: u64) {
        if n == 0 {
            return;
        }
        self.own.fetch_add(n, Ordering::Relaxed);
        if let Some(shared) = self.shared {
            shared.fetch_add(n, Ordering::Relaxed);
        }
    }
    /// This search's own count.
    fn mine(&self) -> u64 {
        self.own.load(Ordering::Relaxed)
    }
    /// What a progress callback is told: the caller's running total where one was supplied, so a
    /// caller watching a batch sees the batch, and this search's own where none was.
    fn reported(&self) -> u64 {
        self.shared.unwrap_or(self.own).load(Ordering::Relaxed)
    }
}

/// Same face twice never helps; of a commuting opposite-face pair, keep one order only —
/// the same canonicalisation apps/web/lib/two-phase.js uses, checked by the ball shells.
#[inline]
pub(crate) fn move_allowed(prev: i8, m: usize) -> bool {
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
    /// The search-wide counters, flushed at every poll point rather than once per opening. A
    /// thread deep in a root branch used to hold millions of nodes locally until it finished,
    /// so a reader of the total — the progress callback, and the cancellation test — saw a
    /// number that lagged the work by whole subtrees. One atomic add per CANCEL_STRIDE nodes
    /// is the cost, which is nothing.
    counters: Nodes<'a>,
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
        self.counters.add(self.nodes);
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

/// One opening's subtree at this contour: replay the prefix, then depth-first from there.
///
/// Returns the outcome together with the path the DFS ended holding — the found maneuver when the
/// outcome is `Found`, and meaningless otherwise, which is why the caller reads it in exactly that
/// arm. `None` means the prefix is longer than the bound, so this opening has nothing in this
/// contour at all.
fn search_prefix(
    tables: &Tables,
    start: &Coords,
    bound: u8,
    prefix: &[u8],
    cancel: &AtomicBool,
    stop: &AtomicBool,
    counters: Nodes<'_>,
) -> Option<(DfsOut, Vec<u8>)> {
    let g = prefix.len() as u8;
    if g > bound {
        return None;
    }
    let mut at = *start;
    for &m in prefix {
        at = at.step(&tables.moves, m as usize);
    }
    let mut dfs = Dfs {
        tables,
        cancel,
        stop,
        counters,
        nodes: 0,
        since_check: 0,
        path: prefix.to_vec(),
    };
    let prev = *prefix.last().expect("openings are non-empty") as i8;
    // A prefix sitting exactly AT the bound is not a special case: `run`'s own `g == bound`
    // arm counts the node and evaluates the terminal, which is what the branch that used to
    // stand here did by hand — a second copy of the terminal rule, and the copy is what
    // drifts. The `g > bound` guard above is what keeps this call inside the contour.
    let out = dfs.run(at, g, bound, prev);
    dfs.flush();
    Some((out, dfs.path))
}

/// One contour, run root-parallel over the given openings (each a canonical move prefix).
/// Returns the found path if any thread found a solution at exactly this bound, and whether a
/// cancel landed. (Nodes are not returned: they accumulate in the caller's counters, which is
/// what a progress callback reads. An earlier version of this sentence said otherwise.) A contour
/// with no find and no cancel was FULLY exhausted: the early-stop flag is only ever set by a find
/// or a cancel.
fn run_contour(
    tables: &Tables,
    start: &Coords,
    bound: u8,
    openings: &[Vec<u8>],
    cancel: &AtomicBool,
    counters: Nodes<'_>,
) -> (Option<Vec<u8>>, bool) {
    let found: Mutex<Option<Vec<u8>>> = Mutex::new(None);
    let stop = AtomicBool::new(false);
    let cancelled = AtomicBool::new(false);
    // "This contour is decided, and here is whether a cancel is why" — the two places that observe
    // it (an opening that never starts, and a subtree that unwound) recorded it with two copies of
    // the same pair of stores, which is how a cancel comes to be remembered at one and forgotten
    // at the other (the audit's finding, 2026-09-05). Storing `stop` again where it was already
    // set is idempotent and is what lets both callers say the same thing.
    let decided = || {
        if cancel.load(Ordering::Relaxed) {
            cancelled.store(true, Ordering::Relaxed);
        }
        stop.store(true, Ordering::Relaxed);
    };
    openings.par_iter().for_each(|prefix| {
        // The cancel flag as well as the contour's stop: without it a cancel that lands between
        // openings started every remaining root, each of which then spent a full stride
        // discovering it — thousands of roots at four-move depth.
        if stop.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
            decided();
            return;
        }
        let Some((out, path)) =
            search_prefix(tables, start, bound, prefix, cancel, &stop, counters)
        else {
            return;
        };
        match out {
            DfsOut::Found => {
                let mut slot = found.lock().unwrap();
                if slot.is_none() {
                    *slot = Some(path);
                }
                stop.store(true, Ordering::Relaxed);
            }
            DfsOut::Aborted => decided(),
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

/// The canonical prefixes at each ply, expanded once per process.
///
/// There are only five: `root_ply` caps at four, so a whole run of contours — and every state a
/// caller ever asks about — draws from the same five lists. Building them was cheap and building
/// them repeatedly was not free: the deepest is 43,254 prefixes, each an allocation, and
/// `prove_all` built it twice over for one state because the collecting pass could not see what
/// the proving pass had just made. Held here instead, which is where a value that depends on
/// nothing belongs.
fn canonical_roots(ply: usize) -> &'static [Vec<u8>] {
    static ROOTS: OnceLock<Vec<Vec<Vec<u8>>>> = OnceLock::new();
    let all = ROOTS.get_or_init(|| {
        (0..=MAX_ROOT_PLY)
            .map(|p| expand_openings(root_openings(), p.max(1)))
            .collect()
    });
    &all[ply.min(MAX_ROOT_PLY)]
}

/// Where a run of contours gets its parallel roots.
///
/// The distinction is real and not a mode flag: the canonical set is the same list for every
/// state and every contour at a given ply, so it is shared; a shard's is a subset picked out by
/// the shard tuple, so it is that shard's own and is expanded per run.
enum Roots<'a> {
    Canonical,
    Shard(&'a [Vec<u8>]),
}

/// The deepest the parallel roots go — see `root_ply`.
const MAX_ROOT_PLY: usize = 4;

/// How deep the parallel roots go at a given contour: as deep as four moves, never past the
/// bound itself (a maneuver of exactly the bound's length must surface as a prefix whose end
/// state is checked directly). Lengths below the ladder's first bound need no coverage — an
/// admissible heuristic above them IS the proof they hold no solution.
fn root_ply(bound: u8) -> usize {
    (bound as usize).min(MAX_ROOT_PLY)
}

/// The partition's whole universe: the canonical two-move openings a shard is a subset of.
/// `certificate.rs` refuses the same ceiling when it collects, and the producer must refuse what
/// the collector will, or it mints certificates guaranteed to be rejected.
const SHARD_OPENINGS: u32 = 243;

/// The 243 canonical two-move openings, in a fixed order every shard agrees on.
///
/// One enumeration, not two: this used to run its own nested loop over the same `move_allowed`
/// rule that `expand_openings` already applies, so the SHARD PARTITION — which is defined as
/// "opening k goes to shard k mod n", and therefore depends on the exact sequence — had two
/// implementations that had to stay byte-identical across machines and across time, with nothing
/// checking that they did (the audit's finding, 2026-09-05). They agreed when the duplicate was
/// removed, which was verified before removing it; now there is nothing left to disagree.
fn two_ply_openings() -> Vec<Vec<u8>> {
    let out = expand_openings(root_openings(), 2);
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
    roots: Roots<'_>,
    cancel: &AtomicBool,
    counters: Nodes<'_>,
    progress: &mut dyn FnMut(u8, u64),
) -> Result<ContourEnd, SearchEnd> {
    let max_bound = *bounds.end();
    let mut bound = *bounds.start();
    // The expansion depends only on `root_ply(bound)`, which is `min(bound, 4)` — so it stops
    // changing at bound 4 and every contour above that was rebuilding the identical 43,254
    // prefixes, cloning each one to push a single move onto it. Kept and reused instead; the deep
    // contours are where a proof spends nearly all of its time, and they are exactly the ones that
    // were paying for it.
    let mut cached: Option<(usize, Vec<Vec<u8>>)> = None;
    while bound <= max_bound {
        if cancel.load(Ordering::Relaxed) {
            return Err(SearchEnd::Cancelled);
        }
        // Expanded per PLY for scheduling only: the expansion partitions each opening's subtree
        // exactly and `root_ply` never goes below the base openings' own length, so the maneuvers
        // covered — and a shard's partition identity — are untouched.
        let ply = root_ply(bound);
        let at_ply: &[Vec<u8>] = match roots {
            Roots::Canonical => canonical_roots(ply),
            Roots::Shard(base) => {
                if cached.as_ref().is_none_or(|(at, _)| *at != ply) {
                    cached = Some((ply, expand_openings(base.to_vec(), ply)));
                }
                &cached.as_ref().expect("just filled").1
            }
        };
        let (found, cancelled) = run_contour(tables, start, bound, at_ply, cancel, counters);
        if let Some(solution) = found {
            return Ok(ContourEnd::Found { bound, solution });
        }
        if cancelled {
            return Err(SearchEnd::Cancelled);
        }
        progress(bound, counters.reported());
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
    // What `nodes` MEANS is this search's own work, not the counter's running total. The two
    // differed: the solved branch reported 1 while the searching branch reported whatever the
    // caller's counter already held plus its own — so a caller reusing one counter across states
    // saw each proof claim every earlier proof's nodes as well. Counted in a counter this call
    // OWNS, and relayed into the caller's; see `Nodes` for why subtracting an entry baseline from
    // a shared counter fixed only the sequential half of that.
    let own = AtomicU64::new(0);
    let counters = Nodes {
        own: &own,
        shared: Some(total_nodes),
    };
    if start.is_solved() {
        counters.add(1);
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
        Roots::Canonical,
        cancel,
        counters,
        progress,
    )? {
        // The first contour to find anything is the shallowest that could: every shallower one
        // was exhausted first. That is the proof.
        ContourEnd::Found { bound, solution } => Ok(Proof {
            length: bound,
            solution,
            nodes: counters.mine(),
        }),
        ContourEnd::Exhausted => Err(SearchEnd::BeyondCap),
    }
}

/// Every minimal CANONICAL maneuver for a state, not merely one of them.
pub struct ProofAll {
    /// The proven minimal length.
    pub length: u8,
    /// Every maneuver of that length **that the canonical move rule admits**, sorted by
    /// `cases::tie_break` — so this is a function of the state and of nothing else.
    ///
    /// **"Canonical" is a real restriction and it is stated rather than glossed.** `move_allowed`
    /// keeps one order of each commuting opposite-face pair, so for the state `U D` this returns
    /// `D' U'` and not `U' D'`. The two are the same maneuver with two adjacent commuting turns
    /// swapped — identical to hold, identical to execute, identical in length — and the whole
    /// search, including the shard partition every distributed certificate depends on, is defined
    /// over that canonicalisation. Enumerating both orders here would make this function disagree
    /// with the search it is a sibling of.
    ///
    /// What the restriction costs is worth being precise about: `cases::tie_break` therefore ranks
    /// within the canonical set, so a table entry is "the smallest canonical minimal maneuver",
    /// not "the smallest of all minimal maneuvers". Deterministic either way, which is the
    /// property that matters for a regenerable artifact.
    pub solutions: Vec<Vec<u8>>,
    /// Search nodes visited, including the collecting pass.
    pub nodes: u64,
}

/// Every solution of exactly `bound` moves under one opening. No early stop on a FIND — but it
/// still honours a cancel.
///
/// A separate walker rather than a mode on `Dfs`: that one is the hot path of every proof this
/// crate makes, and threading a "keep going after a find" flag through it would put a branch in
/// the innermost loop for the benefit of a pass that runs once per case.
///
/// **It does NOT visit a subset of the proving contour's nodes**, and an earlier version of this
/// comment claimed it did. Proving stops at its first find and abandons the rest of the contour;
/// collecting exhausts it. The pruning rule is the same admissible one, so the collector's nodes
/// are a subset of what a FULLY EXHAUSTED contour at this bound would visit — which is more work
/// than `prove` did, not less.
///
/// **Cancellation is polled every `CANCEL_STRIDE` nodes**, the same promise `Dfs` makes. Without
/// it a cancel landing inside a large subtree waited for that subtree to finish, which at a deep
/// bound is minutes — the cancellation contract `plan_checks.rs` measures in nodes would have been
/// silently untrue for this half of the API.
struct Collector<'a> {
    tables: &'a Tables,
    cancel: &'a AtomicBool,
    bound: u8,
    path: Vec<u8>,
    out: Vec<Vec<u8>>,
    nodes: u64,
    since_check: u64,
    aborted: bool,
}

impl Collector<'_> {
    fn run(&mut self, c: Coords, g: u8, prev: i8) {
        self.nodes += 1;
        self.since_check += 1;
        if self.since_check >= CANCEL_STRIDE {
            self.since_check = 0;
            if self.cancel.load(Ordering::Relaxed) {
                self.aborted = true;
            }
        }
        if self.aborted {
            return;
        }
        if g == self.bound {
            if c.is_solved() {
                self.out.push(self.path.clone());
            }
            return;
        }
        if g + self.tables.heuristic(&c) > self.bound {
            return;
        }
        for m in 0..18usize {
            if !move_allowed(prev, m) {
                continue;
            }
            self.path.push(m as u8);
            self.run(c.step(&self.tables.moves, m), g + 1, m as i8);
            self.path.pop();
            if self.aborted {
                return;
            }
        }
    }
}

/// [prove], then every other minimal CANONICAL maneuver of the same length — see [ProofAll].
///
/// **Why this exists.** `prove` runs root branches in parallel and a find stops the siblings, so
/// WHICH minimal maneuver comes back depends on which thread won — verified at `search.rs:198`,
/// and §7a upheld it as finding D. That changes nothing about the LENGTH and everything about the
/// ALGORITHM, which is fatal for a table meant to be memorised: regenerating it a year later would
/// diff dirty with no way to tell a real regression from a reshuffle. The fix is not to make the
/// race deterministic — it is to remove the race by taking the whole contour, and then to CHOOSE
/// with a stated rule (`cases::tie_break`).
///
/// **The cost is one contour, not one search.** Every contour below the answer is exhausted either
/// way; only the winning one is now exhausted rather than abandoned at the first find.
///
/// `progress` reports the proving half, per exhausted contour. The collecting half is silent here;
/// [prove_all_reporting] is the form that reports it, and the reason it exists is that the
/// collecting half of a shallow state is 14 to 36 ms — far too narrow a window for a test to land
/// a cancel in by sleeping. A deterministic hook is the only way to exercise `Collector`'s own
/// polling rather than the cancel check that brackets it.
pub fn prove_all(
    tables: &Tables,
    start: &Coords,
    cap: u8,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u8, u64),
) -> Result<ProofAll, SearchEnd> {
    prove_all_reporting(tables, start, cap, cancel, progress, &|_, _| {})
}

/// [prove_all], with a separate callback for the COLLECTING half.
///
/// Two callbacks rather than one because they run in different places: `progress` is called from
/// this thread between contours, `collected` from rayon's, so only the second needs `Sync`.
/// Widening `prove`'s signature to satisfy the second would have put a thread-safety bound on
/// every caller of the crate's main entry point for the benefit of one test hook.
pub fn prove_all_reporting(
    tables: &Tables,
    start: &Coords,
    cap: u8,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u8, u64),
    collected: &(dyn Fn(u8, u64) + Sync),
) -> Result<ProofAll, SearchEnd> {
    let proof = prove(tables, start, cap, cancel, progress)?;
    if proof.length == 0 {
        return Ok(ProofAll {
            length: 0,
            solutions: vec![Vec::new()],
            nodes: proof.nodes,
        });
    }
    let bound = proof.length;
    let (mut solutions, extra) = collect_contour(tables, start, bound, cancel, &|nodes| {
        collected(bound, proof.nodes + nodes)
    });
    if cancel.load(Ordering::Relaxed) {
        return Err(SearchEnd::Cancelled);
    }
    // Sorted by the STATED rule, so the vector is a function of the state and not of the thread
    // schedule. Without this the set would be right and its order would still be a race — and the
    // order is what a byte-for-byte regeneration diff reads.
    solutions.sort_by(|a, b| crate::cases::tie_break(a, b));
    // An ASSERTION, not a `dedup()`. There is nothing here to remove: the canonical prefixes
    // partition the contour exactly, so two of them cannot enumerate the same maneuver, and a
    // collector walks each subtree once. Removing duplicates would therefore have removed
    // nothing — while silently absorbing the one thing it could ever have removed, a
    // double-enumeration bug, which is exactly what a byte-for-byte regeneration diff exists to
    // catch and would then no longer see.
    debug_assert!(
        solutions.windows(2).all(|w| w[0] != w[1]),
        "the collecting pass enumerated the same maneuver twice — the root partition is broken"
    );
    debug_assert!(
        !solutions.is_empty(),
        "prove found a {bound}-move maneuver, so the collecting pass must find at least that one"
    );
    Ok(ProofAll {
        length: bound,
        solutions,
        nodes: proof.nodes + extra,
    })
}

/// Exhaust one contour and return every maneuver of exactly `bound` moves it holds, with the nodes
/// spent. Root-parallel over the same canonical openings the proving contour uses.
///
/// Its own function because it is its own job: `prove_all_reporting` decides WHICH contour and what
/// to do with the answer, and this walks it. `report` is called once per opening finished, with the
/// running node total — the hook a cancel can be raised from while collectors are still running.
/// Collect ONE opening's subtree, and say how many nodes it cost — the seam the collector's
/// cancellation promise is tested through.
///
/// It exists because that promise cannot be tested through `prove_all` at any bound anyone can
/// afford, and the reason is `root_ply`: the parallel roots go four moves deep, so at a fourteen-
/// move state an average opening is 3,915 nodes against a stride bound of 49,152 (measured,
/// 2026-09-09). A `Collector` that ignored the flag entirely and simply finished the opening it
/// was in would post the same number as one that polls, and the cheap test could not tell them
/// apart — which is what the audit recorded as its one partial finding. One opening at ONE move
/// deep is millions of nodes, and the two hypotheses separate immediately.
///
/// Not a solving entry point. `prove_all` chooses the contour and the openings; a caller that
/// chooses its own gets an answer about the openings it chose rather than about the state.
#[doc(hidden)]
pub fn collect_one_opening(
    tables: &Tables,
    start: &Coords,
    bound: u8,
    prefix: &[u8],
    cancel: &AtomicBool,
) -> (Vec<Vec<u8>>, u64) {
    let mut at = *start;
    for &m in prefix {
        at = at.step(&tables.moves, m as usize);
    }
    let mut collector = Collector {
        tables,
        cancel,
        bound,
        path: prefix.to_vec(),
        out: Vec::new(),
        nodes: 0,
        since_check: 0,
        aborted: false,
    };
    let prev = *prefix.last().expect("an opening is non-empty") as i8;
    collector.run(at, prefix.len() as u8, prev);
    (collector.out, collector.nodes)
}

fn collect_contour(
    tables: &Tables,
    start: &Coords,
    bound: u8,
    cancel: &AtomicBool,
    report: &(dyn Fn(u64) + Sync),
) -> (Vec<Vec<u8>>, u64) {
    // The same list the proving pass just used, not a second copy of it.
    let roots = canonical_roots(root_ply(bound));
    let found: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());
    let nodes = AtomicU64::new(0);
    roots.par_iter().for_each(|prefix| {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let g = prefix.len() as u8;
        // `root_ply` caps the prefix at `min(bound, 4)`, so a prefix longer than the bound cannot
        // occur — no `g > bound` guard here, because a branch that cannot be taken is a branch
        // nothing tests and everything has to read past.
        debug_assert!(
            g <= bound,
            "root_ply never produces a prefix longer than the bound"
        );
        let mut at = *start;
        for &m in prefix {
            at = at.step(&tables.moves, m as usize);
        }
        let mut collector = Collector {
            tables,
            cancel,
            bound,
            path: prefix.to_vec(),
            out: Vec::new(),
            nodes: 0,
            since_check: 0,
            aborted: false,
        };
        let prev = *prefix.last().expect("openings are non-empty") as i8;
        collector.run(at, g, prev);
        let so_far = nodes.fetch_add(collector.nodes, Ordering::Relaxed) + collector.nodes;
        if !collector.out.is_empty() {
            found.lock().unwrap().extend(collector.out);
        }
        // Reported after the work, so a callback that cancels stops the openings that have not
        // started AND every collector already running — the flag is one for both.
        report(so_far);
    });
    (found.into_inner().unwrap(), nodes.load(Ordering::Relaxed))
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
        Roots::Shard(&mine),
        cancel,
        // No caller counter: a certification reports a verdict, not a node count, so its own is
        // the only one there is and the progress callback reads that.
        Nodes {
            own: &total_nodes,
            shared: None,
        },
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
    use crate::cubie::MOVE_NAMES;

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

    /// The shard partition is an ORDER, not a set: "opening k belongs to shard k mod n" only
    /// coordinates machines that enumerate the openings identically. So the sequence is pinned
    /// here by its properties rather than by a second copy of the loop that produces it — the
    /// copy is what was just deleted, and re-typing it into a test would put it straight back.
    #[test]
    fn the_shard_openings_are_one_fixed_canonical_sequence() {
        let out = two_ply_openings();
        assert_eq!(out.len() as u32, SHARD_OPENINGS);
        assert!(
            out.iter().all(|o| o.len() == 2),
            "every shard opening is two moves — depths 0 and 1 are checked directly"
        );
        assert!(
            out.iter().all(|o| move_allowed(o[0] as i8, o[1] as usize)),
            "and every one is canonical"
        );
        // Strictly ascending as pairs: sorted AND without repeats, which together are what make
        // `k mod n` a partition rather than an overlap with a gap somewhere else.
        assert!(
            out.windows(2).all(|w| w[0] < w[1]),
            "the openings are in ascending (m1, m2) order, no duplicates"
        );
        // The ends, so a silent reordering cannot pass the properties above.
        // Move index 3 is `R`, not `F` — `MOVE_NAMES` is U U2 U' R R2 R' F …, so the first legal
        // second move after `U` is `R`. The comment here said F until 2026-09-09.
        assert_eq!(MOVE_NAMES[3], "R");
        assert_eq!(out.first(), Some(&vec![0u8, 3]), "U then the first legal R");
        assert_eq!(out.last(), Some(&vec![17u8, 14]));
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
