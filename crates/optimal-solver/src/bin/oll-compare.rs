//! Our OLL per-case optima against the published ones — Layer 4's OLL half.
//!
//! Plan C4 (dev-docs/method-solver-return-plan.md §7). The PLL comparison
//! (`bin/pll-histogram.rs`) is exact and per state, because a complete 288-state distribution is
//! published. **OLL's ruler is uneven and this binary must not pretend otherwise** — §7's own
//! instruction, which the research note states twice:
//!
//! 1. The published per-case optima cover **56 of the 57 cases. OLL 32 carries no published
//!    optimum.** Any test built on this table must assert 56 and say so.
//! 2. They are **per case (best AUF)**, and no 216-state histogram appears to be published. So the
//!    per-STATE OLL maximum is a result we report, never a number we check against.
//!
//! **Compared by HISTOGRAM, not case by case.** The published table is indexed by the community's
//! OLL numbers (1..57) and ours by a canonical orientation key; mapping between them is a piece of
//! work with its own failure modes, and getting it wrong would produce disagreements that are
//! about the mapping rather than about the tables. The multiset of optima needs no mapping.
//!
//! **What that can and cannot conclude, stated once and not overstated anywhere else.** The
//! comparison is ONE-SIDED and AGGREGATE:
//!
//! - one-sided, because being shorter somewhere is not a failure. Our optima are proved
//!   exhaustively over every alignment and every goal, and every entry is APPLIED and checked
//!   before it is written; the published table is community maintained and the research note rates
//!   it "Medium-high ... demonstrably incomplete". A proof beating a wiki entry by a move is the
//!   expected direction. What would be alarming is the other one — us LONGER, meaning a short
//!   solution the search missed — and that is what this exits non-zero on;
//! - aggregate, because a multiset says nothing about WHICH case is which. Swapping two of our
//!   lengths leaves the histogram identical while making one case worse, and this program cannot
//!   see it. `case-cross-check` is the per-case check, and it is the one §7 calls the strongest of
//!   the three. Nothing here claims more than "no case of ours is longer than SOME published
//!   entry it can be paired with".
//!
//!   cargo run --release -p optimal-solver --bin oll-compare -- oll.json
//!
//! This is integers, so there is no licence exposure at all (§7): the counts below are the whole
//! of what is taken from outside, and they are here rather than in a scratch file because they ARE
//! the assertion — a ruler kept where the check cannot see it is not a ruler.

use optimal_solver::cli::{self, Spec};
use optimal_solver::table_json::read_table;
use std::collections::BTreeMap;

const SPEC: Spec = Spec {
    usage: "usage: oll-compare <oll.json>",
    value_options: &[],
    flags: &[],
    positionals: 1..=1,
};

/// `research/last-layer-published-results.md` §3: how many of the 56 published cases sit at each
/// optimum. Derived from that note's per-case listing, which names the case numbers.
const PUBLISHED: [(u8, usize); 7] = [
    (6, 3),   // 43, 44, 45
    (7, 6),   // 5, 6, 7, 8, 26, 27
    (8, 5),   // 24, 25, 33, 37, 46
    (9, 9),   // 22, 23, 28, 31, 35, 39, 40, 49, 50
    (10, 19), // 9, 10, 13, 14, 15, 16, 29, 30, 34, 36, 38, 41, 42, 47, 48, 51, 52, 53, 54
    (11, 13), // 1, 2, 3, 4, 11, 12, 17, 18, 19, 21, 55, 56, 57
    (12, 1),  // 20
];

/// What pairing our 57 optima against the published 56 concluded.
struct Comparison {
    /// The one of ours left out to make the two lists the same length.
    dropped: u8,
    /// Our remaining 56, in ascending order — the entries the verdict is actually about.
    kept: Vec<u8>,
    /// How many of those 56 are strictly shorter than the published entry beside them.
    shorter: usize,
}

/// Pair our sorted optima against the published sorted optima, one of ours dropped.
///
/// The two lists differ in size by exactly one (OLL 32 has no published optimum), so if SOME
/// choice of dropped entry leaves every one of our remaining optima no longer than the published
/// one beside it, nothing we produced is worse than what is published.
///
/// `shorter` is counted over the KEPT pairing and nothing else. It used to be counted over all 57
/// of ours zipped against the 56 published values plus a fabricated `u8::MAX` on the end — so the
/// dropped entry was compared against a number no ruler contains, and the checked-in artifact
/// reported 5 shorter entries where the pairing that actually passed has 1.
fn compare(mine: &[u8], published: &[u8]) -> Option<Comparison> {
    for drop in 0..mine.len() {
        let kept: Vec<u8> = mine
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != drop)
            .map(|(_, d)| *d)
            .collect();
        if kept.iter().zip(published).all(|(a, b)| a <= b) {
            let shorter = kept.iter().zip(published).filter(|(a, b)| a < b).count();
            return Some(Comparison {
                dropped: mine[drop],
                kept,
                shorter,
            });
        }
    }
    None
}

