//! Coordinates and factored move tables. Each pattern database's index is a bijection onto a
//! small integer range, and every transition is a table lookup — the search never touches a
//! cubie in its hot loop. rank(unrank(i)) == i is asserted exhaustively by tests, and the
//! exhaustive BFS histograms in `pdb.rs` are the deeper check: a single wrong table entry
//! cannot reproduce them.

use crate::cubie::{all_moves, Cubie};

pub const N_CPERM: usize = 40_320; //   8!
pub const N_TWIST: usize = 2_187; //    3^7
pub const CORNER_N: usize = N_CPERM * N_TWIST; // 88,179,840
pub const N_POS: usize = 665_280; //    12·11·10·9·8·7 — ordered placements of six edges
pub const N_FLIP6: usize = 64; //       2^6
pub const EDGE_N: usize = N_POS * N_FLIP6; // 42,577,920
pub const N_MOVES: usize = 18;

/// (n-1-i)! weights for Lehmer ranking of 8-permutations — one table, both directions.
const PERM8_FACTORIALS: [u32; 8] = [5040, 720, 120, 24, 6, 2, 1, 1];

/// Lehmer rank of a full 8-permutation; identity is 0.
pub fn rank_perm8(p: &[u8; 8]) -> u32 {
    const FACT: [u32; 8] = PERM8_FACTORIALS;
    let mut r = 0u32;
    for i in 0..8 {
        let mut smaller = 0u32;
        for j in (i + 1)..8 {
            if p[j] < p[i] {
                smaller += 1;
            }
        }
        r += smaller * FACT[i];
    }
    r
}

pub fn unrank_perm8(mut r: u32) -> [u8; 8] {
    assert!(
        r < N_CPERM as u32,
        "rank {r} outside 8! — a coordinate escaped its range"
    );
    const FACT: [u32; 8] = PERM8_FACTORIALS;
    let mut avail: Vec<u8> = (0..8).collect();
    let mut out = [0u8; 8];
    for i in 0..8 {
        let d = (r / FACT[i]) as usize;
        r %= FACT[i];
        out[i] = avail.remove(d);
    }
    out
}

/// Corner orientation over the first seven corners; the eighth is determined.
pub fn rank_twist(co: &[u8; 8]) -> u32 {
    co[..7].iter().fold(0u32, |acc, &t| acc * 3 + t as u32)
}

pub fn unrank_twist(mut r: u32) -> [u8; 8] {
    assert!(
        r < N_TWIST as u32,
        "rank {r} outside 3^7 — a coordinate escaped its range"
    );
    let mut co = [0u8; 8];
    let mut sum = 0u32;
    for i in (0..7).rev() {
        co[i] = (r % 3) as u8;
        sum += co[i] as u32;
        r /= 3;
    }
    co[7] = ((3 - (sum % 3)) % 3) as u8;
    co
}

/// Where the six tracked edge cubies sit: `pos[i]` is the slot of cubie `base + i`.
pub fn edge_positions(state: &Cubie, base: u8) -> [u8; 6] {
    // A real assert, not debug-only: this runs once per state conversion, not per search
    // node, and a wrong base in release would silently alias slots instead of overflowing.
    assert!(
        base == 0 || base == 6,
        "the two tracked sets start at 0 and 6"
    );
    let mut pos = [0u8; 6];
    for slot in 0..12 {
        let c = state.ep[slot];
        if c >= base && c < base + 6 {
            pos[(c - base) as usize] = slot as u8;
        }
    }
    pos
}

/// Lexicographic rank of an ordered placement of six distinct slots out of twelve.
pub fn rank_pos(pos: &[u8; 6]) -> u32 {
    let mut used = [false; 12];
    let mut r = 0u32;
    for (i, &p) in pos.iter().enumerate() {
        let smaller = used[..p as usize].iter().filter(|u| !**u).count() as u32;
        r = r * (12 - i as u32) + smaller;
        used[p as usize] = true;
    }
    r
}

pub fn unrank_pos(mut r: u32) -> [u8; 6] {
    assert!(
        r < N_POS as u32,
        "rank {r} outside 12P6 — a coordinate escaped its range"
    );
    // Peel mixed-radix digits (most significant first), then map each digit to the d-th
    // unused slot.
    let mut digits = [0u32; 6];
    for i in (0..6).rev() {
        digits[i] = r % (12 - i as u32);
        r /= 12 - i as u32;
    }
    let mut used = [false; 12];
    let mut out = [0u8; 6];
    for (i, &digit) in digits.iter().enumerate() {
        let mut remaining = digit;
        for (s, slot_used) in used.iter_mut().enumerate() {
            if *slot_used {
                continue;
            }
            if remaining == 0 {
                out[i] = s as u8;
                *slot_used = true;
                break;
            }
            remaining -= 1;
        }
    }
    out
}

