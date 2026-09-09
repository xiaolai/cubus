//! Generate a last-layer case table, and the certificates that make its lengths checkable.
//!
//! Phase C of dev-docs/method-solver-return-plan.md. `gen-library.rs` is the precedent — offline,
//! proved, written by write-then-rename, never hand-edited — and this is the same artifact class
//! with one difference that runs through everything: **a case table is memorised by humans.**
//! Nobody memorises a Kociemba solution, so it can change between versions and no one notices; a
//! learner does memorise `R U2 R' U' R U R' U' R U' R'`. Regenerating a year later and shifting an
//! entry by one move invalidates muscle memory built on it. So the table must be right the first
//! time and REGENERABLE TO THE SAME BYTES, which is what `cases::tie_break` and
//! `search::prove_all` are for.
//!
//!   cargo run --release -p optimal-solver --bin gen-cases -- pll table.json certificates.txt
//!   cargo run --release -p optimal-solver --bin gen-cases -- oll table.json certificates.txt
//!
//! ## What a claimed length L obliges, and how it is discharged
//!
//! §7a finding F3: an algorithm's goal is a SET, so `L` obliges *"for every g in the goal set, no
//! solution of `g⁻¹C` shorter than L"*. Certifying the winning goal alone would leave a shorter
//! algorithm reaching a DIFFERENT acceptable goal completely unruled-out.
//!
//! One pass over the goal set discharges it, at cap `L`:
//!
//! - `Ok(L)` — this goal achieves L, and `prove` exhausted every contour below L to say so. That
//!   IS the "nothing shorter to this goal" evidence.
//! - `BeyondCap` — no solution within L at all, so certainly none shorter.
//!
//! Either way every goal gets a `case-lower` record at bound `L-1`, which is what
//! `case_certificate.rs` requires and refuses to do without.
//!
//! ## The goal sets, and why they are what they are
//!
//! **PLL: the four AUF states.** The stored algorithm is the thing that gets memorised, and "turn
//! the top until it matches" is a separate instruction the solver emits — §7's own answer to its
//! own open question. So a PLL algorithm need only reach solved-up-to-a-final-U.
//!
//! **OLL: the 288 last-layer permutations.** Top oriented, first two layers intact, any
//! permutation. This is §4's reduction exactly, and the set the F3 obligation is over.
//!
//! ## The ALIGNMENT is free too, and forgetting that gets the wrong table
//!
//! A case is an orbit, and its representative is one member. A learner turns the top until the
//! case matches the picture they memorised and only then executes — so the alignment is chosen,
//! not given, and the case's optimum is the SHORTEST over all four alignments. A first run here
//! fixed the representative and got 2 PLL cases at 14 where the published per-case table has three
//! (E, F and V perms); minimising over the alignment as well is what reproduces it.
//!
//! That makes the F3 obligation bigger, and the certificate says so: the goal set a case's length
//! is claimed against is the PRODUCT of the four alignments and the goals, so a claimed L obliges
//! "for every alignment and every goal, nothing shorter". Sixteen records per PLL case, 1,152 per
//! OLL case. Recording only the winning alignment would leave three quarters of the claim unmade.
//!
//! ## What this does NOT claim
//!
//! It does not claim the tables are complete against a published set, and it does not compare
//! anything: that is C4, and it needs the reference sets B5 fetches. It claims what `prove` can
//! support — reached the goal, broke nothing, strict HTM face turns, and no shorter algorithm
//! exists to any acceptable goal.

use optimal_solver::cases::{case_of, oll_states, pick, pll_states, Kind};
use optimal_solver::coords::Coords;
use optimal_solver::cubie::{apply_alg, compose, inverse, Cubie, SOLVED};
use optimal_solver::pdb::move_set_hash;
use optimal_solver::search::{prove, prove_all, solution_string, SearchEnd};
use optimal_solver::Tables;
use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

/// God's number: the cap for the first, uncapped search of a case.
const CAP: u8 = 20;

fn usage() -> ! {
    eprintln!("usage: gen-cases <oll|pll> <table.json> <certificates.txt> [--cases N]");
    std::process::exit(1)
}

