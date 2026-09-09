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
//! Two claims are checked per case, not one. That the minimum is the minimum: every canonical
//! maneuver shorter than `L` is enumerated and none reaches the goal. And that the minimal SET is
//! complete: the maneuvers of length exactly `L` that reach the goal are enumerated too, and
//! compared with the generator's list element for element. A table that lost one would still pick
//! a maneuver that works, so nothing else here would notice.
//!
//! Usage: f2l-cross-check [--only <case>] [--max-length N]

use optimal_solver::f2l::{all_cases, prove_all, F2lState, GoalBall, F2L_SOLVED};
use optimal_solver::search::solution_string;
use rayon::prelude::*;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Instant;

/// Same face twice never helps; of a commuting opposite-face pair, keep one order only. The same
/// rule `search.rs` applies, restated here rather than imported, because a cross-check that shares
/// its canonicalisation with what it checks cannot see a canonicalisation bug.
fn allowed(prev: i8, m: usize) -> bool {
    if prev < 0 {
        return true;
    }
    let face = m / 3;
    let pf = prev as usize / 3;
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
        walk(start.step(m), 1, depth, m as i8, &mut path, &mut out);
        if !out.is_empty() {
            found.lock().unwrap().extend(out);
        }
    });
    let mut out = found.into_inner().unwrap();
    out.sort_by(|a, b| optimal_solver::cases::tie_break(a, b));
    out
}

fn walk(s: F2lState, g: u8, depth: u8, prev: i8, path: &mut Vec<u8>, out: &mut Vec<Vec<u8>>) {
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
        walk(s.step(m), g + 1, depth, m as i8, path, out);
        path.pop();
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let only = arg(&args, "--only").map(str::to_string);
    let max_length: u8 = arg(&args, "--max-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(u8::MAX);

    let ball = GoalBall::build();
    ball.validate()
        .expect("the goal ball must be a distance function");
    let cancel = AtomicBool::new(false);
    let mut checked = 0usize;
    let mut refuted = 0usize;
    for case in all_cases() {
        if only.as_deref().is_some_and(|n| n != case.name) {
            continue;
        }
        let claim = prove_all(&ball, &case.state(), 14, &cancel).expect("a proof");
        if claim.length > max_length {
            eprintln!(
                "{:10}  len {:2}  SKIPPED (over --max-length)",
                case.name, claim.length
            );
            continue;
        }
        let at = Instant::now();
        // Everything shorter holds nothing. This is the minimality claim, and it is the expensive
        // half — the whole ball below the answer, with nothing pruning it.
        let mut bad = false;
        for d in 0..claim.length {
            let hits = exhaustive(case.state(), d);
            if !hits.is_empty() {
                eprintln!(
                    "REFUTED {}: claimed {} but {} moves suffice — {}",
                    case.name,
                    claim.length,
                    d,
                    solution_string(&hits[0])
                );
                bad = true;
                break;
            }
        }
        if !bad {
            let all = exhaustive(case.state(), claim.length);
            if all != claim.solutions {
                eprintln!(
                    "REFUTED {}: the minimal set differs — brute force found {}, the table claims {}",
                    case.name,
                    all.len(),
                    claim.solutions.len()
                );
                bad = true;
            }
        }
        if bad {
            refuted += 1;
        }
        checked += 1;
        println!(
            "{:10}  len {:2}  {:5} minimal  {}  {:>8.2?}",
            case.name,
            claim.length,
            claim.solutions.len(),
            if bad { "REFUTED" } else { "confirmed" },
            at.elapsed()
        );
    }
    eprintln!("{checked} cases checked, {refuted} refuted");
    if refuted > 0 {
        std::process::exit(1);
    }
}

fn arg<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
}
