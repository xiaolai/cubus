//! Pattern databases: exhaustive BFS generation, exhaustive validation, and an artifact format
//! that refuses corruption.
//!
//! A wrong table here does not crash — it yields an inadmissible heuristic and a solver that
//! returns non-optimal answers with nothing to see (plan §5/§7). So nothing is sampled:
//! histograms are asserted exactly against the refute pass's own exhaustive BFS, and Bellman
//! validation certifies every entry against every transition.

use crate::coords::{Coords, MoveTables, CORNER_N, EDGE_N, N_FLIP6, N_MOVES, N_TWIST};
use rayon::prelude::*;
use sha2::{Digest, Sha256};

/// Exhaustively measured depth histograms, asserted exactly by the generator — the strongest
/// single check this crate has. The corner and first-edge-set histograms are §7's own numbers
/// and matched on first generation. §7 published ONE histogram for both edge tables, and that
/// over-generalized: the second set is the complement (DL DB FR FL BL BR), which contains no
/// U-face edge, so the three U moves fix its projection and its depth-1 shell is 15 = 18 − 3,
/// not 18. The EDGE_B numbers below are this generator's own exhaustive measurement (first
/// run, 2026-08-29): they sum to exactly 42,577,920, keep §7's diameter of 10, and every
/// entry is additionally certified by Bellman validation, which does not depend on any
/// histogram. The plan file carries the dated correction.
pub const CORNER_HISTOGRAM: [u64; 12] = [
    1, 18, 243, 2874, 28000, 205416, 1168516, 5402628, 20776176, 45391616, 15139616, 64736,
];
pub const EDGE_A_HISTOGRAM: [u64; 11] = [
    1, 18, 230, 2747, 30847, 308783, 2508618, 13189082, 23497569, 3039786, 239,
];
pub const EDGE_B_HISTOGRAM: [u64; 11] = [
    1, 15, 190, 2360, 27139, 281416, 2380459, 13065209, 23961831, 2859244, 56,
];
pub const CORNER_DIAMETER: u8 = 11;
pub const EDGE_DIAMETER: u8 = 10;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Corner,
    EdgeA,
    EdgeB,
}

impl Kind {
    pub fn entries(self) -> usize {
        match self {
            Kind::Corner => CORNER_N,
            Kind::EdgeA | Kind::EdgeB => EDGE_N,
        }
    }
    /// The one place a kind's expected histogram lives — generation and loading both read
    /// this, so they cannot drift apart (EdgeB's deliberately differs from EdgeA's; see the
    /// constants above).
    pub fn expected_histogram(self) -> &'static [u64] {
        match self {
            Kind::Corner => &CORNER_HISTOGRAM,
            Kind::EdgeA => &EDGE_A_HISTOGRAM,
            Kind::EdgeB => &EDGE_B_HISTOGRAM,
        }
    }
    pub fn diameter(self) -> u8 {
        match self {
            Kind::Corner => CORNER_DIAMETER,
            Kind::EdgeA | Kind::EdgeB => EDGE_DIAMETER,
        }
    }
    fn tag(self) -> u8 {
        match self {
            Kind::Corner => 0,
            Kind::EdgeA => 1,
            Kind::EdgeB => 2,
        }
    }
    fn from_tag(t: u8) -> Option<Kind> {
        match t {
            0 => Some(Kind::Corner),
            1 => Some(Kind::EdgeA),
            2 => Some(Kind::EdgeB),
            _ => None,
        }
    }
}

/// A generated, validated database: packed nibbles plus the histogram that certified it.
/// Fields are PRIVATE on purpose — the only ways to hold a Pdb are generation (which
/// certifies exhaustively) and deserialization (which refuses corruption), and nothing may
/// mutate one afterwards: a "validated" struct anyone can edit is a claim, not a property.
pub struct Pdb {
    kind: Kind,
    nibbles: Vec<u8>,
    histogram: Vec<u64>,
}

