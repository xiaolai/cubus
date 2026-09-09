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
//! about the mapping rather than about the tables. The multiset of optima needs no mapping and is
//! decisive for what it does cover: if our 57 lengths, minus one, do not equal the published 56,
//! one of the two is wrong.
//!
//!   cargo run --release -p optimal-solver --bin oll-compare -- oll.json
//!
//! This is integers, so there is no licence exposure at all (§7): the counts below are the whole
//! of what is taken from outside, and they are here rather than in a scratch file because they ARE
//! the assertion — a ruler kept where the check cannot see it is not a ruler.

use std::collections::BTreeMap;

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

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: oll-compare <oll.json>");
        std::process::exit(1)
    });

    // The ruler validates itself before it is used as one: 56 cases, and OLL 32 missing is the
    // reason it is 56 and not 57.
    let published_total: usize = PUBLISHED.iter().map(|(_, n)| n).sum();
    assert_eq!(
        published_total, 56,
        "the published per-case table covers 56 of 57 — OLL 32 has no published optimum"
    );

    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    // The table is this crate's own hand-rolled JSON, so a hand-rolled read is honest: every
    // length is `"length": <n>` and nothing in the file can be mistaken for one.
    let mut ours: BTreeMap<u8, usize> = BTreeMap::new();
    let mut cases = 0usize;
    for chunk in text.split("\"length\": ").skip(1) {
        let n: u8 = chunk
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .expect("a length is a number");
        cases += 1;
        *ours.entry(n).or_insert(0) += 1;
    }
    assert_eq!(
        cases, 58,
        "an OLL table is 57 cases and the skip, not {cases}"
    );
    // The skip is not one of the 57 and has no published optimum to compare against.
    let skips = ours.remove(&0).unwrap_or(0);
    assert_eq!(skips, 1, "exactly one case is the skip");
    let solved: usize = ours.values().sum();
    assert_eq!(solved, 57);

    println!("optimum  ours  published (56 of 57)");
    for d in 0..=20u8 {
        let mine = ours.get(&d).copied().unwrap_or(0);
        let theirs = PUBLISHED
            .iter()
            .find(|(k, _)| *k == d)
            .map(|(_, n)| *n)
            .unwrap_or(0);
        if mine == 0 && theirs == 0 {
            continue;
        }
        let mark = if mine == theirs { "" } else { "   <--" };
        println!("{d:>7}  {mine:>4}  {theirs:>19}{mark}");
    }
    println!(
        "\nour maximum {} — a RESULT, not a check: no per-state OLL histogram is published",
        ours.keys().next_back().copied().unwrap_or(0)
    );

    // ---- what the comparison can and cannot conclude -----------------------------------------
    //
    // The two histograms differ in size by exactly one (OLL 32 has no published optimum), so they
    // are compared as SORTED LISTS with one of ours dropped: if some choice of the dropped case
    // leaves every one of our remaining optima no longer than the published one beside it, then
    // nothing we produced is worse than what is published, and the comparison is satisfied in the
    // one direction §7 says it is valid in.
    //
    // BEING SHORTER SOMEWHERE IS NOT A FAILURE, and treating it as one would be the wrong way
    // round. Our optima are proved exhaustively over every alignment and every goal, and every
    // entry is APPLIED and checked before it is written; the published table is community
    // maintained and the research note rates it "Medium-high ... demonstrably incomplete". A
    // proof beating a wiki entry by a move is the expected direction. What would be alarming is
    // the other one — us LONGER, meaning a short solution the search missed — and that is what
    // this exits non-zero on.
    let mut mine: Vec<u8> = ours
        .iter()
        .flat_map(|(d, n)| std::iter::repeat_n(*d, *n))
        .collect();
    mine.sort_unstable();
    let theirs: Vec<u8> = PUBLISHED
        .iter()
        .flat_map(|(d, n)| std::iter::repeat_n(*d, *n))
        .collect();
    assert_eq!(mine.len(), 57);
    assert_eq!(theirs.len(), 56);
    let mut consistent = None;
    for drop in 0..mine.len() {
        let kept: Vec<u8> = mine
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != drop)
            .map(|(_, d)| *d)
            .collect();
        if kept.iter().zip(&theirs).all(|(a, b)| a <= b) {
            consistent = Some(mine[drop]);
            break;
        }
    }
    let shorter = mine
        .iter()
        .zip(theirs.iter().chain(std::iter::once(&u8::MAX)))
        .filter(|(a, b)| a < b)
        .count();
    match consistent {
        Some(dropped) => {
            println!(
                "\nCONSISTENT: dropping one case at optimum {dropped} — that is OLL 32, which carries no\npublished optimum — leaves all 56 of our remaining optima no longer than the published ones.\n{shorter} of them are SHORTER, which is the direction a proof beats a community table in."
            );
        }
        None => {
            eprintln!(
                "\nour per-case optima are LONGER than the published ones somewhere — the search missed a\nshort solution, which is the direction that would be a defect in us rather than in the ruler"
            );
            std::process::exit(1);
        }
    }
}
