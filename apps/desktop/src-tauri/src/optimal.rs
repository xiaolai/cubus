//! The optimal-solver seam (AGENTS.md, fourth accepted exception, 2026-08-29).
//!
//! The capability is "prove this solution minimal". The desktop answers it here — pattern
//! databases generated natively once, then IDA* proofs on demand; the browser build answers
//! the same capability with the two-phase tiers' honest "the shortest I found" and the
//! precomputed proven library. The affordance in app.js is drawn only where these commands
//! are injected AND a desktop is behind them, and the word "optimal" can reach a screen only
//! from a proof returned here.
//!
//! Desktop-only is enforced twice, because the two locks fail differently. The iOS and Android
//! shells (2026-08-30) build this same crate and inject this same command surface, so the
//! webview's `isDesktopHost()` is what keeps the button off a phone — and `optimal_prepare`
//! below refuses there regardless, since a lock that depends on the UI agreeing is one lock.
//!
//! Three commands, one long-running preparation:
//!   - `optimal_prepare` — load the validated tables from disk or generate them (minutes,
//!     ~500 MB peak; progress goes up as `optimal-progress` events). Returns "ready" when
//!     tables exist, "preparing" when another call is mid-generation — callers poll
//!     `optimal_status` to "ready" before proving; that polling contract is what makes
//!     concurrent prepare calls safe rather than merely tolerated.
//!   - `optimal_prove`  — prove one facelet state's distance. One proof at a time; a proof
//!     can run minutes to hours on deep states, which is why it is cancellable — and why each
//!     exhausted contour goes up as an `optimal-proof-progress` event, so a person waiting can
//!     see the lower bound rising instead of a button that looks wedged.
//!   - `optimal_cancel` — flip the cancel flag; the search acknowledges within milliseconds
//!     and returns a cancelled error, never a best-effort answer dressed as a proof.
//!
//! Cleanup lives INSIDE the blocking workers, not after the command's `.await`: a Tauri
//! command future can be dropped mid-await (webview reload, navigation), and anything
//! scheduled after the await simply never runs. So the preparing flag resets when the
//! generation worker exits, tables are published by the worker that built them, and the
//! proof slot is a lease the search worker owns and settles under the slot mutex — a
//! dropped future changes who hears the answer, never whether state is cleaned up.

use optimal_solver::coords::Coords;
use optimal_solver::cubie::parse_facelets;
use optimal_solver::search::{self, SearchEnd};
use optimal_solver::Tables;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

/// God's number in HTM — the proof cap, and the one bound a legal cube can never exceed.
const GODS_NUMBER: u8 = 20;
/// Progress heartbeat cadence: the webview needs a pulse, not a firehose.
const PROGRESS_EVERY: std::time::Duration = std::time::Duration::from_millis(200);

pub struct OptimalState {
    /// Behind an Arc so the generation worker can publish without the command future — the
    /// future may be gone by the time the tables exist.
    tables: Arc<OnceLock<Arc<Tables>>>,
    preparing: Arc<AtomicBool>,
    /// Whether the last successful preparation persisted its tables (surfaced per proof). A
    /// field of the state rather than a process global: the state is the one thing every
    /// command shares, and a global beside it was a second place for the same fact.
    tables_persisted: Arc<AtomicBool>,
    /// The ONE record of a running proof: Some(cancel-flag) while one runs. Claiming,
    /// cancelling and settling all pass through its mutex, so no window exists where a proof
    /// is accepted but invisible to cancel, or cancelled but reported as if untouched.
    proof: Arc<ProofSlot>,
}

impl Default for OptimalState {
    fn default() -> Self {
        Self {
            tables: Arc::default(),
            preparing: Arc::default(),
            // True until a preparation says otherwise: before any prepare there is nothing to
            // have failed to persist, and a proof cannot run before one anyway.
            tables_persisted: Arc::new(AtomicBool::new(true)),
            proof: Arc::default(),
        }
    }
}

#[derive(Default)]
pub struct ProofSlot(Mutex<Option<Arc<AtomicBool>>>);

