//! Generate the F2L case table, and the certificates that make its lengths checkable.
//!
//! The same artifact class as `gen-cases`: deterministic, proved, written by write-then-rename,
//! never hand-edited. What differs is the obligation behind a length, and it differs because the
//! problem is a different shape — see `f2l.rs` for why F2L is a distance after all, and
//! `case_certificate.rs` for what its records therefore have to say.
//!
//!   cargo run --release -p optimal-solver --bin gen-f2l -- f2l.json f2l-certificates.txt
//!
//! # What a line of the table means
//!
//! A case is a position of one corner and one edge, read in the frame where the slot being worked
//! on is at the front right and the top layer has already been turned to match. The algorithm is
//! the shortest maneuver that finishes the first two layers from there — which, for a cube whose
//! other slots are already home, is exactly the shortest slot-safe maneuver that places the pair.
//! The generator checks that second reading on every maneuver it emits rather than trusting the
//! argument: `slot_safe_on_solved` asks the question the app's `slotSafe` asks, of the algorithm,
//! on a solved cube.

use optimal_solver::cli::{self, Spec};
use optimal_solver::f2l::{all_cases, prove_all, slot_safe_on_solved, GoalBall};
use optimal_solver::pdb::move_set_hash;
use optimal_solver::search::solution_string;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

const SPEC: Spec = Spec {
    usage: "usage: gen-f2l <table.json> <certificates.txt> [--cap N]",
    value_options: &["--cap"],
    flags: &[],
    positionals: 2..=2,
};

