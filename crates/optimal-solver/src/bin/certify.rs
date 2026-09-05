//! The deep tier of the §7 fixture set: certify geodesic segments of chosen lengths, and —
//! the hardest ruler there is — the superflip's exact 20, whole or as distributable shards.
//! Minutes to hours per deep position by the plan's own cost model, which is why this is a
//! binary and not a test.
//!
//!   cargo run --release -p optimal-solver --bin certify -- 14 15 16
//!   cargo run --release -p optimal-solver --bin certify -- superflip
//!   cargo run --release -p optimal-solver --bin certify -- superflip-shard 3 9
//!   cargo run --release -p optimal-solver --bin certify -- superflip-collect shards.log
//!
//! Every result line carries the move-set hash prefix, the bound, and (for shards) the shard
//! tuple — so shard outputs collected from different machines can be checked against each
//! other before anyone calls nine lines a proof.

use optimal_solver::certificate::check_superflip_shards;
use optimal_solver::coords::Coords;
use optimal_solver::cubie::{apply_alg, SOLVED, SUPERFLIP_GEODESIC};
use optimal_solver::pdb::move_set_hash;
use optimal_solver::search::{certify_no_solution_within, prove, solution_string, Certification};
use optimal_solver::Tables;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

enum Command {
    Segments(usize),
    Superflip,
    SuperflipShard { index: u32, count: u32 },
    SuperflipCollect { path: String },
}

fn usage() -> ! {
    eprintln!(
        "usage: certify <segment-length 1..=20>... | superflip | superflip-shard <i> <n> | superflip-collect <file>"
    );
    std::process::exit(1);
}

/// Parse everything BEFORE generating tables: an argv typo must not cost a generation first.
fn parse(args: &[String]) -> Vec<Command> {
    if args.is_empty() {
        usage();
    }
    let mut out = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "superflip" => out.push(Command::Superflip),
            "superflip-collect" => {
                let path = iter.next().cloned().unwrap_or_else(|| usage());
                out.push(Command::SuperflipCollect { path });
            }
            "superflip-shard" => {
                let index = iter
                    .next()
                    .and_then(|a| a.parse().ok())
                    .unwrap_or_else(|| usage());
                let count = iter
                    .next()
                    .and_then(|a| a.parse().ok())
                    .unwrap_or_else(|| usage());
                if count == 0 || index >= count || count > 243 {
                    eprintln!("shard {index}/{count} is not a shard (n must be 1..=243, the canonical openings)");
                    usage();
                }
                out.push(Command::SuperflipShard { index, count });
            }
            other => match other.parse::<usize>() {
                Ok(len) if (1..=20).contains(&len) => out.push(Command::Segments(len)),
                _ => usage(),
            },
        }
    }
    out
}

/// Prove the superflip's exact 20 and print its certificate.
fn superflip(tables: &Tables, cancel: &AtomicBool, hash: &str) {
    let s = apply_alg(&SOLVED, SUPERFLIP_GEODESIC).unwrap();
    let t = Instant::now();
    let proof = prove(tables, &Coords::from_cubie(&s), 20, cancel, &mut |b, n| {
        eprintln!(
            "  contour {b} exhausted, {n} nodes, {:.0}s",
            t.elapsed().as_secs_f64()
        );
    })
    .expect("superflip is within 20");
    assert_eq!(proof.length, 20, "SUPERFLIP MUST BE EXACTLY 20");
    println!(
        "certificate moveset={hash} state=superflip result=PROVED-20 nodes={} secs={:.1} solution={}",
        proof.nodes,
        t.elapsed().as_secs_f64(),
        solution_string(&proof.solution)
    );
}

/// Exhaust one shard of the superflip's bound-19 certification and print its certificate.
fn superflip_shard(tables: &Tables, cancel: &AtomicBool, hash: &str, index: u32, count: u32) {
    let s = apply_alg(&SOLVED, SUPERFLIP_GEODESIC).unwrap();
    let t = Instant::now();
    let out = certify_no_solution_within(
        tables,
        &Coords::from_cubie(&s),
        19,
        (index, count),
        cancel,
        &mut |b, nodes| {
            eprintln!(
                "  shard {index}/{count}: bound {b} exhausted | {nodes} nodes | {:.0}s",
                t.elapsed().as_secs_f64()
            );
        },
    )
    .expect("not cancelled");
    match out {
        Certification::NoSolutionWithin => println!(
            "certificate moveset={hash} state=superflip bound=19 shard={index}/{count} result=NO-SOLUTION secs={:.0}",
            t.elapsed().as_secs_f64()
        ),
        Certification::FoundAt(len) => panic!(
            "SHARD {index}/{count} FOUND A {len}-MOVE SUPERFLIP SOLUTION — tables are wrong"
        ),
    }
}

/// Prove every geodesic segment of one length and print a certificate per segment.
fn segments(tables: &Tables, cancel: &AtomicBool, hash: &str, moves_str: &[&str], len: usize) {
    for start in 0..=(20 - len) {
        let alg = moves_str[start..start + len].join(" ");
        let s = apply_alg(&SOLVED, &alg).unwrap();
        let t = Instant::now();
        let proof = prove(
            tables,
            &Coords::from_cubie(&s),
            len as u8,
            cancel,
            &mut |_, _| {},
        )
        .expect("a geodesic segment is within its own length");
        assert_eq!(
            proof.length as usize,
            len,
            "SEGMENT [{start}..{}) IS NOT DEPTH {len}",
            start + len
        );
        println!(
            "certificate moveset={hash} segment=L{len}@{start} result=PROVED nodes={} secs={:.1}",
            proof.nodes,
            t.elapsed().as_secs_f64()
        );
    }
}

