//! Which capture session is current, and everything that must change WITH it — the worker that owns
//! the device and the camera the app believes is open — behind one lock.
//!
//! WHY ONE LOCK (2026-09-21, audit-fix rows 35, 36, 37 and 39). `windows.rs` kept three things in
//! three places: a generation number the worker polls, the worker handle, and `opened`. Each was
//! correct alone and they raced together:
//!
//! - an open claimed its generation, then installed its worker — so two overlapping opens could
//!   interleave and the OLDER call overwrite the newer worker handle, detaching the thread that
//!   actually held the device (row 35);
//! - a timed-out open retired "the current session" through the global stop — which by then could
//!   be a NEWER open's session, closed by an attempt that had already lost (rows 36, 39);
//! - the `opened` commit checked the generation and then wrote, in two steps, so a close between
//!   them left `current_camera` reporting a camera that was not running (row 37).
//!
//! Every transition here is one critical section: claim, install, retire-if-current, commit. The
//! generation is ALSO published as an atomic, because the capture thread checks it on every frame
//! and must never wait on a lock the command side holds; it is written only under `inner`, so the
//! two can never disagree about which session is current. The JOIN of a retired worker — up to
//! seconds — is the caller's, outside the lock, so `current_camera` (a plain command on the main
//! thread) never waits on it.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use crate::worker::CaptureWorker;

/// The current session's number and the two things owned with it.
struct Inner<O> {
    generation: usize,
    worker: Option<CaptureWorker>,
    opened: Option<O>,
}

pub struct CaptureLifecycle<O> {
    /// The generation as the capture thread reads it, lock-free; mirrors `inner.generation`.
    published: Arc<AtomicUsize>,
    inner: Mutex<Inner<O>>,
}

impl<O> Default for CaptureLifecycle<O> {
    fn default() -> Self {
        Self {
            published: Arc::new(AtomicUsize::new(0)),
            inner: Mutex::new(Inner {
                generation: 0,
                worker: None,
                opened: None,
            }),
        }
    }
}

/// A session's identity as its worker carries it: the published generation and the number this
/// worker was spawned under. `current()` is what the capture loop polls; `ensure_current()` is what
/// an open checks after every blocking device operation, so a worker whose session was retired
/// while it sat inside `Camera::new` stops BEFORE it negotiates a format or lights the camera
/// (2026-09-21, audit-fix row 34).
#[derive(Clone)]
pub struct SessionToken {
    published: Arc<AtomicUsize>,
    mine: usize,
}

impl SessionToken {
    pub fn current(&self) -> bool {
        self.published.load(Ordering::SeqCst) == self.mine
    }

    pub fn ensure_current(&self) -> Result<(), String> {
        if self.current() {
            Ok(())
        } else {
            Err("the camera was closed before it finished opening".to_string())
        }
    }
}

impl<O> CaptureLifecycle<O> {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner<O>> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Retire whatever session is current and claim the next: its number, and the retired worker
    /// for the caller to join outside the lock. `opened` is cleared with it.
    pub fn claim(&self) -> (SessionToken, Option<CaptureWorker>) {
        let mut inner = self.lock();
        inner.generation += 1;
        self.published.store(inner.generation, Ordering::SeqCst);
        inner.opened = None;
        let worker = inner.worker.take();
        (
            SessionToken {
                published: Arc::clone(&self.published),
                mine: inner.generation,
            },
            worker,
        )
    }

    /// Retire the session `token` names — ONLY if it is still the current one. An attempt that has
    /// already been superseded gets `None` and changes nothing; the newer session it would have
    /// closed goes on running. `Some(worker)` is the retired worker to join outside the lock.
    pub fn retire_if_current(&self, token: &SessionToken) -> Option<Option<CaptureWorker>> {
        let mut inner = self.lock();
        if inner.generation != token.mine {
            return None;
        }
        inner.generation += 1;
        self.published.store(inner.generation, Ordering::SeqCst);
        inner.opened = None;
        Some(inner.worker.take())
    }

    /// Install the worker spawned for `token`. Refused — the worker handed back for the caller to
    /// join — when the session was superseded while the thread was being spawned; the worker exits
    /// on its first generation check, and installing it would detach the live one.
    pub fn install(
        &self,
        token: &SessionToken,
        worker: CaptureWorker,
    ) -> Result<(), CaptureWorker> {
        let mut inner = self.lock();
        if inner.generation != token.mine {
            return Err(worker);
        }
        inner.worker = Some(worker);
        Ok(())
    }

    /// Record the camera `token`'s session opened, atomically with the check that the session is
    /// still current. False when it was superseded: nothing is written, and the caller reports the
    /// open as lost rather than publishing a camera that is not running.
    pub fn commit_opened(&self, token: &SessionToken, opened: O) -> bool {
        let mut inner = self.lock();
        if inner.generation != token.mine {
            return false;
        }
        inner.opened = Some(opened);
        true
    }

    /// The camera the current session opened, if it has.
    pub fn opened(&self) -> Option<O>
    where
        O: Clone,
    {
        self.lock().opened.clone()
    }

