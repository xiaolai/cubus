//! The verification bar from optimal-solver-plan.md §7, as runnable checks. One binary on
//! purpose: table generation is minutes of BFS, so every check here shares one generation —
//! and generation itself asserts the exhaustive histograms and diameters before returning.
//!
//! Tiers: plain `cargo test --release` runs everything below a few seconds per proof;
//! `-- --ignored` adds the deeper geodesic certifications. The deepest (L ≥ 14 and the
//! superflip's exact 20) run through `src/bin/certify.rs`, recorded in the plan's stamps.

use optimal_solver::coords::Coords;
use optimal_solver::cubie::{
    all_moves, apply_alg, apply_move, inverse, parse_facelets, to_facelets, MOVE_NAMES, SOLVED,
    SUPERFLIP_GEODESIC,
};
use optimal_solver::pdb;
use optimal_solver::search::{prove, solution_string, SearchEnd};
use optimal_solver::Tables;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

static TABLES: OnceLock<Tables> = OnceLock::new();

/// Generate-once-and-validate: reaching this at all means the exact histograms held, the
/// diameters held, and Bellman certified every entry of every table.
fn tables() -> &'static Tables {
    TABLES.get_or_init(|| {
        Tables::generate(&mut |_, _, _| {}).expect("generation must validate or refuse")
    })
}

fn prove_state(state: &optimal_solver::cubie::Cubie, cap: u8) -> (u8, Vec<u8>, u64) {
    let cancel = AtomicBool::new(false);
    let proof = prove(
        tables(),
        &Coords::from_cubie(state),
        cap,
        &cancel,
        &mut |_, _| {},
    )
    .expect("within cap");
    (proof.length, proof.solution, proof.nodes)
}

#[test]
fn superflip_heuristic_triple_is_exactly_0_7_8() {
    let t = tables();
    let s = apply_alg(&SOLVED, SUPERFLIP_GEODESIC).unwrap();
    let c = Coords::from_cubie(&s);
    let triple = [
        t.corner().get(c.corner_index()),
        t.edge_a().get(c.edge_a_index()),
        t.edge_b().get(c.edge_b_index()),
    ];
    // §7: the corrected milestone. Corners are solved on the superflip, so the corner value is
    // 0 — the vacuity the original plan missed — and the two edge tables read 7 and 8.
    assert_eq!(triple[0], 0);
    let mut edges = [triple[1], triple[2]];
    edges.sort_unstable();
    assert_eq!(
        edges,
        [7, 8],
        "the edge halves of the triple moved: {triple:?}"
    );
}

#[test]
fn metric_contract_all_18_moves_cost_one_and_r2_is_depth_1() {
    // §7 metric row: a QTM table wearing an HTM name would price R2 at 2 and destroy
    // optimality. Every single-move state must prove at exactly 1.
    let moves = all_moves();
    for (i, mv) in moves.iter().enumerate() {
        let s = apply_move(&SOLVED, mv);
        let (len, sol, _) = prove_state(&s, 3);
        assert_eq!(len, 1, "{} must be depth 1", MOVE_NAMES[i]);
        assert_eq!(sol.len(), 1);
    }
}

#[test]
fn u_then_d_is_depth_2_so_pruning_deleted_no_optimal_path() {
    // §7 move-pruning row: an unsafe canonicalisation that dropped both orders of the
    // commuting pair would push U·D to depth 3 or lose it entirely.
    let s = apply_alg(&SOLVED, "U D").unwrap();
    let (len, _, _) = prove_state(&s, 4);
    assert_eq!(len, 2);
}

#[test]
fn htm_ball_shells_to_depth_5_are_exact() {
    // §7: 18, 243, 3240, 43239, 574908 — an independently generated ball. Counted over real
    // states (coordinate 6-tuples are a faithful key: together they determine the cube).
    use std::collections::HashSet;
    let t = tables();
    let key = |c: &Coords| -> u128 {
        (c.cperm as u128)
            | (c.twist as u128) << 32
            | (c.pos_a as u128) << 48
            | (c.flip_a as u128) << 72
            | (c.pos_b as u128) << 80
            | (c.flip_b as u128) << 104
    };
    let expected = [18u64, 243, 3240, 43239, 574908];
    let mut seen: HashSet<u128> = HashSet::new();
    let start = Coords::from_cubie(&SOLVED);
    seen.insert(key(&start));
    let mut frontier = vec![start];
    for (depth, &want) in expected.iter().enumerate() {
        let mut next = Vec::new();
        for c in &frontier {
            for m in 0..18 {
                let n = c.step(t.moves(), m);
                if seen.insert(key(&n)) {
                    next.push(n);
                }
            }
        }
        assert_eq!(next.len() as u64, want, "shell {} moved", depth + 1);
        frontier = next;
    }
}

