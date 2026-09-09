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
//! **A CHECK THAT CANNOT FAIL IS NOT A CHECK, and four of these could not.** Empty stdin, a
//! maneuver in notation we cannot read, a maneuver that does not leave the first two layers alone,
//! and a case no published algorithm reaches all exited 0 while printing something that looked
//! like a report. Every one of them means the comparison did not happen — a ruler with a piece
//! missing measures nothing — so every one of them is now a non-zero exit. So is a duplicate case
//! record, which the "no duplicates" clause above promises and nothing was asking.
//!
//! Nothing from the reference set is stored. What comes out is our numbers, their numbers, and
//! whether they agreed.

use optimal_solver::cases::{case_of, Kind};
use optimal_solver::cli::{self, Spec};
use optimal_solver::cubie::{inverse, Cubie, SOLVED};
use optimal_solver::notation::{apply_indices, normalize};
use optimal_solver::table_json::read_table;
use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};

const SPEC: Spec = Spec {
    usage: "usage: case-cross-check <oll|pll> <table.json>   (maneuvers on stdin)",
    value_options: &[],
    flags: &[],
    positionals: 2..=2,
};

/// What the published set said about one case.
struct Observed {
    /// The shortest HTM length any published maneuver for this case normalized to.
    best: usize,
    /// Every DISTINCT normalized maneuver, and how many entries produced it.
    ///
    /// Keeping only the minimum threw away the multiplicity the "no duplicates" clause is about:
    /// with every one of 21 PLL algorithms listed twice, the minimum was unchanged and the check
    /// passed. Alternatives for one case are ordinary — published sets list several — so what is
    /// refused is the same maneuver recorded twice, which is a corrupt record rather than a
    /// choice.
    algs: BTreeMap<Vec<u8>, usize>,
}

/// What reading the published set produced, including everything it could not read.
struct Reference {
    cases: BTreeMap<String, Observed>,
    accepted: usize,
    rotated: usize,
    refused: Vec<String>,
    not_a_case: Vec<String>,
}

/// Is this the kind of state the `kind`'s cases are about?
///
/// Both kinds need the first two layers left exactly as they were found: a maneuver that does not
/// is not an algorithm for a case we enumerate, whatever its length.
///
/// **PLL needs more, and leaving it out let a wrong answer through.** A PLL case is a PERMUTATION
/// of an ORIENTED last layer, and `pll_projection` reads only the permutation — so an OLL
/// algorithm lands on a PLL case id and is compared against its optimum. Sune (`R U R' U R U2 R'`)
/// preserves the first two layers, projects onto `pll:01230231`, and "refutes" that case's proved
/// 9 with 7 moves that leave the top twisted.
fn is_case_state(kind: Kind, s: &Cubie) -> bool {
    let first_two_layers = (4..8).all(|i| s.cp[i] == i as u8 && s.co[i] == 0)
        && (4..12).all(|i| s.ep[i] == i as u8 && s.eo[i] == 0);
    match kind {
        Kind::Oll => first_two_layers,
        Kind::Pll => {
            first_two_layers
                && s.co[0..4].iter().all(|&c| c == 0)
                && s.eo[0..4].iter().all(|&e| e == 0)
        }
    }
}

