//! Prove a 3x3 solution minimal: three pattern databases and IDA*, per Korf's published 1997
//! method. Written from the method, not from any existing solver's source —
//! dev-docs/optimal-solver-provenance.md records exactly what was and was not read. The bar
//! this crate must clear before the app may say "optimal" is optimal-solver-plan.md §7, and
//! the tests here are those checks, not a summary of them.
//!
//! # Trust contract
//!
//! This is a workspace crate with exactly one untrusted entry point:
//! [`cubie::parse_facelets`], which validates everything (stickers, centres, twist, flip,
//! parity) and is what the Tauri seam calls. Every other public function — `compose`,
//! `inverse`, `to_facelets`, `permutation_parity`, `Coords::from_cubie`, `step`,
//! `Tables::heuristic` — REQUIRES states that came from that parser, from `SOLVED`, or from
//! applying moves to either; on garbage they may panic or return nonsense, by design. They
//! sit on the search's hot path, and validating per call would tax two hundred million calls
//! to guard against a caller this workspace does not contain. The proof-critical TABLES are
//! armored instead (private fields, validated construction), because a wrong table corrupts
//! silently where a wrong state panics loudly.

pub mod certificate;
pub mod coords;
pub mod cubie;
pub mod pdb;
pub mod search;

use coords::MoveTables;
use pdb::{Kind, Pdb};

/// The artifact manifest — the ONE list both save and load walk, so the crate can never write
/// files it cannot read back.
const ARTIFACTS: [(&str, Kind); 3] = [
    ("corner.pdb", Kind::Corner),
    ("edge-a.pdb", Kind::EdgeA),
    ("edge-b.pdb", Kind::EdgeB),
];

/// Why a load did not produce tables — so a caller can tell "regenerate" (missing or invalid
/// artifacts) from "stop and look" (an environment that cannot read files at all, which
/// regeneration cannot fix and a save will hit again).
#[derive(Debug)]
pub enum LoadError {
    /// An artifact file does not exist — the normal first-launch case.
    Missing(String),
    /// An artifact exists but failed verification — corrupt, foreign, or truncated.
    Invalid(String),
    /// The filesystem itself refused — permissions, I/O.
    Io(String),
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadError::Missing(m) => write!(f, "missing: {m}"),
            LoadError::Invalid(m) => write!(f, "invalid: {m}"),
            LoadError::Io(m) => write!(f, "io: {m}"),
        }
    }
}

/// Everything a proof needs, generated or loaded once and shared. Fields are crate-private:
/// every Tables is born validated (generate certifies, load verifies), and nothing outside
/// the crate may swap a table after that — the proofs downstream are only as good as this.
pub struct Tables {
    pub(crate) moves: MoveTables,
    pub(crate) corner: Pdb,
    pub(crate) edge_a: Pdb,
    pub(crate) edge_b: Pdb,
}

/// Write `bytes` to `path` so that the file is either absent, or whole and durable — never a
/// plausible-looking fragment.
///
/// Write-then-rename is the shape, and two details make it hold. The temp name carries the
/// process id and a random word: a FIXED `name.tmp` meant two instances of the app preparing
/// tables at once wrote into one file, and the loser's rename published the winner's half-written
/// bytes under a valid-looking name (the loader's checksum refuses those, at the cost of a
/// regeneration on the next launch — a wasted few seconds, not a wrong proof). And the file is
/// `sync_all`ed before the rename: without it a power loss after the rename can leave a
/// zero-length or partially-written file under the FINAL name on filesystems that reorder the
/// data behind the metadata, which is the one outcome a rename was supposed to rule out.
fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write as _;
    let dir = path.parent().ok_or("artifact path has no directory")?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("artifact path has no file name")?;
    let mut nonce = [0u8; 8];
    getrandom::getrandom(&mut nonce)
        .map_err(|e| format!("no random source for a temp name: {e}"))?;
    let tmp = dir.join(format!(
        ".{name}.{}-{:016x}.tmp",
        std::process::id(),
        u64::from_le_bytes(nonce)
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        // Leave nothing behind: a stray temp file is a plausible-looking fragment by another name.
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{}: {e}", path.display()));
    }
    Ok(())
}

impl Tables {
    pub fn moves(&self) -> &MoveTables {
        &self.moves
    }
    pub fn corner(&self) -> &Pdb {
        &self.corner
    }
    pub fn edge_a(&self) -> &Pdb {
        &self.edge_a
    }
    pub fn edge_b(&self) -> &Pdb {
        &self.edge_b
    }

