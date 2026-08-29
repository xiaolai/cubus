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

    /// Generate all three databases from nothing, validating each exhaustively. Minutes of
    /// work and ~500 MB peak (measured in the plan's refute pass); `progress` hears
    /// (stage, done, total), and each table's Bellman pass is its own "validate" stage — 100%
    /// of a BFS no longer displays while minutes of certification still stand before ready.
    pub fn generate(progress: &mut dyn FnMut(&str, u64, u64)) -> Result<Tables, String> {
        let moves = MoveTables::build();
        let mut one = |kind: Kind, name: &'static str| -> Result<Pdb, String> {
            let table = pdb::generate(kind, &moves, &mut |d, t| progress(name, d, t))?;
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
    /// pins the entries to their places, and it is seconds of parallel work against minutes
    /// of regeneration.
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
        let write = |name: &str, p: &Pdb| -> Result<(), String> {
            // Write-then-rename, so an interrupted save leaves no plausible-looking file.
            let tmp = dir.join(format!("{name}.tmp"));
            std::fs::write(&tmp, pdb::serialize(p)).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, dir.join(name)).map_err(|e| e.to_string())
        };
        for ((name, _), table) in ARTIFACTS
            .iter()
            .zip([&self.corner, &self.edge_a, &self.edge_b])
        {
            write(name, table)?;
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
