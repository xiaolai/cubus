//! Read maneuvers on stdin, one per line; print what each one is in face turns, and what it costs.
//!
//! Plan B5's usable end (dev-docs/method-solver-return-plan.md §9). §7a finding F5 says the
//! reference gate cannot consume its own inputs: `optimal.js` refuses `M2'` and published sets are
//! full of it. `notation::normalize` is the answer; this is how it is pointed at a set held in a
//! scratch path outside the repository, without any part of that set entering the tree.
//!
//!   node scripts/fetch-reference-sets.mjs cubing-algs
//!   grep -o '"alg" *: *"[^"]*"' "$SCRATCH"/data/pll.js | sed 's/.*: *"//;s/"$//' \
//!     | cargo run --release -p optimal-solver --bin normalize-alg
//!
//! Output is one line per input: `OK <htm> <face turns> [rot=…]`, or `REFUSED <reason>`. The
//! refusals are the point as much as the successes — a set with tokens we cannot read must report
//! how many, not quietly compare the rest as if it were the whole.
//!
//! Nothing is written anywhere. What may enter `dev-docs/` is the SUMMARY: how many maneuvers were
//! read, what lengths they came to, and how many were refused and why.
//!
//! **Measured 2026-09-09** against `Logiqx/cubing-algs` at `24e0b9c5`: **270 of 276** OLL and PLL
//! maneuvers normalize; HTM mean 12.037, range 6..21. The six refusals are two footnote markers
//! and four uses of CONJUGATE BRACKETS (`[z': …]`), which are a notation feature this module does
//! not implement — a real limitation, named rather than hidden, and the reason Layer 4's report
//! must state its coverage the way §7 makes the OLL comparison state "56 of 57".

use optimal_solver::notation::normalize;
use std::collections::BTreeMap;
use std::io::{self, Write};

/// The lengths seen, and the extremes — as a map rather than a fixed array.
///
/// A `[usize; 33]` silently dropped anything at 33 or more: a 34-turn input was counted in the
/// mean and vanished from the histogram, so the summary read "mean 34, min 0, max 0". A published
/// set's longest maneuver is not a number this program gets to assume, and the one thing it must
/// not do is report a coverage figure it did not cover.
#[derive(Default)]
struct Lengths {
    counts: BTreeMap<usize, usize>,
    total: usize,
}

impl Lengths {
    fn add(&mut self, htm: usize) {
        *self.counts.entry(htm).or_insert(0) += 1;
        self.total += htm;
    }
    fn accepted(&self) -> usize {
        self.counts.values().sum()
    }
    fn min(&self) -> Option<usize> {
        self.counts.keys().next().copied()
    }
    fn max(&self) -> Option<usize> {
        self.counts.keys().next_back().copied()
    }
}

/// Write a line, and treat a failed write as the failure it is.
///
/// The output used to go through a `BufWriter` that was never flushed explicitly, so the flush
/// happened in `Drop` where its error is discarded by construction. Piping this into a closed
/// `head` therefore printed a confident summary — "read 270, refused 6" — and exited 0 having
/// lost most of what it claimed to have written.
fn emit(out: &mut impl Write, line: &str) {
    if let Err(e) = writeln!(out, "{line}") {
        eprintln!("cannot write output: {e}");
        std::process::exit(1);
    }
}

fn main() {
    let stdin = io::BufRead::lines(io::stdin().lock());
    let mut out = io::BufWriter::new(io::stdout().lock());
    let mut lengths = Lengths::default();
    let mut refused = 0usize;
    for line in stdin {
        let line = line.expect("stdin is readable");
        let alg = line.trim();
        if alg.is_empty() {
            continue;
        }
        match normalize(alg) {
            Ok(n) => {
                lengths.add(n.htm);
                let rot = if n.rotation.is_empty() {
                    String::new()
                } else {
                    format!(" rot={:?}", n.rotation)
                };
                emit(&mut out, &format!("OK {} {}{}", n.htm, n.to_alg(), rot));
            }
            Err(e) => {
                refused += 1;
                emit(&mut out, &format!("REFUSED {e}"));
            }
        }
    }
    if let Err(e) = out.flush() {
        eprintln!("cannot write output: {e}");
        std::process::exit(1);
    }

    // The summary goes to stderr, so a pipeline can take the per-line output and a person still
    // sees the counts. A refusal count of zero is a claim in its own right and is printed either
    // way — a silent run that read nothing looks exactly like one that read everything.
    //
    // The DENOMINATOR is named, because the old wording hid it: "read 1, refused 1" for two inputs
    // used "read" to mean the accepted ones, so the coverage figure a Layer 4 report has to state
    // ("270 of 276") had to be reconstructed by adding two numbers whose relationship was not
    // said.
    let accepted = lengths.accepted();
    eprintln!(
        "\n{} maneuvers in: {accepted} normalized, {refused} refused",
        accepted + refused
    );
    if accepted > 0 {
        eprintln!(
            "htm mean {:.3}, min {}, max {}",
            lengths.total as f64 / accepted as f64,
            lengths.min().expect("accepted is non-zero"),
            lengths.max().expect("accepted is non-zero"),
        );
        eprint!("histogram");
        for (len, n) in &lengths.counts {
            eprint!(" {len}:{n}");
        }
        eprintln!();
    }
}