/// The flip bits of the six tracked cubies: bit `i` is the flip of the cubie at `pos[i]`.
pub fn flip_bits(state: &Cubie, pos: &[u8; 6]) -> u8 {
    let mut f = 0u8;
    for (i, &p) in pos.iter().enumerate() {
        f |= state.eo[p as usize] << i;
    }
    f
}

/// Every factored move table the generators and the search share. Built once (~seconds).
pub struct MoveTables {
    /// cperm × move → cperm
    pub(crate) cperm: Vec<u16>,
    /// twist × move → twist
    pub(crate) twist: Vec<u16>,
    /// pos × move → pos (identical for both edge sets: it is slot arithmetic, not identity)
    pub(crate) pos: Vec<u32>,
    /// pos × move → xor over the six tracked flip bits
    pub(crate) flip_xor: Vec<u8>,
}

impl MoveTables {
    // Read-only views for external cross-checks (the plan_checks test walks every cell).
    // The vectors themselves are crate-private on purpose: these tables underwrite proofs,
    // and `build()` being the only way to make one is what keeps the stamped move-set hash
    // honest — a mutated table can no longer wear it.
    pub fn cperm(&self) -> &[u16] {
        &self.cperm
    }
    pub fn twist(&self) -> &[u16] {
        &self.twist
    }
    pub fn pos(&self) -> &[u32] {
        &self.pos
    }
    pub fn flip_xor(&self) -> &[u8] {
        &self.flip_xor
    }

    pub fn build() -> MoveTables {
        let moves = all_moves();
        // Where does the occupant of slot s land? inv_ep[m][s] = s' with moves[m].ep[s'] == s.
        let mut inv_ep = [[0u8; 12]; 18];
        for (m, mv) in moves.iter().enumerate() {
            for s2 in 0..12 {
                inv_ep[m][mv.ep[s2] as usize] = s2 as u8;
            }
        }

        let mut cperm = vec![0u16; N_CPERM * N_MOVES];
        for r in 0..N_CPERM as u32 {
            let cp = unrank_perm8(r);
            for (m, mv) in moves.iter().enumerate() {
                let mut ncp = [0u8; 8];
                for i in 0..8 {
                    ncp[i] = cp[mv.cp[i] as usize];
                }
                cperm[r as usize * N_MOVES + m] = rank_perm8(&ncp) as u16;
            }
        }

        let mut twist = vec![0u16; N_TWIST * N_MOVES];
        for r in 0..N_TWIST as u32 {
            let co = unrank_twist(r);
            for (m, mv) in moves.iter().enumerate() {
                let mut nco = [0u8; 8];
                for i in 0..8 {
                    nco[i] = (co[mv.cp[i] as usize] + mv.co[i]) % 3;
                }
                twist[r as usize * N_MOVES + m] = rank_twist(&nco) as u16;
            }
        }

        let mut pos = vec![0u32; N_POS * N_MOVES];
        let mut flip_xor = vec![0u8; N_POS * N_MOVES];
        for r in 0..N_POS as u32 {
            let p = unrank_pos(r);
            for (m, mv) in moves.iter().enumerate() {
                let mut np = [0u8; 6];
                let mut mask = 0u8;
                for i in 0..6 {
                    let new_slot = inv_ep[m][p[i] as usize];
                    np[i] = new_slot;
                    mask |= mv.eo[new_slot as usize] << i;
                }
                pos[r as usize * N_MOVES + m] = rank_pos(&np);
                flip_xor[r as usize * N_MOVES + m] = mask;
            }
        }

        MoveTables {
            cperm,
            twist,
            pos,
            flip_xor,
        }
    }
}

/// The full search state as coordinates. Together with the fixed split (edge set A = cubies
/// 0..5, B = 6..11) these six numbers determine the cube completely, so "all at solved values"
/// IS the goal test.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Coords {
    pub cperm: u32,
    pub twist: u32,
    pub pos_a: u32,
    pub flip_a: u8,
    pub pos_b: u32,
    pub flip_b: u8,
}

