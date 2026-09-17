// The clock a walk plays on: the next stop is asked for when the element finishes the last one.
//
// Plan item 6.5. The stop driver's `play({ every })` takes a gap in MILLISECONDS, which is right for a
// drill and wrong for this screen: the cube screen already has a speed control, and it works by setting
// the renderer's `tempo-scale` — 3.8s, 1.9s or 0.95s per quarter turn (`lib/screens/cube/speed-menu.js`).
// A walk played on a metronome would keep its own pace beside that one, so choosing Slow would make each
// turn slower AND make the next stop arrive over the top of it.
//
// So the gap is not a number here. The driver's `schedule` seam is handed a clock that fires when the
// element says a turn has landed, which is what the renderer's own `play()` does internally — the pacing
// the speed menu was built to control, kept, with the driver still owning the position.
//
// The first stop is the exception, and it is the same rule read honestly rather than a special case: the
// clock fires when nothing is in flight, and at the moment Play is pressed nothing is. Waiting for a
// completion there would wait for a turn that is never going to start.

/**
 * The walk clock of one mounted cube screen: a `schedule` for the driver, `afterTurn` for a press that
 * is two stops, and `landed()`, which the screen calls when a turn has.
 *
 * IT LISTENS TO NOTHING. The obvious build has this subscribe to `cubus-step` itself, and it is wrong
 * for a reason the browser suite states as an invariant: one step event must reach EXACTLY ONE handler
 * (`screen-swap.test.mjs`, "a re-used renderer arrives clean, and drives its new screen exactly once").
 * `<cubus-cube>` is parked and re-used between screens, so every listener on it is a teardown to get
 * right, and counting them is how a leak from an earlier visit is caught at all — a second legitimate
 * one hides the next leak inside a number that is already 2. The presenter has the screen's one step
 * listener; it tells this.
 *
 * @param {object} cube the renderer; read for `animating`.
 * @param {object} o `setTimer`/`clearTimer` for a test to drive.
 */
export function createWalkClock(cube, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  /** One-shot callbacks due when the turn in flight lands. */
  const waiting = new Set();
  /** A turn has landed: whatever was waiting on it runs. Called by the screen's step listener. */
  const landed = () => {
    // Copied and cleared BEFORE any of them runs: a callback here asks for the next stop, which starts
    // another turn, and one that re-registered into the set being iterated would run inside its own
    // completion — the walk would finish in a single synchronous burst instead of playing.
    const due = [...waiting];
    waiting.clear();
    for (const fn of due) fn();
  };
  /**
   * Run `fn` once the turn in flight has landed — at once when nothing is turning.
   *
   * For a press that is TWO stops. Every stop command settles whatever group is in flight, so asking
   * for both halves of Repeat in one breath snaps the undo and animates only the redo — which is the
   * one thing that button exists not to do ("show me that again" is watching it twice). With no
   * renderer nothing ever turns, so `fn` runs straight away and the press is bookkeeping, as it was.
   */
  const afterTurn = (fn) => {
    if (!cube?.animating) fn();
    else waiting.add(fn);
  };

  const schedule = (fn, ms) => {
    // NOTHING IN FLIGHT — the first stop of a play, or an element that is not a renderer and will never
    // report one — so the stop is due now. `ms` is still honoured for that first tick: a caller that
    // asked for a gap before anything is happening is entitled to it. What this refuses to do is impose
    // a gap BETWEEN turns that the renderer is already timing.
    if (!cube?.animating) return { timer: setTimer(fn, ms) };
    waiting.add(fn);
    return { fn };
  };
  schedule.cancel = (handle) => {
    if (handle?.timer !== undefined) clearTimer(handle.timer);
    if (handle?.fn) waiting.delete(handle.fn);
  };

  return { schedule, afterTurn, landed };
}
