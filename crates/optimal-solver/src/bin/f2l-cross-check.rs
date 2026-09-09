//! Refute the F2L table by brute force: no heuristic, no pattern database, no pruning but the
//! canonical move order — just every maneuver of every length, counted.
//!
//! The table is produced by IDA* over an exact distance ball, and the failure mode of a guided
//! search is silent: a heuristic that is wrong high does not crash, it returns a length that is
//! not the minimum, and every check that consults the same heuristic agrees with it. So this
//! binary consults none of it — no ball, no pruning but the canonical move order — and shares with
//! the generator only the projection itself, which `the_projection_and_the_cube_step_together`
//! pins against the full cubie model independently.
//!
//! Three claims are checked per case, not two.
//!
//! 1. **The minimum is the minimum**: every canonical maneuver shorter than `L` is enumerated and
//!    none reaches the goal.
//! 2. **The minimal SET is complete**: the maneuvers of length exactly `L` that reach the goal are
//!    enumerated too, and compared element for element. A table that lost one would still pick a
//!    maneuver that works, so nothing else here would notice.
//! 3. **The COMMITTED TABLE says all of that**, which is the one this program used not to check.
//!    It compared brute force against a freshly generated `prove_all`, so the file in
//!    `tables/f2l.json` — the artifact the app ships and a learner memorises — took no part in its
//!    own refutation pass. A missing row, a stale length or a hand-edited maneuver could not
//!    affect the result. The table is now read, and its coverage, lengths, chosen maneuvers and
//!    minimal counts are all compared against what brute force found.
//!
//! Usage: f2l-cross-check [--only <case>] [--max-length N] [--table <f2l.json>]

use optimal_solver::cli::{self, Spec};
use optimal_solver::f2l::{all_cases, prove_all, F2lCase, F2lState, GoalBall, F2L_SOLVED};
use optimal_solver::search::solution_string;
use optimal_solver::table_json::{read_table, CaseTable};
use rayon::prelude::*;
use std::collections::BTreeSet;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Instant;

const SPEC: Spec = Spec {
    usage: "usage: f2l-cross-check [--only <case>] [--max-length N] [--table <f2l.json>]",
    value_options: &["--only", "--max-length", "--table"],
    flags: &[],
    positionals: 0..=0,
};

/// The committed table, the one this check is about when none is named.
const COMMITTED: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tables/f2l.json");

/// God's number bounds every length, so this is "no limit" written as a number rather than as
/// `u8::MAX`.
const NO_LIMIT: u8 = 20;

/// Same face twice never helps; of a commuting opposite-face pair, keep one order only. The same
/// rule `search.rs` applies, restated here rather than imported, because a cross-check that shares
/// its canonicalisation with what it checks cannot see a canonicalisation bug.
///
/// `prev` is a move index and not a sentinel: `exhaustive` handles the first move itself, so every
/// call has a real predecessor. The `prev < 0` branch that used to open this function could not be
/// reached from anywhere, and an unreachable branch is one nothing tests and every reader steps
/// over.
fn allowed(prev: usize, m: usize) -> bool {
    let face = m / 3;
    let pf = prev / 3;
    face != pf && (face % 3 != pf % 3 || face < pf)
}

/// Every canonical maneuver of exactly `depth` moves that takes `start` to the goal.
fn exhaustive(start: F2lState, depth: u8) -> Vec<Vec<u8>> {
    if depth == 0 {
        return if start == F2L_SOLVED {
            vec![Vec::new()]
        } else {
            Vec::new()
        };
    }
    let found: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());
    (0..18usize).into_par_iter().for_each(|m| {
        let mut path = vec![m as u8];
        let mut out = Vec::new();
        walk(start.step(m), 1, depth, m, &mut path, &mut out);
        if !out.is_empty() {
            found.lock().expect("the collector lock").extend(out);
        }
    });
    let mut out = found.into_inner().expect("the collector lock");
    out.sort_by(|a, b| optimal_solver::cases::tie_break(a, b));
    out
}

fn walk(s: F2lState, g: u8, depth: u8, prev: usize, path: &mut Vec<u8>, out: &mut Vec<Vec<u8>>) {
    if g == depth {
        if s == F2L_SOLVED {
            out.push(path.clone());
        }
        return;
    }
    for m in 0..18usize {
        if !allowed(prev, m) {
            continue;
        }
        path.push(m as u8);
        walk(s.step(m), g + 1, depth, m, path, out);
        path.pop();
    }
}

/// What checking one case concluded.
struct Outcome {
    name: String,
    length: u8,
    minimal: usize,
    /// Every disagreement found, so one case can report more than one and the run still says all
    /// of them.
    refutations: Vec<String>,
    elapsed: std::time::Duration,
}

