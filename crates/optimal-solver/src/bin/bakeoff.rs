//! §7 search-choice row: a fixed-corpus bake-off logging nodes and ns/node, so the search
//! configuration is a measurement rather than a preference. The corpus is deterministic —
//! geodesic segments — so runs compare across changes. Node counts are NOT: root-parallel
//! contours stop siblings on a first find, so `nodes` varies with scheduling. Compare
//! medians across a few runs, never single readings.
//!
//!   cargo run --release -p optimal-solver --bin bakeoff

use optimal_solver::coords::Coords;
use optimal_solver::cubie::{apply_alg, SOLVED, SUPERFLIP_GEODESIC};
use optimal_solver::search::prove;
use optimal_solver::Tables;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

fn main() {
    // No options exist; accepting any would let a mistyped flag look honoured.
    if std::env::args().len() > 1 {
        eprintln!("usage: bakeoff (no arguments — the corpus is fixed so runs compare)");
        std::process::exit(1);
    }
    let tables = Tables::generate(&mut |_, _, _| {}).expect("tables");
    let cancel = AtomicBool::new(false);
    let moves_str: Vec<&str> = SUPERFLIP_GEODESIC.split_whitespace().collect();
    println!("len offset | nodes | ms | ns/node");
    for len in [8usize, 10, 12, 13, 14] {
        for start in [0usize, 4, 20 - len] {
            let alg = moves_str[start..start + len].join(" ");
            let s = apply_alg(&SOLVED, &alg).unwrap();
            let t = Instant::now();
            let proof = prove(
                &tables,
                &Coords::from_cubie(&s),
                len as u8,
                &cancel,
                &mut |_, _| {},
            )
            .expect("within cap");
            // The row is labelled with the requested depth — the proof must actually BE that
            // depth, or the table measures something it does not claim to.
            assert_eq!(
                proof.length as usize, len,
                "L={len} offset={start} did not prove at {len}"
            );
            let ms = t.elapsed().as_secs_f64() * 1e3;
            println!(
                "{len:3} {start:6} | {:12} | {ms:9.1} | {:6.1}",
                proof.nodes,
                ms * 1e6 / proof.nodes as f64
            );
        }
    }
}