impl ProofSlot {
    /// Flip the running proof's cancel flag, if one runs. Runs under the slot mutex, the
    /// same lock `finish` settles under — which is what makes the pair linearizable: a
    /// cancel that returns true is GUARANTEED to turn that proof's outcome into cancelled.
    fn cancel(&self) -> bool {
        match self.0.lock().unwrap().as_ref() {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

/// A claimed proof slot, owned by the search worker. Settling goes through `finish`; a
/// panic or any path that never reaches it releases the slot on drop, so a wedged slot
/// cannot outlive its worker.
struct ProofLease {
    slot: Arc<ProofSlot>,
    flag: Arc<AtomicBool>,
    finished: bool,
}

impl ProofLease {
    /// Claim the slot, installing this proof's cancel flag. None when a proof already runs.
    fn claim(slot: &Arc<ProofSlot>) -> Option<ProofLease> {
        let mut guard = slot.0.lock().unwrap();
        if guard.is_some() {
            return None;
        }
        let flag = Arc::new(AtomicBool::new(false));
        *guard = Some(flag.clone());
        drop(guard);
        Some(ProofLease {
            slot: slot.clone(),
            flag,
            finished: false,
        })
    }

    fn cancel_flag(&self) -> Arc<AtomicBool> {
        self.flag.clone()
    }

    /// Release the slot and settle the outcome, atomically with any cancel: under the slot
    /// mutex, a cancel flag flipped before this moment converts even a completed answer into
    /// "cancelled" — the caller asked the proof to stop, so a success would be a lie about
    /// what they were promised.
    fn finish<T>(mut self, out: Result<T, String>) -> Result<T, String> {
        let mut guard = self.slot.0.lock().unwrap();
        let cancelled = self.flag.load(Ordering::Relaxed);
        *guard = None;
        drop(guard);
        self.finished = true;
        if cancelled {
            return Err("cancelled".into());
        }
        out
    }
}

impl Drop for ProofLease {
    fn drop(&mut self) {
        if !self.finished {
            *self.slot.0.lock().unwrap() = None;
        }
    }
}

/// Clears a flag on drop — the one honest way to promise "reset on every exit path".
struct FlagGuard(Arc<AtomicBool>);
impl FlagGuard {
    fn claim(flag: &Arc<AtomicBool>) -> Option<FlagGuard> {
        if flag.swap(true, Ordering::SeqCst) {
            None // already claimed by another call
        } else {
            Some(FlagGuard(flag.clone()))
        }
    }
}
impl Drop for FlagGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(serde::Serialize, Clone)]
pub struct OptimalProgress {
    stage: String,
    done: u64,
    total: u64,
}

/// One completed contour of a running proof.
///
/// `ruled_out` is the largest length now EXHAUSTED: every maneuver that short has been searched
/// and none solves the cube, so the answer is at least one move longer. That is a lower bound
/// being established in public, which is the one number a waiting person can actually use — and
/// deliberately not a percentage, because a proof has no denominator to be a fraction of.
///
/// The search also reports a cumulative node count, and this payload deliberately does NOT carry
/// it: nothing renders it, and a field shipped over the bridge for no reader is weight plus an
/// invitation to start trusting a number no test covers.
#[derive(serde::Serialize, Clone)]
pub struct OptimalProofProgress {
    ruled_out: u8,
}

#[derive(serde::Serialize)]
pub struct OptimalProof {
    length: u8,
    solution: String,
    nodes: u64,
    millis: u128,
    /// False when the 86 MB tables could not be persisted: everything still works, but the
    /// next launch regenerates for minutes — said out loud, not buried in a log.
    tables_persisted: bool,
}

fn tables_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("optimal-pdb"))
}

/// The load-or-generate decision, with every I/O injected so it can be tested without minutes
/// of BFS (the real `Tables` cannot be built in a unit test in any useful time).
///
/// `Ok` from the loader is the tables and `persisted = true`. Missing or invalid artifacts are
/// the regeneration cases: the reason is logged first — so a permission problem does not
/// masquerade as corruption — then the fresh tables are saved, and a save that fails is
/// reported as `persisted = false`, never as an error: the tables exist and every proof works,
/// the next launch just pays the generation again, and the proof says so out loud. An `Io`
/// refusal from the loader is different in kind: the filesystem itself would not read, minutes
/// of regeneration cannot fix that, and the save would hit the same wall — so it is surfaced
/// instead of spent.
fn resolve_tables<T>(
    loaded: Result<T, optimal_solver::LoadError>,
    generate: impl FnOnce() -> Result<T, String>,
    save: impl FnOnce(&T) -> Result<(), String>,
) -> Result<(T, bool), String> {
    match loaded {
        Ok(tables) => Ok((tables, true)),
        Err(
            e @ (optimal_solver::LoadError::Missing(_) | optimal_solver::LoadError::Invalid(_)),
        ) => {
            log::info!("optimal: not loading saved tables ({e}); generating");
            let tables = generate()?;
            let persisted = match save(&tables) {
                Ok(()) => true,
                Err(e) => {
                    log::warn!("optimal: tables generated but not saved: {e}");
                    false
                }
            };
            Ok((tables, persisted))
        }
        Err(e @ optimal_solver::LoadError::Io(_)) => {
            Err(format!("cannot read the tables directory: {e}"))
        }
    }
}

