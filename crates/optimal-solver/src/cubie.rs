//! The cube at cubie level — the same model, ordering and composition as
//! `apps/web/lib/cube-pieces.js`, which is cubejs's (Kociemba's) convention. The quarter-turn
//! tables below are this repository's own numbers, copied from cube-pieces.js where a test
//! re-derives them from cubejs on every run; the exhaustive histograms in `pdb.rs` would
//! shatter under any transcription slip here.

/// Corner slots in cubejs order: URF UFL ULB UBR DFR DLF DBL DRB. `cp[i]` is the cubie sitting
/// in slot `i`; `co[i]` its twist. Edges likewise: UR UF UL UB DR DF DL DB FR FL BL BR.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Cubie {
    pub cp: [u8; 8],
    pub co: [u8; 8],
    pub ep: [u8; 12],
    pub eo: [u8; 12],
}

pub const SOLVED: Cubie = Cubie {
    cp: [0, 1, 2, 3, 4, 5, 6, 7],
    co: [0; 8],
    ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    eo: [0; 12],
};

/// The six quarter turns, in U R F D L B face order — cube-pieces.js's QUARTER verbatim.
const QUARTER: [Cubie; 6] = [
    // U
    Cubie {
        cp: [3, 0, 1, 2, 4, 5, 6, 7],
        co: [0; 8],
        ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11],
        eo: [0; 12],
    },
    // R
    Cubie {
        cp: [4, 1, 2, 0, 7, 5, 6, 3],
        co: [2, 0, 0, 1, 1, 0, 0, 2],
        ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0],
        eo: [0; 12],
    },
    // F
    Cubie {
        cp: [1, 5, 2, 3, 0, 4, 6, 7],
        co: [1, 2, 0, 0, 2, 1, 0, 0],
        ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11],
        eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0],
    },
    // D
    Cubie {
        cp: [0, 1, 2, 3, 5, 6, 7, 4],
        co: [0; 8],
        ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11],
        eo: [0; 12],
    },
    // L
    Cubie {
        cp: [0, 2, 6, 3, 4, 1, 5, 7],
        co: [0, 1, 2, 0, 0, 2, 1, 0],
        ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11],
        eo: [0; 12],
    },
    // B
    Cubie {
        cp: [0, 1, 3, 7, 4, 5, 2, 6],
        co: [0, 0, 1, 2, 0, 0, 2, 1],
        ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7],
        eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1],
    },
];

/// `a` then `b`, cube-pieces' compose(): orientation adds in the destination's frame.
pub fn compose(a: &Cubie, b: &Cubie) -> Cubie {
    let mut out = SOLVED;
    for i in 0..8 {
        out.cp[i] = a.cp[b.cp[i] as usize];
        out.co[i] = (a.co[b.cp[i] as usize] + b.co[i]) % 3;
    }
    for i in 0..12 {
        out.ep[i] = a.ep[b.ep[i] as usize];
        out.eo[i] = (a.eo[b.ep[i] as usize] + b.eo[i]) % 2;
    }
    out
}

/// All 18 face turns in cube-pieces' MOVE_NAMES order: for each face U R F D L B, the quarter,
/// the half, the inverse quarter. So `face = m / 3` and opposite faces share `face % 3`.
pub fn all_moves() -> [Cubie; 18] {
    let mut out: [Cubie; 18] = core::array::from_fn(|_| SOLVED);
    for (f, q) in QUARTER.iter().enumerate() {
        let twice = compose(q, q);
        out[f * 3] = q.clone();
        out[f * 3 + 1] = twice.clone();
        out[f * 3 + 2] = compose(&twice, q);
    }
    out
}

pub const MOVE_NAMES: [&str; 18] = [
    "U", "U2", "U'", "R", "R2", "R'", "F", "F2", "F'", "D", "D2", "D'", "L", "L2", "L'", "B", "B2",
    "B'",
];

pub fn apply_move(state: &Cubie, mv: &Cubie) -> Cubie {
    compose(state, mv)
}

/// Apply a space-separated maneuver. Unknown tokens are an error, never skipped.
pub fn apply_alg(state: &Cubie, alg: &str) -> Result<Cubie, String> {
    let moves = all_moves();
    let mut s = state.clone();
    for token in alg.split_whitespace() {
        let idx = MOVE_NAMES
            .iter()
            .position(|n| *n == token)
            .ok_or_else(|| format!("unknown move: {token}"))?;
        s = compose(&s, &moves[idx]);
    }
    Ok(s)
}