impl Coords {
    pub fn from_cubie(s: &Cubie) -> Coords {
        let pa = edge_positions(s, 0);
        let pb = edge_positions(s, 6);
        Coords {
            cperm: rank_perm8(&s.cp),
            twist: rank_twist(&s.co),
            pos_a: rank_pos(&pa),
            flip_a: flip_bits(s, &pa),
            pos_b: rank_pos(&pb),
            flip_b: flip_bits(s, &pb),
        }
    }

    pub const SOLVED_B_POS: u32 = 366_288; // rank_pos([6,7,8,9,10,11]) — asserted by a test

    pub fn is_solved(&self) -> bool {
        // The goal is a constant of the fixed edge split — a caller-supplied goal could only
        // ever be this value or a bug.
        self.cperm == 0
            && self.twist == 0
            && self.pos_a == 0
            && self.flip_a == 0
            && self.pos_b == Self::SOLVED_B_POS
            && self.flip_b == 0
    }

    #[inline]
    pub fn step(&self, t: &MoveTables, m: usize) -> Coords {
        let ia = self.pos_a as usize * N_MOVES + m;
        let ib = self.pos_b as usize * N_MOVES + m;
        Coords {
            cperm: t.cperm[self.cperm as usize * N_MOVES + m] as u32,
            twist: t.twist[self.twist as usize * N_MOVES + m] as u32,
            pos_a: t.pos[ia],
            flip_a: self.flip_a ^ t.flip_xor[ia],
            pos_b: t.pos[ib],
            flip_b: self.flip_b ^ t.flip_xor[ib],
        }
    }

    /// The two pattern-database indices for the edges, and the corner index.
    #[inline]
    pub fn corner_index(&self) -> usize {
        self.cperm as usize * N_TWIST + self.twist as usize
    }
    #[inline]
    pub fn edge_a_index(&self) -> usize {
        self.pos_a as usize * N_FLIP6 + self.flip_a as usize
    }
    #[inline]
    pub fn edge_b_index(&self) -> usize {
        self.pos_b as usize * N_FLIP6 + self.flip_b as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cubie::{apply_alg, SOLVED};

    #[test]
    fn ranks_round_trip_exhaustively() {
        // Exhaustive, as §7 asks — every value of every coordinate, no strides. ~1M unranks;
        // seconds even in a debug build.
        for r in 0..N_TWIST as u32 {
            assert_eq!(rank_twist(&unrank_twist(r)), r);
        }
        for r in 0..N_CPERM as u32 {
            assert_eq!(rank_perm8(&unrank_perm8(r)), r);
        }
        for r in 0..N_POS as u32 {
            assert_eq!(rank_pos(&unrank_pos(r)), r);
        }
    }

    #[test]
    #[should_panic(expected = "outside")]
    fn out_of_range_ranks_are_refused_not_aliased() {
        // unrank_twist(N_TWIST) used to silently alias to coordinate zero.
        let _ = unrank_twist(N_TWIST as u32);
    }

    #[test]
    fn solved_coordinates_are_where_the_goal_test_looks() {
        let c = Coords::from_cubie(&SOLVED);
        assert_eq!(c.cperm, 0);
        assert_eq!(c.twist, 0);
        assert_eq!(c.pos_a, 0);
        assert_eq!(c.flip_a, 0);
        assert_eq!(
            c.pos_b,
            Coords::SOLVED_B_POS,
            "the constant must be the computed rank"
        );
        assert_eq!(c.flip_b, 0);
        assert!(c.is_solved());
    }

    #[test]
    fn stepping_coordinates_agrees_with_stepping_cubies() {
        let t = MoveTables::build();
        let mut s = SOLVED;
        let mut c = Coords::from_cubie(&s);
        let moves = crate::cubie::all_moves();
        for i in 0..200usize {
            let m = (i * 5 + 2) % 18;
            s = crate::cubie::compose(&s, &moves[m]);
            c = c.step(&t, m);
            assert_eq!(c, Coords::from_cubie(&s), "diverged at step {i}");
        }
    }

    #[test]
    fn superflip_projects_to_solved_corners() {
        let s = apply_alg(&SOLVED, crate::cubie::SUPERFLIP_GEODESIC).unwrap();
        let c = Coords::from_cubie(&s);
        assert_eq!(
            c.corner_index(),
            0,
            "superflip has solved corners — §7's vacuity point"
        );
        assert_eq!(c.flip_a, 0b11_1111);
        assert_eq!(c.flip_b, 0b11_1111);
    }
}
