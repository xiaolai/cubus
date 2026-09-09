//! Which of the two ways to find an OLL algorithm is actually cheaper — measured, not argued.
//!
//! Plan B6 (dev-docs/method-solver-return-plan.md §9), and it exists because of §7a's "silver
//! lining" paragraph, which is the one place the review found the plan *pessimistic* rather than
//! optimistic.
//!
//! **The reduction (§4).** The optimal algorithm for OLL case `C` is `min` over the 288 goal
//! states `g` of the minimal solution of `g⁻¹C`. It needs no new machinery: `prove()` already
//! answers each of those. But finding F6 corrected its cost — the transformed inputs `g⁻¹C` are
//! exactly the 62,208 last-layer states, whose optimal mean is **13.15082** (Miller p.22), not the
//! ~11 the plan assumed. That is 216 x 288 = 62,208 proofs at mean depth 13.15.
//!
//! **The direct search.** Search from `C` to the GOAL SET rather than to a single state: stop as
//! soon as the top face is oriented and the first two layers are intact, whatever the last-layer
//! permutation. OLL's own optimal mean is **9.2̄** — nearly four plies shallower — and 216
//! searches instead of 62,208. How much that is worth in time is what a benchmark would have to
//! say; the per-ply growth factor of one search does not carry across to a search with a
//! different heuristic and a different goal test.
//!
//! The plan dropped the direct route earlier as "inventing a problem" and §7a says that was too
//! quick. This binary settles it the way the plan says such things get settled: **both routes are
//! benchmarked before either is committed to.**
//!
//!   cargo run --release -p optimal-solver --bin oll-routes -- 8
//!
//! The argument is how many of the 57 non-skip cases to sample. Every case is not the point — the
//! per-case cost is — and the sample is taken at an even STRIDE through the case set rather than
//! from the front. Taking the first six meant taking six cases that share a key prefix: all three
//! of the corner-oriented cases (the cheapest kind, and 3 of 57) were among them, so the mean was
//! measured on a sample chosen by an ordering that correlates with difficulty.
//!
//! **What this binary does NOT do, and what it must not be read as saying.** It does not generate
//! a table, and it does not measure the direct route AT ALL. The goal-set search that route needs
//! does not exist in this crate — writing it is the decision this measurement informs — so there
//! is nothing to time. What is reported is the reduction's measured cost, and the two published
//! mean depths the routes differ by. It used to close with a multiplier ("~13.3^3.9 = ~2.5e4
//! times cheaper") presented as a bound; branching-factor arithmetic does not bound a search that
//! uses a different heuristic and a different goal test, and the measurement it was applied to
//! caps each search at the incumbent rather than solving to full depth. That number is gone
//! rather than qualified: a bound nobody can check is worse than no bound.

use optimal_solver::cases::{case_of, oll_states, pll_states, Kind};
use optimal_solver::cli::{self, Spec};
use optimal_solver::coords::Coords;
use optimal_solver::cubie::{compose, inverse, Cubie, SOLVED};
use optimal_solver::search::prove_counted;
use optimal_solver::Tables;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

/// The 57 cases that have something to solve. The skip is not a measurement of anything.
const SOLVABLE_CASES: usize = 57;

const SPEC: Spec = Spec {
    usage: "usage: oll-routes [cases 1..=57]",
    value_options: &[],
    flags: &[],
    positionals: 0..=1,
};

/// One case's representative state, for each OLL case, in key order.
fn oll_representatives() -> Vec<(String, Cubie)> {
    let mut by_case: BTreeMap<String, Cubie> = BTreeMap::new();
    for s in oll_states() {
        let c = case_of(Kind::Oll, &s);
        by_case.entry(c.id()).or_insert(s);
    }
    by_case.into_iter().collect()
}

/// `want` cases spread evenly through `cases`, deterministically.
///
/// A stride sample is reproducible (two runs of the same size measure the same cases, so two
/// machines' numbers are comparable) and it does not correlate with the key ordering the way
/// taking a prefix does. It is not a random sample and does not pretend to be; what it buys is
/// that the cheap cases and the expensive ones are both represented at every sample size.
fn stride_sample<T>(cases: &[T], want: usize) -> Vec<&T> {
    assert!(want >= 1 && want <= cases.len());
    (0..want).map(|i| &cases[i * cases.len() / want]).collect()
}

/// What measuring one case cost.
struct Measurement {
    id: String,
    optimum: u8,
    nodes: u64,
    wall_secs: f64,
}

/// THE REDUCTION, exactly as §4 describes it: prove `g⁻¹C` for every goal and take the minimum.
///
/// Each proof is capped at the best length found so far — a goal that cannot beat the incumbent is
/// not worth exhausting past it, and that cap is the reduction's only real optimisation. Without
/// it every one of the 288 runs to God's number.
///
/// `nodes` counts every search, including the ones that end `BeyondCap`. Those are the ORDINARY
/// case once a short solution has been found, and each of them can be substantial work; totalling
/// only the successful proofs reported a fraction of what the run actually did, which is the one
/// number a cost benchmark exists to produce.
fn measure(
    tables: &Tables,
    id: &str,
    state: &Cubie,
    goals: &[Cubie],
    cancel: &AtomicBool,
) -> Measurement {
    let t = Instant::now();
    let nodes = AtomicU64::new(0);
    let mut best = u8::MAX;
    for g in goals {
        let start = compose(&inverse(g), state);
        let cap = if best == u8::MAX { 20 } else { best - 1 };
        if let Ok(p) = prove_counted(
            tables,
            &Coords::from_cubie(&start),
            cap,
            cancel,
            &nodes,
            &mut |_, _| {},
        ) {
            best = best.min(p.length);
        }
    }
    Measurement {
        id: id.to_string(),
        optimum: best,
        nodes: nodes.load(Ordering::Relaxed),
        wall_secs: t.elapsed().as_secs_f64(),
    }
}

