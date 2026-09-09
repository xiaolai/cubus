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

use optimal_solver::cases::{pll_states, representatives, Kind};
use optimal_solver::cli::{self, Spec};
use optimal_solver::coords::Coords;
use optimal_solver::cubie::{all_moves, apply_alg, compose, inverse, Cubie, SOLVED};
use optimal_solver::pdb::move_set_hash;
use optimal_solver::search::{prove_all_counted, prove_counted, solution_string, SearchEnd};
use optimal_solver::Tables;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

/// God's number: the cap for the first, uncapped search of a case.
const CAP: u8 = 20;

const SPEC: Spec = Spec {
    usage: "usage: gen-cases <oll|pll> <table.json> <certificates.txt> [--cases N]",
    value_options: &["--cases"],
    flags: &[],
    positionals: 3..=3,
};

/// The four U-turn states, in the order everything here indexes them by.
///
/// ONE constructor. This sequence is both the PLL goal set and the alignment set, and it was built
/// twice from the same three lines — two definitions of an ordering that certificates, table rows
/// and the solver's emitted "turn the top N times" instruction all index into. They agreed; the
/// point is that nothing was making them.
fn auf_states() -> Vec<Cubie> {
    let u = all_moves()[0].clone();
    let mut out = vec![SOLVED];
    for _ in 0..3 {
        out.push(compose(out.last().expect("non-empty"), &u));
    }
    out
}

