//! Feed published algorithms through our own case machinery — §7's strongest Layer 4 check.
//!
//! Plan C4. `oll-compare` compares two histograms and can only say THAT they differ; this says
//! WHERE, and it is the check §7 calls the strongest of the three:
//!
//! > **Published algorithms solve our cases**: feed each published alg through Layer 1's
//! > validator. If a published T-perm does not solve what we call the T-perm case, one of us has
//! > the case wrong.
//!
//! Plus the two that go with it:
//!
//! - **Case-set structure** — the published set must cover exactly the cases we enumerate, no
//!   duplicates, none missing. Structural, and independent of any algorithm choice.
//! - **Our optimum ≤ every published algorithm's HTM length** for that case. ONE-DIRECTIONAL and
//!   valid in exactly one direction (§7): a published 10-HTM maneuver refutes a claimed 11-move
//!   optimum; a longer one proves nothing, because published sets are chosen for finger tricks.
//!
//! ```text
//! node scripts/fetch-reference-sets.mjs cubing-algs
//! grep -o '"alg" *: *"[^"]*"' "$SCRATCH"/data/oll.js | sed 's/.*: *"//;s/"$//' |
//!   cargo run --release -p optimal-solver --bin case-cross-check -- oll /tmp/cases/oll.json
//! ```
//!
//! **Which case an algorithm solves is derived, not matched by name.** If `A` solves case `C` then
//! `C·A = g` for some goal, so `C = g·A⁻¹` — and since every goal is oriented, the ORIENTATION
//! projection of `g·A⁻¹` is `A⁻¹`'s own, whatever `g` is. So the case is `case_of(inverse(A))`,
//! with no name mapping anywhere: the community's OLL numbers never enter this program, which is
//! what keeps a disagreement about numbering from looking like a disagreement about cubes.
//!
//! Nothing from the reference set is stored. What comes out is our numbers, their numbers, and
//! whether they agreed.

use optimal_solver::cases::{case_of, Kind};
use optimal_solver::cubie::{inverse, Cubie};
use optimal_solver::notation::{apply_indices, normalize};
use std::collections::BTreeMap;
use std::io::{self, Write};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (kind, path) = match args.as_slice() {
        [k, p] => (
            match k.as_str() {
                "oll" => Kind::Oll,
                "pll" => Kind::Pll,
                _ => usage(),
            },
            p.clone(),
        ),
        _ => usage(),
    };

    // Our table, read from its own hand-rolled JSON — every field is a quoted string or a number.
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let mut ours: BTreeMap<String, u8> = BTreeMap::new();
    for chunk in text.split("{ \"case\": \"").skip(1) {
        let case = chunk
            .split('"')
            .next()
            .expect("a quoted case id")
            .to_string();
        let len_chunk = chunk
            .split("\"length\": ")
            .nth(1)
            .expect("every entry has a length");
        let length: u8 = len_chunk
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .expect("a length is a number");
        ours.insert(case, length);
    }
    assert!(!ours.is_empty(), "{path} holds no cases");

    // The published set, one maneuver per line on stdin.
    let mut theirs: BTreeMap<String, usize> = BTreeMap::new();
    let mut read = 0usize;
    let mut refused: Vec<String> = Vec::new();
    let mut rotated = 0usize;
    let mut wrong_frame = 0usize;
    for line in io::stdin().lines() {
        let line = line.expect("stdin is readable");
        let alg = line.trim();
        if alg.is_empty() {
            continue;
        }
        let n = match normalize(alg) {
            Ok(n) => n,
            Err(e) => {
                refused.push(e);
                continue;
            }
        };
        // The FACE TURNS, without the net rotation — and that is the whole subtlety.
        //
        // "A solves case C" means C·moves·R = g·R for some goal g and the maneuver's net rotation
        // R, because a cube that is solved is solved however you are holding it. Cancel R and the
        // condition is C·moves = g: the rotation is where the learner's hands end up, not part of
        // what the maneuver did. Including it filed 15 maneuvers under keys with an ODD number of
        // flipped edges — patterns no cube can be in — which is what a frame error looks like
        // when nothing checks for one. More than half of this set (102 of 192) ends rotated, so
        // getting this backwards discards most of the ruler.
        let state = apply_indices(&n.moves);
        if !n.rotation.is_empty() {
            rotated += 1;
        }
        // The guard that would have caught it: a maneuver whose length is to be compared with
        // ours has to be about our cube first. Anything that does not leave the first two layers
        // exactly as it found them is not an algorithm for a case we enumerate.
        let start = inverse(&state);
        if !preserves_first_two_layers(&start) {
            wrong_frame += 1;
            continue;
        }
        let case = case_of(kind, &start).id();
        read += 1;
        theirs
            .entry(case)
            .and_modify(|best| *best = (*best).min(n.htm))
            .or_insert(n.htm);
    }

    let mut out = io::BufWriter::new(io::stdout().lock());
    writeln!(out, "case                    ours  published  verdict").expect("stdout");
    let mut refutations = 0usize;
    let mut matched = 0usize;
    let mut longer = 0usize;
    for (case, &mine) in &ours {
        // The skip has no algorithm and no published entry — comparing it would compare nothing.
        if mine == 0 {
            continue;
        }
        let Some(&best) = theirs.get(case) else {
            writeln!(
                out,
                "{case:<22} {mine:>5}          -  no published algorithm reaches this case"
            )
            .expect("stdout");
            continue;
        };
        matched += 1;
        let verdict = if best < mine as usize {
            refutations += 1;
            "REFUTES our optimum"
        } else if best == mine as usize {
            "equal"
        } else {
            longer += 1;
            "published is longer — proves nothing"
        };
        writeln!(out, "{case:<22} {mine:>5}  {best:>9}  {verdict}").expect("stdout");
    }
    out.flush().expect("stdout");

    eprintln!(
        "\nread {read} maneuvers ({rotated} ended the cube rotated), refused {}, wrong frame {wrong_frame}",
        refused.len()
    );
    for r in refused.iter().take(6) {
        eprintln!("  {r}");
    }
    eprintln!(
        "\ncase-set structure: ours {} (incl. the skip), theirs {}, matched {matched}",
        ours.len(),
        theirs.len()
    );
    let unknown: Vec<&String> = theirs.keys().filter(|k| !ours.contains_key(*k)).collect();
    if !unknown.is_empty() {
        eprintln!(
            "published algorithms reached {} cases we do not enumerate: {unknown:?}",
            unknown.len()
        );
    }
    eprintln!(
        "equal {}, published longer {longer}, REFUTATIONS {refutations}",
        matched - longer - refutations
    );
    if refutations > 0 || !unknown.is_empty() {
        // A refutation blocks the ship (§7, Layer 4): a published maneuver shorter than our proved
        // optimum means one of the two is wrong, and it is not a thing to print and exit 0 over.
        std::process::exit(1);
    }
}

/// Does this state leave everything but the last layer exactly as it found it?
///
/// The condition every OLL and PLL case state satisfies by construction, and the one a published
/// maneuver has to satisfy before its length is comparable to ours.
fn preserves_first_two_layers(s: &Cubie) -> bool {
    (4..8).all(|i| s.cp[i] == i as u8 && s.co[i] == 0)
        && (4..12).all(|i| s.ep[i] == i as u8 && s.eo[i] == 0)
}

fn usage() -> ! {
    eprintln!("usage: case-cross-check <oll|pll> <table.json>   (maneuvers on stdin)");
    std::process::exit(1)
}