    /// The published generation, for a test or a log.
    pub fn generation(&self) -> usize {
        self.published.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::mpsc;
    use std::time::Duration;

    /// A worker that runs until its session is retired, as the capture loop does.
    fn worker_for(token: SessionToken, stopped: Arc<AtomicBool>) -> CaptureWorker {
        CaptureWorker::spawn(move || {
            while token.current() {
                std::thread::sleep(Duration::from_millis(1));
            }
            stopped.store(true, Ordering::SeqCst);
        })
    }

    /// Rows 36 and 39, the overlapping-open regression: attempt A times out AFTER attempt B has
    /// become current. A's retirement must be a no-op — B's session number stands and B's worker
    /// keeps running.
    #[test]
    fn an_old_attempts_timeout_cannot_retire_a_newer_session() {
        let life: CaptureLifecycle<&str> = CaptureLifecycle::default();
        let (a, _) = life.claim();
        let (b, _) = life.claim();
        let b_stopped = Arc::new(AtomicBool::new(false));
        life.install(&b, worker_for(b.clone(), Arc::clone(&b_stopped)))
            .ok()
            .expect("B is current, so its worker installs");
        assert!(life.commit_opened(&b, "camera B"));

        // A's `settle_open` timeout fires now, the way `windows.rs` retires: only if current.
        assert!(
            life.retire_if_current(&a).is_none(),
            "a superseded attempt must not retire anything"
        );
        assert_eq!(life.generation(), b.mine, "B's session number stands");
        assert!(b.current(), "B's worker still owns the device");
        assert_eq!(
            life.opened(),
            Some("camera B"),
            "B's camera is still reported"
        );
        std::thread::sleep(Duration::from_millis(10));
        assert!(
            !b_stopped.load(Ordering::SeqCst),
            "B's worker was stopped by A's timeout"
        );

        // And B's own retirement still works, and returns its worker to join.
        let retired = life
            .retire_if_current(&b)
            .expect("B is current")
            .expect("B's worker was installed");
        assert_eq!(
            retired.join_within(Duration::from_secs(5)),
            crate::worker::Joined::Clean
        );
        assert!(b_stopped.load(Ordering::SeqCst));
        assert_eq!(life.opened(), None);
    }

    /// Row 35: a worker whose session was superseded while its thread was being spawned is handed
    /// back rather than installed over the live one.
    #[test]
    fn a_worker_installed_after_its_session_was_superseded_is_handed_back() {
        let life: CaptureLifecycle<&str> = CaptureLifecycle::default();
        let (a, _) = life.claim();
        let (b, _) = life.claim();
        let (tx, rx) = mpsc::channel::<()>();
        let b_worker = CaptureWorker::spawn(move || {
            let _ = rx.recv();
        });
        life.install(&b, b_worker).ok().expect("B installs");
        let a_worker = CaptureWorker::spawn(|| {});
        let refused = life
            .install(&a, a_worker)
            .expect_err("A was superseded, its worker must be handed back");
        assert_eq!(
            refused.join_within(Duration::from_secs(5)),
            crate::worker::Joined::Clean
        );
        // B's worker is still the installed one: retiring B returns it.
        drop(tx);
        let mine = life
            .retire_if_current(&b)
            .expect("B current")
            .expect("B's worker");
        assert_eq!(
            mine.join_within(Duration::from_secs(5)),
            crate::worker::Joined::Clean
        );
    }

    /// Row 37: the `opened` commit is atomic with the currency check — a session superseded before
    /// its commit writes nothing, so `current_camera` never reports a camera that is not running.
    #[test]
    fn opened_is_committed_only_while_the_session_is_current() {
        let life: CaptureLifecycle<&str> = CaptureLifecycle::default();
        let (a, _) = life.claim();
        let (b, _) = life.claim();
        assert!(!life.commit_opened(&a, "camera A"), "A was superseded");
        assert_eq!(life.opened(), None, "nothing was written for A");
        assert!(life.commit_opened(&b, "camera B"));
        assert_eq!(life.opened(), Some("camera B"));
        // A close clears it with the generation, in the same step.
        let (_, _) = life.claim();
        assert_eq!(life.opened(), None);
        assert!(!b.current());
    }

    /// `claim` retires the previous session's worker and hands it over for the join — the reopen
    /// safety that keeps the device from being opened twice.
    #[test]
    fn claim_retires_the_previous_worker_for_the_caller_to_join() {
        let life: CaptureLifecycle<&str> = CaptureLifecycle::default();
        let (a, none) = life.claim();
        assert!(none.is_none(), "nothing ran before the first claim");
        let a_stopped = Arc::new(AtomicBool::new(false));
        life.install(&a, worker_for(a.clone(), Arc::clone(&a_stopped)))
            .ok()
            .unwrap();
        let (b, previous) = life.claim();
        let previous = previous.expect("A's worker is handed to B's open to join");
        assert_eq!(
            previous.join_within(Duration::from_secs(5)),
            crate::worker::Joined::Clean
        );
        assert!(
            a_stopped.load(Ordering::SeqCst),
            "A stopped on its generation check"
        );
        assert!(b.current() && !a.current());
        assert!(a.ensure_current().is_err() && b.ensure_current().is_ok());
    }
}
