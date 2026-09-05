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

/// A scratch directory this process CREATED, removed when the value goes out of scope.
///
/// Two defects it exists for (2026-09-05). The old name was `cubus-measure-<pid>` and was used
/// whether or not it already existed: a pid is reused within a day, so a leftover directory from
/// an earlier crashed run was written into and then recursively deleted — and if a pid happened
/// to collide with something else's directory, that went too. `create_dir` refuses to make a
/// directory that exists, so a name this call did not create is a name this type never holds,
/// and the random component makes a collision a lottery rather than a schedule.
/// And the removal was `let _ = remove_dir_all(...)` placed after a `save` that panics on
/// failure, so the one case that leaves 86 MB behind — a failed save — was the one case that
/// never cleaned up. Drop runs while unwinding; a cleanup that fails says so out loud, because a
/// measurement harness that quietly fills a temp directory is a measurement harness nobody
/// notices is broken.
struct Scratch(std::path::PathBuf);

impl Scratch {
    fn create() -> std::io::Result<Scratch> {
        let mut nonce = [0u8; 8];
        getrandom::getrandom(&mut nonce).map_err(|e| {
            std::io::Error::other(format!("no random source for a scratch name: {e}"))
        })?;
        let dir = std::env::temp_dir().join(format!(
            "cubus-measure-{}-{:016x}",
            std::process::id(),
            u64::from_le_bytes(nonce)
        ));
        // Not create_dir_all: this must FAIL on an existing directory, or the guard would take
        // ownership of something it did not make and delete it on the way out.
        std::fs::create_dir(&dir)?;
        Ok(Scratch(dir))
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_dir_all(&self.0) {
            eprintln!(
                "warning: scratch directory {} not removed: {e}",
                self.0.display()
            );
        }
    }
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
            let scratch = Scratch::create().expect("a scratch directory this run owns");
            let dir = scratch.path();
            let tables = Tables::generate(&mut |stage, done, total| {
                if done == total {
                    println!("  {stage} done at {:8.1} s", whole.elapsed().as_secs_f64());
                }
            })
            .expect("generation must certify or refuse");
            let t = Instant::now();
            // A save that refuses still cleans up: the guard's Drop runs while unwinding, which
            // is the case that used to leave 86 MB of half-written tables in the temp directory.
            tables.save(dir).expect("save");
            println!(
                "save     {:8.1} s -> {}",
                t.elapsed().as_secs_f64(),
                dir.display()
            );
            drop(scratch);
        }
        _ => usage(),
    }
    println!("total    {:8.1} s", whole.elapsed().as_secs_f64());
}

#[cfg(test)]
mod tests {
    use super::Scratch;

    /// The two properties the guard exists for: the directory is one this run made (so cleanup
    /// can never reach anything it did not), and it goes away with its contents on every exit —
    /// including the panicking one, which is the same `Drop` this test observes.
    #[test]
    fn a_scratch_directory_is_this_runs_own_and_leaves_nothing_behind() {
        let path = {
            let scratch = Scratch::create().expect("a fresh scratch directory");
            let path = scratch.path().to_path_buf();
            assert!(path.is_dir());
            // The mechanism the ownership claim rests on: `create_dir` refuses a name that
            // already exists, so no guard can ever adopt a directory it did not make.
            assert!(
                std::fs::create_dir(&path).is_err(),
                "create_dir must refuse an existing directory"
            );
            // And two guards alive at once never name the same one — the bare pid did, across a
            // pid reuse, which is what made cleanup a hazard rather than a courtesy.
            let other = Scratch::create().expect("a second scratch directory");
            assert_ne!(other.path(), path);
            std::fs::write(path.join("corner.pdb"), b"an artifact").unwrap();
            path
        };
        assert!(
            !path.exists(),
            "the guard removed its directory, contents and all"
        );
    }
}