impl Pdb {
    pub fn kind(&self) -> Kind {
        self.kind
    }
    /// Read-only view, for serialization checks and tests.
    pub fn nibbles(&self) -> &[u8] {
        &self.nibbles
    }
    pub fn histogram(&self) -> &[u64] {
        &self.histogram
    }
    #[inline]
    pub fn get(&self, index: usize) -> u8 {
        let b = self.nibbles[index >> 1];
        if index & 1 == 0 {
            b & 0x0f
        } else {
            b >> 4
        }
    }
}

#[inline]
fn neighbor(kind: Kind, t: &MoveTables, index: usize, m: usize) -> usize {
    match kind {
        Kind::Corner => {
            let p = index / N_TWIST;
            let tw = index % N_TWIST;
            t.cperm[p * N_MOVES + m] as usize * N_TWIST + t.twist[tw * N_MOVES + m] as usize
        }
        Kind::EdgeA | Kind::EdgeB => {
            let pos = index / N_FLIP6;
            let flip = index % N_FLIP6;
            let i = pos * N_MOVES + m;
            t.pos[i] as usize * N_FLIP6 + (flip ^ t.flip_xor[i] as usize)
        }
    }
}

fn solved_index(kind: Kind) -> usize {
    match kind {
        Kind::Corner => 0,
        Kind::EdgeA => 0,
        // Cubies 6..11 at home means pos [6..11], whose rank is SOLVED_B_POS; flips zero.
        Kind::EdgeB => Coords::SOLVED_B_POS as usize * N_FLIP6,
    }
}