#[test]
fn geodesic_segments_prove_their_exact_depth_shallow_tier() {
    // §7's fixture set: every contiguous segment of a 20-move superflip geodesic is a position
    // of exactly known depth. The shallow tier certifies L ≤ 9 across every offset — deeper
    // rungs are the ignored tier and the certify binary.
    let moves_str: Vec<&str> = SUPERFLIP_GEODESIC.split_whitespace().collect();
    for len in 1..=9usize {
        for start in 0..=(20 - len) {
            let alg = moves_str[start..start + len].join(" ");
            let s = apply_alg(&SOLVED, &alg).unwrap();
            let (proved, sol, _) = prove_state(&s, len as u8);
            assert_eq!(
                proved as usize,
                len,
                "segment [{start}..{}) '{alg}'",
                start + len
            );
            // The solution must actually solve the position — checked in the same independent
            // state model the JS oracle test re-checks through cubejs at the seam.
            let solved = apply_alg(&s, &solution_string(&sol)).unwrap();
            assert_eq!(solved, SOLVED, "solution does not solve '{alg}'");
        }
    }
}

#[test]
#[ignore = "minutes: the L=10..=13 geodesic tier — run with --ignored"]
fn geodesic_segments_prove_their_exact_depth_deep_tier() {
    let moves_str: Vec<&str> = SUPERFLIP_GEODESIC.split_whitespace().collect();
    for len in 10..=13usize {
        for start in 0..=(20 - len) {
            let alg = moves_str[start..start + len].join(" ");
            let s = apply_alg(&SOLVED, &alg).unwrap();
            let (proved, _, nodes) = prove_state(&s, len as u8);
            assert_eq!(
                proved as usize,
                len,
                "segment [{start}..{}) — {nodes} nodes",
                start + len
            );
        }
    }
}

#[test]
fn symmetry_expansion_inverse_of_a_segment_has_the_same_depth() {
    // §7 expands the fixtures by rotations and inverses; the inverse is the cheap half and
    // exercises a genuinely different search. d(s) == d(s⁻¹) always (invert the path).
    let moves_str: Vec<&str> = SUPERFLIP_GEODESIC.split_whitespace().collect();
    for (start, len) in [(0usize, 7usize), (5, 8), (11, 9), (3, 6)] {
        let alg = moves_str[start..start + len].join(" ");
        let s = apply_alg(&SOLVED, &alg).unwrap();
        let (proved, _, _) = prove_state(&inverse(&s), len as u8);
        assert_eq!(proved as usize, len, "inverse of '{alg}'");
    }
}