/// Load-or-generate, once. Loading refuses any corrupt artifact (checksum, move-set hash,
/// metric, payload histogram, truncation); the refusal REASON is logged before regeneration,
/// so a permission problem does not masquerade as corruption. Regeneration rebuilds from
/// nothing and re-validates exhaustively rather than trusting bytes.
#[tauri::command]
pub async fn optimal_prepare(
    app: AppHandle,
    state: tauri::State<'_, OptimalState>,
) -> Result<String, String> {
    // Not this machine's work. Generating the tables is a rayon fan-out over every core,
    // ~500 MB peak and 86 MB written; the mobile shells inject this command anyway, so the
    // refusal lives here as well as in the webview that never draws the button. Loud, not
    // silent: a caller that reached this learns why instead of waiting on a preparation that
    // is never coming.
    if cfg!(mobile) {
        return Err("proving a minimum is desktop-only — a phone has neither the cores nor the room for the tables".into());
    }
    if state.tables.get().is_some() {
        return Ok("ready".into());
    }
    let dir = tables_dir(&app)?; // resolved BEFORE the flag: an error here must not wedge us
    let Some(guard) = FlagGuard::claim(&state.preparing) else {
        return Ok("preparing".into());
    };
    // Recheck under the claim: another prepare may have published between the look above and
    // the flag — regenerating over existing tables would burn minutes and ~500 MB for nothing.
    if state.tables.get().is_some() {
        return Ok("ready".into());
    }
    let emitter = app.clone();
    let cell = state.tables.clone();
    let persisted_flag = state.tables_persisted.clone();
    // Everything after this point happens in the worker, guard included: if this command's
    // future is dropped mid-await, the generation still completes, publishes, and resets the
    // flag — the drop only costs the caller the report, never the state.
    let outcome = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let _guard = guard;
        let generate = || {
            let mut last = std::time::Instant::now();
            let mut emit_failed = false;
            Tables::generate(&mut |stage, done, total| {
                if last.elapsed() >= PROGRESS_EVERY || done == total {
                    last = std::time::Instant::now();
                    if let Err(e) = emitter.emit(
                        "optimal-progress",
                        OptimalProgress {
                            stage: stage.to_string(),
                            done,
                            total,
                        },
                    ) {
                        // Log once: a silent heartbeat failure makes minutes of generation
                        // look like a hang, and a log per beat would be its own flood.
                        if !emit_failed {
                            emit_failed = true;
                            log::warn!(
                                "optimal: progress events are not reaching the webview: {e}"
                            );
                        }
                    }
                }
            })
        };
        let (tables, persisted) =
            resolve_tables(Tables::load(&dir), generate, |tables| tables.save(&dir))?;
        // Persisted-flag first, then publish: a prove that sees the tables must also see the
        // right persistence answer. Losing the set race would mean another prepare slipped
        // the flag — possible only through a bug, so it is logged, never shrugged off.
        persisted_flag.store(persisted, Ordering::Relaxed);
        if cell.set(Arc::new(tables)).is_err() {
            log::warn!(
                "optimal: tables were already published — a concurrent prepare slipped the flag"
            );
        }
        Ok("ready".into())
    })
    .await
    .map_err(|e| format!("preparation worker failed: {e}"))?;
    outcome
}

#[tauri::command]
pub fn optimal_status(state: tauri::State<'_, OptimalState>) -> String {
    if state.tables.get().is_some() {
        "ready".into()
    } else if state.preparing.load(Ordering::SeqCst) {
        "preparing".into()
    } else if state.tables.get().is_some() {
        // Publication landed between the two reads above (the worker publishes BEFORE its
        // guard drops, so preparing=false means any publish is already visible). Without
        // this recheck a poll at exactly that instant would say "cold" over ready tables —
        // and the webview treats "cold" mid-wait as a failed generation.
        "ready".into()
    } else {
        "cold".into()
    }
}