/// One representative state per case, in case-id order — so the table's rows, and the bytes of
/// the file, are a function of the case set and of nothing else.
fn representatives(kind: Kind) -> Vec<(String, Cubie)> {
    let states = match kind {
        Kind::Oll => oll_states(),
        Kind::Pll => pll_states(),
    };
    let mut by_case: BTreeMap<String, Cubie> = BTreeMap::new();
    for s in states {
        let id = case_of(kind, &s).id();
        // The SMALLEST state in the orbit, by its own projection, so "the representative" does not
        // depend on the order `oll_states()` happens to yield.
        by_case
            .entry(id)
            .and_modify(|held| {
                if state_key(&s) < state_key(held) {
                    *held = s.clone();
                }
            })
            .or_insert(s);
    }
    by_case.into_iter().collect()
}

/// A total order on states, for choosing a representative deterministically.
fn state_key(s: &Cubie) -> (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) {
    (s.cp.to_vec(), s.co.to_vec(), s.ep.to_vec(), s.eo.to_vec())
}

/// The goal set a `kind`'s algorithms may end in.
fn goal_set(kind: Kind) -> (String, Vec<Cubie>) {
    match kind {
        // Solved up to a final U turn: the case algorithm is what gets learned, and the alignment
        // is an instruction the solver emits beside it.
        Kind::Pll => {
            let u = optimal_solver::cubie::all_moves()[0].clone();
            let mut out = vec![SOLVED];
            for _ in 0..3 {
                out.push(compose(out.last().expect("non-empty"), &u));
            }
            ("auf4".to_string(), out)
        }
        // Top oriented, first two layers intact, ANY last-layer permutation — §4's reduction.
        Kind::Oll => ("pll288".to_string(), pll_states()),
    }
}

struct Entry {
    id: String,
    length: u8,
    alg: Vec<u8>,
    facelets: String,
    goals_at_optimum: usize,
    /// How far the top is turned before the algorithm is executed — a separate instruction the
    /// solver emits, and the reason the stored body is the thing that gets memorised.
    alignment: usize,
    nodes: u64,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (kind_arg, table_path, cert_path, limit) = match args.as_slice() {
        [k, t, c] => (k.clone(), t.clone(), c.clone(), usize::MAX),
        [k, t, c, flag, n] if flag == "--cases" => (
            k.clone(),
            t.clone(),
            c.clone(),
            n.parse().unwrap_or_else(|_| usage()),
        ),
        _ => usage(),
    };
    let kind = match kind_arg.as_str() {
        "oll" => Kind::Oll,
        "pll" => Kind::Pll,
        _ => usage(),
    };

    eprintln!("generating tables…");
    let tables = Tables::generate(&mut |_, _, _| {}).expect("tables");
    let cancel = AtomicBool::new(false);
    let hash: String = move_set_hash().iter().map(|b| format!("{b:02x}")).collect();

    let (goalset_base, goals) = goal_set(kind);
    // The alignment is part of the claim, so it is part of the goal set's identity: a certificate
    // taken over one alignment must never be read as covering four.
    let goalset_id = format!("{goalset_base}x auf4");
    let u = optimal_solver::cubie::all_moves()[0].clone();
    let alignments: Vec<Cubie> = {
        let mut out = vec![SOLVED];
        for _ in 0..3 {
            out.push(compose(out.last().expect("non-empty"), &u));
        }
        out
    };
    // Every (alignment, goal) pair, in a fixed order both passes and the certificate agree on.
    let pairs: Vec<(usize, usize)> = (0..alignments.len())
        .flat_map(|a| (0..goals.len()).map(move |g| (a, g)))
        .collect();
    let cases = representatives(kind);
    let expect = match kind {
        Kind::Oll => 58,
        Kind::Pll => 22,
    };
    assert_eq!(
        cases.len(),
        expect,
        "{kind_arg}: the case set is not the size it should be"
    );
    eprintln!(
        "{kind_arg}: {} cases, goal set {goalset_id} — {} goals x {} alignments = {} pairs",
        cases.len(),
        goals.len(),
        alignments.len(),
        pairs.len()
    );

