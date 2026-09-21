//! A capture thread that can actually be stopped: the handle, and a join that waits a bounded time.
//!
//! `windows.rs` retires a capture session by bumping a generation number the worker polls, which
//! is correct and was also incomplete: nothing waited for the old thread to LEAVE. A reopen could
//! therefore spawn its new worker while the previous one still held the Media Foundation device —
//! `Camera::new` on the new thread then failed with a busy device, or the two raced over
//! `stop_stream`, and the scan reported a camera that "could not be opened" for a camera nobody
//! else was using (audit 2026-09-04, native B4). The handle is kept so the reopen can wait, and the
//! wait is bounded because a worker blocked inside a ten-second `Camera::new` must not freeze the
//! command that is trying to replace it — a timed-out join leaves that thread to notice the
//! generation change on its own, which it does before publishing anything.
//!
//! Exit is signalled by DROP, not by a message the worker has to remember to send: the sender lives
//! inside the thread closure, so a panic ends the wait exactly as a clean return does. Compiled on
//! Windows and under `cfg(test)` everywhere, so the join contract is exercised on a Mac.
//!
//! The same drop rule governs the OPEN HANDSHAKE, and [settle_open] is its reading: the worker
//! answers `open_camera` once over a channel whose sender it owns, so the channel reports three
//! things — the worker's answer, the worker's death, and a worker still busy — and each obliges
//! the caller to something different (audit 2026-09-20, 2.8).

use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

/// Read the open handshake's answer, and do the one thing each answer obliges the caller to do.
///
/// `open_camera` waits on a channel the worker writes exactly once — `Ok(label)` once the stream is
/// up, `Err(why)` when `Camera::new` or `open_stream` refused — and the sender lives in the worker's
/// closure, so the channel also reports the worker's END: a return or a panic drops it.
/// `std::sync::mpsc` hands over every message sent before that drop AHEAD of `Disconnected`, which
/// is what lets a worker that failed inside `Camera::new` be reported in its own words: the message
/// is queued before the closure returns and read before the disconnect is. Three answers:
///
/// - **a message**: relay it as it is. The worker has either started publishing or already left,
///   and in neither case can anything change hands behind the caller's back.
/// - **`Timeout`**: RETIRE the session, then report. The worker is still inside `Camera::new`, and
///   until 2026-09-20 nothing here bumped the generation — so a camera that answered at 11 s
///   published frames with the lens on and no owner: `opened` was never set, so no close ever
///   reached it. `retire` bumps the generation (and joins or detaches the thread), and the
///   straggler's first generation check stops it before it publishes a frame.
/// - **`Disconnected`**: the worker ended without answering, which after a return is impossible
///   (a return always sends first) and so means a panic before the channel was written. Reported
///   as that. Until 2026-09-20 both errors were mapped to "did not answer within 10s" — the same
///   words for a dead thread as for a slow camera, and the reader told to wait.
///
/// Pure in the result and the closure, so the policy is tested here on every host; `windows.rs`
/// is the only caller, and what it passes as `retire` is CONDITIONAL on the timed-out attempt still
/// being the current session (`CaptureLifecycle::retire_if_current`, 2026-09-21, audit-fix row 39):
/// an attempt that timed out after a newer open had replaced it used to stop the newer session.
pub fn settle_open(
    answer: Result<Result<String, String>, mpsc::RecvTimeoutError>,
    waited: Duration,
    retire: impl FnOnce(),
) -> Result<String, String> {
    match answer {
        Ok(reply) => reply,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            retire();
            Err(format!("the camera did not answer within {waited:?}"))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(
            "the capture thread ended without answering — it panicked before the camera could \
             report"
                .to_string(),
        ),
    }
}

pub struct CaptureWorker {
    handle: Option<JoinHandle<()>>,
    exited: mpsc::Receiver<()>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Joined {
    /// The thread returned (or panicked) within the timeout and has been joined.
    Clean,
    /// The thread is still running; it has been left to finish on its own.
    TimedOut,
}

impl CaptureWorker {
    pub fn spawn<F: FnOnce() + Send + 'static>(work: F) -> Self {
        let (tx, exited) = mpsc::channel::<()>();
        let handle = std::thread::spawn(move || {
            let _exit_on_drop = tx;
            work();
        });
        Self {
            handle: Some(handle),
            exited,
        }
    }

