//! The optimum of every one of the 288 PLL states, against the published histogram.
//!
//! Plan C4, Layer 4 (dev-docs/method-solver-return-plan.md §7), and it is **the strongest external
//! ruler this project has**. `research/last-layer-published-results.md` §2 records the complete
//! optimum distribution over all 288 distinct PLL states, computed with **Cube Explorer** —
//! Kociemba's implementation, wholly independent of anything here — and double-sourced against
//! Miller's academic figure to five decimal places. The note's own instruction: *our generated
//! table must reproduce that histogram bucket for bucket.*
//!
//!   cargo run --release -p optimal-solver --bin pll-histogram
//!
//! **This is integers, so there is no licence exposure at all** (§7): a histogram is not a work,
//! and comparing counts is not copying a set. The eight numbers below are the whole of what is
//! taken from outside, and they are here rather than in a scratch file because they are the
//! assertion — a ruler kept somewhere the test cannot see is not a ruler.
//!
//! **Per STATE, not per case.** The published data solves each of the 288 states to SOLVED, with
//! no alignment freedom — which is why three states come out at 1 (they are U, U' and U2). A
//! per-case figure is a different quantity and would not match; the note flags exactly that
//! confusion as the source of the widely-cited "14".
//!
//! The mean is `3353/288 = 11.6423611…`, and the note's five-decimal double-sourcing is a fact
//! about the SOURCE rather than something this binary can re-derive: the two integers below are
//! all it has, and they determine the quotient exactly.

use optimal_solver::cases::pll_states;
use optimal_solver::coords::Coords;
use optimal_solver::cubie::{apply_alg, Cubie, SOLVED};
use optimal_solver::search::{prove, solution_string};
use optimal_solver::Tables;
use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

/// The published distribution — `research/last-layer-published-results.md` §2, from cuBerBruce's
/// Cube Explorer computation. Sums to 288, and its weighted total is 3353.
const PUBLISHED: [(u8, usize); 9] = [
    (0, 1),
    (1, 3),
    (9, 18),
    (10, 82),
    (11, 16),
    (12, 40),
    (13, 84),
    (14, 40),
    (15, 4),
];

/// The ruler validates itself before it is used as one.
///
/// A transcription slip in the table above would otherwise be indistinguishable from a defect in
/// our prover — and the ruler is the thing with no second opinion behind it.
///
/// Two checks, not three. The count and the weighted total pin the table EXACTLY, and the mean is
/// `3353/288` by construction once they hold — so the third assertion that used to sit here,
/// comparing that quotient with 11.642 to within 0.001, could not fail after them. It read as a
/// check on the published five-decimal figure and was arithmetic on the two numbers above.
fn check_the_ruler() {
    let total: usize = PUBLISHED.iter().map(|(_, n)| n).sum();
    assert_eq!(total, 288, "the published histogram does not sum to 288");
    let weighted: usize = PUBLISHED.iter().map(|(d, n)| *d as usize * n).sum();
    assert_eq!(
        weighted, 3353,
        "the published histogram's weighted total is not 3353, so its mean is not 3353/288"
    );
}

/// What solving every state produced.
struct Distribution {
    counts: BTreeMap<u8, usize>,
    sum: usize,
}

/// Solve all 288 states, verifying each maneuver rather than counting its claimed length.
fn solve_every_state(tables: &Tables, states: &[Cubie], cancel: &AtomicBool) -> Distribution {
    let mut out = Distribution {
        counts: BTreeMap::new(),
        sum: 0,
    };
    let run = Instant::now();
    for (i, s) in states.iter().enumerate() {
        let t = Instant::now();
        let proof = prove(tables, &Coords::from_cubie(s), 20, cancel, &mut |_, _| {})
            .expect("God's number is 20");
        // The maneuver is applied and checked, every time. A histogram of lengths nobody verified
        // would agree with the published one for the wrong reason.
        let end = apply_alg(s, &solution_string(&proof.solution)).expect("our own notation");
        assert_eq!(end, SOLVED, "state {i}: the maneuver does not solve it");
        // And it is checked to be the length the histogram is about to count it as. Replaying the
        // maneuver proves it SOLVES; it says nothing about how many moves the proof claimed, so a
        // proof whose `length` disagreed with its own solution would have been counted in the
        // wrong bucket by a run that verified every one of its maneuvers.
        assert_eq!(
            proof.solution.len(),
            usize::from(proof.length),
            "state {i}: the proof claims {} moves and carries {}",
            proof.length,
            proof.solution.len()
        );
        *out.counts.entry(proof.length).or_insert(0) += 1;
        out.sum += usize::from(proof.length);
        if t.elapsed().as_secs_f64() > 5.0 || i % 32 == 0 {
            eprintln!(
                "{}/288: depth {} | {:.1}s | total {:.0}s",
                i + 1,
                proof.length,
                t.elapsed().as_secs_f64(),
                run.elapsed().as_secs_f64()
            );
        }
    }
    out
}

/// Print the two histograms side by side, and say whether they agree.
fn report(ours: &Distribution) -> bool {
    println!("optimum  ours  published");
    let mut lengths: Vec<u8> = ours.counts.keys().copied().collect();
    lengths.extend(PUBLISHED.iter().map(|(d, _)| *d));
    lengths.sort_unstable();
    lengths.dedup();
    let mut agree = true;
    for d in lengths {
        let mine = ours.counts.get(&d).copied().unwrap_or(0);
        let want = PUBLISHED
            .iter()
            .find(|(k, _)| *k == d)
            .map(|(_, n)| *n)
            .unwrap_or(0);
        if mine != want {
            agree = false;
        }
        let mark = if mine == want { "" } else { "   <-- DISAGREES" };
        println!("{d:>7}  {mine:>4}  {want:>9}{mark}");
    }
    println!(
        "\nour mean {:.6}, published {:.6}",
        ours.sum as f64 / 288.0,
        3353.0 / 288.0
    );
    agree
}

fn main() {
    check_the_ruler();

    eprintln!("generating tables…");
    let tables = Tables::generate(&mut |_, _, _| {}).expect("tables");
    let cancel = AtomicBool::new(false);
    let states = pll_states();
    assert_eq!(states.len(), 288);

    let run = Instant::now();
    let ours = solve_every_state(&tables, &states, &cancel);
    let agree = report(&ours);
    println!("computed in {:.0}s", run.elapsed().as_secs_f64());
    if agree {
        println!("\nAGREES bucket for bucket with the published 288-state distribution.");
    } else {
        // A disagreement here is a finding about one of the two, and it BLOCKS the ship (§7,
        // Layer 4). Printing it and exiting 0 would be the quiet default this repository refuses.
        eprintln!("\nthe generated distribution disagrees with the published one — one of the two is wrong");
        std::process::exit(1);
    }
}