#[test]
fn cancellation_acknowledges_fast_and_the_solver_survives_it() {
    // §7 cancellation row: start a hopeless search, cancel, require a prompt Err — never a
    // "best found" dressed as optimal — then prove something real on the same tables. The ×100
    // stress keeps the thread pool and the tables stable across repeated cancels.
    //
    // THE PROMISE IS MEASURED IN NODES, NOT MILLISECONDS. The solver polls the cancel flag every
    // CANCEL_STRIDE nodes and flushes its count at every poll, so after the flag flips each of
    // the pool's threads can visit at most one more stride before it sees the flag and unwinds —
    // plus the stride of a root it may have started meanwhile, plus the unflushed stride it held
    // when the flag flipped. That bound is a property of the code and holds on any machine; a
    // wall-clock bound holds on a machine that is not busy, which a shared CI runner is not
    // (measured: one preempted thread stretched one round to 409 ms with the solver entirely
    // correct). The milliseconds are still printed, as information.
    use optimal_solver::search::{prove_counted, CANCEL_STRIDE};
    use std::sync::atomic::AtomicU64;
    let t = tables();
    let superflip = apply_alg(&SOLVED, SUPERFLIP_GEODESIC).unwrap();
    let coords = Coords::from_cubie(&superflip);
    // A dedicated pool: the ack contract is "the SOLVER acknowledges within a stride", and in
    // this test binary the global rayon pool is also running sibling tests' parallel work.
    // The app's proof owns its pool in practice; the test recreates that premise instead of
    // measuring the harness's congestion.
    const THREADS: u64 = 4;
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(THREADS as usize)
        .build()
        .unwrap();
    let mut worst_since_cancel = 0u64;
    let mut acks: Vec<std::time::Duration> = Vec::with_capacity(100);
    for round in 0..100 {
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let counter = std::sync::Arc::new(AtomicU64::new(0));
        let flag = cancel.clone();
        let read = counter.clone();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(if round == 0 {
                100
            } else {
                1
            }));
            flag.store(true, Ordering::Relaxed);
            // The count at the moment of the flip, read AFTER the store so nothing visited
            // before the flag was visible is charged to the solver.
            (read.load(Ordering::Relaxed), std::time::Instant::now())
        });
        let out = pool.install(|| prove_counted(t, &coords, 20, &cancel, &counter, &mut |_, _| {}));
        let (at_flip, cancelled_at) = handle.join().unwrap();
        let ack = cancelled_at.elapsed();
        assert!(matches!(out, Err(SearchEnd::Cancelled)), "round {round}");
        let since = counter.load(Ordering::Relaxed).saturating_sub(at_flip);
        worst_since_cancel = worst_since_cancel.max(since);
        acks.push(ack);
    }
    // Per thread: the stride it was inside (unflushed, so it counts when it lands), the stride
    // it needs to reach the next poll, and one stride for a root it may have started before the
    // contour's stop flag caught up. Deterministic; a broken cancellation breaks it by orders of
    // magnitude, not by a margin.
    let bound = THREADS * 3 * CANCEL_STRIDE;
    assert!(
        worst_since_cancel <= bound,
        "the solver visited {worst_since_cancel} nodes after a cancel; the stride bound is {bound}"
    );
    acks.sort();
    let median = acks[acks.len() / 2];
    let worst = *acks.last().unwrap();
    eprintln!(
        "cancellation: worst nodes-since-cancel {worst_since_cancel} (bound {bound}); wall clock \
         median {median:?}, worst {worst:?} — informational"
    );
    let r2 = apply_alg(&SOLVED, "R2").unwrap();
    let (len, _, _) = prove_state(&r2, 2);
    assert_eq!(len, 1, "the solver must be whole after 100 cancels");
}

#[test]
fn artifacts_round_trip_and_every_corruption_is_refused() {
    // §7 packed-layout row. The corner table is 44 MB — serialize once, attack it many ways.
    let t = tables();
    let bytes = pdb::serialize(t.corner());
    let back = pdb::deserialize(&bytes, pdb::Kind::Corner).expect("clean file loads");
    assert_eq!(back.nibbles(), t.corner().nibbles());

    // Interrupted generation at 1%, 50%, 99% — a prefix is never a database.
    for frac in [1usize, 50, 99] {
        let cut = bytes.len() * frac / 100;
        assert!(
            pdb::deserialize(&bytes[..cut], pdb::Kind::Corner).is_err(),
            "cut at {frac}%"
        );
    }
    // A single bit flip anywhere — header, payload, histogram — must be refused.
    for at in [9usize, 60, bytes.len() / 2, bytes.len() - 40] {
        let mut bad = bytes.clone();
        bad[at] ^= 0x10;
        assert!(
            pdb::deserialize(&bad, pdb::Kind::Corner).is_err(),
            "bit flip at {at}"
        );
    }
    // Every header field doctored INDIVIDUALLY, each under a freshly recomputed checksum —
    // the reseal is what separates "the checksum caught it" from "the field check caught it".
    let reseal = |bytes: &mut [u8]| {
        use sha2::{Digest, Sha256};
        let body = bytes.len() - 32;
        let digest: [u8; 32] = Sha256::digest(&bytes[..body]).into();
        bytes[body..].copy_from_slice(&digest);
    };
    // Offsets per the layout: magic 0..8, version 8..12, kind 12, metric 13, reserved 14..16,
    // move-set hash 16..48, count 48..56.
    for (name, at, delta) in [
        ("magic", 0usize, 1u8),
        ("version", 8, 1),
        ("kind byte", 12, 1),
        ("metric byte", 13, 1),
        ("reserved", 14, 1),
        ("count", 48, 1),
    ] {
        let mut bad = bytes.clone();
        bad[at] ^= delta;
        reseal(&mut bad);
        assert!(
            pdb::deserialize(&bad, pdb::Kind::Corner).is_err(),
            "doctored {name} under a valid checksum"
        );
    }
    // A doctored histogram VALUE under a valid checksum: the stored histogram stays the
    // right length and the file reseals clean, so only the payload RECOUNT can catch it.
    {
        let mut bad = bytes.clone();
        let hist_first_value_at = 57; // 56 is the length byte; entries are u64 LE after it
        bad[hist_first_value_at] ^= 0x01;
        reseal(&mut bad);
        assert!(
            pdb::deserialize(&bad, pdb::Kind::Corner).is_err(),
            "doctored histogram value under a valid checksum"
        );
    }
    // And the checksum trailer itself: a flipped bit there must also refuse.
    {
        let mut bad = bytes.clone();
        let last = bad.len() - 1;
        bad[last] ^= 0x01;
        assert!(
            pdb::deserialize(&bad, pdb::Kind::Corner).is_err(),
            "bit flip inside the checksum trailer"
        );
    }
    // The wrong kind under a valid checksum.
    assert!(pdb::deserialize(&bytes, pdb::Kind::EdgeA).is_err());
    // A foreign move set under a valid checksum: rewrite the hash, re-seal the file. This is
    // the QTM-table-wearing-an-HTM-name attack, and the checksum alone cannot catch it.
    let mut forged = bytes.clone();
    forged[16] ^= 0xff; // inside the move-set hash field
    let body_len = forged.len() - 32;
    let reseal: [u8; 32] = {
        use sha2::{Digest, Sha256};
        Sha256::digest(&forged[..body_len]).into()
    };
    forged[body_len..].copy_from_slice(&reseal);
    let err = match pdb::deserialize(&forged, pdb::Kind::Corner) {
        Err(e) => e,
        Ok(_) => panic!("a forged move-set hash loaded as a valid table"),
    };
    assert!(
        err.contains("move-set"),
        "refused for the right reason, got: {err}"
    );
}