    /// Wait up to `timeout` for the thread to end, then join it. The caller has already told the
    /// thread to stop (by whatever signal it polls); this only waits for it to comply.
    pub fn join_within(mut self, timeout: Duration) -> Joined {
        match self.exited.recv_timeout(timeout) {
            // The sender only ever drops; a value is never sent.
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(h) = self.handle.take() {
                    // A panicked worker has already reported through the log; the join result
                    // carries nothing more.
                    let _ = h.join();
                }
                Joined::Clean
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Detached: the handle drops here and the thread keeps its own life.
                self.handle.take();
                Joined::TimedOut
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

    /// The panic hook is PROCESS-GLOBAL and the harness runs tests on parallel threads. Two tests
    /// here panic on purpose and used to silence the hook with `set_hook` and put it back with
    /// `take_hook` — which installs the DEFAULT hook, not the previous one, and raced the other
    /// test's own set/take (2026-09-21, audit-fix row 100). This guard serialises the two through
    /// one lock, saves the hook that was installed, and restores exactly that hook when dropped, on
    /// the unwind path too.
    struct QuietPanics {
        _serialised: MutexGuard<'static, ()>,
        previous: Option<PanicHook>,
    }

    /// What `std::panic::take_hook` hands back, and `set_hook` takes.
    type PanicHook = Box<dyn Fn(&std::panic::PanicHookInfo<'_>) + Sync + Send + 'static>;

    static HOOK: Mutex<()> = Mutex::new(());

    fn quiet_panics() -> QuietPanics {
        let serialised = HOOK.lock().unwrap_or_else(PoisonError::into_inner);
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        QuietPanics {
            _serialised: serialised,
            previous: Some(previous),
        }
    }

    impl Drop for QuietPanics {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                std::panic::set_hook(previous);
            }
        }
    }

    #[test]
    fn a_worker_that_returns_is_joined_cleanly() {
        let done = Arc::new(AtomicBool::new(false));
        let d = done.clone();
        let w = CaptureWorker::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            d.store(true, Ordering::SeqCst);
        });
        assert_eq!(w.join_within(Duration::from_secs(5)), Joined::Clean);
        assert!(
            done.load(Ordering::SeqCst),
            "joined means the work finished"
        );
    }

    /// The reopen race in one line: a worker that will not leave must not hold the caller
    /// hostage. Bounded, and reported as such rather than as a clean join.
    #[test]
    fn a_worker_that_will_not_leave_times_out_instead_of_hanging_the_caller() {
        let (never_tx, never_rx) = mpsc::channel::<()>();
        let w = CaptureWorker::spawn(move || {
            let _ = never_rx.recv(); // blocks until the test drops never_tx
        });
        let started = std::time::Instant::now();
        assert_eq!(w.join_within(Duration::from_millis(100)), Joined::TimedOut);
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "the join must be bounded by the timeout, not by the worker"
        );
        drop(never_tx);
    }

    /// A panic is an exit. The old shape — a flag the worker set on the way out — would have
    /// left a panicked worker looking alive forever.
    #[test]
    fn a_panicking_worker_still_counts_as_exited() {
        let _quiet = quiet_panics(); // keep the test log clean, and put the hook back
        let w = CaptureWorker::spawn(|| {
            panic!("capture blew up");
        });
        assert_eq!(w.join_within(Duration::from_secs(5)), Joined::Clean);
    }

    // The open handshake, driven through a REAL worker and a real channel rather than a
    // hand-built `Result`, because the claim under test is about how `mpsc` orders a message
    // against the sender's drop — and that is the runtime's behaviour, not this module's.

    /// A worker that refuses inside `Camera::new` sends its reason and returns; the reason must
    /// reach the caller as the worker wrote it, not as "ended" and not as "timed out". Nothing is
    /// retired: the thread has already left, and the parked handle is joined by the next stop.
    #[test]
    fn a_worker_that_refuses_is_reported_in_its_own_words() {
        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        let w = CaptureWorker::spawn(move || {
            let _ = tx.send(Err("could not open the camera: device busy".into()));
        });
        let retired = AtomicBool::new(false);
        let out = settle_open(
            rx.recv_timeout(Duration::from_secs(5)),
            Duration::from_secs(5),
            || retired.store(true, Ordering::SeqCst),
        );
        assert_eq!(
            out,
            Err("could not open the camera: device busy".to_string())
        );
        assert!(
            !retired.load(Ordering::SeqCst),
            "a worker that answered has nothing left to retire"
        );
        assert_eq!(w.join_within(Duration::from_secs(5)), Joined::Clean);
    }

    /// The audit's finding, 2.8: a worker still inside `Camera::new` when the wait runs out must
    /// have its session retired BEFORE the error goes back, or it publishes into nobody's session
    /// when the camera finally answers.
    #[test]
    fn a_timed_out_open_retires_the_session_before_reporting() {
        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        let (hold_tx, hold_rx) = mpsc::channel::<()>();
        let w = CaptureWorker::spawn(move || {
            let _ = hold_rx.recv(); // the ten-second Camera::new, held open by the test
            let _ = tx.send(Ok("late camera".into()));
        });
        let retired = AtomicBool::new(false);
        let out = settle_open(
            rx.recv_timeout(Duration::from_millis(50)),
            Duration::from_millis(50),
            || retired.store(true, Ordering::SeqCst),
        );
        assert_eq!(
            out,
            Err("the camera did not answer within 50ms".to_string())
        );
        assert!(
            retired.load(Ordering::SeqCst),
            "the session was not retired — a camera answering after the timeout would publish \
             with no owner"
        );
        drop(hold_tx);
        assert_eq!(w.join_within(Duration::from_secs(5)), Joined::Clean);
    }

    /// A worker that dies before it writes the channel is a different failure from a slow camera,
    /// and the words must say so; and a dead worker cannot publish, so nothing is retired.
    #[test]
    fn a_worker_that_dies_before_answering_is_reported_as_dead_not_slow() {
        let _quiet = quiet_panics(); // keep the test log clean, and put the hook back
        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        let w = CaptureWorker::spawn(move || {
            let _keep_until_unwind = tx;
            panic!("Camera::new blew up");
        });
        let retired = AtomicBool::new(false);
        let out = settle_open(
            rx.recv_timeout(Duration::from_secs(5)),
            Duration::from_secs(5),
            || retired.store(true, Ordering::SeqCst),
        );
        let why = out.expect_err("a dead worker is an error");
        assert!(
            why.contains("ended without answering"),
            "a dead worker was reported as something else: {why}"
        );
        assert!(
            !why.contains("did not answer within"),
            "a dead worker was reported as a slow camera: {why}"
        );
        assert!(
            !retired.load(Ordering::SeqCst),
            "a dead worker has nothing to retire"
        );
        assert_eq!(w.join_within(Duration::from_secs(5)), Joined::Clean);
    }
}
