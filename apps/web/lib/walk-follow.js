// Following a smart cube along the walk on the cube screen: one model of where the cube in your
// hand is, matched against the walk by state; the four live hooks the connection calls with every
// turn, snapshot, lost turn and lapse of trust; the drawing that mirrors those turns; and the
// button that lets the cube lead.
//
// Its own unit because it owns its own state — the model, the position on the walk, whether the
// model is ahead of the last snapshot, the end of the renderer's queue — and the session reaches it
// only through the operations it returns. It reads the walk through `walkNow()`, when it acts.
// Lifted out of lib/walk-session.js on 2026-09-13; the orderings it keeps are pinned through the
// session, in test/walk-session.test.mjs.

import { showMove } from './solving-hold.js';

/**
 * The follow tracker of one mounted cube screen, its buttons wired.
 *
 * @param {object} deps `root`; the renderer `cube`; shared `state`; `cubejs()`; the speed menu's
 *   `applyTempo()`; the transport's `setPlaying(on)`; `holdAt(k)`, how move `k` is held;
 *   `markStale`; `adoptCube`; `go`; `scrambling`; the live distance's `refreshLiveDistance` and
 *   `dropLiveDistance`; and `walkNow()`, the walk on screen as `{ moves, steps }`.
 */
export function createFollowTracker({
  root, cube, state, cubejs, applyTempo, setPlaying, holdAt, markStale, adoptCube, go, scrambling,
  refreshLiveDistance, dropLiveDistance, walkNow,
}) {
  const $ = (sel, from) => from.querySelector(sel);

  // Who drives the guide: 'slow' = the transport buttons, 'cube' = the physical cube.
  // Read by the screen's speed menu through `following()`, because tempo DEPENDS on the driver:
  // the walk speeds are for the app demonstrating a move, but while following, the drawing is a
  // mirror of moves the user already made — a mirror slower than the hand must fall behind, so
  // follow runs at the renderer's 190ms base whatever speed is chosen for demonstrations.
  let mode = 'slow';

  // Where the PHYSICAL cube is, in solution indices. The model beneath it tracks in EVERY
  // mode — only drawing and notes are gated on `mode` — so resuming follow needs no special
  // case: the position is simply already right.
  let cubePos = 0;
  let liveModel = null; // cubejs cube in truth frame; seeded below, resynced by every snapshot
  /**
   * Has `liveModel` advanced past the snapshot it was seeded from?
   *
   * TWO DEFECTS TURN ON THIS, and neither is visible without it. Adopting whenever the model
   * merely DIFFERS from the subject overwrote a reconnect answer with the previous screen's
   * model — the answer had just established the truth, and the model belonged to the cube
   * before it. And the walk reset reseeds from `state.live`, so turns arriving DURING a search
   * were discarded, which then defeated the adoption on the next load. Both reproduced by an
   * audit. "Advanced by moves we tracked" is the fact both of them actually need; "differs" is
   * not it.
   */
  let liveMoved = false;
  let drawn = 0;        // index the renderer's QUEUE will end at; meaningful only while following
  let lastSerial = null;
  // For each half-turn step i, the two states one quarter turn in: the cube passes through
  // one of them mid-R2 in either direction (undoing is steps[i]·R2·R = steps[i]·R'). Owner-
  // indexed, because a midpoint only counts BESIDE its own half turn — landing on a distant
  // one is a wrong move, not silent progress.
  const midpoints = new Map();

  // ---- Follow cube -----------------------------------------------------------------------
  //
  // The physical cube drives the guide through ONE local model matched by STATE, never by
  // move token: the driver emits quarter turns only, while the plan is full of half turns —
  // tokens can never pair those up, states always can. Position, drawing and the note are
  // three views of that model. Full design, and the adversarial review that shaped it, in
  // dev-docs/follow-mode-redesign.md.
  //
  // One pacing control, and only when there is a cube to pace against: with nothing connected,
  // walking by hand is the only behaviour there is, so a button naming it would be a switch
  // with one position. Connected, following is what you want by default — a single toggle
  // that starts on, provided the preconditions hold.
  const followBtn = root.querySelector('[data-mode="cube"]');
  const note = $('#followNote', root), noteMsg = $('#followMsg', root);
  const showNote = (msg) => {
    if (note) { note.hidden = false; note.classList.remove('info'); noteMsg.textContent = msg; }
  };
  // Neutral, not a warning, and without the rescue buttons: pausing is a choice, not a fault.
  const pauseNote = () => {
    if (note) { note.hidden = false; note.classList.add('info'); noteMsg.textContent = 'Paused — you are driving. Switch Cube leads back on and your cube sets the pace.'; }
  };
  const clearNote = () => {
    if (note) { note.hidden = true; note.classList.remove('info'); }
  };

  // Touching the transport hands control back to you. Following and the buttons were two
  // drivers for one guide, and while both were live the step counter tracked the ANIMATION
  // rather than the cube. One rule removes the ambiguity — the toggle is right there to
  // resume. The screen's transport buttons and its move list call it.
  function takeOver() {
    if (mode !== 'cube') return;
    setFollow(false);
    pauseNote();
  }

  const locate = (f) => {
    const { steps } = walkNow();
    for (let d = 0; d <= 2; d++) {
      for (const idx of d === 0 ? [cubePos] : [cubePos - d, cubePos + d]) {
        if (idx >= 0 && idx < steps.length && steps[idx] === f) return { kind: 'step', idx };
      }
    }
    if (midpoints.get(f)?.some((i) => i === cubePos || i === cubePos - 1)) return { kind: 'mid' };
    const idx = steps.indexOf(f);
    return idx >= 0 ? { kind: 'step', idx } : { kind: 'off' };
  };

  /** Move the drawing toward where the cube is. Deltas are against `drawn` — the end of the
   *  renderer's QUEUE — never against the animation's progress: reading the completion index
   *  dropped any turn made inside the 0.19–3.8s animation window, permanently.
   *
   *  The renderer guard is not belt-and-braces: if the vendored bundle failed to upgrade the
   *  element — which this repo has shipped more than once — the guide still tracks turns
   *  rather than throwing on every one. */
  const drawTo = (idx) => {
    if (typeof cube.step !== 'function' || typeof cube.seek !== 'function') return;
    if (idx === drawn) return;
    if (idx > drawn && idx - drawn <= 2) { for (let i = drawn; i < idx; i++) cube.step(); }
    else if (idx === drawn - 1) cube.stepBack(); // an undo is a turn worth watching too
    else cube.seek(idx); // a jump: animating a dozen moves to catch up helps nobody
    drawn = idx;
  };

  /** ONE reaction to every accepted reading, move or snapshot. */
  const act = (loc, offMsg) => {
    if (loc.kind === 'step') {
      cubePos = loc.idx;
      if (mode === 'cube') { clearNote(); drawTo(cubePos); }
    } else if (loc.kind === 'mid') {
      if (mode === 'cube') clearNote(); // half a half-turn: legal, silent, position held
    } else if (mode === 'cube') {
      showNote(offMsg);
    }
  };

  /** The FIFO tripwire. Moves and snapshots ride one ordered channel and share one counter;
   *  a regression means that assumption broke, which deserves a loud word — placed AFTER
   *  act() by every caller, so the warning is not painted over by the event it arrived on. */
  const tripwire = (serial) => {
    if (!Number.isInteger(serial)) return;
    // Repeats are normal — a resting cube re-sends snapshots under one counter, and a
    // FACELETS packet shares its move's serial. Only a REGRESSION is a breach, and a breach
    // is a trust matter, not just a note: the stream this model is built on is unreliable,
    // so trust lapses (which stands follow down through the hook) and the screen says why.
    if (lastSerial !== null && (serial - lastSerial + 256) % 256 > 127) {
      console.warn('cube events arrived out of order', { lastSerial, serial });
      showNote('The cube’s reports arrived out of order — read it again before following.');
      markStale('its reports arrived out of order');
    }
    lastSerial = serial;
  };

  /** ONE owner for the driver switch: tempo, button paint and the atomic hand-over all live
   *  here, so no exit path can leak follow's tempo into a demonstration or leave the queue
   *  running under the wrong driver. BOTH directions seek: taking over collapses follow's
   *  queue debt and its in-flight animation; resuming re-bases `drawn` on wherever the cube
   *  is now — which is what makes `drawn` trustworthy within a follow session. */
  function setFollow(on) {
    const want = on ? 'cube' : 'slow';
    if (mode === want) return;
    mode = want;
    if (typeof cube.seek === 'function') cube.seek(cubePos);
    drawn = cubePos;
    applyTempo();
    followBtn?.classList.toggle('on', on);
    followBtn?.setAttribute('aria-pressed', String(on));
    if (followBtn) {
      followBtn.title = on
        ? 'Turn your smart cube and the guide keeps up'
        : 'You took over — click to let the cube drive again';
    }
    if (on) {
      setPlaying(false);
      // Say at once whether the cube is still on the plan, rather than waiting up to a
      // second for its next report to say it.
      if (liveModel) act(locate(liveModel.asString()), 'This cube is not on the plan any more.');
      else clearNote();
    }
  }

  const refuseFollow = (why) => {
    if (!followBtn) return;
    followBtn.disabled = true;
    followBtn.classList.remove('on');
    followBtn.title = why;
  };
  if (followBtn) {
    followBtn.onclick = () => {
      if (followBtn.disabled) return;
      setFollow(mode !== 'cube');
    };
  }

  const liveMove = (m) => {
    if (!liveModel) return; // nothing to track against until a first reading seeds the model
    liveModel.move(m.notation);
    liveMoved = true;
    // Both moves named for the hold the walk is in: the cube reports in its own colour frame,
    // which is the scan frame, and the child is holding it the way the chips say.
    const heldNow = holdAt(cubePos);
    const { moves } = walkNow();
    act(locate(liveModel.asString()),
      `That was ${showMove(m.notation, heldNow)} — the next move is ${cubePos < moves.length ? showMove(moves[cubePos], heldNow) : '—'}.`);
    tripwire(m.serial);
    void refreshLiveDistance();
  };

  // Snapshots are authoritative: they share the moves' FIFO channel, so every one delivered
  // is current, and the model resyncs from it unconditionally — that IS the drift correction,
  // including after a lost move packet. The 2D net is never repainted here: its card says
  // INITIAL STATE (or TARGET STATE), and a label naming a fixed reference must not sit over a
  // moving picture — what the cube does live is the 3D cube's and the transport's story.
  const liveUpdate = (f, serial) => {
    liveModel = cubejs().fromString(f);
    liveMoved = false; // a snapshot IS the truth, so the model is no longer ahead of anything
    act(locate(f), 'This cube is not on the plan any more.');
    tripwire(serial);
    void refreshLiveDistance();
  };

  // Trust has already lapsed by the time this runs — onGap() owns that, with or without a
  // screen mounted to hear it — and the trust hook below has stood follow down. What is left
  // is this screen's own account of what happened.
  const liveGap = () => {
    // The shutdown itself is NOT repeated here: onMovesLost marks trust stale first, and the
    // trust hook below owns standing follow down. What this adds is the account of what
    // happened. Disabled, not merely un-highlighted: following matches your turns against an
    // arrangement we have just said we cannot vouch for.
    refuseFollow('Your cube missed a turn — read it again before following');
    // AND THE LIVE DISTANCE GOES WITH IT (§5.4). A lost packet means the local model and the
    // cube have stopped agreeing, so every number derived from the model is about a cube that
    // is not in anyone's hand. Bumping the generation is what stops an answer already in
    // flight arriving to contradict this; clearing the line is what stops the last one
    // standing. A lost move is reported, never absorbed.
    dropLiveDistance();
    // AND THE MODEL IS NO LONGER AHEAD OF ANYTHING KNOWN. A lost packet means the model and the
    // cube have stopped agreeing, so the turns it holds are not turns anybody can vouch for —
    // carrying them across a walk reset, or adopting them as the subject, would be adopting a
    // guess. `onTrustLost` clears this too; both are here because a lost move is the case where
    // the screen has something of its own to say.
    liveMoved = false;
    // No count. Reconciliation proves a turn was lost; it cannot say how many, and the old
    // "Missed 2 turns" came from a serial the app no longer has. Silence here would look
    // exactly like a wrong turn; it is neither, and the next snapshot will resync.
    showNote('A turn went unrecorded — checking the cube…');
  };

  // Any loss of trust while walking — a gap, a disconnect, a report that failed validation —
  // stands follow down the moment it happens, not at the next mount.
  const onTrustLost = () => {
    setFollow(false);
    refuseFollow(`Read the cube first — ${state.cube.staleWhy || 'its position is unverified'}`);
    // AND THE MODEL STOPS BEING AHEAD OF ANYTHING. `liveMoved` says "this model has turns in it
    // that no snapshot has confirmed", which is a claim about the CURRENT connection — and it
    // survived a disconnect. Reproduced: scan `R`, report `U`, disconnect, reconnect, confirm
    // `R`, and the adoption overwrote the confirmed truth with `R U` AND marked it trusted.
    // That is §9a's severe failure — a route for a cube other than the one in their hands,
    // passing every internal check. Trust lapsing is the one event that covers all of them:
    // a disconnect, a refused report and a lost move all go through `markStale` to get here.
    liveMoved = false;
    // AND THE LIVE NUMBER. Trust is the gate `refreshLiveDistance` reads, so a number computed
    // while it held is about a cube nobody can vouch for the moment it lapses — and an answer
    // already in flight would repaint over the clearing without this. `onTrustLost` did neither
    // until an audit reproduced both.
    dropLiveDistance();
  };

  $('#resolveBtn', root).onclick = () => {
    // Re-solve starts from the cube as it IS. The model can be ahead of the last adopted
    // snapshot by whatever was turned in the past second — remounting from the stale global
    // would build a walk for a cube that no longer exists.
    if (liveModel && state.cube.trusted) {
      const f = liveModel.asString();
      if (f !== state.cube.facelets) adoptCube(f, { physical: true, source: 'cube' });
      // `live` too, or the next mount's "starts where the cube is" precondition compares the
      // fresh walk against a snapshot from before those turns and refuses to follow — for
      // the whole visit, since the precondition runs once. The model IS the corrected
      // report stream carried forward, so this stays true to what `live` means; `reported`
      // (the raw stream) is deliberately untouched.
      state.live = f;
    }
    // Scramble ignores the subject — it always walks from solved — so "Re-solve this cube"
    // must go where the cube in hand is actually solved from: the solve walk on Home.
    go(scrambling ? 'home' : state.screen);
  };
  $('#turnBackBtn', root).onclick = () => {
    // Acknowledging is not the same as the cube being back: hiding the warning here would
    // silently accept an off-plan cube if no further report arrived. The note stays, saying
    // what is being waited for — only act() clears it, on an actually on-plan reading.
    if (note && !note.hidden) noteMsg.textContent = 'Watching for it — turn it back and the guide picks up.';
  };

  /**
   * Put following back at the start of a walk the session has just committed: its positions reset,
   * the midpoints of its half turns built, and whether the cube may lead judged for THIS walk.
   */
  function rebase({ moves, steps, total }) {
    cubePos = 0;
    // THE MODEL SURVIVES IF IT IS AHEAD OF THE SNAPSHOT. Clearing it unconditionally and
    // reseeding from `state.live` below discarded every turn reported DURING the search — and
    // since the adoption at the top of the next load reads this model, the rewind then defeated
    // that too. Reproduced by an audit: start at `R`, turn `U` while the reply is in flight,
    // and the model comes back as `R`. `liveMoved` is the precise condition, and it is why that
    // flag exists rather than a comparison against the subject.
    if (!liveMoved) liveModel = null;
    drawn = 0;
    lastSerial = null;
    clearNote();
    // Following is judged per walk, so a session that was following must be stood down before
    // the new walk is judged — otherwise setFollow(true) below sees `mode` already 'cube',
    // returns early, and never re-bases the drawing on the new plan.
    setFollow(false);
    midpoints.clear();
    // Built only from a COMPLETE step array: with steps short (the case refuseFollow answers
    // below), steps[i] is undefined for the tail and fromString(undefined) throws — which
    // turned "follow is refused" into "the whole screen fails to mount".
    if (steps.length === total + 1) {
      for (let i = 0; i < moves.length; i++) {
        if (!moves[i].endsWith('2')) continue;
        for (const q of [moves[i][0], `${moves[i][0]}'`]) {
          const c = cubejs().fromString(steps[i]); c.move(q);
          const s = c.asString();
          if (!midpoints.has(s)) midpoints.set(s, []);
          midpoints.get(s).push(i);
        }
      }
    }

    /** Where is this state on the plan? Locality first: the near window resolves a repeated
     *  state toward where the cube actually is, and is also the cheap path. */
    if (followBtn) {
      followBtn.disabled = false; // a previous walk may have refused it; this one is re-judged
      // Following compares the real cube against the state each move produces, so it needs one
      // state per step, a TRUSTED cube (the move stream is in the CUBE's frame — following an
      // unverified one advances the guide on turns that may not be the ones being made), and a
      // walk that STARTS from where the cube in your hand actually is. The last rule is what
      // makes a random cube unfollowable while a scramble from a solved cube is perfectly
      // followable — and why a solved cube used to complete a random solve instantly.
      if (steps.length !== total + 1) {
        refuseFollow('Needs a solve worked out on this screen');
      } else if (!state.cube.trusted) {
        refuseFollow(`Read the cube first — ${state.cube.staleWhy || 'its position is unverified'}`);
      } else if (steps[0] !== state.live) {
        refuseFollow(state.live
          ? 'This is not the cube in your hand — read your cube to follow along'
          : 'Waiting to hear from your cube…');
      } else {
        // …and only seed a NEW model where the carried one is not already ahead. Reseeding over
        // a model with untracked turns in it is the rewind this walk just avoided.
        if (!liveMoved) liveModel = cubejs().fromString(state.live);
        setFollow(true);
      }
    }
  }

  return Object.freeze({
    takeOver,
    /** The walk it was following is being replaced: stand down, and forget its plan. */
    standDown() { midpoints.clear(); setFollow(false); clearNote(); },
    refuse: refuseFollow,
    rebase,
    /** The model's arrangement when it holds turns no snapshot has confirmed, or null. */
    aheadOfSnapshot: () => (liveMoved && liveModel ? liveModel.asString() : null),
    following: () => mode === 'cube',
    model: () => liveModel,
    liveMove, liveUpdate, liveGap, onTrustLost,
  });
}
