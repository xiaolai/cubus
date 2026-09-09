//! The committed case tables, checked against their committed certificates.
//!
//! These files are the reason the tables are in the repository at all. A generated table with no
//! evidence beside it is a list somebody has to take on trust, and the plan's rule
//! (method-solver-return-plan.md C4) is that no table is committed before its certificate is. What
//! makes that rule mean anything is this file: the certificates are READ on every test run, by the
//! checker that can refuse them, rather than being a folder nobody opens.
//!
//! What is and is not established here. The certificates prove internal completeness and mutual
//! consistency — every case claims a length, every length carries the evidence that nothing
//! shorter exists, no case is missing, no record is duplicated, and the move set the run used is
//! this build's. They are NOT a proof of work, and no line claims to be; a forged log passes. The
//! defence is against the operational failures that actually happen — a lost case, a stale binary,
//! a half-finished run pasted in as complete. `case_certificate.rs` states the same trust model at
//! greater length.
//!
//! Regenerating, if a table ever needs it:
//!
//! ```text
//! cargo run --release -p optimal-solver --bin gen-f2l   -- tables/f2l.json tables/f2l-certificates.txt
//! cargo run --release -p optimal-solver --bin gen-cases -- pll tables/pll.json tables/pll-certificates.txt
//! cargo run --release -p optimal-solver --bin gen-cases -- oll tables/oll.json tables/oll-certificates.txt
//! ```
//!
//! OLL takes about three quarters of an hour and its certificate is ten megabytes of them; the
//! other two are seconds. That asymmetry is why they are committed rather than regenerated on
//! demand, and it compresses to under two hundred kilobytes in the object store.

use optimal_solver::case_certificate::{check_case_certificates, Expect};
use optimal_solver::pdb::move_set_hash;
use optimal_solver::table_json::read_table;
use std::path::PathBuf;

fn tables_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tables")
}

fn read(name: &str) -> String {
    let path = tables_dir().join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "{}: {e} — the committed tables are part of the crate, not an optional extra",
            path.display()
        )
    })
}

/// The table's own rows, through the crate's strict reader.
///
/// This file used to carry a third improvised parser — a line-prefix match and a `find`/`trim`
/// per field — beside the two in `case-cross-check` and `oll-compare`. Reading the artifact a
/// check is ABOUT through a reader that accepts a truncated file is the wrong place to be lenient,
/// and the three of them accepted different things.
fn table_rows(json: &str, kind: &str) -> Vec<(String, u8, String)> {
    read_table(json, kind)
        .unwrap_or_else(|e| panic!("{kind}.json: {e}"))
        .rows
        .into_iter()
        .map(|r| (r.case, r.length, r.alg))
        .collect()
}

/// Every table, its certificate, and how many cases each must hold.
///
/// The counts are written out rather than read off the file, because "as many as the file has" is
/// the one thing a certificate cannot check for you: a truncated log is internally consistent.
const TABLES: [(&str, &str, &str, usize); 3] = [
    ("f2l", "f2l.json", "f2l-certificates.txt", 42),
    ("oll", "oll.json", "oll-certificates.txt", 58),
    ("pll", "pll.json", "pll-certificates.txt", 22),
];

#[test]
fn every_committed_table_is_covered_by_its_committed_certificate() {
    for (kind, table_file, cert_file, cases) in TABLES {
        let cert = read(cert_file);
        let lines: Vec<&str> = cert.lines().collect();
        let hash: String = move_set_hash().iter().map(|b| format!("{b:02x}")).collect();
        // The expectation is derived from the case machinery, and the count beside it is the
        // second opinion: `Expect::standard` says which case ids must appear, and the literal here
        // says how many there should be. A change that quietly dropped a case would satisfy the
        // first and fail the second.
        let expect = Expect::standard(kind).expect("a known kind");
        assert_eq!(
            expect.cases.len(),
            cases,
            "{kind}: this build enumerates a different number of cases"
        );
        let proof = check_case_certificates(&lines, &hash, &expect)
            .unwrap_or_else(|e| panic!("{cert_file}: {e}"));
        assert_eq!(proof.cases, cases, "{kind}: wrong number of cases");

        // And the certificate is about THIS table, not a table with the same name. The certificate
        // carries every case's chosen algorithm, so the two can disagree — which is exactly what a
        // hand-edit to the JSON, or a table copied from a different run, would look like.
        let rows = table_rows(&read(table_file), kind);
        assert_eq!(rows.len(), cases, "{table_file}: wrong number of rows");
        let certified: std::collections::BTreeMap<&str, (u8, &str)> = proof
            .table
            .iter()
            .map(|(id, len, alg)| (id.as_str(), (*len, alg.as_str())))
            .collect();
        for (id, length, alg) in &rows {
            let (want_len, want_alg) = certified
                .get(id.as_str())
                .unwrap_or_else(|| panic!("{table_file}: case {id} has no certificate"));
            assert_eq!(
                *length, *want_len,
                "{table_file}: case {id} says {length} moves, its certificate says {want_len}"
            );
            let dotted = alg.split_whitespace().collect::<Vec<_>>().join(".");
            assert_eq!(
                dotted, *want_alg,
                "{table_file}: case {id} carries an algorithm its certificate does not"
            );
        }
    }
}

#[test]
fn the_f2l_table_is_what_regenerating_it_would_produce() {
    // Determinism, asserted where it can fail rather than promised in a comment. The table is
    // sorted, the minimal set is sorted by a stated rule, and the chosen maneuver is the first of
    // that set — so a rerun on any machine has to give this byte for byte. F2L is the one of the
    // three cheap enough to prove it this way on every run — a third of a second for the distance
    // ball and a hundredth for all 42 searches; OLL's forty-five minutes is why its equivalent
    // lives in the nightly tier.
    use optimal_solver::f2l::{all_cases, prove_all, GoalBall};
    use optimal_solver::search::solution_string;
    use std::sync::atomic::AtomicBool;

    let ball = GoalBall::build();
    ball.validate()
        .expect("the goal ball must be a distance function");
    let cancel = AtomicBool::new(false);
    let rows = table_rows(&read("f2l.json"), "f2l");
    let cases = all_cases();
    assert_eq!(rows.len(), cases.len());
    for (case, (id, length, alg)) in cases.iter().zip(rows.iter()) {
        let want_id = case.id();
        assert_eq!(
            *id, want_id,
            "the table is not in the generator's own order"
        );
        let proof = prove_all(&ball, &case.state(), 14, &cancel).expect("a proof");
        assert_eq!(
            proof.length, *length,
            "{}: the committed length is not the one the search proves",
            case.name
        );
        assert_eq!(
            solution_string(&proof.solutions[0]),
            *alg,
            "{}: the committed maneuver is not the one the tie-break chooses",
            case.name
        );
    }
}
