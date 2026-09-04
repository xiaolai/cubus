//! Plan §8: the entry point the generation-memory numbers in that section come from, so they
//! can be re-derived rather than believed. Peak RSS is a property of the PROCESS, which is why
//! this is a binary and not a test — a test binary's peak is whatever else the suite was doing.
//!
//!   /usr/bin/time -l cargo run --release -p optimal-solver --bin measure-generate -- generate
//!   /usr/bin/time -l cargo run --release -p optimal-solver --bin measure-generate -- prepare
//!
//! `generate` builds all three tables and holds them, which is what generation costs.
//! `prepare` is the desktop `optimal_prepare` path end to end — the same `Tables::generate`
//! (every table Bellman-certified) followed by the same `save` — written to a scratch
//! directory that is removed afterwards, so the number is comparable to the app's.
//!
//! Run it under `/usr/bin/time -l` and read `maximum resident set size` (bytes on macOS).
//! Build first if the cargo download/compile should stay out of the measurement.

use optimal_solver::coords::MoveTables;
use optimal_solver::pdb::{self, Kind};
use optimal_solver::Tables;
use std::time::Instant;

const KINDS: [(Kind, &str); 3] = [
    (Kind::Corner, "corners"),
    (Kind::EdgeA, "edges-a"),
    (Kind::EdgeB, "edges-b"),
];

fn usage() -> ! {
    eprintln!("usage: measure-generate generate [corners|edges-a|edges-b] | prepare");
    std::process::exit(1);
}

/// The kinds a mode should build: all three by default, or the one named. Measuring one in
/// isolation is what says WHERE the peak lives; measuring all three says what the app pays.
fn selected(arg: Option<&String>) -> Vec<(Kind, &'static str)> {
    match arg.map(String::as_str) {
        None => KINDS.to_vec(),
        Some(name) => match KINDS.iter().find(|(_, n)| *n == name) {
            Some(&pair) => vec![pair],
            None => usage(),
        },
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mode, rest) = match args.split_first() {
        Some((mode, rest)) if rest.len() <= 1 => (mode.clone(), rest),
        _ => usage(),
    };
    let whole = Instant::now();
    match mode.as_str() {
        // Generation only, no certification and no I/O: the allocation the plan is about.
        // Every table is HELD to the end, as `Tables::generate` holds them.
        "generate" => {
            let moves = MoveTables::build();
            let mut held = Vec::new();
            for (kind, name) in selected(rest.first()) {
                let t = Instant::now();
                let table = pdb::generate_levels(kind, &moves, &mut |_, _| {})
                    .expect("generation must certify or refuse");
                println!("{name:8} {:8.1} s", t.elapsed().as_secs_f64());
                held.push(table);
            }
            // Nothing may drop before the total is printed, or the peak reported alongside it
            // belongs to a different program than the one that was timed.
            println!("held {} tables", held.len());
        }
        // The desktop's prepare, minus Tauri: generate, Bellman-certify each table, serialize
        // and write all three.
        "prepare" if rest.is_empty() => {
            let dir = std::env::temp_dir().join(format!("cubus-measure-{}", std::process::id()));
            let tables = Tables::generate(&mut |stage, done, total| {
                if done == total {
                    println!("  {stage} done at {:8.1} s", whole.elapsed().as_secs_f64());
                }
            })
            .expect("generation must certify or refuse");
            let t = Instant::now();
            tables.save(&dir).expect("save");
            println!(
                "save     {:8.1} s -> {}",
                t.elapsed().as_secs_f64(),
                dir.display()
            );
            let _ = std::fs::remove_dir_all(&dir);
        }
        _ => usage(),
    }
    println!("total    {:8.1} s", whole.elapsed().as_secs_f64());
}