    let mut entries: Vec<Entry> = Vec::new();
    let mut certificates: Vec<String> = vec![format!(
        "case-goals moveset={hash} kind={kind_arg} goalset={} size={}",
        goalset_id.replace(' ', ""),
        pairs.len()
    )];
    let run = Instant::now();

    for (n, (id, state)) in cases.iter().enumerate() {
        if n >= limit {
            break;
        }
        let t = Instant::now();
        let facelets = optimal_solver::cubie::to_facelets(state);

        // The SKIP: already at a goal, so there is no algorithm and nothing to bound. Carrying
        // lower bounds for it would be evidence about something that does not exist, and
        // `case_certificate.rs` refuses exactly that.
        if goals.iter().any(|g| g == state) {
            certificates.push(format!(
                "case-alg moveset={hash} kind={kind_arg} case={id} length=0 alg="
            ));
            entries.push(Entry {
                id: id.clone(),
                length: 0,
                alg: Vec::new(),
                facelets,
                goals_at_optimum: goals.iter().filter(|g| *g == state).count(),
                alignment: 0,
                nodes: 0,
            });
            eprintln!("{}/{}: {id} — the skip", n + 1, cases.len());
            continue;
        }

        // Pass A — find L, with the incumbent as the cap. A goal that cannot beat the best found
        // so far is not worth exhausting past it, and without this cap every one of the goals runs
        // to God's number. This is the pass B6 measured at ~9.4 s per OLL case.
        let mut best = u8::MAX;
        let mut nodes = 0u64;
        let aligned = |a: usize| compose(state, &alignments[a]);
        for &(a, g) in &pairs {
            let start = compose(&inverse(&goals[g]), &aligned(a));
            let cap = if best == u8::MAX { CAP } else { best - 1 };
            if let Ok(p) = prove(
                &tables,
                &Coords::from_cubie(&start),
                cap,
                &cancel,
                &mut |_, _| {},
            ) {
                nodes += p.nodes;
                best = best.min(p.length);
            }
        }
        assert!(best != u8::MAX, "{id}: no goal is reachable within {CAP}");
        let length = best;

        // Pass B — the F3 obligation, over every goal, at cap L. `Ok(L)` is a goal that achieves
        // the optimum AND the exhaustion of every contour below it; `BeyondCap` is a goal with
        // nothing within L at all. Both discharge "no solution shorter than L to this goal", and
        // a third outcome would mean L was not the minimum.
        let mut minimal: Vec<(usize, Vec<u8>)> = Vec::new();
        let mut achievers = 0usize;
        for (index, &(a, g)) in pairs.iter().enumerate() {
            let start = compose(&inverse(&goals[g]), &aligned(a));
            let coords = Coords::from_cubie(&start);
            match prove(&tables, &coords, length, &cancel, &mut |_, _| {}) {
                Ok(p) => {
                    assert_eq!(
                        p.length, length,
                        "{id}: a pair beat the minimum found in pass A"
                    );
                    nodes += p.nodes;
                    achievers += 1;
                    // Every minimal maneuver to this pair, not merely the one a thread won with.
                    let all = prove_all(&tables, &coords, length, &cancel, &mut |_, _| {})
                        .expect("the length is already known");
                    nodes += all.nodes;
                    minimal.extend(all.solutions.into_iter().map(|s| (a, s)));
                }
                Err(SearchEnd::BeyondCap) => {}
                Err(e) => panic!("{id}: search ended as {e:?}"),
            }
            certificates.push(format!(
                "case-lower moveset={hash} kind={kind_arg} case={id} goal={index} bound={} result=NO-SOLUTION",
                length - 1
            ));
        }

        // ONE algorithm per case, chosen by the stated rule rather than by which thread won. The
        // ALIGNMENT is part of the entry — the algorithm is written for the alignment it was found
        // at, and the solver emits that alignment as a separate instruction (§7).
        minimal.sort_by(|(aa, a), (bb, b)| optimal_solver::cases::tie_break(a, b).then(aa.cmp(bb)));
        minimal.dedup();
        let bodies: Vec<Vec<u8>> = minimal.iter().map(|(_, s)| s.clone()).collect();
        let alg = pick(&bodies).to_vec();
        let alignment = minimal
            .iter()
            .find(|(_, s)| *s == alg)
            .map(|(a, _)| *a)
            .expect("the picked algorithm came from the set");
        let alg_text = solution_string(&alg);

        // The founding gate, and it trusts nothing: APPLY the algorithm — after its alignment — and
        // check it reaches a goal. A mistyped or mis-picked entry cannot survive this, whatever the
        // prover said.
        let reached = apply_alg(&aligned(alignment), &alg_text).expect("our own notation");
        assert!(
            goals.contains(&reached),
            "{id}: the chosen algorithm does not reach the goal set"
        );
        assert_eq!(
            alg.len(),
            length as usize,
            "{id}: the chosen algorithm is not of length L"
        );

        let secs = t.elapsed().as_secs_f64();
        certificates.push(format!(
            "case-alg moveset={hash} kind={kind_arg} case={id} length={length} alg={}",
            alg_text.split_whitespace().collect::<Vec<_>>().join(".")
        ));
        eprintln!(
            "{}/{}: {id} — {length} moves, alignment {alignment}, {achievers} of {} pairs at the optimum, {} minimal in all, {:.1}s (total {:.0}s)",
            n + 1,
            cases.len(),
            pairs.len(),
            minimal.len(),
            secs,
            run.elapsed().as_secs_f64()
        );
        entries.push(Entry {
            id: id.clone(),
            length,
            alg,
            facelets,
            goals_at_optimum: achievers,
            alignment,
            nodes,
        });
    }