/// The two histograms side by side, over every length either of them mentions.
///
/// The row range is the UNION of what was observed and what is published, not a hardcoded 0..=20:
/// a table with an entry above the hardcoded ceiling passed the comparison while its extra row
/// simply did not print.
fn render(ours: &BTreeMap<u8, usize>, published: &[(u8, usize)]) {
    println!("optimum  ours  published (56 of 57)");
    let mut lengths: Vec<u8> = ours.keys().copied().collect();
    lengths.extend(published.iter().map(|(d, _)| *d));
    lengths.sort_unstable();
    lengths.dedup();
    for d in lengths {
        let mine = ours.get(&d).copied().unwrap_or(0);
        let theirs = published
            .iter()
            .find(|(k, _)| *k == d)
            .map(|(_, n)| *n)
            .unwrap_or(0);
        let mark = if mine == theirs { "" } else { "   <--" };
        println!("{d:>7}  {mine:>4}  {theirs:>19}{mark}");
    }
}

fn main() {
    let args = cli::parse_or_exit(&SPEC);
    let path = args.positional(0).to_string();

    // The ruler validates itself before it is used as one: 56 cases, and OLL 32 missing is the
    // reason it is 56 and not 57.
    let published_total: usize = PUBLISHED.iter().map(|(_, n)| n).sum();
    assert_eq!(
        published_total, 56,
        "the published per-case table covers 56 of 57 — OLL 32 has no published optimum"
    );

    // Through the crate's strict reader. The hand-rolled `split("\"length\": ")` this used to do
    // accepted a truncated file, read `9.5` as `9`, and found nothing at all in compact JSON —
    // failing its own count assertion with a message about the wrong thing.
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| cli::fail(&SPEC, &format!("cannot read {path}: {e}")));
    let table =
        read_table(&text, "oll").unwrap_or_else(|e| cli::fail(&SPEC, &format!("{path}: {e}")));
    let mut ours: BTreeMap<u8, usize> = BTreeMap::new();
    for (_, length) in table.lengths() {
        *ours.entry(length).or_insert(0) += 1;
    }
    assert_eq!(
        table.rows.len(),
        58,
        "an OLL table is 57 cases and the skip, not {}",
        table.rows.len()
    );
    // The skip is not one of the 57 and has no published optimum to compare against.
    let skips = ours.remove(&0).unwrap_or(0);
    assert_eq!(skips, 1, "exactly one case is the skip");
    let solved: usize = ours.values().sum();
    assert_eq!(solved, 57);

    render(&ours, &PUBLISHED);
    println!(
        "\nour longest per-case optimum {} — a RESULT, not a check.",
        ours.keys().next_back().copied().unwrap_or(0)
    );
    // Said precisely, because it used to be said as "our maximum" with an explanation about the
    // per-STATE maximum. These are per-CASE optima, each already minimised over the four
    // alignments, so their maximum is the largest per-case optimum. The per-state maximum is a
    // different number over a different set (216 states, no alignment freedom), and no 216-state
    // OLL histogram appears to be published to check it against anyway.
    println!("It is the largest per-case optimum, not the per-state maximum: every entry here is");
    println!("already minimised over the four alignments, so no state's own distance appears.");

    // `BTreeMap::iter` already yields ascending keys, so this is built sorted — the
    // `sort_unstable()` that used to follow re-sorted a sorted list.
    let mine: Vec<u8> = ours
        .iter()
        .flat_map(|(d, n)| std::iter::repeat_n(*d, *n))
        .collect();
    let theirs: Vec<u8> = PUBLISHED
        .iter()
        .flat_map(|(d, n)| std::iter::repeat_n(*d, *n))
        .collect();
    assert_eq!(mine.len(), 57);
    assert_eq!(theirs.len(), 56);
    debug_assert!(mine.windows(2).all(|w| w[0] <= w[1]), "the histogram is ascending");

    match compare(&mine, &theirs) {
        Some(result) => {
            println!(
                "\nCONSISTENT (aggregate, one-sided): leaving out one case at optimum {} pairs our",
                result.dropped
            );
            println!(
                "remaining {} optima against the published 56 with none of ours longer.",
                result.kept.len()
            );
            println!(
                "{} of those pairs have ours strictly shorter, which is the direction a proof beats",
                result.shorter
            );
            println!("a community table in.");
            // NOT "that is OLL 32". The pairing is over a multiset with no case identity in it,
            // so which of our cases was left out is not something this program knows — it knows
            // only the LENGTH of the one it dropped. Naming it was an inference the comparison
            // does not support, and `case-cross-check` is where per-case identity is established.
            println!(
                "\nWhich case was left out is not established here: this is a multiset comparison,"
            );
            println!("so it identifies a length and never a case. Use case-cross-check for that.");
        }
        None => {
            eprintln!(
                "\nour per-case optima are LONGER than the published ones somewhere — the search missed a\nshort solution, which is the direction that would be a defect in us rather than in the ruler"
            );
            std::process::exit(1);
        }
    }
}
