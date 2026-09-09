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
use std::io::{self, Write};

fn main() {
    let stdin = io::BufRead::lines(io::stdin().lock());
    let mut out = io::BufWriter::new(io::stdout().lock());
    let mut read = 0usize;
    let mut refused = 0usize;
    let mut total_htm = 0usize;
    let mut histogram = [0usize; 33];
    for line in stdin {
        let line = line.expect("stdin is readable");
        let alg = line.trim();
        if alg.is_empty() {
            continue;
        }
        match normalize(alg) {
            Ok(n) => {
                read += 1;
                total_htm += n.htm;
                if n.htm < histogram.len() {
                    histogram[n.htm] += 1;
                }
                let rot = if n.rotation.is_empty() {
                    String::new()
                } else {
                    format!(" rot={:?}", n.rotation)
                };
                writeln!(out, "OK {} {}{}", n.htm, n.to_alg(), rot).expect("stdout");
            }
            Err(e) => {
                refused += 1;
                writeln!(out, "REFUSED {e}").expect("stdout");
            }
        }
    }
    // The summary goes to stderr, so a pipeline can take the per-line output and a person still
    // sees the counts. A refusal count of zero is a claim in its own right and is printed either
    // way — a silent run that read nothing looks exactly like one that read everything.
    eprintln!("\nread {read}, refused {refused}");
    if read > 0 {
        eprintln!(
            "htm mean {:.3}, min {}, max {}",
            total_htm as f64 / read as f64,
            histogram.iter().position(|&n| n > 0).unwrap_or(0),
            histogram.iter().rposition(|&n| n > 0).unwrap_or(0),
        );
        eprint!("histogram");
        for (len, n) in histogram.iter().enumerate() {
            if *n > 0 {
                eprint!(" {len}:{n}");
            }
        }
        eprintln!();
    }
}
