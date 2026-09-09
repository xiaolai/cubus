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

pub mod case_certificate;
pub mod cases;
pub mod certificate;
pub mod cli;
pub mod coords;
pub mod cubie;
pub mod f2l;
pub mod notation;
pub mod pdb;
pub mod search;
pub mod table_json;

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
///
/// **Public because the generators need exactly this and kept writing their own.** `gen-cases` and
/// `gen-f2l` each carried a four-line `write_atomic` that put the temporary file at
/// `<path>.tmp` — a FIXED name, so two runs writing the same table truncated each other's
/// temporary file and one of them published a file the other was still writing. The version here
/// was already correct; the defect was that it was private, so the second and third callers wrote
/// their own instead of reaching for it.
pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    write_atomic_with(path, bytes, &mut sync_dir)
}

fn write_atomic_with(
    path: &std::path::Path,
    bytes: &[u8],
    sync: &mut dyn FnMut(&std::path::Path) -> std::io::Result<()>,
) -> Result<(), String> {
    let staged = stage(path, bytes)?;
    staged.commit(sync)
}

/// Bytes written and made durable under a temporary name, waiting for the rename that publishes
/// them. Dropping one without committing removes it.
struct Staged {
    tmp: std::path::PathBuf,
    final_path: std::path::PathBuf,
}

impl Staged {
    fn commit(
        self,
        sync: &mut dyn FnMut(&std::path::Path) -> std::io::Result<()>,
    ) -> Result<(), String> {
        let dir = self
            .final_path
            .parent()
            .ok_or("artifact path has no directory")?
            .to_path_buf();
        let result = std::fs::rename(&self.tmp, &self.final_path).and_then(|()| sync(&dir));
        match result {
            Ok(()) => {
                std::mem::forget(self);
                Ok(())
            }
            Err(e) => Err(format!("{}: {e}", self.final_path.display())),
        }
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        // Leave nothing behind: a stray temp file is a plausible-looking fragment by another name.
        let _ = std::fs::remove_file(&self.tmp);
    }
}

