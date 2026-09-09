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
//! permutation. OLL's own optimal mean is **9.2̄** — nearly four plies shallower — and IDA* cost
//! grows roughly 13.3x per ply. 216 searches instead of 62,208.
//!
//! The plan dropped the direct route earlier as "inventing a problem" and §7a says that was too
//! quick. This binary settles it the way the plan says such things get settled: **both routes are
//! benchmarked before either is committed to.**
//!
//!   cargo run --release -p optimal-solver --bin oll-routes -- 8
//!
//! The argument is how many cases to sample. Every case is not the point — the ratio is, and it
//! is stable well before the whole set.
//!
//! **What this binary does NOT do.** It does not generate a table. The direct route needs a
//! goal-set search this crate does not have, so the honest comparison is between the reduction as
//! it exists and a LOWER BOUND on what the direct route would cost, measured on the same states.
//! That bound is what decides whether writing the goal-set search is worth it, and it is a much
//! smaller claim than "here is the table".

use optimal_solver::cases::{case_of, oll_states, pll_states, Kind};
use optimal_solver::coords::Coords;
use optimal_solver::cubie::{compose, inverse, Cubie};
use optimal_solver::search::prove;
use optimal_solver::Tables;
use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

/// One case's representative state, for each OLL case, in key order.
fn oll_representatives() -> Vec<(String, Cubie)> {
    let mut by_case: BTreeMap<String, Cubie> = BTreeMap::new();
    for s in oll_states() {
        let c = case_of(Kind::Oll, &s);
        by_case.entry(c.id()).or_insert(s);
    }
    by_case.into_iter().collect()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sample: usize = match args.as_slice() {
        [] => 6,
        [n] => n.parse().unwrap_or_else(|_| {
            eprintln!("usage: oll-routes [cases 1..=58]");
            std::process::exit(1)
        }),
        _ => {
            eprintln!("usage: oll-routes [cases 1..=58]");
            std::process::exit(1)
        }
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
    assert_eq!(cases.len(), 58, "57 OLL cases and the skip");

    // The skip has nothing to solve, so it is not a measurement of anything.
    let measured: Vec<&(String, Cubie)> = cases
        .iter()
        .filter(|(_, s)| *s != optimal_solver::cubie::SOLVED)
        .take(sample)
        .collect();

    println!("case                       optimum  goal-proofs      nodes        secs");
    let mut total_nodes = 0u64;
    let mut total_secs = 0f64;
    let mut total_best = 0usize;
    for (id, state) in &measured {
        // THE REDUCTION, exactly as §4 describes it: prove `g⁻¹C` for every goal and take the
        // minimum. Each proof is capped at the best length found so far — a goal that cannot beat
        // the incumbent is not worth exhausting past it, and that cap is the reduction's only
        // real optimisation. Without it every one of the 288 runs to God's number.
        let t = Instant::now();
        let mut nodes = 0u64;
        let mut best = u8::MAX;
        for g in &goals {
            let start = compose(&inverse(g), state);
            let cap = if best == u8::MAX { 20 } else { best - 1 };
            // `Err` means this goal cannot beat the incumbent — the ordinary case once a short
            // one has been found, and not a failure, which is why it has no arm of its own.
            if let Ok(p) = prove(
                &tables,
                &Coords::from_cubie(&start),
                cap,
                &cancel,
                &mut |_, _| {},
            ) {
                nodes += p.nodes;
                best = best.min(p.length);
            }
        }
        let secs = t.elapsed().as_secs_f64();
        total_nodes += nodes;
        total_secs += secs;
        total_best += best as usize;
        println!(
            "{id:<26} {best:>7}  {:>11}  {nodes:>9}  {secs:>10.1}",
            goals.len()
        );
    }

    let n = measured.len().max(1);
    eprintln!("\n--- the reduction, measured ---");
    eprintln!(
        "cases {}, mean optimum {:.2}",
        measured.len(),
        total_best as f64 / n as f64
    );
    eprintln!(
        "mean {:.0} nodes and {:.1}s per case",
        total_nodes as f64 / n as f64,
        total_secs / n as f64
    );
    eprintln!(
        "extrapolated to all 57: {:.0} core-seconds ({:.1} core-hours)",
        total_secs / n as f64 * 57.0,
        total_secs / n as f64 * 57.0 / 3600.0
    );

    // The direct route's cost is not measured here because the goal-set search does not exist
    // yet — writing it is the decision this measurement informs. What CAN be stated is the ratio
    // the two routes differ by, from numbers both sides agree on.
    eprintln!("\n--- the direct route, as a bound ---");
    eprintln!("The reduction proves 288 states of optimal mean 13.15082 per case (Miller p.22).");
    eprintln!("A goal-set search proves ONE state per case, of optimal mean 9.2 (OLL's own).");
    eprintln!("IDA* grows ~13.3x per ply, so four plies shallower is ~13.3^3.9 = ~2.5e4 times");
    eprintln!("cheaper per proof, on top of doing 1/288 as many. The reduction's own numbers");
    eprintln!("above are what that ratio is applied to.");
}