/// The group inverse — where each piece came from, twist undone.
pub fn inverse(state: &Cubie) -> Cubie {
    let mut out = SOLVED;
    for i in 0..8 {
        out.cp[state.cp[i] as usize] = i as u8;
        out.co[state.cp[i] as usize] = (3 - state.co[i]) % 3;
    }
    for i in 0..12 {
        out.ep[state.ep[i] as usize] = i as u8;
        out.eo[state.ep[i] as usize] = state.eo[i];
    }
    out
}

/// A 20-move maneuver whose result is the superflip (every piece home, every edge flipped) —
/// the same maneuver apps/web/test/two-phase.test.mjs pins structurally. Since the superflip's
/// distance is the proven 20, this maneuver is a geodesic, and every contiguous segment of it
/// is a position of exactly known depth (plan §7): the fixture set.
pub const SUPERFLIP_GEODESIC: &str = "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2";

// ---- facelets ---------------------------------------------------------------------------------
// The 54-character URFDLB string, exactly apps/web/lib/two-phase.js's convention (which a test
// pins to cubejs at the cubie level). Needed at the seam: Tauri commands take facelets.

const CORNER_NAMES: [&str; 8] = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"];
const EDGE_NAMES: [&str; 12] = [
    "UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR",
];
const CORNER_FACELETS: [[usize; 3]; 8] = [
    [8, 9, 20],
    [6, 18, 38],
    [0, 36, 47],
    [2, 45, 11],
    [29, 26, 15],
    [27, 44, 24],
    [33, 53, 42],
    [35, 17, 51],
];
const EDGE_FACELETS: [[usize; 2]; 12] = [
    [5, 10],
    [7, 19],
    [3, 37],
    [1, 46],
    [32, 16],
    [28, 25],
    [30, 43],
    [34, 52],
    [23, 12],
    [21, 41],
    [50, 39],
    [48, 14],
];
const CENTERS: [usize; 6] = [4, 13, 22, 31, 40, 49];
const FACE_LETTERS: [char; 6] = ['U', 'R', 'F', 'D', 'L', 'B'];

/// Parse a facelet string into a legal cubie state, or say exactly why not. Solvability
/// (orientation sums, permutation parity) is enforced — an unsolvable state must never reach
/// a solver that would search it forever.
pub fn parse_facelets(facelets: &str) -> Result<Cubie, String> {
    // Length first, on the raw bytes: this is the crate's untrusted entry point, and an
    // oversized input should cost a comparison, not an allocation proportional to itself.
    if facelets.len() != 54 {
        // Bytes, not chars: counting chars would scan the oversized input this check exists
        // to not pay for.
        return Err(format!(
            "expected 54 facelets, got {} bytes",
            facelets.len()
        ));
    }
    let f: Vec<char> = facelets.chars().collect();
    if f.len() != 54 {
        return Err(format!("expected 54 facelets, got {}", f.len()));
    }
    for (i, &c) in CENTERS.iter().enumerate() {
        if f[c] != FACE_LETTERS[i] {
            return Err(format!(
                "centre {} is {}, expected {}",
                i, f[c], FACE_LETTERS[i]
            ));
        }
    }
    let mut state = SOLVED;
    for (slot, idx) in CORNER_FACELETS.iter().enumerate() {
        let stickers = [f[idx[0]], f[idx[1]], f[idx[2]]];
        let ori = stickers
            .iter()
            .position(|&s| s == 'U' || s == 'D')
            .ok_or_else(|| format!("corner slot {slot} has no U/D sticker"))?;
        let name: String = (0..3).map(|k| stickers[(ori + k) % 3]).collect();
        let cubie = CORNER_NAMES
            .iter()
            .position(|n| *n == name)
            .ok_or_else(|| format!("corner slot {slot} spells no corner: {name}"))?;
        state.cp[slot] = cubie as u8;
        state.co[slot] = ori as u8;
    }
    for (slot, idx) in EDGE_FACELETS.iter().enumerate() {
        let upright: String = [f[idx[0]], f[idx[1]]].iter().collect();
        let flipped: String = [f[idx[1]], f[idx[0]]].iter().collect();
        if let Some(cubie) = EDGE_NAMES.iter().position(|n| *n == upright) {
            state.ep[slot] = cubie as u8;
            state.eo[slot] = 0;
        } else if let Some(cubie) = EDGE_NAMES.iter().position(|n| *n == flipped) {
            state.ep[slot] = cubie as u8;
            state.eo[slot] = 1;
        } else {
            return Err(format!("edge slot {slot} spells no edge: {upright}"));
        }
    }
    let mut seen_c = [false; 8];
    let mut seen_e = [false; 12];
    for i in 0..8 {
        seen_c[state.cp[i] as usize] = true;
    }
    for i in 0..12 {
        seen_e[state.ep[i] as usize] = true;
    }
    if seen_c.contains(&false) || seen_e.contains(&false) {
        return Err("a piece appears twice".to_string());
    }
    if state.co.iter().map(|&x| x as u32).sum::<u32>() % 3 != 0 {
        return Err("corner twists do not cancel".to_string());
    }
    if state.eo.iter().map(|&x| x as u32).sum::<u32>() % 2 != 0 {
        return Err("edge flips do not cancel".to_string());
    }
    if permutation_parity(&state.cp) != permutation_parity(&state.ep) {
        return Err("permutation parity mismatch".to_string());
    }
    Ok(state)
}

