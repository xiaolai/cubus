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

use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

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
    use std::sync::Arc;

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
        let w = CaptureWorker::spawn(|| {
            std::panic::set_hook(Box::new(|_| {})); // keep the test log clean
            panic!("capture blew up");
        });
        assert_eq!(w.join_within(Duration::from_secs(5)), Joined::Clean);
        let _ = std::panic::take_hook();
    }
}