    // Hand-rolled JSON, as `gen-library.rs` does: every field is a move string over [URFDLB'2 ],
    // a facelet string, or a number — no escaping exists to get wrong. Written by
    // write-then-rename, so an interruption leaves either the old file or none.
    let rows: Vec<String> = entries
        .iter()
        .map(|e| {
            format!(
                "    {{ \"case\": \"{}\", \"facelets\": \"{}\", \"length\": {}, \"alg\": \"{}\", \"alignment\": {}, \"goalsAtOptimum\": {} }}",
                e.id,
                e.facelets,
                e.length,
                solution_string(&e.alg),
                e.alignment,
                e.goals_at_optimum
            )
        })
        .collect();
    let json = format!(
        "{{\n  \"kind\": \"{kind_arg}\",\n  \"moveset\": \"{hash}\",\n  \"goalSet\": \"{}\",\n  \"goals\": {},\n  \"cases\": [\n{}\n  ]\n}}\n",
        goalset_id.replace(' ', ""),
        pairs.len(),
        rows.join(",\n")
    );
    write_atomic(&table_path, &json);
    write_atomic(&cert_path, &format!("{}\n", certificates.join("\n")));

    let solved: Vec<&Entry> = entries.iter().filter(|e| e.length > 0).collect();
    let total: usize = solved.iter().map(|e| e.length as usize).sum();
    eprintln!(
        "\n{} cases in {:.0}s | mean optimum {:.4} | longest {} | {} nodes",
        entries.len(),
        run.elapsed().as_secs_f64(),
        total as f64 / solved.len().max(1) as f64,
        solved.iter().map(|e| e.length).max().unwrap_or(0),
        entries.iter().map(|e| e.nodes).sum::<u64>()
    );
    eprint!("histogram");
    for len in 0..=20u8 {
        let n = entries.iter().filter(|e| e.length == len).count();
        if n > 0 {
            eprint!(" {len}:{n}");
        }
    }
    eprintln!("\nwrote {table_path} and {cert_path}");
}

fn write_atomic(path: &str, body: &str) {
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, body).unwrap_or_else(|e| panic!("cannot write {tmp}: {e}"));
    std::fs::rename(&tmp, path).unwrap_or_else(|e| panic!("cannot move {tmp} into place: {e}"));
}