#[test]
fn sharded_certification_cannot_falsely_certify_shallow_states() {
    // The two-move openings cannot see depths 0 and 1 — the audit caught that a solved cube
    // would have been "certified" as unsolvable-within-1. Every shard must report the shallow
    // find directly.
    use optimal_solver::search::{certify_no_solution_within, Certification, SearchEnd};
    let cancel = AtomicBool::new(false);
    let solved = Coords::from_cubie(&SOLVED);
    let one = Coords::from_cubie(&apply_alg(&SOLVED, "R").unwrap());
    for i in 0..3u32 {
        assert_eq!(
            certify_no_solution_within(tables(), &solved, 5, (i, 3), &cancel, &mut |_, _| {}),
            Ok(Certification::FoundAt(0)),
            "shard {i}: a solved cube is found at zero, never certified away"
        );
        assert_eq!(
            certify_no_solution_within(tables(), &one, 5, (i, 3), &cancel, &mut |_, _| {}),
            Ok(Certification::FoundAt(1)),
            "shard {i}: a one-move cube is found at one"
        );
    }
    // Invalid shard tuples are refused before any expensive work.
    assert_eq!(
        certify_no_solution_within(tables(), &one, 5, (3, 3), &cancel, &mut |_, _| {}),
        Err(SearchEnd::InvalidShard)
    );
    assert_eq!(
        certify_no_solution_within(tables(), &one, 5, (0, 0), &cancel, &mut |_, _| {}),
        Err(SearchEnd::InvalidShard)
    );
}