/// Exhaustive BFS from solved over the whole coordinate space. Byte distances during the
/// search (255 = unvisited), packed to nibbles only after every certification has held.
/// Certification failures are errors, not panics: the caller (a CLI, or the desktop's prepare
/// command) refuses cleanly instead of unwinding a worker thread.
pub fn generate(
    kind: Kind,
    tables: &MoveTables,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<Pdb, String> {
    let n = kind.entries();
    let mut dist = vec![255u8; n];
    let mut queue: Vec<u32> = Vec::with_capacity(n);
    let start = solved_index(kind);
    dist[start] = 0;
    queue.push(start as u32);
    let mut head = 0usize;
    while head < queue.len() {
        let idx = queue[head] as usize;
        head += 1;
        if head % 4_000_000 == 0 {
            progress(head as u64, n as u64);
        }
        let d = dist[idx] + 1;
        for m in 0..N_MOVES {
            let nb = neighbor(kind, tables, idx, m);
            if dist[nb] == 255 {
                dist[nb] = d;
                queue.push(nb as u32);
            }
        }
    }
    progress(n as u64, n as u64);

    // Every reachable-space claim, certified rather than trusted.
    if queue.len() != n {
        return Err(format!(
            "{kind:?}: BFS reached {} of {n} — a move table is wrong",
            queue.len()
        ));
    }
    let expected = kind.expected_histogram();
    let mut histogram = vec![0u64; expected.len()];
    for &d in dist.iter() {
        if d as usize >= expected.len() {
            return Err(format!("{kind:?}: depth {d} beyond the known diameter"));
        }
        histogram[d as usize] += 1;
    }
    if histogram != expected {
        return Err(format!(
            "{kind:?}: depth histogram differs from the exhaustively measured one — a table is wrong\n  got      {histogram:?}\n  expected {expected:?}"
        ));
    }
    if *dist.iter().max().unwrap() != kind.diameter() {
        return Err(format!("{kind:?}: diameter moved"));
    }

    // Pack into a buffer PRE-FILLED with the reserved value 15, writing with masked assignment
    // — so an unwritten nibble reads as "uninitialised", never as a plausible goal-distance
    // zero. (A zero-initialised buffer once made that claim false while looking identical.)
    let mut nibbles = vec![0xffu8; n.div_ceil(2)];
    for (i, &d) in dist.iter().enumerate() {
        debug_assert!(d < 15);
        if i & 1 == 0 {
            nibbles[i >> 1] = (nibbles[i >> 1] & 0xf0) | d;
        } else {
            nibbles[i >> 1] = (nibbles[i >> 1] & 0x0f) | (d << 4);
        }
    }
    Ok(Pdb {
        kind,
        nibbles,
        histogram,
    })
}

/// Exhaustive Bellman validation (plan §7, replacing sampled admissibility): every entry
/// initialised, exactly one zero (the goal), |d(s) − d(move(s))| ≤ 1 on every transition, and
/// every non-zero entry has a neighbour one closer. Certifies each of the N entries; sampling
/// could not (finding one bad entry at 95% confidence would need ~264M samples). Violations
/// are errors, not panics — a bad table refuses cleanly instead of unwinding a worker.
pub fn bellman_validate(pdb: &Pdb, tables: &MoveTables) -> Result<(), String> {
    let n = pdb.kind.entries();
    let start = solved_index(pdb.kind);
    let zeros: u64 = (0..n)
        .into_par_iter()
        .with_min_len(1 << 16)
        .map(|idx| -> Result<u64, String> {
            let d = pdb.get(idx);
            if d == 15 {
                return Err(format!("{:?}: entry {idx} uninitialised", pdb.kind));
            }
            let mut has_closer = d == 0;
            for m in 0..N_MOVES {
                let nd = pdb.get(neighbor(pdb.kind, tables, idx, m));
                if (d as i16 - nd as i16).abs() > 1 {
                    return Err(format!("{:?}: |{d} - {nd}| > 1 at {idx}", pdb.kind));
                }
                if nd + 1 == d {
                    has_closer = true;
                }
            }
            if !has_closer {
                return Err(format!(
                    "{:?}: entry {idx} at depth {d} has no neighbour closer",
                    pdb.kind
                ));
            }
            Ok(u64::from(d == 0))
        })
        .try_reduce(|| 0, |a, b| Ok(a + b))?;
    if zeros != 1 {
        return Err(format!(
            "{:?}: {zeros} zero entries, expected exactly the goal",
            pdb.kind
        ));
    }
    if pdb.get(start) != 0 {
        return Err(format!("{:?}: the goal is not at distance zero", pdb.kind));
    }
    Ok(())
}

// ---- the artifact -----------------------------------------------------------------------------
// Layout, all little-endian: magic "CUBUSPDB" · version u32 · kind u8 · metric u8 (0 = HTM,
// every move cost 1) · reserved u16 · move-set hash [32] · entry count u64 · histogram length
// u8 · histogram u64s · nibble payload · SHA-256 of everything above. The loader re-derives
// the move-set hash from its own move tables, so a file generated under different move
// definitions — a QTM table wearing an HTM name — is refused, not misread (plan §7, metric
// contract).

const MAGIC: &[u8; 8] = b"CUBUSPDB";
const VERSION: u32 = 1;
const METRIC_HTM: u8 = 0;

/// The identity of the move set: faces, order, and every permutation/orientation entry.
pub fn move_set_hash() -> [u8; 32] {
    let moves = crate::cubie::all_moves();
    let mut h = Sha256::new();
    h.update(b"HTM18");
    for mv in moves.iter() {
        h.update(mv.cp);
        h.update(mv.co);
        h.update(mv.ep);
        h.update(mv.eo);
    }
    h.finalize().into()
}

pub fn serialize(pdb: &Pdb) -> Vec<u8> {
    // Exact capacity, computed not guessed: magic + version + kind/metric/reserved + move-set
    // hash + count + histogram length byte + histogram + payload + trailing hash. A wrong
    // guess here silently reallocates tens of megabytes mid-append.
    let exact = 8 + 4 + 4 + 32 + 8 + 1 + pdb.histogram.len() * 8 + pdb.nibbles.len() + 32;
    let mut out = Vec::with_capacity(exact);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.push(pdb.kind.tag());
    out.push(METRIC_HTM);
    out.extend_from_slice(&[0u8; 2]);
    out.extend_from_slice(&move_set_hash());
    out.extend_from_slice(&(pdb.kind.entries() as u64).to_le_bytes());
    out.push(pdb.histogram.len() as u8);
    for v in &pdb.histogram {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&pdb.nibbles);
    let hash: [u8; 32] = Sha256::digest(&out).into();
    out.extend_from_slice(&hash);
    debug_assert_eq!(out.len(), exact);
    out
}

/// Refuses everything §7's packed-layout row lists: wrong magic/version/kind/metric, nonzero
/// reserved bytes, a foreign move set, a truncated payload, any bit flip (the trailing SHA
/// covers header and payload alike) — and, because a checksum only proves the file matches
/// ITSELF, the payload's recomputed depth histogram must equal the exhaustively measured one.
/// A resealed file with a doctored payload fails that check; full Bellman certification stays
/// at generation time (minutes, not the 100 ms this costs). Every read is bounds-checked: a
/// crafted length field returns Err, never a panic.
pub fn deserialize(bytes: &[u8], expect: Kind) -> Result<Pdb, String> {
    if bytes.len() < 8 + 4 + 4 + 32 + 8 + 1 + 32 {
        return Err("file too short to be a pattern database".into());
    }
    let (body, tail) = bytes.split_at(bytes.len() - 32);
    let hash: [u8; 32] = Sha256::digest(body).into();
    if hash != tail {
        return Err("checksum mismatch — the file is corrupt or truncated".into());
    }
    let mut at = 0usize;
    let mut take = |n: usize| -> Result<&[u8], String> {
        let end = at.checked_add(n).ok_or("length overflow")?;
        let s = body.get(at..end).ok_or("file ends inside a field")?;
        at = end;
        Ok(s)
    };
    if take(8)? != MAGIC {
        return Err("not a CUBUSPDB file".into());
    }
    let version = u32::from_le_bytes(take(4)?.try_into().unwrap());
    if version != VERSION {
        return Err(format!("version {version}, expected {VERSION}"));
    }
    let kind = Kind::from_tag(take(1)?[0]).ok_or("unknown table kind")?;
    if kind != expect {
        return Err(format!("file holds {kind:?}, expected {expect:?}"));
    }
    if take(1)?[0] != METRIC_HTM {
        return Err("metric is not HTM — refusing rather than overestimating".into());
    }
    if take(2)? != [0u8, 0u8] {
        return Err("reserved header bytes are not zero — a future format, not this one".into());
    }
    if take(32)? != move_set_hash() {
        return Err("move-set hash differs — generated under different move definitions".into());
    }
    let n_raw = u64::from_le_bytes(take(8)?.try_into().unwrap());
    let n = usize::try_from(n_raw).map_err(|_| "entry count does not fit this platform")?;
    if n != kind.entries() {
        return Err(format!("entry count {n}, expected {}", kind.entries()));
    }
    let expected_hist = kind.expected_histogram();
    let hist_len = take(1)?[0] as usize;
    if hist_len != expected_hist.len() {
        // Checked BEFORE reading: an inflated length once walked the cursor off the body.
        return Err(format!(
            "histogram length {hist_len}, expected {}",
            expected_hist.len()
        ));
    }
    let mut histogram = Vec::with_capacity(hist_len);
    for _ in 0..hist_len {
        histogram.push(u64::from_le_bytes(take(8)?.try_into().unwrap()));
    }
    if histogram != expected_hist {
        return Err("stored histogram differs from the exhaustively measured one".into());
    }
    let payload = &body[at..];
    if payload.len() != n.div_ceil(2) {
        return Err(format!(
            "payload {} bytes, expected {}",
            payload.len(),
            n.div_ceil(2)
        ));
    }
    // The payload must actually HAVE the histogram it claims — this is what catches a
    // doctored-and-resealed payload, and any serializer bug, at ~100 ms for the corner table.
    let mut recomputed = vec![0u64; expected_hist.len()];
    for i in 0..n {
        let b = payload[i >> 1];
        let d = if i & 1 == 0 { b & 0x0f } else { b >> 4 } as usize;
        if d >= recomputed.len() {
            return Err(format!(
                "payload nibble {d} at entry {i} is beyond the diameter"
            ));
        }
        recomputed[d] += 1;
    }
    if recomputed != expected_hist {
        return Err(
            "payload depth histogram differs from the certified one — the payload was altered"
                .into(),
        );
    }
    Ok(Pdb {
        kind,
        nibbles: payload.to_vec(),
        histogram,
    })
}