fn main() {
    // Parsed by `cli`, which consumes an option WITH its value. The hand-rolled version filtered
    // out anything starting with `--` and kept the rest as positionals, so `table.json --cap 8`
    // published the certificates to a file named `8`; and an unparseable cap fell back to 14
    // rather than being refused, so the run used a bound nobody asked for and said nothing.
    let args = cli::parse_or_exit(&SPEC);
    let table_path = args.positional(0).to_string();
    let cert_path = args.positional(1).to_string();
    let cap: u8 = cli::or_exit(&SPEC, args.parsed_in("--cap", 1..=20u8, 14));
    // Two artifacts, and they must not be one file: writing the certificates over the table it
    // just generated is a failure that reports success.
    cli::or_exit(
        &SPEC,
        optimal_solver::destinations_differ(&[&table_path, &cert_path]),
    );

    let t0 = Instant::now();
    let ball = GoalBall::build();
    ball.validate()
        .expect("the goal ball must be a distance function");
    eprintln!(
        "exact distances to radius {} — {} states in {:.3}s, layers {:?}",
        ball.radius(),
        ball.len(),
        t0.elapsed().as_secs_f64(),
        ball.layers()
    );

    let hash: String = move_set_hash().iter().map(|b| format!("{b:02x}")).collect();
    let cancel = AtomicBool::new(false);
    let cases = all_cases();
    let mut certificates: Vec<String> = Vec::new();
    let mut rows: Vec<String> = Vec::new();
    let mut lengths: Vec<u8> = Vec::new();
    let mut total_nodes = 0u64;
    let run = Instant::now();

    for case in &cases {
        // The case key, and it is the position rather than a digest of it: two hex bytes, the
        // corner's slot and twist then the edge's slot and flip. A hash would be shorter and would
        // make a wrong entry unreadable, which is the opposite of what a key is for here.
        let id = format!(
            "f2l:{:02x}{:02x}",
            case.corner_slot * 3 + case.corner_twist as usize,
            case.edge_slot * 2 + case.edge_flip as usize
        );
        let proof = prove_all(&ball, &case.state(), cap, &cancel)
            .unwrap_or_else(|e| panic!("{}: {e:?}", case.name));
        total_nodes += proof.nodes;
        lengths.push(proof.length);

        let alg = &proof.solutions[0];
        // Every minimal maneuver, not just the chosen one. The equivalence this table rests on is
        // that reaching the goal and being slot-safe are the same thing here; a single maneuver
        // that reached the goal without being slot-safe would refute it, and would do so silently
        // if only the chosen one were asked.
        for (i, candidate) in proof.solutions.iter().enumerate() {
            assert!(
                slot_safe_on_solved(candidate),
                "{}: minimal maneuver {i} reaches the goal but is not slot-safe — the projection \
                 and the app's slotSafe have come apart",
                case.name
            );
        }

        if proof.length == 0 {
            // The SKIP: the pair is already placed, so there is no algorithm and nothing shorter
            // to rule out. `case_certificate.rs` refuses a lower bound for it, and rightly.
            certificates.push(format!(
                "case-alg moveset={hash} kind=f2l case={id} length=0 alg="
            ));
        } else {
            certificates.push(format!(
                "case-alg moveset={hash} kind=f2l case={id} length={} alg={}",
                proof.length,
                solution_string(alg)
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(".")
            ));
            certificates.push(format!(
                "case-lower moveset={hash} kind=f2l case={id} scope=f2l-projection floor={} bound={} nodes={} result=NO-SOLUTION",
                proof.floor,
                proof.length - 1,
                proof.nodes_below
            ));
        }

        rows.push(format!(
            "    {{ \"case\": \"{id}\", \"name\": \"{}\", \"cornerSlot\": {}, \"cornerTwist\": {}, \"edgeSlot\": {}, \"edgeFlip\": {}, \"length\": {}, \"alg\": \"{}\", \"minimal\": {} }}",
            case.name,
            case.corner_slot,
            case.corner_twist,
            case.edge_slot,
            case.edge_flip,
            proof.length,
            solution_string(alg),
            proof.solutions.len()
        ));
        eprintln!(
            "{:10} {:2} moves, {:4} minimal, floor {}, {} nodes below",
            case.name,
            proof.length,
            proof.solutions.len(),
            proof.floor,
            proof.nodes_below
        );
    }

    let json = format!(
        "{{\n  \"kind\": \"f2l\",\n  \"moveset\": \"{hash}\",\n  \"scope\": \"f2l-projection\",\n  \"cases\": [\n{}\n  ]\n}}\n",
        rows.join(",\n")
    );
    // ONE publish for the pair. A table and the certificates that make its lengths checkable are
    // one artifact in two files: writing them in sequence left a new table beside stale
    // certificates whenever the second write did not finish.
    publish_pair(
        &table_path,
        json.as_bytes(),
        &cert_path,
        format!("{}\n", certificates.join("\n")).as_bytes(),
    );

    let solved: Vec<u8> = lengths.iter().copied().filter(|&l| l > 0).collect();
    let total: usize = solved.iter().map(|&l| l as usize).sum();
    eprintln!(
        "\n{} cases in {:.2}s | mean optimum {:.4} | longest {} | {} nodes",
        cases.len(),
        run.elapsed().as_secs_f64(),
        total as f64 / solved.len().max(1) as f64,
        solved.iter().copied().max().unwrap_or(0),
        total_nodes
    );
    eprint!("histogram");
    for len in 0..=20u8 {
        let n = lengths.iter().filter(|&&l| l == len).count();
        if n > 0 {
            eprint!(" {len}:{n}");
        }
    }
    eprintln!("\nwrote {table_path} and {cert_path}");
}

/// Publish the table and its certificates through the crate's own staged writer.
///
/// This binary used to carry a four-line `write_atomic` that wrote `<path>.tmp` — a FIXED name, so
/// two runs writing the same table shared one temporary file and could publish each other's
/// half-written bytes. The library's version was already correct (a random temp name, `sync_all`
/// before the rename, the directory synced after it); the defect was that it was private and two
/// callers wrote their own instead.
fn publish_pair(table: &str, table_body: &[u8], certs: &str, cert_body: &[u8]) {
    optimal_solver::write_all_atomic(&[
        (std::path::Path::new(table), table_body),
        (std::path::Path::new(certs), cert_body),
    ])
    .unwrap_or_else(|e| panic!("cannot publish {table} and {certs}: {e}"));
}