/// The inverse, for the seam's round-trips and for library scrambles.
pub fn to_facelets(state: &Cubie) -> String {
    let mut out = ['?'; 54];
    for (i, &c) in CENTERS.iter().enumerate() {
        out[c] = FACE_LETTERS[i];
    }
    for slot in 0..8 {
        let name: Vec<char> = CORNER_NAMES[state.cp[slot] as usize].chars().collect();
        for k in 0..3 {
            out[CORNER_FACELETS[slot][(k + state.co[slot] as usize) % 3]] = name[k];
        }
    }
    for slot in 0..12 {
        let name: Vec<char> = EDGE_NAMES[state.ep[slot] as usize].chars().collect();
        for k in 0..2 {
            out[EDGE_FACELETS[slot][(k + state.eo[slot] as usize) % 2]] = name[k];
        }
    }
    out.iter().collect()
}

/// Even (0) or odd (1), by cycle decomposition — public because the library generator also
/// needs it, and two implementations of a legality invariant is one too many.
pub fn permutation_parity<const N: usize>(perm: &[u8; N]) -> u32 {
    let mut seen = [false; N];
    let mut swaps = 0;
    for start in 0..N {
        if seen[start] {
            continue;
        }
        let mut len = 0;
        let mut at = start;
        while !seen[at] {
            seen[at] = true;
            at = perm[at] as usize;
            len += 1;
        }
        swaps += len - 1;
    }
    (swaps % 2) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_quarters_are_identity_and_inverses_invert() {
        let moves = all_moves();
        for f in 0..6 {
            let q = &moves[f * 3];
            let mut s = SOLVED;
            for _ in 0..4 {
                s = compose(&s, q);
            }
            assert_eq!(s, SOLVED, "{} four times", MOVE_NAMES[f * 3]);
            assert_eq!(
                compose(&moves[f * 3], &moves[f * 3 + 2]),
                SOLVED,
                "{} then its inverse",
                MOVE_NAMES[f * 3]
            );
            assert_eq!(
                compose(&moves[f * 3 + 1], &moves[f * 3 + 1]),
                SOLVED,
                "{} twice",
                MOVE_NAMES[f * 3 + 1]
            );
        }
    }

    #[test]
    fn superflip_is_every_edge_flipped_in_place() {
        let s = apply_alg(&SOLVED, SUPERFLIP_GEODESIC).unwrap();
        assert_eq!(s.cp, SOLVED.cp);
        assert_eq!(s.co, SOLVED.co);
        assert_eq!(s.ep, SOLVED.ep);
        assert!(
            s.eo.iter().all(|&o| o == 1),
            "the maneuver must be the superflip"
        );
    }

    #[test]
    fn a_sixty_move_walk_matches_cubejs_exactly() {
        // The cross-language anchor the audit asked for: cube-pieces' tables are pinned to
        // cubejs in JS, and this pins the RUST transcription to the same authority. The
        // expected string was produced by the vendored cubejs itself (apps/web/vendor/
        // cubejs.js, via `new Cube().move(alg).asString()`, 2026-08-29) — not by this crate.
        let alg = "R U F' D2 L B R' U2 F L2 D B' U' R2 F2 L' D' B2 U F R2 D' L2 B U2 F' R D \
                   L' B2 U' F2 R' D2 L B' U R F D' L2 U2 B2 R2 F' D L U' B F2 R D2 U L' B' R2 \
                   F D' U2 L";
        let expected = "FDBFUFRLLFDLBRBLBRUFDLFDDDFBLURDRFRDUUBLLUDFLURRUBBBUR";
        let s = apply_alg(&SOLVED, alg).unwrap();
        assert_eq!(
            to_facelets(&s),
            expected,
            "the Rust tables diverge from cubejs"
        );
    }

    #[test]
    fn every_way_a_scan_goes_wrong_is_refused_with_its_reason() {
        // The negative battery, ported from apps/web/test/two-phase.test.mjs — each mutation
        // is a distinct rejection branch, and each must fire.
        let good = to_facelets(&apply_alg(&SOLVED, "R U F' D L2").unwrap());
        let swap = |f: &str, pairs: &[(usize, usize)]| -> String {
            let mut c: Vec<char> = f.chars().collect();
            for &(a, b) in pairs {
                c.swap(a, b);
            }
            c.iter().collect()
        };
        let cases: Vec<(String, &str)> = vec![
            (good[..53].to_string(), "54 facelets"),
            (format!("X{}", &good[1..]), "sticker"), // an unknown letter breaks a piece
            (swap(&good, &[(4, 22)]), "centre"),     // U and F centres traded
            (swap(&good, &[(5, 10)]), "flip"),       // UR edge flipped in place
            (swap(&good, &[(5, 7), (10, 19)]), "parity"), // UR and UF edges swapped
            // Ten of one colour: replace a non-U sticker with U — the piece it lived on now
            // spells nothing (or a duplicate), and the parse must refuse rather than guess.
            (
                {
                    let mut c: Vec<char> = good.chars().collect();
                    let victim = c.iter().position(|&x| x != 'U').unwrap();
                    c[victim] = 'U';
                    c.iter().collect::<String>()
                },
                "",
            ),
        ];
        for (facelets, expect) in cases {
            let err = parse_facelets(&facelets).unwrap_err();
            // An empty expectation means "any refusal will do" — the mutation's exact symptom
            // depends on which sticker it hit, but parsing it must never succeed.
            assert!(
                expect.is_empty()
                    || err.to_lowercase().contains(&expect.to_lowercase())
                    || expect == "flip" && err.contains("flips"),
                "expected a {expect} refusal, got: {err}"
            );
        }
        // And the twisted corner already covered below keeps its own test.
    }

    #[test]
    fn facelets_round_trip_through_random_walks() {
        let moves = all_moves();
        let mut s = SOLVED;
        // A deterministic 60-move walk visits enough structure to catch any table slip.
        for i in 0..60usize {
            s = compose(&s, &moves[(i * 7 + 3) % 18]);
            let f = to_facelets(&s);
            let back = parse_facelets(&f).expect("a legal state must parse");
            assert_eq!(back, s);
        }
        assert_eq!(to_facelets(&SOLVED).len(), 54);
    }

    #[test]
    fn inverse_composes_to_identity() {
        let s = apply_alg(&SOLVED, "R U F' D2 L B R' U2").unwrap();
        assert_eq!(compose(&s, &inverse(&s)), SOLVED);
        assert_eq!(compose(&inverse(&s), &s), SOLVED);
    }

    #[test]
    fn unsolvable_states_are_refused_with_the_reason() {
        let f = to_facelets(&SOLVED);
        // Twist one corner in place: rotate URF's three stickers.
        let mut chars: Vec<char> = f.chars().collect();
        let (a, b, c) = (8, 9, 20);
        let tmp = chars[a];
        chars[a] = chars[c];
        chars[c] = chars[b];
        chars[b] = tmp;
        let twisted: String = chars.iter().collect();
        assert!(parse_facelets(&twisted).unwrap_err().contains("twists"));
    }
}