    /// Generate all three databases from nothing, validating each exhaustively. `progress`
    /// hears (stage, done, total), and each table's Bellman pass is its own "validate" stage —
    /// 100% of a BFS no longer displays while a whole certification pass still stands between
    /// it and ready.
    ///
    /// Cost, measured 2026-09-05 through `src/bin/measure-generate.rs prepare` — the same
    /// three generations, the same three Bellman passes, the same save — under
    /// `/usr/bin/time -l` on a 10-core Apple Silicon laptop: **281 MB peak, ~4 s**, of which
    /// the save is 0.2 s for 86 MB. Before plan §8's level-synchronous rewrite the same path
    /// measured **804 MB and ~23 s**. The plan's older "~500 MB" was the corner table's own
    /// BFS (548 MB measured) and understated the whole: the first table is still held while
    /// the other two generate.
    pub fn generate(progress: &mut dyn FnMut(&str, u64, u64)) -> Result<Tables, String> {
        let moves = MoveTables::build();
        let mut one = |kind: Kind, name: &'static str| -> Result<Pdb, String> {
            let table = pdb::generate_levels(kind, &moves, &mut |d, t| progress(name, d, t))?;
            progress("validate", 0, 1);
            pdb::bellman_validate(&table, &moves)?;
            progress("validate", 1, 1);
            Ok(table)
        };
        let corner = one(Kind::Corner, "corners")?;
        let edge_a = one(Kind::EdgeA, "edges-a")?;
        let edge_b = one(Kind::EdgeB, "edges-b")?;
        Ok(Tables {
            moves,
            corner,
            edge_a,
            edge_b,
        })
    }

    /// Load the three artifacts from a directory, refusing anything corrupt; regenerate is the
    /// caller's decision, not a silent fallback. Files are read and verified FIRST — the
    /// seconds of move-table construction only happen once all three artifacts are real, so a
    /// cold start with no files fails fast into regeneration instead of doing work twice.
    ///
    /// Verification ends with a full Bellman pass per table: the file checks (checksum,
    /// histogram recount) catch corruption, but a deliberately RESEALED file — two nibbles of
    /// different depths swapped, every hash recomputed — preserves both. Only the recurrence
    /// itself (`h(goal)=0`, one zero, `|Δh|≤1` per move, a closer neighbour for every `h>0`)
    /// pins the entries to their places. It is 1–2 s of parallel work against ~4 s to regenerate
    /// (measured 2026-09-05, after plan §8; the margin used to be seconds against minutes). The
    /// reason survives that shrinking, because it was never about the margin: a load whose
    /// recurrence does not hold has to regenerate anyway, and one that skipped the check would
    /// publish a resealed table as a certified one.
    pub fn load(dir: &std::path::Path) -> Result<Tables, LoadError> {
        let read = |(name, kind): (&str, Kind)| -> Result<Pdb, LoadError> {
            let bytes = std::fs::read(dir.join(name)).map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => LoadError::Missing(format!("{name}: {e}")),
                _ => LoadError::Io(format!("{name}: {e}")),
            })?;
            pdb::deserialize(&bytes, kind).map_err(|e| LoadError::Invalid(format!("{name}: {e}")))
        };
        let [corner, edge_a, edge_b] = ARTIFACTS.map(read);
        let (corner, edge_a, edge_b) = (corner?, edge_a?, edge_b?);
        let moves = MoveTables::build();
        for ((name, _), table) in ARTIFACTS.iter().zip([&corner, &edge_a, &edge_b]) {
            pdb::bellman_validate(table, &moves)
                .map_err(|e| LoadError::Invalid(format!("{name}: {e}")))?;
        }
        Ok(Tables {
            moves,
            corner,
            edge_a,
            edge_b,
        })
    }

    pub fn save(&self, dir: &std::path::Path) -> Result<(), String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        for ((name, _), table) in ARTIFACTS
            .iter()
            .zip([&self.corner, &self.edge_a, &self.edge_b])
        {
            write_atomic(&dir.join(name), &pdb::serialize(table))?;
        }
        Ok(())
    }

    /// The admissible heuristic: max of the three projections (§7 confirmed max, not sum —
    /// summing is inadmissible, measured on the one-move position F).
    #[inline]
    pub fn heuristic(&self, c: &coords::Coords) -> u8 {
        let a = self.corner.get(c.corner_index());
        let b = self.edge_a.get(c.edge_a_index());
        let d = self.edge_b.get(c.edge_b_index());
        a.max(b).max(d)
    }
}

#[cfg(test)]
mod write_atomic_tests {
    use super::write_atomic;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let d =
            std::env::temp_dir().join(format!("cubus-write-atomic-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_saved_file_is_whole_and_no_temp_survives() {
        let d = scratch("whole");
        let target = d.join("corner.pdb");
        write_atomic(&target, b"hello tables").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"hello tables");
        let leftovers: Vec<_> = std::fs::read_dir(&d)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| n != "corner.pdb")
            .collect();
        assert!(
            leftovers.is_empty(),
            "temp files left behind: {leftovers:?}"
        );
        // Overwriting is the same operation, and the reader never sees a partial file.
        write_atomic(&target, b"newer").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"newer");
    }

    /// Two writers, one target, at once: each uses its own temp name, so neither publishes the
    /// other's bytes half-written. The fixed `.tmp` name this replaces made exactly that possible.
    #[test]
    fn concurrent_writers_never_publish_each_others_fragments() {
        let d = scratch("race");
        let target = d.join("edge-a.pdb");
        let payloads: Vec<Vec<u8>> = (0..8u8).map(|i| vec![i; 200_000]).collect();
        std::thread::scope(|scope| {
            for p in &payloads {
                let target = target.clone();
                scope.spawn(move || {
                    for _ in 0..5 {
                        write_atomic(&target, p).unwrap();
                    }
                });
            }
        });
        let got = std::fs::read(&target).unwrap();
        assert_eq!(got.len(), 200_000, "the published file is a whole payload");
        assert!(
            got.iter().all(|&b| b == got[0]),
            "the published file is ONE writer's bytes, not a mix"
        );
        let leftovers = std::fs::read_dir(&d).unwrap().count();
        assert_eq!(leftovers, 1, "only the target remains");
    }

    #[test]
    fn a_failed_write_leaves_nothing_behind() {
        let d = scratch("fail");
        // A directory where the FINAL name is a directory: the rename fails after the temp is
        // written, and the temp must be cleaned up.
        let target = d.join("blocked");
        std::fs::create_dir_all(&target).unwrap();
        assert!(write_atomic(&target, b"x").is_err());
        assert_eq!(
            std::fs::read_dir(&d).unwrap().count(),
            1,
            "only the blocking dir remains"
        );
    }
}