/// What a collected shard log concludes, as the one line the CLI prints — a function rather than
/// a block inside `main`, because this is the proof-critical half of the binary and the only
/// half a test can reach without hours of search (the audit's finding, 2026-09-05). `Err` is the
/// refusal verbatim, and the caller turns it into the nonzero exit.
fn collect_report(lines: &[&str], hash: &str) -> Result<(String, Vec<String>), String> {
    let (proof, warnings) = check_superflip_shards(lines, hash)?;
    let mut line = format!(
        "PROOF-COMPLETE state=superflip bound={} shards={} — no solution within {}",
        proof.bound, proof.shard_count, proof.bound
    );
    // The exact-20 conclusion needs precisely bound 19: the known 20-move maneuver is the upper
    // half, no-solution-within-19 the lower. Any other bound proves less, and saying more would
    // be inventing.
    if proof.bound == 19 {
        line.push_str("; with the known 20-move maneuver, the superflip is EXACTLY 20");
    } else {
        line.push_str(" — NOT an exact-20 proof (that needs bound 19)");
    }
    Ok((line, warnings))
}

fn collect(path: &str, hash: &str) {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let lines: Vec<&str> = text.lines().collect();
    match collect_report(&lines, hash) {
        Ok((conclusion, warnings)) => {
            for w in warnings {
                eprintln!("warning: {w}");
            }
            println!("{conclusion}");
        }
        Err(e) => {
            eprintln!("NOT A PROOF: {e}");
            std::process::exit(1);
        }
    }
}

fn hex_prefix(hash: &[u8; 32]) -> String {
    // The FULL hash: a certificate is checked by equality across machines, and a 48-bit
    // prefix invited exactly the collision doubt a certificate exists to end. (Shards started
    // before 2026-08-29T19:00 print the short prefix; their table identity is still pinned by
    // the generation-time histogram asserts in the same binary.)
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

fn main() {
    let commands = parse(&std::env::args().skip(1).collect::<Vec<_>>());
    let hash = hex_prefix(&move_set_hash());
    // Collecting checks text against the move-set hash — a whole table generation would be
    // pure ceremony, so it only happens when a command actually searches.
    let searches = commands
        .iter()
        .any(|c| !matches!(c, Command::SuperflipCollect { .. }));
    let tables = searches.then(|| {
        eprintln!("generating tables (histograms + Bellman asserted inside)…");
        let t0 = Instant::now();
        let tables = Tables::generate(&mut |_, _, _| {}).expect("tables");
        eprintln!("tables ready in {:.1}s", t0.elapsed().as_secs_f64());
        tables
    });
    let cancel = AtomicBool::new(false);
    let moves_str: Vec<&str> = SUPERFLIP_GEODESIC.split_whitespace().collect();
    let searching = || tables.as_ref().expect("search commands generate tables");

    for command in commands {
        match command {
            Command::Superflip => superflip(searching(), &cancel, &hash),
            Command::SuperflipShard { index, count } => {
                superflip_shard(searching(), &cancel, &hash, index, count)
            }
            Command::SuperflipCollect { path } => collect(&path, &hash),
            Command::Segments(len) => segments(searching(), &cancel, &hash, &moves_str, len),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::collect_report;

    const HASH: &str = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
    fn shard(i: u32, n: u32, bound: u8) -> String {
        format!("certificate moveset={HASH} state=superflip bound={bound} shard={i}/{n} result=NO-SOLUTION secs=1")
    }

    /// The conclusion is a function of the BOUND, and only bound 19 licenses "exactly 20". The
    /// binary printed this inline, where nothing could reach it.
    #[test]
    fn only_a_complete_bound_19_set_concludes_exactly_twenty() {
        let lines = [shard(0, 2, 19), shard(1, 2, 19)];
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        let (line, warnings) = collect_report(&refs, HASH).expect("a complete set");
        assert!(line.starts_with("PROOF-COMPLETE state=superflip bound=19 shards=2"));
        assert!(line.contains("EXACTLY 20"), "{line}");
        assert!(warnings.is_empty());

        // A complete set at a LOWER bound is a real result and a smaller claim — saying more
        // would be inventing, and this is the sentence that must not drift into saying it.
        let lines = [shard(0, 2, 18), shard(1, 2, 18)];
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        let (line, _) = collect_report(&refs, HASH).expect("a complete set at 18");
        assert!(line.contains("NOT an exact-20 proof"), "{line}");
        assert!(!line.contains("EXACTLY 20"), "{line}");
    }

    /// A refusal is carried out verbatim, so the CLI's message and its exit status come from one
    /// place rather than from a summary of what went wrong.
    #[test]
    fn an_incomplete_set_is_a_refusal_carrying_its_reason() {
        let lines = [shard(0, 3, 19), shard(2, 3, 19)];
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        let e = collect_report(&refs, HASH).expect_err("a missing shard is not a proof");
        assert!(e.contains("shards missing: [1]"), "{e}");
        // And nothing at all is a refusal too, never an empty proof.
        assert!(collect_report(&["chatter"], HASH).is_err());
    }
}