/// Read the published set from stdin, one maneuver per line.
fn read_reference(kind: Kind, input: impl BufRead) -> Reference {
    let mut out = Reference {
        cases: BTreeMap::new(),
        accepted: 0,
        rotated: 0,
        refused: Vec::new(),
        not_a_case: Vec::new(),
    };
    for line in input.lines() {
        let line = line.expect("stdin is readable");
        let alg = line.trim();
        if alg.is_empty() {
            continue;
        }
        let n = match normalize(alg) {
            Ok(n) => n,
            Err(e) => {
                out.refused.push(e);
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
        // when nothing checks for one.
        //
        // `n.rotation` is the NET rotation, so this counts the maneuvers that really do end the
        // cube turned. It used to be the list of rotation TOKENS, which counted `x x'` as rotated
        // and put the figure at 102 of 192.
        let state = apply_indices(&n.moves);
        if !n.rotation.is_empty() {
            out.rotated += 1;
        }
        let start = inverse(&state);
        if !is_case_state(kind, &start) {
            out.not_a_case.push(alg.to_string());
            continue;
        }
        let case = case_of(kind, &start).id();
        out.accepted += 1;
        let seen = out.cases.entry(case).or_insert(Observed {
            best: n.htm,
            algs: BTreeMap::new(),
        });
        seen.best = seen.best.min(n.htm);
        *seen.algs.entry(n.moves.clone()).or_insert(0) += 1;
    }
    out
}

/// One line of the report.
struct Verdict {
    case: String,
    ours: u8,
    theirs: Option<usize>,
    text: &'static str,
}

/// Everything the comparison concluded, so the exit policy is one decision made in one place.
struct Comparison {
    verdicts: Vec<Verdict>,
    refutations: usize,
    matched: usize,
    longer: usize,
    /// Cases we enumerate that no published maneuver reached.
    missing: Vec<String>,
    /// Cases published maneuvers reached that we do not enumerate.
    unknown: Vec<String>,
    /// `(case, algorithm)` pairs recorded more than once.
    duplicates: Vec<(String, String)>,
}

fn compare(ours: &BTreeMap<String, u8>, skip: &str, theirs: &Reference) -> Comparison {
    let mut out = Comparison {
        verdicts: Vec::new(),
        refutations: 0,
        matched: 0,
        longer: 0,
        missing: Vec::new(),
        unknown: Vec::new(),
        duplicates: Vec::new(),
    };
    for (case, &mine) in ours {
        // The skip has no algorithm and no published entry — comparing it would compare nothing.
        // Identified by its CASE ID rather than by `length == 0`: reading any zero-length entry as
        // the skip meant a case whose length had been edited to 0 silently left the comparison.
        if case == skip {
            continue;
        }
        let Some(seen) = theirs.cases.get(case) else {
            out.missing.push(case.clone());
            out.verdicts.push(Verdict {
                case: case.clone(),
                ours: mine,
                theirs: None,
                text: "no published algorithm reaches this case",
            });
            continue;
        };
        out.matched += 1;
        let best = seen.best;
        let text = if best < mine as usize {
            out.refutations += 1;
            "REFUTES our optimum"
        } else if best == mine as usize {
            "equal"
        } else {
            out.longer += 1;
            "published is longer — proves nothing"
        };
        out.verdicts.push(Verdict {
            case: case.clone(),
            ours: mine,
            theirs: Some(best),
            text,
        });
    }
    for (case, seen) in &theirs.cases {
        if !ours.contains_key(case) {
            out.unknown.push(case.clone());
        }
        for (alg, count) in &seen.algs {
            if *count > 1 {
                out.duplicates
                    .push((case.clone(), optimal_solver::search::solution_string(alg)));
            }
        }
    }
    out
}

/// The per-case table, on stdout — our number, theirs, and the verdict.
fn print_table(result: &Comparison) -> io::Result<()> {
    let mut out = io::BufWriter::new(io::stdout().lock());
    writeln!(out, "case                    ours  published  verdict")?;
    for v in &result.verdicts {
        match v.theirs {
            Some(best) => writeln!(out, "{:<22} {:>5}  {best:>9}  {}", v.case, v.ours, v.text),
            None => writeln!(out, "{:<22} {:>5}          -  {}", v.case, v.ours, v.text),
        }?;
    }
    out.flush()
}

/// What was read, what could not be, and what the structure check found — on stderr, so a pipeline
/// takes the table and a person reads the account of it.
fn print_account(ours: &BTreeMap<String, u8>, theirs: &Reference, result: &Comparison) {
    eprintln!(
        "\nread {} maneuvers ({} ended the cube rotated), refused {}, not a case {}",
        theirs.accepted,
        theirs.rotated,
        theirs.refused.len(),
        theirs.not_a_case.len()
    );
    for r in theirs.refused.iter().take(6) {
        eprintln!("  refused: {r}");
    }
    for r in theirs.not_a_case.iter().take(6) {
        eprintln!("  not a case: {r}");
    }
    eprintln!(
        "\ncase-set structure: ours {} (incl. the skip), theirs {}, matched {}",
        ours.len(),
        theirs.cases.len(),
        result.matched
    );
    if !result.unknown.is_empty() {
        eprintln!(
            "published algorithms reached {} cases we do not enumerate: {:?}",
            result.unknown.len(),
            result.unknown
        );
    }
    if !result.missing.is_empty() {
        eprintln!(
            "{} of our cases no published algorithm reaches: {:?}",
            result.missing.len(),
            result.missing
        );
    }
    for (case, alg) in &result.duplicates {
        eprintln!("duplicate record: {case} carries `{alg}` more than once");
    }
    eprintln!(
        "equal {}, published longer {}, REFUTATIONS {}",
        result.matched - result.longer - result.refutations,
        result.longer,
        result.refutations
    );
}

/// Every reason this comparison did not happen, or did not conclude what it claims to.
///
/// ONE list, built in one place, so the exit is one decision. A refutation blocks the ship (§7,
/// Layer 4): a published maneuver shorter than our proved optimum means one of the two is wrong,
/// and it is not a thing to print and exit 0 over. Neither is a set half of which we could not
/// read — every entry here used to exit 0.
fn blockers(theirs: &Reference, result: &Comparison) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if theirs.accepted == 0 {
        out.push("no maneuvers were read at all — stdin held none this program could use".into());
    }
    if !theirs.refused.is_empty() {
        out.push(format!(
            "{} maneuvers were in notation this program cannot read",
            theirs.refused.len()
        ));
    }
    if !theirs.not_a_case.is_empty() {
        out.push(format!(
            "{} maneuvers do not leave the first two layers as they found them",
            theirs.not_a_case.len()
        ));
    }
    if !result.missing.is_empty() {
        out.push(format!(
            "{} of our cases were never reached, so the comparison covers less than the set",
            result.missing.len()
        ));
    }
    if !result.unknown.is_empty() {
        out.push(format!(
            "{} reached cases we do not enumerate",
            result.unknown.len()
        ));
    }
    if !result.duplicates.is_empty() {
        out.push(format!(
            "{} case records are duplicates of one another",
            result.duplicates.len()
        ));
    }
    if result.refutations > 0 {
        out.push(format!(
            "{} of our optima are REFUTED by a shorter published maneuver",
            result.refutations
        ));
    }
    out
}

fn main() {
    let args = cli::parse_or_exit(&SPEC);
    let kind_arg = cli::or_exit(&SPEC, args.positional_one_of(0, "kind", &["oll", "pll"]));
    let kind = if kind_arg == "oll" { Kind::Oll } else { Kind::Pll };
    let path = args.positional(1).to_string();

    // Our table, through the crate's strict reader: a truncated file, a fractional length and a
    // duplicated case id are all refusals rather than a smaller table that looks fine.
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        cli::fail(&SPEC, &format!("cannot read {path}: {e}"));
    });
    let table = read_table(&text, kind.as_str())
        .unwrap_or_else(|e| cli::fail(&SPEC, &format!("{path}: {e}")));
    let ours: BTreeMap<String, u8> = table.lengths().map(|(c, l)| (c.to_string(), l)).collect();
    let skip = case_of(kind, &SOLVED).id();

    let theirs = read_reference(kind, io::stdin().lock());
    let result = compare(&ours, &skip, &theirs);

    print_table(&result).expect("stdout");
    print_account(&ours, &theirs, &result);

    let blocked = blockers(&theirs, &result);
    if !blocked.is_empty() {
        eprintln!("\nthis comparison did not pass:");
        for b in &blocked {
            eprintln!("  - {b}");
        }
        std::process::exit(1);
    }
    eprintln!("\nthe published set and our table agree, and the set covered every case.");
}