#[test]
fn tables_survive_a_save_load_round_trip_and_refuse_a_damaged_directory() {
    // The filesystem path the desktop's prepare command actually takes: save, load, compare;
    // then damage one artifact and watch load refuse the whole set.
    let t = tables();
    let dir = std::env::temp_dir().join(format!("optimal-solver-io-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    t.save(&dir).expect("save must land");
    let back = Tables::load(&dir).expect("a clean directory loads");
    assert_eq!(back.corner().nibbles(), t.corner().nibbles());
    assert_eq!(back.edge_a().nibbles(), t.edge_a().nibbles());
    assert_eq!(back.edge_b().nibbles(), t.edge_b().nibbles());
    // No stray .tmp files: the write-then-rename either completed or left nothing.
    let strays: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(strays.is_empty(), "a temporary file survived the save");
    // Truncate one artifact: the load must refuse, naming the file.
    let victim = dir.join("edge-a.pdb");
    let bytes = std::fs::read(&victim).unwrap();
    std::fs::write(&victim, &bytes[..bytes.len() / 2]).unwrap();
    let err = match Tables::load(&dir) {
        Err(e) => e,
        Ok(_) => panic!("a damaged directory loaded"),
    };
    let text = err.to_string();
    assert!(
        text.contains("edge-a.pdb"),
        "the refusal names the damaged file: {text}"
    );
    assert!(
        matches!(err, optimal_solver::LoadError::Invalid(_)),
        "a truncated artifact is Invalid — the kind regeneration cures"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn deserialize_never_panics_on_crafted_length_fields() {
    // A checksum-valid file with an inflated histogram length once walked the cursor off the
    // body and panicked. Craft exactly that file: bump the length byte, re-seal, deserialize.
    let t = tables();
    let mut bytes = pdb::serialize(t.corner());
    let hist_len_at = 8 + 4 + 4 + 32 + 8; // magic, version, kind/metric/reserved, hash, count
    bytes[hist_len_at] = 200;
    let body_len = bytes.len() - 32;
    let reseal: [u8; 32] = {
        use sha2::{Digest, Sha256};
        Sha256::digest(&bytes[..body_len]).into()
    };
    bytes[body_len..].copy_from_slice(&reseal);
    let err = match pdb::deserialize(&bytes, pdb::Kind::Corner) {
        Err(e) => e,
        Ok(_) => panic!("an inflated histogram length loaded"),
    };
    assert!(
        err.contains("histogram length"),
        "refused for the right reason: {err}"
    );
    // And a sweep: TRUNCATION at every byte boundary of the header region (where all the
    // cursor arithmetic lives — magic through histogram) must return Err, never panic. One
    // crafted length was the original bug; this pins the whole family. Body truncations are
    // covered by the 1%/50%/99% cuts above — sweeping the 44 MB body would re-hash it per
    // cut and cost half an hour for checks that all fail the same length comparison.
    for cut in 0..256 {
        assert!(
            pdb::deserialize(&bytes[..cut], pdb::Kind::Corner).is_err(),
            "truncation at {cut} must refuse"
        );
    }
    // The same prefixes RESEALED, so the checksum passes and the refusal must come from the
    // parser's own cursor arithmetic — the code the crafted-length bug lived in.
    for cut in 32..256 {
        let mut prefix = bytes[..cut].to_vec();
        let body = cut - 32;
        let digest: [u8; 32] = {
            use sha2::{Digest, Sha256};
            Sha256::digest(&prefix[..body]).into()
        };
        prefix[body..].copy_from_slice(&digest);
        assert!(
            pdb::deserialize(&prefix, pdb::Kind::Corner).is_err(),
            "resealed truncation at {cut} must refuse without panicking"
        );
    }
}

#[test]
fn a_doctored_payload_under_a_valid_checksum_is_refused() {
    // The checksum proves a file matches itself; only the payload-histogram recount proves it
    // matches the CERTIFIED table. Flip one nibble deep in the payload and re-seal.
    let t = tables();
    let mut bytes = pdb::serialize(t.corner());
    let payload_start = 8 + 4 + 4 + 32 + 8 + 1 + pdb::CORNER_HISTOGRAM.len() * 8;
    let mid = payload_start + (bytes.len() - 32 - payload_start) / 2;
    bytes[mid] ^= 0x03;
    let body_len = bytes.len() - 32;
    let reseal: [u8; 32] = {
        use sha2::{Digest, Sha256};
        Sha256::digest(&bytes[..body_len]).into()
    };
    bytes[body_len..].copy_from_slice(&reseal);
    let err = match pdb::deserialize(&bytes, pdb::Kind::Corner) {
        Err(e) => e,
        Ok(_) => panic!("a resealed doctored payload loaded"),
    };
    assert!(
        err.contains("payload"),
        "refused for the right reason: {err}"
    );
}

#[test]
fn every_move_table_entry_agrees_with_the_cubie_model() {
    // §7 asks for agreement, and a 200-step trajectory samples it; this certifies it — every
    // (coordinate, move) cell of every factored table equals unrank → cubie move → rerank.
    // The tables under test drive PDB generation AND the search, so nothing downstream can
    // independently catch a single wrong cell that keeps depths compatible.
    use optimal_solver::coords::{
        edge_positions, flip_bits, rank_perm8, rank_pos, rank_twist, unrank_perm8, unrank_pos,
        unrank_twist, N_CPERM, N_MOVES, N_POS, N_TWIST,
    };
    use optimal_solver::cubie::{all_moves, SOLVED};
    use rayon::prelude::*;
    let t = tables();
    let moves = all_moves();

    // Independence matters here: every expected value is derived by embedding the coordinate
    // into a full cubie state and applying the REAL move (apply_move, pinned to cubejs by the
    // 60-move fixture) — never by re-typing the builder's transition formula, which would make
    // the check circular and blind to a shared typo.
    (0..N_CPERM as u32).into_par_iter().for_each(|r| {
        for (m, mv) in moves.iter().enumerate() {
            let mut state = SOLVED;
            state.cp = unrank_perm8(r);
            let after = optimal_solver::cubie::apply_move(&state, mv);
            assert_eq!(
                t.moves().cperm()[r as usize * N_MOVES + m],
                rank_perm8(&after.cp) as u16,
                "cperm[{r}][{m}]"
            );
        }
    });
    (0..N_TWIST as u32).into_par_iter().for_each(|r| {
        for (m, mv) in moves.iter().enumerate() {
            let mut state = SOLVED; // identity cp — twist transitions are slot-indexed
            state.co = unrank_twist(r);
            let after = optimal_solver::cubie::apply_move(&state, mv);
            assert_eq!(
                t.moves().twist()[r as usize * N_MOVES + m],
                rank_twist(&after.co) as u16,
                "twist[{r}][{m}]"
            );
        }
    });
    (0..N_POS as u32).into_par_iter().for_each(|r| {
        // Rebuild a full edge state whose tracked set (cubies 0..5) sits at the unranked
        // slots, apply the real cubie move, and re-derive both the position rank and the
        // flip-xor mask the factored tables claim.
        let pos = unrank_pos(r);
        for (m, mv) in moves.iter().enumerate() {
            let mut state = SOLVED;
            let mut filler = 6u8; // the six untracked cubies fill the six untracked slots
            for slot in 0..12 {
                if !pos.contains(&(slot as u8)) {
                    state.ep[slot] = filler;
                    filler += 1;
                }
            }
            for (i, &slot) in pos.iter().enumerate() {
                state.ep[slot as usize] = i as u8;
            }
            let after = optimal_solver::cubie::apply_move(&state, mv);
            let npos = edge_positions(&after, 0);
            let idx = r as usize * N_MOVES + m;
            assert_eq!(t.moves().pos()[idx], rank_pos(&npos), "pos[{r}][{m}]");
            // The xor mask: flips acquired by the tracked cubies, starting from all-zero.
            let mask = flip_bits(&after, &npos);
            assert_eq!(t.moves().flip_xor()[idx], mask, "flip_xor[{r}][{m}]");
        }
    });
}

#[test]
fn every_single_move_matches_cubejs_exactly() {
    // Eighteen independent anchors, one per move constant, generated by the vendored cubejs
    // (apps/web/vendor/cubejs.js) — not by this crate. The 60-move fixture pins the COMPOSITE
    // of all move types; a compensating pair of errors could in principle cancel there. Here
    // each constant is pinned alone: encoder against the literal, and the literal back
    // through the decoder against the cubie state, so encoder and decoder are each anchored
    // per move, not merely consistent with each other.
    let fixtures: [(&str, &str); 18] = [
        (
            "U",
            "UUUUUUUUUBBBRRRRRRRRRFFFFFFDDDDDDDDDFFFLLLLLLLLLBBBBBB",
        ),
        (
            "U2",
            "UUUUUUUUULLLRRRRRRBBBFFFFFFDDDDDDDDDRRRLLLLLLFFFBBBBBB",
        ),
        (
            "U'",
            "UUUUUUUUUFFFRRRRRRLLLFFFFFFDDDDDDDDDBBBLLLLLLRRRBBBBBB",
        ),
        (
            "R",
            "UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB",
        ),
        (
            "R2",
            "UUDUUDUUDRRRRRRRRRFFBFFBFFBDDUDDUDDULLLLLLLLLFBBFBBFBB",
        ),
        (
            "R'",
            "UUBUUBUUBRRRRRRRRRFFUFFUFFUDDFDDFDDFLLLLLLLLLDBBDBBDBB",
        ),
        (
            "F",
            "UUUUUULLLURRURRURRFFFFFFFFFRRRDDDDDDLLDLLDLLDBBBBBBBBB",
        ),
        (
            "F2",
            "UUUUUUDDDLRRLRRLRRFFFFFFFFFUUUDDDDDDLLRLLRLLRBBBBBBBBB",
        ),
        (
            "F'",
            "UUUUUURRRDRRDRRDRRFFFFFFFFFLLLDDDDDDLLULLULLUBBBBBBBBB",
        ),
        (
            "D",
            "UUUUUUUUURRRRRRFFFFFFFFFLLLDDDDDDDDDLLLLLLBBBBBBBBBRRR",
        ),
        (
            "D2",
            "UUUUUUUUURRRRRRLLLFFFFFFBBBDDDDDDDDDLLLLLLRRRBBBBBBFFF",
        ),
        (
            "D'",
            "UUUUUUUUURRRRRRBBBFFFFFFRRRDDDDDDDDDLLLLLLFFFBBBBBBLLL",
        ),
        (
            "L",
            "BUUBUUBUURRRRRRRRRUFFUFFUFFFDDFDDFDDLLLLLLLLLBBDBBDBBD",
        ),
        (
            "L2",
            "DUUDUUDUURRRRRRRRRBFFBFFBFFUDDUDDUDDLLLLLLLLLBBFBBFBBF",
        ),
        (
            "L'",
            "FUUFUUFUURRRRRRRRRDFFDFFDFFBDDBDDBDDLLLLLLLLLBBUBBUBBU",
        ),
        (
            "B",
            "RRRUUUUUURRDRRDRRDFFFFFFFFFDDDDDDLLLULLULLULLBBBBBBBBB",
        ),
        (
            "B2",
            "DDDUUUUUURRLRRLRRLFFFFFFFFFDDDDDDUUURLLRLLRLLBBBBBBBBB",
        ),
        (
            "B'",
            "LLLUUUUUURRURRURRUFFFFFFFFFDDDDDDRRRDLLDLLDLLBBBBBBBBB",
        ),
    ];
    use optimal_solver::cubie::{all_moves, to_facelets, MOVE_NAMES, SOLVED};
    let moves = all_moves();
    for (i, (name, facelets)) in fixtures.iter().enumerate() {
        assert_eq!(MOVE_NAMES[i], *name, "move order drifted at {i}");
        let after = optimal_solver::cubie::apply_move(&SOLVED, &moves[i]);
        assert_eq!(&to_facelets(&after), facelets, "encoder for {name}");
        assert_eq!(
            parse_facelets(facelets).expect("cubejs emits legal states"),
            after,
            "decoder for {name}"
        );
    }
}

#[test]
fn a_resealed_nibble_swap_passes_the_file_checks_and_bellman_on_load_refuses_it() {
    // The strongest artifact attack in scope: swap two nibbles of DIFFERENT depths (the
    // histogram is a multiset, so it cannot notice), recompute the stored histogram's
    // twin — the payload recount — by construction, and reseal the checksum. Every file
    // check passes. Only the Bellman recurrence, which Tables::load now runs, can catch it.
    let t = tables();
    let mut bytes = pdb::serialize(t.corner());
    let payload_at = 56 + 1 + 12 * 8; // header, histogram length byte, 12 u64 buckets
    let solved_idx = Coords::from_cubie(&SOLVED).corner_index();
    assert_eq!(t.corner().get(solved_idx), 0, "the goal is depth 0");
    let deep_idx = (0..optimal_solver::pdb::Kind::Corner.entries())
        .find(|&i| t.corner().get(i) == 11)
        .expect("the corner table reaches depth 11");
    let read = |bytes: &[u8], i: usize| -> u8 {
        let b = bytes[payload_at + (i >> 1)];
        if i & 1 == 0 {
            b & 0x0f
        } else {
            b >> 4
        }
    };
    let write = |bytes: &mut [u8], i: usize, v: u8| {
        let b = &mut bytes[payload_at + (i >> 1)];
        if i & 1 == 0 {
            *b = (*b & 0xf0) | v;
        } else {
            *b = (*b & 0x0f) | (v << 4);
        }
    };
    let (a, b) = (read(&bytes, solved_idx), read(&bytes, deep_idx));
    assert_eq!((a, b), (0, 11));
    write(&mut bytes, solved_idx, b);
    write(&mut bytes, deep_idx, a);
    let body = bytes.len() - 32;
    let digest: [u8; 32] = {
        use sha2::{Digest, Sha256};
        Sha256::digest(&bytes[..body]).into()
    };
    bytes[body..].copy_from_slice(&digest);
    // Structural verification accepts the forgery — that is the point of the attack…
    let forged = pdb::deserialize(&bytes, pdb::Kind::Corner).expect("file checks pass");
    // …and the recurrence does not.
    let err = optimal_solver::pdb::bellman_validate(&forged, t.moves())
        .expect_err("bellman must refuse a displaced goal");
    assert!(
        err.contains("goal") || err.contains("closer") || err.contains("> 1"),
        "{err}"
    );
    // The wiring: a directory carrying this file is refused by Tables::load as Invalid.
    let dir = std::env::temp_dir().join(format!("cubus-pdb-swap-{}", std::process::id()));
    t.save(&dir).expect("save");
    std::fs::write(dir.join("corner.pdb"), &bytes).expect("plant the forgery");
    let err = match optimal_solver::Tables::load(&dir) {
        Err(e) => e,
        Ok(_) => panic!("a forged table loaded"),
    };
    assert!(
        matches!(err, optimal_solver::LoadError::Invalid(_)),
        "refused as Invalid, the kind regeneration cures"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn facelets_cross_the_seam_faithfully() {
    // The Tauri command will take facelets; a state must survive the trip exactly.
    let s = apply_alg(&SOLVED, "R U F' D2 L B R' U2 F L2").unwrap();
    let parsed = parse_facelets(&to_facelets(&s)).unwrap();
    assert_eq!(parsed, s);
}

#[test]
fn sharded_certification_partitions_the_search_exactly() {
    // The distribution primitive must be airtight before any machine trusts another's shard:
    // a depth-9 geodesic segment has NO solution within 8 — every shard must certify that —
    // and at bound 9 at least one shard must find the solution (they partition the canonical
    // maneuvers, so the 9-move geodesic lives in exactly one opening's shard).
    use optimal_solver::search::{certify_no_solution_within, Certification};
    let moves_str: Vec<&str> = SUPERFLIP_GEODESIC.split_whitespace().collect();
    let s = apply_alg(&SOLVED, &moves_str[0..9].join(" ")).unwrap();
    let coords = Coords::from_cubie(&s);
    let cancel = AtomicBool::new(false);
    for n in [3u32, 5] {
        let mut found_at_9 = 0;
        for i in 0..n {
            let below =
                certify_no_solution_within(tables(), &coords, 8, (i, n), &cancel, &mut |_, _| {})
                    .expect("not cancelled");
            assert_eq!(
                below,
                Certification::NoSolutionWithin,
                "shard {i}/{n} claims a sub-9 solution for a depth-9 state"
            );
            let at =
                certify_no_solution_within(tables(), &coords, 9, (i, n), &cancel, &mut |_, _| {})
                    .expect("not cancelled");
            if let Certification::FoundAt(len) = at {
                assert_eq!(len, 9);
                found_at_9 += 1;
            }
        }
        // EXACTLY one: the geodesic's first two moves select one canonical opening, which
        // i mod n places in one shard. Two finds would mean overlapping shards — the defect
        // a >=1 assertion would have waved through.
        assert_eq!(
            found_at_9, 1,
            "the 9-move solution must live in exactly one of {n} shards — {found_at_9} found it"
        );
    }
}

/// The progress seam, which existed and reported nothing.
///
/// `prove` has taken a progress callback for as long as it has existed, and the only caller that
/// matters — the desktop command — passed `&mut |_, _| {}`. So the one number a waiting person
/// can use never left this crate. What the callback carries is a lower bound being established:
/// contours are reported after they FAIL, so each call means "no solution this short exists",
/// and the answer is at least one move longer.
#[test]
fn a_proof_reports_each_length_it_rules_out_as_it_goes() {
    let t = tables();
    // Chosen so the heuristic UNDERSTATES the answer: 9 against a true 11, so contours 9 and 10
    // must both be exhausted before 11 succeeds. A fixture the heuristic gets exactly right
    // (a six-move state is one) reports nothing at all and would prove nothing here — which the
    // assertion below makes explicit rather than leaving to a silently empty vector.
    let state = apply_alg(&SOLVED, "R U2 F L' D B2 R' U F2 L D'").expect("a legal alg");
    let coords = Coords::from_cubie(&state);
    let cancel = AtomicBool::new(false);

    let mut ruled_out: Vec<u8> = Vec::new();
    let mut nodes_seen: Vec<u64> = Vec::new();
    let proof = prove(t, &coords, 20, &cancel, &mut |bound, nodes| {
        ruled_out.push(bound);
        nodes_seen.push(nodes);
    })
    .expect("a legal state proves within God's number");

    let start_bound = t.heuristic(&coords).max(1);
    assert!(
        start_bound < proof.length,
        "this fixture is solved at its own heuristic ({start_bound} = {}), so no contour fails \
         and the test would pass while reporting nothing",
        proof.length
    );
    // Exact, not merely non-empty: every length between the heuristic and the answer is
    // exhausted, reported once, in order. Anything missing would be a lower bound the UI never
    // heard about; anything extra would be a length claimed exhausted that was not.
    let expected: Vec<u8> = (start_bound..proof.length).collect();
    assert_eq!(
        ruled_out, expected,
        "every failed contour is reported once, in order, between the heuristic and the answer"
    );
    // The claim each event licenses: the answer is at least one more than the last ruled-out
    // length. If that were ever false the UI would be showing a lower bound that is not one.
    assert!(
        ruled_out.iter().all(|&b| proof.length > b),
        "every ruled-out length must be a real lower bound on the answer"
    );
    assert!(
        nodes_seen.windows(2).all(|w| w[1] >= w[0]) && nodes_seen[0] > 0,
        "the node count is cumulative and non-zero: {nodes_seen:?}"
    );
}