#[tauri::command]
pub async fn optimal_prove(
    app: AppHandle,
    facelets: String,
    state: tauri::State<'_, OptimalState>,
) -> Result<OptimalProof, String> {
    // Parse before claiming anything: a malformed request should never occupy the proof slot.
    let cube = parse_facelets(&facelets).map_err(|e| format!("not a solvable cube: {e}"))?;
    let tables = state
        .tables
        .get()
        .ok_or("tables are not ready — call optimal_prepare first")?
        .clone();
    let Some(lease) = ProofLease::claim(&state.proof) else {
        return Err("a proof is already running".into());
    };
    let started = std::time::Instant::now();
    let emitter = app.clone();
    let persisted_flag = state.tables_persisted.clone();
    // The lease rides in the worker: settled there under the slot mutex, released by drop if
    // the search panics — a dropped command future cannot wedge the slot.
    tauri::async_runtime::spawn_blocking(move || {
        let cancel = lease.cancel_flag();
        let coords = Coords::from_cubie(&cube);
        // Report each exhausted contour. At most twenty of these exist for any cube (the cap is
        // God's number), so there is no firehose to throttle — unlike table generation, whose
        // heartbeat is rate-limited precisely because it has one. A webview that has gone away
        // must not fail a proof that is running perfectly well, so a failed emit is logged once
        // and the search carries on.
        let mut warned = false;
        let mut on_progress = |ruled_out: u8, _nodes: u64| {
            if let Err(e) =
                emitter.emit("optimal-proof-progress", OptimalProofProgress { ruled_out })
            {
                if !warned {
                    warned = true;
                    log::warn!("optimal: proof progress is not reaching the webview: {e}");
                }
            }
        };
        let out = match search::prove(&tables, &coords, GODS_NUMBER, &cancel, &mut on_progress) {
            Ok(proof) => Ok(OptimalProof {
                length: proof.length,
                solution: search::solution_string(&proof.solution),
                nodes: proof.nodes,
                millis: started.elapsed().as_millis(),
                tables_persisted: persisted_flag.load(Ordering::Relaxed),
            }),
            Err(SearchEnd::Cancelled) => Err("cancelled".to_string()),
            // Unreachable with the cap at God's number on a legal cube, and said loudly
            // rather than absorbed if a table regression ever makes it reachable.
            Err(SearchEnd::BeyondCap) => Err(format!(
                "no solution within {GODS_NUMBER} — the tables are wrong"
            )),
            Err(SearchEnd::InvalidShard) => unreachable!("prove takes no shard"),
        };
        lease.finish(out)
    })
    .await
    .map_err(|e| format!("proof worker failed: {e}"))?
}

