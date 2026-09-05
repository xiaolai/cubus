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
///
/// And a third, added 2026-09-05: the PARENT DIRECTORY is synced after the rename. Syncing the
/// temp file makes its bytes durable; the directory entry that gives those bytes their final
/// name is separate metadata, so a crash between the rename and the directory's own writeback
/// could leave the file back under its temp name or gone entirely — a save that returned Ok and
/// did not happen, which is exactly what this function exists to rule out.
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
        std::fs::rename(&tmp, path)?;
        sync_dir(dir)
    })();
    if let Err(e) = result {
        // Leave nothing behind: a stray temp file is a plausible-looking fragment by another name.
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{}: {e}", path.display()));
    }
    Ok(())
}

/// Flush the directory's own entries, so the rename that published the file is as durable as the
/// file's bytes already are. Opening a directory read-only and `fsync`ing that handle is the
/// POSIX way to do it — there is nothing to write, so no write permission is involved — and the
/// failure is returned, never swallowed: a save that could not make its own name durable has not
/// finished.
#[cfg(unix)]
fn sync_dir(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::File::open(dir)?.sync_all()
}

/// Windows has no directory handle to sync: opening one needs backup semantics and
/// `FlushFileBuffers` refuses it regardless, so there is nothing to call. A documented no-op
/// rather than a silent one — the durability of `MoveFileEx` is the platform's answer here, and
/// stating that is the difference between a known limit and an unnoticed gap.
#[cfg(not(unix))]
fn sync_dir(_dir: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

/// Read a file that must be at most `exact` bytes, refusing anything larger WITHOUT reading it.
///
/// `std::fs::read` sizes its buffer from the file's own metadata, so a corrupt or foreign
/// `corner.pdb` of forty gigabytes was a forty-gigabyte allocation before the first check ran —
/// the process dies where it should have said `Invalid` and regenerated. An artifact's size is
/// known exactly from its kind, so the read is bounded by it; the one extra byte is what makes a
/// full buffer mean OVERSIZED rather than "exactly right", since a file that fills the bound and
/// still has a byte left cannot be this table.
fn read_bounded(path: &std::path::Path, name: &str, exact: usize) -> Result<Vec<u8>, LoadError> {
    use std::io::Read as _;
    let file = std::fs::File::open(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => LoadError::Missing(format!("{name}: {e}")),
        _ => LoadError::Io(format!("{name}: {e}")),
    })?;
    let mut bytes = Vec::with_capacity(exact + 1);
    file.take(exact as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| LoadError::Io(format!("{name}: {e}")))?;
    if bytes.len() > exact {
        // Invalid, not Io: the directory is readable and the cure is regeneration.
        return Err(LoadError::Invalid(format!(
            "{name}: longer than the {exact} bytes a whole artifact is"
        )));
    }
    Ok(bytes)
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
            // Bounded by what this kind's artifact IS: an oversized file is refused before it is
            // read, not after it has been held in memory.
            let bytes = read_bounded(&dir.join(name), name, pdb::serialized_len(kind))?;
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
    ///
    /// A READER RUNS BESIDE THEM, and that is the half that makes this a test of atomic
    /// publication rather than of the last write. Reading only after every writer has finished
    /// looks at one file — the survivor — and a torn or mixed intermediate state would have come
    /// and gone unobserved (the audit's finding, 2026-09-05). The guarantee is about every
    /// instant the file is visible, so every instant is looked at: each read must be a whole
    /// payload from the allowed set, or the file must not be there at all.
    #[test]
    fn concurrent_writers_never_publish_each_others_fragments() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        let d = scratch("race");
        let target = d.join("edge-a.pdb");
        let payloads: Vec<Vec<u8>> = (0..8u8).map(|i| vec![i; 200_000]).collect();
        let done = AtomicBool::new(false);
        let reads = AtomicU64::new(0);
        std::thread::scope(|scope| {
            {
                let target = target.clone();
                let payloads = &payloads;
                let (done, reads) = (&done, &reads);
                scope.spawn(move || {
                    while !done.load(Ordering::Relaxed) {
                        match std::fs::read(&target) {
                            Ok(got) => {
                                assert!(
                                    payloads.contains(&got),
                                    "a reader saw {} bytes that are no writer's whole payload",
                                    got.len()
                                );
                                reads.fetch_add(1, Ordering::Relaxed);
                            }
                            // Before the first rename lands there is legitimately no file.
                            Err(e) => assert_eq!(
                                e.kind(),
                                std::io::ErrorKind::NotFound,
                                "a reader hit an unexpected error: {e}"
                            ),
                        }
                    }
                });
            }
            let writers: Vec<_> = payloads
                .iter()
                .map(|p| {
                    let target = target.clone();
                    scope.spawn(move || {
                        for _ in 0..5 {
                            write_atomic(&target, p).unwrap();
                        }
                    })
                })
                .collect();
            // Joined here rather than at the end of the scope, because the reader spins until it
            // is told to stop and only the writers finishing is that signal.
            for w in writers {
                w.join().unwrap();
            }
            done.store(true, Ordering::Relaxed);
        });
        assert!(
            reads.load(Ordering::Relaxed) > 0,
            "the reader never observed the file, so it checked nothing"
        );
        let got = std::fs::read(&target).unwrap();
        assert_eq!(got.len(), 200_000, "the published file is a whole payload");
        assert!(
            got.iter().all(|&b| b == got[0]),
            "the published file is ONE writer's bytes, not a mix"
        );
        let leftovers = std::fs::read_dir(&d).unwrap().count();
        assert_eq!(leftovers, 1, "only the target remains");
    }

    /// The read bound, at its edge. An artifact's length is known exactly from its kind, so a
    /// file one byte over cannot be one — and refusing it is what keeps a corrupt forty-gigabyte
    /// `corner.pdb` from being allocated before anything is checked.
    #[test]
    fn a_bounded_read_takes_an_exact_file_and_refuses_one_byte_more() {
        use super::{read_bounded, LoadError};
        let d = scratch("bounded");
        let at = d.join("corner.pdb");

        std::fs::write(&at, vec![7u8; 64]).unwrap();
        assert_eq!(read_bounded(&at, "corner.pdb", 64).unwrap().len(), 64);
        // Under the bound is fine too: short files are the deserializer's business, not this
        // function's — it refuses only what it must not hold.
        assert_eq!(read_bounded(&at, "corner.pdb", 4096).unwrap().len(), 64);

        std::fs::write(&at, vec![7u8; 65]).unwrap();
        let err = read_bounded(&at, "corner.pdb", 64).expect_err("one byte over is refused");
        assert!(
            matches!(&err, LoadError::Invalid(m) if m.contains("corner.pdb") && m.contains("64")),
            "Invalid and it names the file and the bound: {err}"
        );

        // An absent file is still Missing, not Invalid — the first-launch case must survive the
        // bound, or every cold start reports corruption.
        std::fs::remove_file(&at).unwrap();
        assert!(matches!(
            read_bounded(&at, "corner.pdb", 64),
            Err(LoadError::Missing(_))
        ));
    }

    /// The directory sync reports its failures rather than swallowing them: a save that could not
    /// make its own name durable has not finished, and `write_atomic` returns that. Unix only,
    /// because there the call is real; on Windows it is a documented no-op with nothing to fail.
    #[cfg(unix)]
    #[test]
    fn syncing_a_directory_that_is_not_there_is_an_error() {
        let d = scratch("syncdir");
        assert!(super::sync_dir(&d).is_ok(), "a real directory syncs");
        assert!(
            super::sync_dir(&d.join("no-such-directory")).is_err(),
            "and a missing one is reported, never shrugged off"
        );
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