/// The measured cost, and the extrapolation — in the unit the clock actually measured.
///
/// `Instant` measures WALL time, and `prove` searches in parallel through rayon, so multiplying
/// elapsed seconds by the case count gives wall-seconds on a machine with this many workers. It
/// used to be printed as "core-seconds" and "core-hours", which understates the CPU spent by
/// roughly the worker count and is the figure someone sizing a nightly job would take away.
fn report(measured: &[Measurement], threads: usize) {
    let n = measured.len() as f64;
    let total_nodes: u64 = measured.iter().map(|m| m.nodes).sum();
    let total_secs: f64 = measured.iter().map(|m| m.wall_secs).sum();
    let total_best: usize = measured.iter().map(|m| m.optimum as usize).sum();
    let slowest = measured
        .iter()
        .max_by(|a, b| a.wall_secs.total_cmp(&b.wall_secs))
        .expect("at least one case");
    let fastest = measured
        .iter()
        .min_by(|a, b| a.wall_secs.total_cmp(&b.wall_secs))
        .expect("at least one case");

    eprintln!("\n--- the reduction, measured ---");
    eprintln!(
        "cases {}, mean optimum {:.2}",
        measured.len(),
        total_best as f64 / n
    );
    eprintln!(
        "mean {:.0} nodes and {:.1} wall-seconds per case on {threads} rayon workers",
        total_nodes as f64 / n,
        total_secs / n
    );
    // The spread, because a mean over a stride sample is a summary of cases that differ by more
    // than an order of magnitude and a single number hides that.
    eprintln!(
        "spread: {} at {:.1}s, {} at {:.1}s",
        fastest.id, fastest.wall_secs, slowest.id, slowest.wall_secs
    );
    eprintln!(
        "extrapolated to all {SOLVABLE_CASES}: {:.0} wall-seconds ({:.1} wall-hours) at this width",
        total_secs / n * SOLVABLE_CASES as f64,
        total_secs / n * SOLVABLE_CASES as f64 / 3600.0
    );

    eprintln!("\n--- the direct route: NOT measured here ---");
    eprintln!("The reduction proves 288 states of optimal mean 13.15082 per case (Miller p.22).");
    eprintln!("A goal-set search would prove ONE state per case, of optimal mean 9.2 (OLL's own).");
    eprintln!(
        "How much cheaper that is depends on a search this crate does not have — a different"
    );
    eprintln!("heuristic and a different goal test — so no ratio is stated. The numbers above are");
    eprintln!("what a goal-set implementation would have to be benchmarked against.");
}

fn main() {
    let args = cli::parse_or_exit(&SPEC);
    // Zero used to be accepted: it generated the pattern databases, measured nothing, and printed
    // a mean of NaN and an extrapolation of zero core-hours. So did 1000, silently truncated to
    // the case count. Both are refused before the tables are generated, which is the expensive
    // part.
    let sample: usize = if args.positionals().is_empty() {
        6
    } else {
        let n: usize = cli::or_exit(&SPEC, args.positional_parsed(0, "cases"));
        if !(1..=SOLVABLE_CASES).contains(&n) {
            cli::fail(
                &SPEC,
                &format!("cases: {n} is outside 1..={SOLVABLE_CASES} — there are {SOLVABLE_CASES} cases to solve and the skip"),
            );
        }
        n
    };

    eprintln!("generating tables…");
    let tables = Tables::generate(&mut |_, _, _| {}).expect("tables");
    let cancel = AtomicBool::new(false);

    let goals = pll_states();
    assert_eq!(
        goals.len(),
        288,
        "the OLL goal set is the 288 last-layer permutations"
    );
    let cases = oll_representatives();
    assert_eq!(cases.len(), SOLVABLE_CASES + 1, "57 OLL cases and the skip");
    let solvable: Vec<&(String, Cubie)> = cases.iter().filter(|(_, s)| *s != SOLVED).collect();
    assert_eq!(solvable.len(), SOLVABLE_CASES);

    println!("case                       optimum  goal-proofs      nodes   wall-secs");
    let mut measured = Vec::with_capacity(sample);
    for (id, state) in stride_sample(&solvable, sample) {
        let m = measure(&tables, id, state, &goals, &cancel);
        println!(
            "{:<26} {:>7}  {:>11}  {:>9}  {:>10.1}",
            m.id,
            m.optimum,
            goals.len(),
            m.nodes,
            m.wall_secs
        );
        measured.push(m);
    }
    report(&measured, rayon::current_num_threads());
}
