//! The challenge library (plan §4.6): uniform random states, each PROVED minimal, dumped as
//! JSON. §7's costing stands — this is a by-product, not a free one: deep positions take
//! minutes to hours each, so the count is an argument and the cost is printed, not hidden.
//!
//!   cargo run --release -p optimal-solver --bin gen-library -- 8 challenges.json

use optimal_solver::coords::Coords;
use optimal_solver::cubie::{parse_facelets, permutation_parity, to_facelets, Cubie, SOLVED};
use optimal_solver::search::{prove, solution_string};
use optimal_solver::Tables;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

/// A uniform random legal state — Fisher-Yates from a cryptographic source, parity repaired by
/// one transposition, orientations constructed to cancel: the same discipline (and the same
/// reasoning, comment for comment) as apps/web/lib/random-state.js. Legality is then enforced
/// by the library's own boundary, not by trusting this constructor: the parse round-trip runs
/// every check parse_facelets makes.
fn random_state() -> Cubie {
    fn rand_below(n: u32) -> u32 {
        // Rejection past the largest multiple of n, so the modulo bias goes with it.
        let limit = (u32::MAX / n) * n;
        loop {
            let mut b = [0u8; 4];
            getrandom::getrandom(&mut b).expect("no cryptographic source; refusing a weak one");
            let v = u32::from_le_bytes(b);
            if v < limit {
                return v % n;
            }
        }
    }
    fn shuffle(a: &mut [u8]) {
        for i in (1..a.len()).rev() {
            a.swap(i, rand_below(i as u32 + 1) as usize);
        }
    }
    let mut s = SOLVED;
    shuffle(&mut s.cp);
    shuffle(&mut s.ep);
    if permutation_parity(&s.cp) != permutation_parity(&s.ep) {
        s.ep.swap(0, 1);
    }
    let mut total = 0u8;
    for i in 0..7 {
        s.co[i] = rand_below(3) as u8;
        total += s.co[i];
    }
    s.co[7] = (3 - (total % 3)) % 3;
    let mut flips = 0u8;
    for i in 0..11 {
        s.eo[i] = rand_below(2) as u8;
        flips ^= s.eo[i];
    }
    s.eo[11] = flips;
    parse_facelets(&to_facelets(&s)).expect("a constructed state must be legal");
    s
}

/// Invert at the move-index level — quarter <-> inverse quarter within each face triple, half
/// turns self-inverse — so no second string parser exists to drift from the first.
fn invert_moves(solution: &[u8]) -> Vec<u8> {
    solution
        .iter()
        .rev()
        .map(|&m| m - (m % 3) + (2 - (m % 3)))
        .collect()
}

fn main() {
    // Exactly zero or one argument, and it must be a sensible count: a typo must fail loudly,
    // not silently launch a day of default-sized proving.
    let args: Vec<String> = std::env::args().skip(1).collect();
    let usage = || -> ! {
        eprintln!("usage: gen-library <count 1..=100000> [output.json]");
        std::process::exit(1);
    };
    // No silent default: each entry can be an hour of proving, so the size of the bill is
    // always stated by the person running it. With an output path the artifact lands by
    // write-then-rename — an interrupted run leaves no file at all, not a truncated one.
    let (count_arg, out_path): (&str, Option<&str>) = match args.as_slice() {
        [one] => (one, None),
        [one, path] => (one, Some(path)),
        _ => usage(),
    };
    let n: usize = match count_arg.parse() {
        Ok(v) if (1..=100_000).contains(&v) => v,
        _ => usage(),
    };
    eprintln!("generating tables…");
    let tables = Tables::generate(&mut |_, _, _| {}).expect("tables");
    let cancel = AtomicBool::new(false);
    let run = Instant::now();
    // Entries are buffered and the JSON printed only when every proof succeeded: stdout is
    // redirected to the artifact, and an interrupted run must leave nothing that parses as
    // a smaller library — progress lives on stderr, where it always did.
    let mut entries: Vec<String> = Vec::with_capacity(n);
    for i in 0..n {
        let state = random_state();
        let t = Instant::now();
        let proof = prove(
            &tables,
            &Coords::from_cubie(&state),
            20,
            &cancel,
            &mut |_, _| {},
        )
        .expect("God's number is 20");
        let solution = solution_string(&proof.solution);
        // The scramble is the inverse of the proved-minimal solution: applying it to solved
        // reaches exactly this state, so scramble length == optimal length by construction.
        let scramble = solution_string(&invert_moves(&proof.solution));
        eprintln!(
            "{}/{n}: depth {} | {} nodes | {:.1}s | total {:.0}s",
            i + 1,
            proof.length,
            proof.nodes,
            t.elapsed().as_secs_f64(),
            run.elapsed().as_secs_f64()
        );
        // Hand-rolled JSON: every field is a move string over [URFDLB'2 ] or a number — no
        // escaping exists to get wrong.
        entries.push(format!(
            "  {{ \"facelets\": \"{}\", \"scramble\": \"{scramble}\", \"optimalLength\": {}, \"optimalSolution\": \"{solution}\" }}",
            to_facelets(&state),
            proof.length,
        ));
    }
    let json = format!("[\n{}\n]\n", entries.join(",\n"));
    match out_path {
        // The artifact path: write-then-rename, the same discipline as Tables::save — an
        // interruption anywhere leaves either the old file or none, never a torn one.
        Some(path) => {
            let tmp = format!("{path}.tmp");
            std::fs::write(&tmp, &json).unwrap_or_else(|e| panic!("cannot write {tmp}: {e}"));
            std::fs::rename(&tmp, path)
                .unwrap_or_else(|e| panic!("cannot move {tmp} into place: {e}"));
            eprintln!("wrote {path}");
        }
        // The pipe path: one print of the whole document. (No truncation of this JSON parses
        // as a smaller library anyway — the closing bracket is the final byte.)
        None => print!("{json}"),
    }
    eprintln!(
        "library of {n} proved states in {:.0}s",
        run.elapsed().as_secs_f64()
    );
}