#[tauri::command]
pub fn optimal_cancel(state: tauri::State<'_, OptimalState>) -> bool {
    state.proof.cancel()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_proof_lease_is_exclusive_cancellable_and_reusable() {
        // The coordinator logic, unit-tested without a Tauri runtime — the audit's ask.
        let slot = Arc::new(ProofSlot::default());
        assert!(!slot.cancel(), "nothing to cancel while idle");
        let lease = ProofLease::claim(&slot).expect("idle slot claims");
        assert!(
            ProofLease::claim(&slot).is_none(),
            "a second proof is refused while one runs"
        );
        assert!(slot.cancel(), "a running proof can be cancelled");
        assert!(
            lease.flag.load(Ordering::Relaxed),
            "and its own flag is the one flipped"
        );
        assert_eq!(
            lease.finish(Ok::<_, String>(42)),
            Err("cancelled".into()),
            "a cancelled proof never reports success, even one that finished"
        );
        assert!(!slot.cancel(), "finish retires the handle");
        assert!(
            ProofLease::claim(&slot).is_some(),
            "and the slot is reusable"
        );
    }

    #[test]
    fn an_uncancelled_finish_reports_the_result_and_a_drop_frees_the_slot() {
        let slot = Arc::new(ProofSlot::default());
        let lease = ProofLease::claim(&slot).expect("claims");
        assert_eq!(lease.finish(Ok::<_, String>(7)), Ok(7));
        // The panic path: a lease that never reaches finish must still free the slot.
        let lease = ProofLease::claim(&slot).expect("claims again");
        drop(lease);
        assert!(
            ProofLease::claim(&slot).is_some(),
            "a dropped lease cannot wedge the slot"
        );
    }

    #[test]
    fn racing_claims_admit_exactly_one_winner() {
        // The audit's concurrency ask, on real threads: however many callers arrive at once,
        // one prepare holds the flag and one proof holds the slot — no lost or double claims.
        let flag = Arc::new(AtomicBool::new(false));
        let slot = Arc::new(ProofSlot::default());
        // The barrier holds every winner's guard alive until every thread has TRIED — without
        // it a winner could drop early and hand a second thread a second win.
        let barrier = std::sync::Barrier::new(16);
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..16)
                .map(|_| {
                    scope.spawn(|| {
                        let won = (FlagGuard::claim(&flag), ProofLease::claim(&slot));
                        barrier.wait();
                        (won.0.is_some(), won.1.is_some())
                    })
                })
                .collect();
            let (guards, claims): (Vec<bool>, Vec<bool>) =
                handles.into_iter().map(|h| h.join().unwrap()).unzip();
            assert_eq!(guards.iter().filter(|&&g| g).count(), 1, "one prepare");
            assert_eq!(claims.iter().filter(|&&c| c).count(), 1, "one proof");
        });
        // Guards and leases from the scope are dropped by now — both released.
        assert!(
            !flag.load(Ordering::SeqCst),
            "flag released after the scope"
        );
        // A cancel racing claims and finishes never poisons the next claim: one mutex
        // serializes all three, so the storm must end with a claimable slot.
        std::thread::scope(|scope| {
            let a = scope.spawn(|| {
                for i in 0..1000 {
                    if let Some(lease) = ProofLease::claim(&slot) {
                        let _ = lease.finish(Ok::<_, String>(i));
                    }
                }
            });
            let b = scope.spawn(|| {
                for _ in 0..1000 {
                    slot.cancel();
                }
            });
            a.join().unwrap();
            b.join().unwrap();
        });
        assert!(
            ProofLease::claim(&slot).is_some(),
            "slot still claimable after the storm"
        );
    }

    /// `optimal_prepare`'s three branches, with the minutes of BFS replaced by closures that
    /// count. The `Io`-versus-`Invalid` distinction and the `tables_persisted=false` path were
    /// the two things in this file no test reached.
    #[test]
    fn prepare_regenerates_on_missing_or_invalid_and_refuses_on_io() {
        use optimal_solver::LoadError;
        // Loaded: no generation, no save, persisted.
        let mut generated = 0;
        let out = resolve_tables::<u8>(
            Ok(1),
            || {
                generated += 1;
                Ok(2)
            },
            |_| panic!("a loaded table is not saved again"),
        );
        assert_eq!(out, Ok((1, true)));
        assert_eq!(generated, 0);

        // Missing and Invalid: regenerate, save, persisted.
        for e in [
            LoadError::Missing("corner.pdb".into()),
            LoadError::Invalid("corner.pdb: checksum".into()),
        ] {
            let mut saved = 0;
            let out = resolve_tables::<u8>(
                Err(e),
                || Ok(2),
                |t| {
                    assert_eq!(*t, 2);
                    saved += 1;
                    Ok(())
                },
            );
            assert_eq!(out, Ok((2, true)));
            assert_eq!(saved, 1, "fresh tables are saved once");
        }

        // A save that fails is NOT an error: the tables are good, the answer says so.
        let out = resolve_tables::<u8>(
            Err(LoadError::Missing("edge-a.pdb".into())),
            || Ok(3),
            |_| Err("read-only volume".into()),
        );
        assert_eq!(
            out,
            Ok((3, false)),
            "tables_persisted=false, tables still returned"
        );

        // Io: surfaced, and NOTHING is generated — minutes of work the save would waste.
        let mut generated = 0;
        let out = resolve_tables::<u8>(
            Err(LoadError::Io("corner.pdb: permission denied".into())),
            || {
                generated += 1;
                Ok(4)
            },
            |_| Ok(()),
        );
        assert_eq!(
            generated, 0,
            "an unreadable directory is not regenerated over"
        );
        let e = out.unwrap_err();
        assert!(
            e.contains("cannot read the tables directory") && e.contains("permission denied"),
            "{e}"
        );

        // A generation that refuses is the caller's error, verbatim.
        let out = resolve_tables::<u8>(
            Err(LoadError::Missing("edge-b.pdb".into())),
            || Err("a move table is wrong".into()),
            |_| Ok(()),
        );
        assert_eq!(out, Err("a move table is wrong".into()));
    }

    #[test]
    fn the_flag_guard_resets_on_every_exit() {
        let flag = Arc::new(AtomicBool::new(false));
        {
            let g = FlagGuard::claim(&flag).expect("first claim");
            assert!(FlagGuard::claim(&flag).is_none(), "no double claim");
            drop(g);
        }
        assert!(
            !flag.load(Ordering::SeqCst),
            "dropped guard released the flag"
        );
        let g = FlagGuard::claim(&flag).expect("reusable after drop");
        drop(g);
    }
}