fn stage(path: &std::path::Path, bytes: &[u8]) -> Result<Staged, String> {
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
    let staged = Staged {
        tmp: tmp.clone(),
        final_path: path.to_path_buf(),
    };
    let result = (|| -> std::io::Result<()> {
        // `create_new`, not `create`: the nonce makes a collision vanishingly unlikely and this
        // makes it impossible to be silent about. A temp name that already exists is somebody
        // else's file, and truncating it is the failure mode this whole function is about.
        let mut f = std::fs::File::options()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()
    })();
    match result {
        Ok(()) => Ok(staged),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Publish several artifacts that only mean anything together — a table and the certificates that
/// make its lengths checkable.
///
/// **The failure this narrows.** `gen-cases` wrote the table, then wrote the certificates. An
/// interruption between the two — a full disk on the second write, ^C, a killed job — left a NEW
/// table beside STALE certificates, which is worse than either being missing: the pair looks
/// complete and the certificate is about a different run. Every file is written and `fsync`ed
/// first, and only then are the renames done back to back.
///
/// **What that is and is not.** It is not a transaction; a crash in the microseconds between two
/// renames still splits the pair. It removes the window that is actually wide — the one holding a
/// whole file's worth of I/O, where every real interruption lands — and leaves one with no I/O in
/// it at all. Making it truly atomic needs a directory swap or a manifest pointer, which is a
/// bigger change than the risk warrants for artifacts that are committed to git and checked by
/// `tests/committed_tables.rs` on every run.
///
/// The one rename failure that is PREDICTABLE — a destination that is already a directory, which
/// no rename can ever replace — is checked before anything is staged, because finding it at commit
/// time is exactly the split this function exists to avoid.
pub fn write_all_atomic(artifacts: &[(&std::path::Path, &[u8])]) -> Result<(), String> {
    for (path, _) in artifacts {
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.is_dir() => {
                return Err(format!(
                    "{}: is a directory, not an artifact",
                    path.display()
                ))
            }
            Ok(_) | Err(_) => {}
        }
    }
    let mut staged = Vec::with_capacity(artifacts.len());
    for (path, bytes) in artifacts {
        staged.push(stage(path, bytes)?);
    }
    for s in staged {
        s.commit(&mut sync_dir)?;
    }
    Ok(())
}

/// The identity of a destination path, for asking whether two of them are the same file.
///
/// A generator writes two artifacts and they must not be one: `gen-cases pll t.json t.json` used
/// to generate the table, write it, then write the CERTIFICATES over the top of it, and report
/// success. Comparing the argument strings would not catch it — `tables/f2l.json` and
/// `./tables/../tables/f2l.json` are the same file spelt twice — so the parent directory is
/// canonicalized (which resolves `..` and every symlink along the way) and the file name is
/// re-attached. The file itself need not exist yet; its directory must, which is true of any
/// destination that could be written anyway.
pub fn destination_key(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let parent = match path.parent() {
        Some(p) if p.as_os_str().is_empty() => std::path::Path::new("."),
        Some(p) => p,
        None => return Err(format!("{}: not a file path", path.display())),
    };
    let name = path
        .file_name()
        .ok_or_else(|| format!("{}: has no file name", path.display()))?;
    let dir = parent
        .canonicalize()
        .map_err(|e| format!("{}: {e}", parent.display()))?;
    Ok(dir.join(name))
}

/// Refuse a set of destinations that are not all distinct, naming the pair.
pub fn destinations_differ(paths: &[&str]) -> Result<(), String> {
    let mut seen: Vec<(std::path::PathBuf, &str)> = Vec::new();
    for raw in paths {
        let key = destination_key(std::path::Path::new(raw))?;
        if let Some((_, first)) = seen.iter().find(|(k, _)| *k == key) {
            return Err(format!(
                "{raw} and {first} are the same file — the second artifact would overwrite the first"
            ));
        }
        seen.push((key, raw));
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

/// The directory whose entry list holds `path` — the one an `fsync` has to reach to make `path`'s
/// own NAME durable. `None` for a filesystem root, whose name lives in no directory and so has
/// nothing to publish it. An empty parent means a relative single-component path, whose entry is
/// in the current directory.
fn parent_of(path: &std::path::Path) -> Option<&std::path::Path> {
    match path.parent() {
        Some(parent) if parent.as_os_str().is_empty() => Some(std::path::Path::new(".")),
        other => other,
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
/// **Publishing only what THIS call created is not enough** (the same audit's verification pass,
/// 2026-09-05). An unsynced entry outlives the process that made it, so "I did not create it" and
/// "it is durable" are different facts — and two ordinary sequences separate them. A save whose
/// sync FAILED leaves the directory on disk anyway, so the next save finds it already there and,
/// under the old rule, synced nothing: two saves, one of them `Ok`, and an entry nobody ever
/// forced to disk. And two savers racing means one of them loses `create_dir` and gets
/// `AlreadyExists`, which says the entry exists — never that anyone has flushed it.
///
/// So the parent of every directory in the chain is synced by whoever needs the chain, not by
/// whoever happened to create it: first the deepest directory that was ALREADY there, before
/// anything is made inside it, then each one this call creates, whether the create succeeded or
/// found it already made. An `fsync` of a directory with nothing dirty is a cheap no-op; a save
/// that skipped one is a save that returned `Ok` for a directory that can vanish.
///
/// That makes the chain durable by induction: an attempt stops at its first sync failure, so it
/// can leave at most one directory — its deepest — unpublished, and the next attempt down that
/// path finds exactly that directory as the one already there and publishes it before going
/// deeper. Concurrency lands in the same place, because the loser of a `create_dir` syncs the
/// parent it would have synced had it won.
///
/// The walk stops at the first existing directory rather than climbing to the root. Ancestors
/// above it are not this crate's to publish, and fsyncing a filesystem root — read-only on macOS,
/// and not necessarily openable for reading at all — would trade a durability gap this crate
/// cannot close for a save that fails where it used to work.
///
/// Losing the race to another process is not a failure: its entry, our sync as well. A path that
/// already exists and is NOT a directory is a failure, and is reported rather than adopted.
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
    let mut found: Option<&std::path::Path> = None;
    let mut at = Some(dir);
    while let Some(path) = at {
        if path.as_os_str().is_empty() {
            break;
        }
        if path.is_dir() {
            found = Some(path);
            break;
        }
        missing.push(path);
        at = path.parent();
    }
    // The directory this save FOUND is published first, before anything is made inside it: it may
    // be what a previous save created and then could not sync, and there is no way to tell.
    if let Some(parent) = found.and_then(parent_of) {
        sync(parent)?;
    }
    for path in missing.iter().rev() {
        match std::fs::create_dir(path) {
            Ok(()) => {}
            // Someone else made it between the walk and here. Their entry, our sync too — winning
            // the call is what publishes a directory, and we did not win it.
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && path.is_dir() => {}
            Err(e) => return Err(e),
        }
        if let Some(parent) = parent_of(path) {
            sync(parent)?;
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

    /// A private directory for one test, emptied on the way in so a rerun starts clean.
    ///
    /// The tag must be unique across the module, and that is asserted rather than assumed: tests
    /// run in parallel, so two tests sharing a tag delete each other's tree mid-run — and the
    /// failure surfaces in whichever one happened to be slower, which is a defect that reads as
    /// the wrong test being broken.
    fn scratch(tag: &'static str) -> std::path::PathBuf {
        static TAGS: std::sync::Mutex<std::collections::BTreeSet<&'static str>> =
            std::sync::Mutex::new(std::collections::BTreeSet::new());
        assert!(
            TAGS.lock()
                .expect("the tag lock is never poisoned")
                .insert(tag),
            "scratch tag {tag:?} is used by more than one test, and they would erase each other"
        );
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
    ///
    /// **And the reader must be given something to see.** One whole payload is published before
    /// the reader starts, and the writers are held until it has read one — so `reads > 0` at the
    /// end is a fact about the code rather than about the scheduler. It used to be neither: the
    /// reader had to be scheduled AND find a file before eight writers finished forty renames
    /// between them, which is a green run that verified nothing when it lost that race narrowly
    /// and a spurious failure when it lost it badly (the audit's finding, 2026-09-05, reproduced
    /// by delaying the reader 300 ms).
    #[test]
    fn concurrent_writers_never_publish_each_others_fragments() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        let d = scratch("race");
        let target = d.join("edge-a.pdb");
        let payloads: Vec<Vec<u8>> = (0..8u8).map(|i| vec![i; 200_000]).collect();
        let done = AtomicBool::new(false);
        let reads = AtomicU64::new(0);
        // The file the reader is guaranteed to find, published while nothing else is running.
        write_atomic(&target, &payloads[0]).unwrap();
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
            let reads = &reads;
            let writers: Vec<_> = payloads
                .iter()
                .map(|p| {
                    let target = target.clone();
                    scope.spawn(move || {
                        // Held until the reader has seen the pre-published file, so the one thing
                        // it is guaranteed to find is still there when it looks. A DEADLINE and
                        // not a barrier: a reader that died has its own assertion waiting for it
                        // at the end, and must not ALSO hang the suite here — the same reason
                        // the joins below are collected before `done` is stored.
                        let deadline =
                            std::time::Instant::now() + std::time::Duration::from_secs(10);
                        while reads.load(Ordering::Relaxed) == 0
                            && std::time::Instant::now() < deadline
                        {
                            std::thread::yield_now();
                        }
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

    /// Every directory a save depends on is published the same way the files inside it are.
    ///
    /// A directory's entry is metadata in its parent, so `create_dir_all` alone left three
    /// carefully-synced artifacts inside something a crash could take whole (the audit's finding,
    /// 2026-09-05). Every intermediate ancestor counts: they are created top-down, and each one's
    /// entry is published before the next is made inside it. The directory the walk FINDS is
    /// published too, ahead of them all — see the two tests below for the saves that prove why.
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
                d.parent()
                    .expect("the scratch directory has a parent")
                    .into(),
                d.clone(),
                d.join("cubus"),
                d.join("cubus").join("optimal-pdb")
            ],
            "the directory it found, then each new entry's parent in turn"
        );

        // Idempotent — and a directory that was already there is published once, rather than
        // taken on trust. Nothing was created, so there is exactly one entry whose durability is
        // in question: the target's own.
        let mut again: Vec<std::path::PathBuf> = Vec::new();
        create_dirs_with(&deep, &mut |at| {
            again.push(at.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(
            again,
            vec![d.join("cubus").join("optimal-pdb")],
            "publishing the directory it is about to write into is the whole of the second call"
        );

        // A sync that refuses stops the creation there, rather than carrying on into a tree whose
        // upper levels may not survive a crash. The refusal here is the one that would publish
        // `a`, so `b` is never made.
        let mut calls = 0;
        let e = create_dirs_with(&d.join("a").join("b"), &mut |at| {
            calls += 1;
            if at == d {
                return Err(std::io::Error::other(
                    "this volume cannot fsync a directory",
                ));
            }
            Ok(())
        })
        .expect_err("a refusal is propagated, never swallowed");
        assert_eq!(e.to_string(), "this volume cannot fsync a directory");
        assert_eq!(calls, 2, "the directory it found, then the refusal");
        assert!(d.join("a").is_dir(), "`a` was created");
        assert!(
            !d.join("a").join("b").exists(),
            "and it stopped at that level, not after all of them"
        );

        // A refusal on the FIRST sync — the one for the directory that was already there — stops
        // the call before anything is created at all.
        let mut before = 0;
        assert!(create_dirs_with(&d.join("c").join("e"), &mut |_| {
            before += 1;
            Err(std::io::Error::other(
                "this volume cannot fsync a directory",
            ))
        })
        .is_err());
        assert_eq!(before, 1);
        assert!(
            !d.join("c").exists(),
            "nothing is made inside a directory whose own entry could not be published"
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

        // A filesystem root's name lives in no directory, so there is nothing to publish it —
        // and nothing to fail on a volume whose root cannot be opened or fsynced.
        #[cfg(unix)]
        {
            let mut root: Vec<std::path::PathBuf> = Vec::new();
            create_dirs_with(std::path::Path::new("/"), &mut |at| {
                root.push(at.to_path_buf());
                Ok(())
            })
            .unwrap();
            assert!(root.is_empty(), "a root has no parent to sync");
        }
    }

    /// A save retried after a FAILED sync publishes the directory the failed save left behind.
    ///
    /// The first attempt creates the directory and then cannot sync its parent, so it reports
    /// failure — but the directory is on disk, and the old rule ("publish what THIS call created")
    /// had the retry find it already there and sync nothing. Two saves, the second returning `Ok`,
    /// and an entry nobody ever forced to disk. Found by the audit's verification pass,
    /// 2026-09-05.
    #[test]
    fn a_save_after_a_failed_sync_publishes_the_directory_it_finds() {
        use super::create_dirs_with;
        let d = scratch("retry");
        let deep = d.join("cubus").join("optimal-pdb");

        let mut first: Vec<std::path::PathBuf> = Vec::new();
        let e = create_dirs_with(&deep, &mut |at| {
            first.push(at.to_path_buf());
            if at == d {
                return Err(std::io::Error::other(
                    "this volume cannot fsync a directory",
                ));
            }
            Ok(())
        })
        .expect_err("a save that cannot publish what it created has not finished");
        assert_eq!(e.to_string(), "this volume cannot fsync a directory");
        assert_eq!(first.last(), Some(&d), "the refusal was `cubus`'s parent");
        assert!(
            d.join("cubus").is_dir(),
            "the directory is on disk regardless — that is the whole problem"
        );
        assert!(
            !deep.exists(),
            "and the save stopped rather than going deeper"
        );

        let mut second: Vec<std::path::PathBuf> = Vec::new();
        create_dirs_with(&deep, &mut |at| {
            second.push(at.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert!(deep.is_dir());
        assert_eq!(
            second,
            vec![d.clone(), d.join("cubus")],
            "the unpublished directory is published first, before anything is made inside it"
        );
    }

    /// Two savers creating one directory: the one that LOSES `create_dir` publishes it too.
    ///
    /// `AlreadyExists` says the entry exists, never that anyone flushed it — the winner may not
    /// have reached its own sync yet, or may die before it does. A saver that returns `Ok` on the
    /// strength of another process's unfinished work has published nothing. Found by the audit's
    /// verification pass, 2026-09-05.
    ///
    /// **Starting the two together does not make them race**, and the fix this test stands for
    /// lives entirely in the branch a non-race never enters. One saver can finish outright before
    /// the other begins; the second then walks the tree, finds the target already a directory,
    /// syncs its parent and returns — never calling `create_dir` at all, so `AlreadyExists` is
    /// never taken while every assertion here passes (the audit's finding, 2026-09-05, reproduced
    /// by serializing the two calls: green, and testing nothing). So there is a SECOND barrier,
    /// inside the first sync: both savers are held there after each has walked the tree and found
    /// the target missing, and before either can create it. Both therefore go on to `create_dir`,
    /// and exactly one of them loses.
    #[test]
    fn two_savers_racing_to_create_one_directory_both_publish_it() {
        use super::create_dirs_with;
        let d = scratch("mkdir-race");
        let target = d.join("cubus");
        let seen: std::sync::Mutex<Vec<(usize, std::path::PathBuf, bool)>> =
            std::sync::Mutex::new(Vec::new());
        let start = std::sync::Barrier::new(2);
        let both_walked = std::sync::Barrier::new(2);
        let (seen, start, both_walked, target) = (&seen, &start, &both_walked, &target);

        std::thread::scope(|s| {
            for who in 0..2 {
                s.spawn(move || {
                    start.wait();
                    let mut walking = true;
                    create_dirs_with(target, &mut |at| {
                        // Recorded WITH the fact that decides the question: whether the directory
                        // existed at the moment of the sync. A sync before it is created cannot
                        // have published it. Recorded BEFORE the barrier, so both savers write
                        // "not there yet" whichever order they arrive in.
                        seen.lock()
                            .expect("the recording lock is never poisoned")
                            .push((who, at.to_path_buf(), target.is_dir()));
                        if std::mem::take(&mut walking) {
                            both_walked.wait();
                        }
                        Ok(())
                    })
                    .expect("losing the race is not a failure");
                });
            }
        });

        assert!(target.is_dir(), "one of them created it");
        let seen = seen.lock().expect("the recording lock is never poisoned");
        let parent = d.clone();
        for who in 0..2 {
            let mine: Vec<_> = seen.iter().filter(|(w, ..)| *w == who).collect();
            // TWO syncs is what says this saver went through `create_dir`: the directory it
            // FOUND, then the one it made — or found already made, which is the branch. A saver
            // that arrived after the target existed makes exactly ONE call, and that one-call
            // shape used to satisfy everything below.
            assert_eq!(
                mine.len(),
                2,
                "saver {who} never attempted the creation, so it never met `AlreadyExists`: \
                 {seen:?}"
            );
            assert!(
                !mine[0].2,
                "saver {who} walked the tree with the directory already there, so it was not \
                 racing anyone: {seen:?}"
            );
            assert!(
                mine[1].1 == parent && mine[1].2,
                "saver {who} returned Ok, so it synced {} itself with the directory already \
                 there — waiting on the other one's fsync is not publishing: {seen:?}",
                parent.display()
            );
        }
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

    /// A table and its certificates are one artifact in two files, and the pair is what has to
    /// survive a failure. Writing them one after the other left a new table beside stale
    /// certificates whenever the second write failed — the state that looks complete and is not.
    #[test]
    fn a_paired_publish_writes_both_or_leaves_both_alone() {
        use super::write_all_atomic;
        let d = scratch("pair");
        let table = d.join("t.json");
        let certs = d.join("t-certificates.txt");
        std::fs::write(&table, b"old table").unwrap();
        std::fs::write(&certs, b"old certificates").unwrap();

        // The second destination cannot be written: staging it fails BEFORE the first is renamed.
        let blocked = d.join("blocked");
        std::fs::create_dir_all(&blocked).unwrap();
        assert!(write_all_atomic(&[(&table, b"new table"), (&blocked, b"x")]).is_err());
        assert_eq!(
            std::fs::read(&table).unwrap(),
            b"old table",
            "the first artifact was published even though the second could not be"
        );

        // And the successful case publishes both, leaving no temporary behind.
        write_all_atomic(&[(&table, b"new table"), (&certs, b"new certificates")]).unwrap();
        assert_eq!(std::fs::read(&table).unwrap(), b"new table");
        assert_eq!(std::fs::read(&certs).unwrap(), b"new certificates");
        let leftovers: Vec<_> = std::fs::read_dir(&d)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "temp files left behind: {leftovers:?}"
        );
    }

    /// Two spellings of one destination are one destination.
    #[test]
    fn a_generator_cannot_be_told_to_write_both_artifacts_to_one_file() {
        use super::destinations_differ;
        let d = scratch("distinct");
        let a = d.join("t.json");
        let a_text = a.to_str().unwrap().to_string();
        let round_trip = d.join("sub").join("..").join("t.json");
        std::fs::create_dir_all(d.join("sub")).unwrap();
        let round_trip_text = round_trip.to_str().unwrap().to_string();
        let b_text = d.join("c.txt").to_str().unwrap().to_string();

        destinations_differ(&[&a_text, &b_text]).expect("two different files");
        let e = destinations_differ(&[&a_text, &a_text]).expect_err("the same file twice");
        assert!(e.contains("same file"), "{e}");
        let e = destinations_differ(&[&a_text, &round_trip_text])
            .expect_err("the same file spelt two ways");
        assert!(e.contains("same file"), "{e}");
    }
}