/// The goal set a `kind`'s algorithms may end in.
fn goal_set(kind: Kind) -> (String, Vec<Cubie>) {
    match kind {
        // Solved up to a final U turn: the case algorithm is what gets learned, and the alignment
        // is an instruction the solver emits beside it.
        Kind::Pll => ("auf4".to_string(), auf_states()),
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

/// Everything a case's generation needs that does not vary between cases.
///
/// `main` used to be 245 lines holding all of this in locals: argument parsing, the goal set, two
/// search passes, the tie-break, the founding gate, serialization, publishing and the summary.
/// Splitting it is not tidying — each of those is a claim someone has to be able to check on its
/// own, and a reader could not see where one ended and the next began.
struct Run<'a> {
    tables: &'a Tables,
    kind_arg: &'a str,
    hash: &'a str,
    goals: &'a [Cubie],
    alignments: &'a [Cubie],
    /// Every (alignment, goal) pair, in the fixed order both passes and the certificate index by.
    pairs: &'a [(usize, usize)],
    cancel: &'a AtomicBool,
}

/// Pass B's output: every minimal maneuver with the alignment it was found at, how many
/// (alignment, goal) pairs reached the optimum, and the `case-lower` record for each pair.
struct Certified {
    minimal: Vec<(usize, Vec<u8>)>,
    achievers: usize,
    certificates: Vec<String>,
}

/// One case's result: the table row, and every certificate record that supports it.
struct Generated {
    entry: Entry,
    certificates: Vec<String>,
    /// How many (alignment, goal) pairs reach the optimum — reported, not certified.
    achievers: usize,
    /// How many minimal maneuvers there were to choose between.
    minimal: usize,
}

impl Run<'_> {
    /// The case state as the learner presents it after turning the top `a` quarter turns.
    fn aligned(&self, state: &Cubie, a: usize) -> Cubie {
        compose(state, &self.alignments[a])
    }

    /// The state a search starts from for one (alignment, goal) pair.
    fn start(&self, state: &Cubie, a: usize, g: usize) -> Cubie {
        compose(&inverse(&self.goals[g]), &self.aligned(state, a))
    }

    /// Pass A — the optimum L, with the incumbent as the cap.
    ///
    /// A goal that cannot beat the best found so far is not worth exhausting past it, and without
    /// this cap every one of the goals runs to God's number. `nodes` counts EVERY search, not only
    /// the ones that returned a proof: a `BeyondCap` search can be most of the work, and totalling
    /// only the successes understated every run this binary has ever reported.
    fn shortest_length(&self, id: &str, state: &Cubie, nodes: &AtomicU64) -> u8 {
        let mut best = u8::MAX;
        for &(a, g) in self.pairs {
            let start = self.start(state, a, g);
            let cap = if best == u8::MAX { CAP } else { best - 1 };
            if let Ok(p) = prove_counted(
                self.tables,
                &Coords::from_cubie(&start),
                cap,
                self.cancel,
                nodes,
                &mut |_, _| {},
            ) {
                best = best.min(p.length);
            }
        }
        assert!(best != u8::MAX, "{id}: no goal is reachable within {CAP}");
        best
    }

    /// Pass B — the F3 obligation, over every pair, at cap L.
    ///
    /// `Ok(L)` is a pair that achieves the optimum AND the exhaustion of every contour below it;
    /// `BeyondCap` is a pair with nothing within L at all. Both discharge "no solution shorter than
    /// L to this pair", and a third outcome would mean L was not the minimum.
    ///
    /// `prove_all` DIRECTLY, not `prove` and then `prove_all`. `prove_all` begins by running the
    /// same `prove` with the same state and the same cap, so asking both repeated every successful
    /// contour search — the expensive half of a pass B6 measured at ~9.4 s per OLL case.
    fn certify(&self, id: &str, state: &Cubie, length: u8, nodes: &AtomicU64) -> Certified {
        let mut minimal: Vec<(usize, Vec<u8>)> = Vec::new();
        let mut achievers = 0usize;
        let mut certificates = Vec::with_capacity(self.pairs.len());
        for (index, &(a, g)) in self.pairs.iter().enumerate() {
            let start = self.start(state, a, g);
            match prove_all_counted(
                self.tables,
                &Coords::from_cubie(&start),
                length,
                self.cancel,
                nodes,
                &mut |_, _| {},
            ) {
                Ok(all) => {
                    assert_eq!(
                        all.length, length,
                        "{id}: a pair beat the minimum found in pass A"
                    );
                    achievers += 1;
                    // Every minimal maneuver to this pair, not merely the one a thread won with.
                    minimal.extend(all.solutions.into_iter().map(|s| (a, s)));
                }
                Err(SearchEnd::BeyondCap) => {}
                Err(e) => panic!("{id}: search ended as {e:?}"),
            }
            certificates.push(format!(
                "case-lower moveset={} kind={} case={id} goal={index} bound={} result=NO-SOLUTION",
                self.hash,
                self.kind_arg,
                length - 1
            ));
        }
        Certified {
            minimal,
            achievers,
            certificates,
        }
    }

    /// The skip: already at a goal, so there is no algorithm and nothing to bound.
    ///
    /// Carrying lower bounds for it would be evidence about something that does not exist, and
    /// `case_certificate.rs` refuses exactly that.
    ///
    /// `goalsAtOptimum` counts (alignment, goal) PAIRS, the same denominator every other row uses.
    /// It used to count goals equal to the unaligned state, which is one — so both skip rows
    /// reported 1 where four pairs reach length zero, and the column meant two different things
    /// depending on the row.
    fn skip(&self, id: &str, state: &Cubie, facelets: String) -> Generated {
        let achievers = self
            .pairs
            .iter()
            .filter(|&&(a, g)| self.aligned(state, a) == self.goals[g])
            .count();
        Generated {
            entry: Entry {
                id: id.to_string(),
                length: 0,
                alg: Vec::new(),
                facelets,
                goals_at_optimum: achievers,
                alignment: 0,
                nodes: 0,
            },
            certificates: vec![format!(
                "case-alg moveset={} kind={} case={id} length=0 alg=",
                self.hash, self.kind_arg
            )],
            achievers,
            minimal: 0,
        }
    }

    /// One case, end to end: the optimum, the obligation, the chosen maneuver and the gate.
    fn generate(&self, id: &str, state: &Cubie) -> Generated {
        let facelets = optimal_solver::cubie::to_facelets(state);
        if self.goals.iter().any(|g| g == state) {
            return self.skip(id, state, facelets);
        }

        let nodes = AtomicU64::new(0);
        let length = self.shortest_length(id, state, &nodes);
        let Certified {
            mut minimal,
            achievers,
            mut certificates,
        } = self.certify(id, state, length, &nodes);

        // ONE algorithm per case, chosen by the stated rule rather than by which thread won. The
        // ALIGNMENT is part of the entry — the algorithm is written for the alignment it was found
        // at, and the solver emits that alignment as a separate instruction (§7).
        //
        // The sort puts the winner first, so it is READ from there. Cloning every body, taking the
        // minimum again with `pick`, and then searching the list for the alignment that maneuver
        // came from asked the same question three times and allocated the whole set to do it.
        minimal.sort_by(|(aa, a), (bb, b)| optimal_solver::cases::tie_break(a, b).then(aa.cmp(bb)));
        minimal.dedup();
        let (alignment, alg) = minimal
            .first()
            .cloned()
            .expect("a case with no minimal maneuver is a search failure, not a tie");
        let alg_text = solution_string(&alg);

        // The founding gate, and it trusts nothing: APPLY the algorithm — after its alignment — and
        // check it reaches a goal. A mistyped or mis-picked entry cannot survive this, whatever the
        // prover said.
        let reached =
            apply_alg(&self.aligned(state, alignment), &alg_text).expect("our own notation");
        assert!(
            self.goals.contains(&reached),
            "{id}: the chosen algorithm does not reach the goal set"
        );
        assert_eq!(
            alg.len(),
            length as usize,
            "{id}: the chosen algorithm is not of length L"
        );

        certificates.push(format!(
            "case-alg moveset={} kind={} case={id} length={length} alg={}",
            self.hash,
            self.kind_arg,
            alg_text.split_whitespace().collect::<Vec<_>>().join(".")
        ));
        Generated {
            entry: Entry {
                id: id.to_string(),
                length,
                alg,
                facelets,
                goals_at_optimum: achievers,
                alignment,
                nodes: nodes.load(Ordering::Relaxed),
            },
            certificates,
            achievers,
            minimal: minimal.len(),
        }
    }
}

