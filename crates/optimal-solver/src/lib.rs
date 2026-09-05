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

/// Write `bytes` to `path` so that a reader never sees a plausible-looking fragment, and — on
/// Unix — so that a `path` this returned `Ok` for survives a crash.
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
///
/// **What is guaranteed, per platform.** On Unix, all three: whole bytes, an atomic name, and a
/// name that survives a crash. On Windows only the first two — `sync_dir` is a no-op there (see
/// its own note), so a crash immediately after this returns `Ok` may leave the file under its temp
/// name or absent. That is a stated limit, not a hidden one, and it is survivable rather than
/// silent: the next launch finds the artifact missing and regenerates, which is the same path a
/// corrupt artifact already takes. A wrong proof is never among the outcomes.
///
/// The directory sync is INJECTED because an `fsync` leaves nothing behind for a test to look at:
/// handing the function the call is the only way to assert that it happens, and the claim above
/// needs a test that fails when it stops being true.
fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    write_atomic_with(path, bytes, &mut sync_dir)
}

fn write_atomic_with(
    path: &std::path::Path,
    bytes: &[u8],
    sync: &mut dyn FnMut(&std::path::Path) -> std::io::Result<()>,
) -> Result<(), String> {
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
        sync(dir)
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

/// Windows has no directory handle to sync: opening one needs `FILE_FLAG_BACKUP_SEMANTICS` and
/// `FlushFileBuffers` refuses a directory handle regardless, so there is nothing to call.
///
/// This is a no-op, and it does NOT deliver what its Unix twin does. Being precise about that is
/// the whole point of the note (the audit's finding, 2026-09-05: the previous wording said "the
/// durability of `MoveFileEx` is the platform's answer here", which reads as a promise the
/// platform does not make — `MoveFileEx` is atomic with respect to READERS, and atomicity is not
/// durability). What Windows gives: a reader never observes a half-written artifact, and the
/// rename is all-or-nothing. What it does not give: a guarantee that a rename this crate returned
/// `Ok` for has reached the disk. A crash in that window loses the entry, the next launch reports
/// the artifact missing, and it is regenerated — the same path a corrupt artifact takes. The
/// outcome that is excluded on every platform, which is the one that matters here, is a table that
/// loads and is wrong.
#[cfg(not(unix))]
fn sync_dir(_dir: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

/// The directory a path is created IN. An empty parent means a relative single-component path,
/// which is created in the current directory.
fn parent_of(path: &std::path::Path) -> &std::path::Path {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => std::path::Path::new("."),
    }
}

/// Create `dir` and every missing ancestor, publishing each newly created directory as durably as
/// the files that will go inside it.
///
/// A directory's own bytes are nothing; its ENTRY is metadata in its PARENT. So `create_dir_all`
/// left the artifact directory in exactly the position `write_atomic`'s rename used to be in (the
/// audit's finding, 2026-09-05): three tables written with synced bytes and synced names, inside a
/// directory the kernel had not been asked to write back — a crash after `save` returned `Ok`
/// could take all of it, and the care one level down would have bought nothing. Creation is
/// top-down and one level at a time, because a parent must exist before its child can be made in
/// it, and each new entry is published before the next is created inside it.
///
/// Losing the race to another process is not a failure: its entry, its sync. A path that already
/// exists and is NOT a directory is a failure, and is reported rather than adopted.
///
/// Windows: see `sync_dir` — the creations happen, the entries are not forced to disk, and a lost
/// directory reads as missing artifacts and regenerates.
fn create_dirs(dir: &std::path::Path) -> std::io::Result<()> {
    create_dirs_with(dir, &mut sync_dir)
}

/// [`create_dirs`], with the sync injected — an `fsync` leaves no trace a test can look at, so
/// handing the function the call is the only way to assert it happens.
fn create_dirs_with(
    dir: &std::path::Path,
    sync: &mut dyn FnMut(&std::path::Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let mut missing: Vec<&std::path::Path> = Vec::new();
    let mut at = Some(dir);
    while let Some(path) = at {
        if path.as_os_str().is_empty() || path.is_dir() {
            break;
        }
        missing.push(path);
        at = path.parent();
    }
    for path in missing.iter().rev() {
        match std::fs::create_dir(path) {
            Ok(()) => sync(parent_of(path))?,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && path.is_dir() => {}
            Err(e) => return Err(e),
        }
    }
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

    /// Write the three artifacts into `dir`, creating it if it is not there. Every file is
    /// published atomically and — on Unix — durably, and so is the directory itself: see
    /// `create_dirs` for why a synced file inside an unsynced directory is not a saved file.
    pub fn save(&self, dir: &std::path::Path) -> Result<(), String> {
        create_dirs(dir).map_err(|e| e.to_string())?;
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
            //
            // COLLECT, then signal, then propagate — never `join().unwrap()` in the loop. `unwrap`
            // unwinds on the FIRST failed writer, which skips the `done` store below; the reader
            // then spins forever inside the scope's own join, so a writer failure hangs the suite
            // instead of reporting it (the audit's finding, 2026-09-05, demonstrated on a
            // reduction of exactly this shape: the old form ran past a four-second watchdog, this
            // one exits with the writer's panic). `join` itself returns the panic rather than
            // raising it, so nothing unwinds before the reader has been told to stop.
            let outcomes: Vec<std::thread::Result<()>> =
                writers.into_iter().map(|w| w.join()).collect();
            done.store(true, Ordering::Relaxed);
            for outcome in outcomes {
                if let Err(panic) = outcome {
                    std::panic::resume_unwind(panic);
                }
            }
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

    /// A published file's DIRECTORY is synced, after the rename and exactly once.
    ///
    /// `write_atomic`'s doc comment has claimed this since 2026-09-05 and nothing checked it: an
    /// `fsync` leaves no trace on the filesystem, so a version that dropped the call passed every
    /// test here (the audit's finding — the round-1 fix was the call, this is the assertion that
    /// keeps it). The sync is injected precisely so the call itself is observable.
    #[test]
    fn a_published_file_has_its_directory_entry_synced_too() {
        use super::write_atomic_with;
        let d = scratch("dirsync");
        let target = d.join("corner.pdb");
        let mut synced: Vec<std::path::PathBuf> = Vec::new();
        write_atomic_with(&target, b"tables", &mut |at| {
            // The rename has already happened when this runs — the entry being made durable is
            // the one that exists.
            assert_eq!(std::fs::read(&target).unwrap(), b"tables");
            synced.push(at.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(
            synced,
            vec![d.clone()],
            "the directory the rename published into, once"
        );

        // And a sync that refuses is a save that has not finished. The bytes and the name are both
        // there — what is not established is that the name survives a crash, and a save reporting
        // success over an unanswerable question is the failure mode this whole function exists to
        // exclude.
        let e = write_atomic_with(&d.join("edge-a.pdb"), b"tables", &mut |_| {
            Err(std::io::Error::other(
                "this volume cannot fsync a directory",
            ))
        })
        .expect_err("an unsyncable directory is not a completed save");
        assert!(e.contains("cannot fsync a directory"), "{e}");
    }

    /// A directory this crate CREATES is published the same way the files inside it are.
    ///
    /// A directory's entry is metadata in its parent, so `create_dir_all` alone left three
    /// carefully-synced artifacts inside something a crash could take whole (the audit's finding,
    /// 2026-09-05). Every intermediate ancestor counts: they are created top-down, and each one's
    /// entry is published before the next is made inside it.
    #[test]
    fn every_directory_created_for_a_save_is_published_by_syncing_its_parent() {
        use super::create_dirs_with;
        let d = scratch("mkdir");
        let deep = d.join("cubus").join("optimal-pdb").join("v1");
        let mut synced: Vec<std::path::PathBuf> = Vec::new();
        create_dirs_with(&deep, &mut |at| {
            synced.push(at.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert!(deep.is_dir());
        assert_eq!(
            synced,
            vec![
                d.clone(),
                d.join("cubus"),
                d.join("cubus").join("optimal-pdb")
            ],
            "each new directory's entry lives in its parent, so each parent is synced in turn"
        );

        // Idempotent, and a directory that was already there publishes nothing: no entry was made,
        // so there is nothing to make durable.
        let mut again: Vec<std::path::PathBuf> = Vec::new();
        create_dirs_with(&deep, &mut |at| {
            again.push(at.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert!(again.is_empty(), "nothing created, nothing published");

        // A sync that refuses stops the creation there, rather than carrying on into a tree whose
        // upper levels may not survive a crash.
        let mut calls = 0;
        let e = create_dirs_with(&d.join("a").join("b"), &mut |_| {
            calls += 1;
            Err(std::io::Error::other(
                "this volume cannot fsync a directory",
            ))
        })
        .expect_err("a refusal is propagated, never swallowed");
        assert_eq!(e.to_string(), "this volume cannot fsync a directory");
        assert_eq!(
            calls, 1,
            "and it stopped at the first level, not after all of them"
        );

        // A name that exists and is not a directory is reported, never adopted.
        let file = d.join("corner.pdb");
        std::fs::write(&file, b"an artifact").unwrap();
        assert!(create_dirs_with(&file, &mut |_| Ok(())).is_err());
        assert_eq!(
            std::fs::read(&file).unwrap(),
            b"an artifact",
            "and it is left exactly as it was"
        );
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