/// Brute-force one case, and compare the result with the table's own row for it.
fn check_case(
    case: &F2lCase,
    ball: &GoalBall,
    table: &CaseTable,
    cancel: &AtomicBool,
) -> Outcome {
    let at = Instant::now();
    let claim = prove_all(ball, &case.state(), 14, cancel).expect("a proof");
    let mut refutations = Vec::new();

    // Everything shorter holds nothing. This is the minimality claim, and it is the expensive
    // half — the whole ball below the answer, with nothing pruning it.
    for d in 0..claim.length {
        let hits = exhaustive(case.state(), d);
        if !hits.is_empty() {
            refutations.push(format!(
                "claimed {} but {d} moves suffice — {}",
                claim.length,
                solution_string(&hits[0])
            ));
            break;
        }
    }
    if refutations.is_empty() {
        let all = exhaustive(case.state(), claim.length);
        if all != claim.solutions {
            refutations.push(format!(
                "the minimal set differs — brute force found {}, the search claims {}",
                all.len(),
                claim.solutions.len()
            ));
        }
    }

    // AND THE COMMITTED ROW. The two checks above compare brute force with a search run just now;
    // this compares both with the file.
    let id = case.id();
    match table.row(&id) {
        None => refutations.push(format!("the table has no row for {id}")),
        Some(row) => {
            if row.length != claim.length {
                refutations.push(format!(
                    "the table says {} moves, brute force says {}",
                    row.length, claim.length
                ));
            }
            let want = solution_string(&claim.solutions[0]);
            if row.alg != want {
                refutations.push(format!(
                    "the table carries `{}`, the tie-break chooses `{want}`",
                    row.alg
                ));
            }
            match row.integer("minimal") {
                Ok(n) if n as usize == claim.solutions.len() => {}
                Ok(n) => refutations.push(format!(
                    "the table counts {n} minimal maneuvers, brute force found {}",
                    claim.solutions.len()
                )),
                Err(e) => refutations.push(format!("the table's `minimal` column: {e}")),
            }
            match row.text("name") {
                Ok(n) if n == case.name => {}
                Ok(n) => refutations.push(format!("the table names this case `{n}`")),
                Err(e) => refutations.push(format!("the table's `name` column: {e}")),
            }
        }
    }

    Outcome {
        name: case.name.to_string(),
        length: claim.length,
        minimal: claim.solutions.len(),
        refutations,
        elapsed: at.elapsed(),
    }
}

fn main() {
    let args = cli::parse_or_exit(&SPEC);
    let cases = all_cases();
    // A `--only` that names nothing used to check nothing and exit 0 — a green run that did not
    // happen. The name is checked against the case set before any work starts.
    let only = args.value("--only").map(str::to_string);
    if let Some(name) = &only {
        if !cases.iter().any(|c| c.name == *name) {
            cli::fail(
                &SPEC,
                &format!("--only {name}: no such case (there are {} of them)", cases.len()),
            );
        }
    }
    // An unparseable `--max-length` used to become "no limit", so a run asked to stop at six moves
    // silently checked all nine.
    let max_length: u8 = cli::or_exit(&SPEC, args.parsed_in("--max-length", 0..=NO_LIMIT, NO_LIMIT));
    let table_path = args.value("--table").unwrap_or(COMMITTED).to_string();
    let text = std::fs::read_to_string(&table_path)
        .unwrap_or_else(|e| cli::fail(&SPEC, &format!("cannot read {table_path}: {e}")));
    let table = read_table(&text, "f2l")
        .unwrap_or_else(|e| cli::fail(&SPEC, &format!("{table_path}: {e}")));

    let ball = GoalBall::build();
    ball.validate()
        .expect("the goal ball must be a distance function");
    let cancel = AtomicBool::new(false);

    let mut outcomes: Vec<Outcome> = Vec::new();
    let mut skipped = 0usize;
    for case in &cases {
        if only.as_deref().is_some_and(|n| n != case.name) {
            continue;
        }
        // The cheap length check first, so `--max-length` skips the expensive pass rather than
        // running it and discarding the answer.
        let claim = prove_all(&ball, &case.state(), 14, &cancel).expect("a proof");
        if claim.length > max_length {
            eprintln!(
                "{:10}  len {:2}  SKIPPED (over --max-length {max_length})",
                case.name, claim.length
            );
            skipped += 1;
            continue;
        }
        let out = check_case(case, &ball, &table, &cancel);
        println!(
            "{:10}  len {:2}  {:5} minimal  {}  {:>8.2?}",
            out.name,
            out.length,
            out.minimal,
            if out.refutations.is_empty() {
                "confirmed"
            } else {
                "REFUTED"
            },
            out.elapsed
        );
        for r in &out.refutations {
            eprintln!("REFUTED {}: {r}", out.name);
        }
        outcomes.push(out);
    }

    // Coverage, both ways — a table row for a case that does not exist is as much a defect as a
    // case with no row, and neither shows up case by case.
    let mut extra: Vec<&str> = Vec::new();
    if only.is_none() && skipped == 0 {
        let expected: BTreeSet<String> = cases.iter().map(F2lCase::id).collect();
        extra = table
            .rows
            .iter()
            .map(|r| r.case.as_str())
            .filter(|id| !expected.contains(*id))
            .collect();
        for id in &extra {
            eprintln!("REFUTED: {table_path} has a row for {id}, which is not a case");
        }
    }

    let refuted = outcomes.iter().filter(|o| !o.refutations.is_empty()).count();
    eprintln!(
        "{} cases checked against {table_path}, {skipped} skipped, {refuted} refuted",
        outcomes.len()
    );
    if refuted > 0 || !extra.is_empty() {
        std::process::exit(1);
    }
    if outcomes.is_empty() {
        eprintln!("no case was checked — that is not a pass");
        std::process::exit(1);
    }
}