/// The table file's bytes.
///
/// Hand-rolled JSON, as `gen-library.rs` does: every field is a move string over [URFDLB'2 ], a
/// facelet string, or a number — no escaping exists to get wrong. `table_json::read_table` is the
/// other half, and it refuses everything this cannot produce.
fn render_table(
    kind_arg: &str,
    hash: &str,
    goalset_id: &str,
    pairs: usize,
    entries: &[Entry],
) -> String {
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
    format!(
        "{{\n  \"kind\": \"{kind_arg}\",\n  \"moveset\": \"{hash}\",\n  \"goalSet\": \"{goalset_id}\",\n  \"goals\": {pairs},\n  \"cases\": [\n{}\n  ]\n}}\n",
        rows.join(",\n")
    )
}

/// What the run found, on stderr, for a human watching a forty-minute job.
fn report(entries: &[Entry], elapsed: f64) {
    let solved: Vec<&Entry> = entries.iter().filter(|e| e.length > 0).collect();
    let total: usize = solved.iter().map(|e| e.length as usize).sum();
    eprintln!(
        "\n{} cases in {elapsed:.0}s | mean optimum {:.4} | longest {} | {} nodes",
        entries.len(),
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
    eprintln!();
}

fn main() {
    let args = cli::parse_or_exit(&SPEC);
    let kind_arg = cli::or_exit(&SPEC, args.positional_one_of(0, "kind", &["oll", "pll"]));
    let table_path = args.positional(1).to_string();
    let cert_path = args.positional(2).to_string();
    let limit: usize = cli::or_exit(&SPEC, args.parsed_in("--cases", 1..=usize::MAX, usize::MAX));
    // Two artifacts, and they must not be one file. `gen-cases pll t.json t.json` used to generate
    // the table, write it, write the certificates over the top of it, and report success.
    cli::or_exit(
        &SPEC,
        optimal_solver::destinations_differ(&[&table_path, &cert_path]),
    );
    let kind = match kind_arg.as_str() {
        "oll" => Kind::Oll,
        _ => Kind::Pll,
    };

    eprintln!("generating tables…");
    let tables = Tables::generate(&mut |_, _, _| {}).expect("tables");
    let cancel = AtomicBool::new(false);
    let hash: String = move_set_hash().iter().map(|b| format!("{b:02x}")).collect();

    let (goalset_base, goals) = goal_set(kind);
    // The alignment is part of the claim, so it is part of the goal set's identity: a certificate
    // taken over one alignment must never be read as covering four.
    let goalset_id = format!("{goalset_base}xauf4");
    let alignments = auf_states();
    // Every (alignment, goal) pair, in a fixed order both passes and the certificate agree on.
    let pairs: Vec<(usize, usize)> = (0..alignments.len())
        .flat_map(|a| (0..goals.len()).map(move |g| (a, g)))
        .collect();
    // THE LOOP CLOSED. `case_certificate` refuses a log whose declared goal set is not the one a
    // claim of this kind is about, and these are the values it requires. Asserting them here means
    // a change to what this binary generates fails at once rather than producing certificates the
    // checker will reject — and a change to the checker's expectation fails here.
    let expected_goal_set = match kind {
        Kind::Oll => optimal_solver::case_certificate::OLL_GOAL_SET,
        Kind::Pll => optimal_solver::case_certificate::PLL_GOAL_SET,
    };
    assert_eq!(
        (goalset_id.as_str(), pairs.len() as u32),
        expected_goal_set,
        "{kind_arg}: the goal set generated is not the one case_certificate requires"
    );
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

    let run = Run {
        tables: &tables,
        kind_arg: &kind_arg,
        hash: &hash,
        goals: &goals,
        alignments: &alignments,
        pairs: &pairs,
        cancel: &cancel,
    };
    let mut entries: Vec<Entry> = Vec::new();
    let mut certificates: Vec<String> = vec![format!(
        "case-goals moveset={hash} kind={kind_arg} goalset={goalset_id} size={}",
        pairs.len()
    )];
    let started = Instant::now();

    for (n, (id, state)) in cases.iter().enumerate() {
        if n >= limit {
            break;
        }
        let t = Instant::now();
        let out = run.generate(id, state);
        if out.entry.length == 0 {
            eprintln!("{}/{}: {id} — the skip", n + 1, cases.len());
        } else {
            eprintln!(
                "{}/{}: {id} — {} moves, alignment {}, {} of {} pairs at the optimum, {} minimal in all, {:.1}s (total {:.0}s)",
                n + 1,
                cases.len(),
                out.entry.length,
                out.entry.alignment,
                out.achievers,
                pairs.len(),
                out.minimal,
                t.elapsed().as_secs_f64(),
                started.elapsed().as_secs_f64()
            );
        }
        certificates.extend(out.certificates);
        entries.push(out.entry);
    }

    let json = render_table(&kind_arg, &hash, &goalset_id, pairs.len(), &entries);
    // ONE publish for the pair: a new table beside stale certificates is worse than either being
    // missing, because it looks complete.
    optimal_solver::write_all_atomic(&[
        (std::path::Path::new(&table_path), json.as_bytes()),
        (
            std::path::Path::new(&cert_path),
            format!("{}\n", certificates.join("\n")).as_bytes(),
        ),
    ])
    .unwrap_or_else(|e| panic!("cannot publish {table_path} and {cert_path}: {e}"));

    report(&entries, started.elapsed().as_secs_f64());
    eprintln!("wrote {table_path} and {cert_path}");
}
