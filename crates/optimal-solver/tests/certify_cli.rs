//! The `certify` binary as a program: its conclusions, its exit status, and the work it must
//! NOT do (the audit's finding, 2026-09-05 — the CLI's reporting path was reachable only by
//! running it by hand, so the exact-20 sentence, the rejection status and the
//! collect-without-generating rule were each one edit away from silently changing).
//!
//! These run the real binary, because that is where the three things being asserted live: the
//! exit code is the process's, and "no tables were generated" is only observable from outside.
//! Everything here uses `superflip-collect` or an argv typo, both of which are milliseconds —
//! the searching commands are hours by design and belong to the plan's stamps, not to a suite.

use optimal_solver::pdb::move_set_hash;
use std::process::Command;

/// The move-set hash the binary will compute for itself. A log written with anything else is
/// refused, which is the point of the field — so the fixtures are built from the same source.
fn local_hash() -> String {
    move_set_hash().iter().map(|b| format!("{b:02x}")).collect()
}

fn shard_line(i: u32, n: u32, bound: u8, hash: &str) -> String {
    format!(
        "certificate moveset={hash} state=superflip bound={bound} shard={i}/{n} result=NO-SOLUTION secs=1"
    )
}

struct Run {
    ok: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn certify(args: &[&str]) -> Run {
    let out = Command::new(env!("CARGO_BIN_EXE_certify"))
        .args(args)
        .output()
        .expect("the certify binary runs");
    Run {
        ok: out.status.success(),
        code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    }
}

/// A log file this test owns, removed with the value. Named per test AND per process, so a
/// parallel suite and a leftover from a crashed run cannot collide.
struct Log(std::path::PathBuf);

impl Log {
    fn of(tag: &str, lines: &[String]) -> Log {
        let at = std::env::temp_dir().join(format!(
            "cubus-certify-cli-{}-{tag}.log",
            std::process::id()
        ));
        std::fs::write(&at, lines.join("\n")).expect("write the shard log");
        Log(at)
    }
    fn path(&self) -> &str {
        self.0.to_str().expect("a utf-8 temp path")
    }
}

impl Drop for Log {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Table generation announces itself on stderr before it starts; its absence is how a test can
/// tell that collecting stayed a text check.
const GENERATION_ANNOUNCEMENT: &str = "generating tables";

#[test]
fn a_complete_bound_19_log_concludes_exactly_20_without_generating_tables() {
    let hash = local_hash();
    let lines: Vec<String> = (0..3).map(|i| shard_line(i, 3, 19, &hash)).collect();
    let log = Log::of("complete19", &lines);
    let run = certify(&["superflip-collect", log.path()]);
    assert!(run.ok, "exit {:?}: {}", run.code, run.stderr);
    assert!(
        run.stdout
            .contains("PROOF-COMPLETE state=superflip bound=19 shards=3"),
        "{}",
        run.stdout
    );
    assert!(
        run.stdout.contains("the superflip is EXACTLY 20"),
        "the one conclusion bound 19 licenses: {}",
        run.stdout
    );
    // Collecting is a text check. Generating the tables to do it would be minutes of BFS and
    // ~281 MB for a job that never touches them — the binary skips it, and this is the assertion
    // that keeps it skipped.
    assert!(
        !run.stderr.contains(GENERATION_ANNOUNCEMENT),
        "collecting generated tables: {}",
        run.stderr
    );
}

#[test]
fn a_complete_log_at_a_lower_bound_refuses_to_claim_the_exact_20() {
    let hash = local_hash();
    let lines: Vec<String> = (0..2).map(|i| shard_line(i, 2, 18, &hash)).collect();
    let log = Log::of("complete18", &lines);
    let run = certify(&["superflip-collect", log.path()]);
    assert!(run.ok, "a complete set is a result, at any bound");
    assert!(
        run.stdout
            .contains("NOT an exact-20 proof (that needs bound 19)"),
        "{}",
        run.stdout
    );
    assert!(
        !run.stdout.contains("EXACTLY 20"),
        "a bound-18 set must never print the bound-19 conclusion: {}",
        run.stdout
    );
}

#[test]
fn every_log_that_is_not_a_proof_exits_nonzero_and_says_why() {
    let hash = local_hash();
    let cases: [(&str, Vec<String>, &str); 4] = [
        // A missing shard: the commonest real failure, and the one a shrug would hide.
        (
            "incomplete",
            vec![shard_line(0, 3, 19, &hash), shard_line(2, 3, 19, &hash)],
            "shards missing: [1]",
        ),
        // A mangled certificate must never pass as chatter.
        (
            "mangled",
            vec![
                shard_line(0, 2, 19, &hash),
                shard_line(1, 2, 19, &hash).replace(" bound=19", ""),
            ],
            "missing bound=",
        ),
        // A stale binary's move set: the reason the field is on the line at all.
        (
            "foreign",
            vec![shard_line(0, 1, 19, &"ff".repeat(32))],
            "does not match the local move set",
        ),
        // Chatter alone is a proof of nothing, and must not read as an empty success.
        (
            "empty",
            vec!["  contour 17 exhausted".into()],
            "no superflip shard",
        ),
    ];
    for (tag, lines, because) in cases {
        let log = Log::of(tag, &lines);
        let run = certify(&["superflip-collect", log.path()]);
        assert_eq!(run.code, Some(1), "{tag}: must exit 1, said {}", run.stderr);
        assert!(
            run.stderr.contains("NOT A PROOF") && run.stderr.contains(because),
            "{tag}: {}",
            run.stderr
        );
        assert!(
            run.stdout.is_empty(),
            "{tag}: a refusal prints no conclusion, got {}",
            run.stdout
        );
    }
}

/// The claim `parse`'s comment makes — "an argv typo must not cost a generation first" — which
/// nothing checked. A bad shard tuple is the case where it matters most: the shard commands are
/// the ones that would otherwise burn a table generation before refusing.
#[test]
fn an_argv_typo_is_refused_before_any_table_generation() {
    for args in [
        vec!["superflip-shard", "3", "3"],
        vec!["superflip-shard", "0", "244"],
        vec!["superflip-shard", "0", "0"],
        vec!["nonsense"],
        vec!["21"],
        vec![],
    ] {
        let run = certify(&args);
        assert_eq!(run.code, Some(1), "{args:?} must be refused");
        assert!(
            !run.stderr.contains(GENERATION_ANNOUNCEMENT),
            "{args:?} generated tables before refusing: {}",
            run.stderr
        );
        assert!(
            run.stderr.contains("usage:") || run.stderr.contains("is not a shard"),
            "{args:?}: {}",
            run.stderr
        );
    }
}
