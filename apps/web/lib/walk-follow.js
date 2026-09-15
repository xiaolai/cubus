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

import { t } from './i18n.js';
import { parse } from './cube-notation.js';
import { locate as locateOnTrack, trackOf } from './script-track.js';
import { showMove } from './solving-hold.js';

/**
 * The follow tracker of one mounted cube screen, its buttons wired.
 *
 * @param {object} deps `root`; the renderer `cube`; shared `state`; `cubejs()`; the speed menu's
 *   `applyTempo()`; the transport's `setPlaying(on)`; `holdAt(k)`, how move `k` is held;
 *   `markStale`; `adoptCube`; `go`; `scrambling`; the live distance's `refreshLiveDistance` and
 *   `dropLiveDistance`; `chainTrusted()`, the one predicate for trust in the live chain; and
 *   `walkNow()`, the walk on screen as `{ moves, steps }`.
 */
export function createFollowTracker({
  root, cube, state, cubejs, applyTempo, setPlaying, holdAt, markStale, adoptCube, go, scrambling,
  refreshLiveDistance, dropLiveDistance, chainTrusted, walkNow,
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
  let liveModel = null; // cubejs cube in truth frame; made by seed() or a snapshot, on a trusted chain
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
  // The walk as a TRACK: every step's arrangement and the midpoints between them — the states a
  // cube passes through part way into a half turn (and, for a script, a slice). Matching lives in
  // lib/script-track.js, shared with every stop-driven script (plan item 3.3 of
  // dev-docs/tutorial-capability-plan.md); what stays here is what the cube screen does with a match.
  let track = null;
  /** Why the cube may not lead the walk on screen, or null while it may. */
  let refusal = null;
  /** Where the cube was when the walk being searched for was asked about — see judge(). */
  let startedFrom = null;

  /**
   * The model: kept in step with the last snapshot unless it holds turns no snapshot has confirmed,
   * and seeded from that snapshot where there is none — but only on a TRUSTED chain.
   *
   * A model is knowledge of the cube itself, so one is made only while `chainTrusted()` holds: a
   * rolled scramble is `trusted` too, and a model taken on its word is a guess. Seeded on demand,
   * not only once a walk is committed, or a turn reported during the FIRST search reached no model
   * and was dropped.
   */
  const seed = () => {
    if (chainTrusted() && state.live && !liveMoved && liveModel?.asString() !== state.live && cubejs()) {
      liveModel = cubejs().fromString(state.live);
    }
    return liveModel;
  };
  /**
   * The model stops being knowledge of anything: a turn was lost, or trust lapsed. ONE owner for
   * both, and the live number goes with the model it was computed from.
   *
   * ONCE PER LOSS. One lost turn can reach both hooks below, in either order, and each must also
   * be whole alone — so whichever hears of it second finds nothing left to forget, and forgets
   * nothing. No model means no number to drop: the live distance asks only about a model, and
   * clears its line when there is none.
   */
  const forget = () => {
    if (liveModel === null) return;
    liveModel = null;
    liveMoved = false;
    dropLiveDistance();
  };

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
    if (note) { note.hidden = false; note.classList.add('info'); noteMsg.textContent = t('Paused — you are driving. Switch Cube leads back on and your cube sets the pace.'); }
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

  // Near first, ahead before behind (R6), then a midpoint beside the cube, then anywhere on the walk.
  // A walk with no track — none committed yet — is matched by its steps alone, as it always was.
  const locate = (f) => {
    const { steps } = walkNow();
    const on = track ?? trackOf(steps, steps.slice(1).map(() => []));
    return locateOnTrack(on, f, cubePos);
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
      showNote(t('The cube’s reports arrived out of order — read it again before following.'));
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
    // A refused walk is never followed, whoever asks. Checked HERE and not only through the
    // toggle's `disabled`, which is DOM state any later paint could get wrong.
    const want = on && refusal === null ? 'cube' : 'slow';
    if (mode !== want) {
      mode = want;
      if (typeof cube.seek === 'function') cube.seek(cubePos);
      drawn = cubePos;
      applyTempo();
      if (mode === 'cube') {
        setPlaying(false);
        // Say at once whether the cube is still on the plan, rather than waiting up to a
        // second for its next report to say it.
        if (liveModel) act(locate(liveModel.asString()), t('This cube is not on the plan any more.'));
        else clearNote();
      }
    }
    paintFollow();
  }

  /** The toggle as things stand, in every channel: pressed only while the cube leads, disabled and
   *  saying why while it may not. Painted on every call, a call that changes nothing included — a
   *  refusal before the first walk left the markup's `aria-pressed="true"` standing. */
  const paintFollow = () => {
    if (!followBtn) return;
    const on = mode === 'cube';
    followBtn.disabled = refusal !== null;
    followBtn.classList.toggle('on', on);
    followBtn.setAttribute('aria-pressed', String(on));
    followBtn.title = refusal ?? (on
      ? t('Turn your smart cube and the guide keeps up')
      : t('You took over — click to let the cube drive again'));
  };

  /** The cube may not lead this walk, and why. Atomic: following stops — tempo, drawing, toggle —
   *  through the one switch that owns them, and stays stopped until judge() finds a walk
   *  followable. */
  const refuseFollow = (why) => {
    refusal = why;
    setFollow(false);
  };
  if (followBtn) {
    followBtn.onclick = () => {
      if (followBtn.disabled) return;
      setFollow(mode !== 'cube');
    };
  }

  const liveMove = (m) => {
    if (!seed()) return; // nothing to track against: no trusted reading to seed a model from
    liveModel.move(m.notation);
    liveMoved = true;
    // Both moves named for the hold the walk is in: the cube reports in its own colour frame,
    // which is the scan frame, and the child is holding it the way the chips say.
    const heldNow = holdAt(cubePos);
    const { moves } = walkNow();
    act(locate(liveModel.asString()), t('That was %1 — the next move is %2.',
      showMove(m.notation, heldNow), cubePos < moves.length ? showMove(moves[cubePos], heldNow) : '—'));
    tripwire(m.serial);
    rejudge();
    void refreshLiveDistance();
  };

  // Snapshots are authoritative: they share the moves' FIFO channel, so every one delivered
  // is current, and the model resyncs from it unconditionally — that IS the drift correction,
  // including after a lost move packet. The 2D net is never repainted here: its card says
  // INITIAL STATE (or TARGET STATE), and a label naming a fixed reference must not sit over a
  // moving picture — what the cube does live is the 3D cube's and the transport's story.
  const liveUpdate = (f, serial) => {
    // On a trusted chain only, like every model (seed): a report nobody can vouch for is not
    // knowledge of the cube, and a model made of one was carried into the next connection.
    liveModel = chainTrusted() ? cubejs().fromString(f) : null;
    liveMoved = false; // a snapshot IS the truth, so the model is no longer ahead of anything
    act(locate(f), t('This cube is not on the plan any more.'));
    tripwire(serial);
    rejudge();
    void refreshLiveDistance();
  };

  // Trust has already been marked stale by the time this runs — onMovesLost owns that, with or
  // without a screen mounted to hear it. What is left is this screen's own account of it.
  const liveGap = () => {
    // THE MODEL, AND THE LIVE NUMBER MADE FROM IT (§5.4), before anything else. The model and the
    // cube have stopped agreeing, so its turns are not turns anybody can vouch for — adopting them
    // would adopt a guess — and an answer in flight about it must not land. A lost move is
    // reported, never absorbed. Not left to onTrustLost: markStale notifies only a LAPSE, so a
    // turn lost on a chain already stale for another reason reaches this hook and no other.
    // Before anything else, because standing follow down turns the renderer, which can throw, and
    // a throw ahead of this left the model and its number standing (found by audit, 2026-09-13).
    forget();
    // Disabled, not merely un-highlighted: following matches your turns against an arrangement
    // we have just said we cannot vouch for.
    refuseFollow(t('Your cube missed a turn — read it again before following'));
    // No count. Reconciliation proves a turn was lost; it cannot say how many, and the old
    // "Missed 2 turns" came from a serial the app no longer has. Silence here would look
    // exactly like a wrong turn, and it is neither.
    showNote(t('A turn went unrecorded — checking the cube…'));
  };

  /** Why the cube's position cannot be vouched for, in the catalog's words: the reason trust
   *  lapsed for — markStale's own sentence, and so a key like any other — or the general one. */
  const unverifiedWhy = () => t(state.cube.staleWhy || 'its position is unverified');

  // Any loss of trust while walking — a gap, a disconnect, a report that failed validation —
  // stands follow down the moment it happens, not at the next mount.
  const onTrustLost = () => {
    // THE MODEL GOES, before anything else — not merely its claim to be ahead. It is knowledge of
    // the CURRENT chain: clearing only "ahead" let the next connection's turns move it on and make
    // it ahead again, and a load then adopted it over the cube the user had just confirmed,
    // trusted — §9a's severe failure. Trust lapsing covers a disconnect, a refused report and a
    // lost move alike. Before anything else, because standing follow down turns the renderer,
    // which can throw: markStale says so and carries on, and a throw ahead of this left the model
    // and its number standing (found by audit, 2026-09-13).
    forget();
    refuseFollow(t('Read the cube first — %1', unverifiedWhy()));
  };

  $('#resolveBtn', root).onclick = () => {
    // Re-solve starts from the cube as it IS. The model can be ahead of the last adopted
    // snapshot by whatever was turned in the past second — remounting from the stale global
    // would build a walk for a cube that no longer exists.
    // On the CHAIN's trust: a rolled scramble is `trusted` as well, and a model adopted on its word
    // was a guess filed as the cube in hand. Unlike a load's adoption, a press takes the model
    // whether or not it is ahead: this is someone asking for the cube as it is.
    const model = seed();
    if (model && chainTrusted()) {
      const f = model.asString();
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
    if (note && !note.hidden) noteMsg.textContent = t('Watching for it — turn it back and the guide picks up.');
  };

  /**
   * Whether the cube may lead a walk: null when it may, or the sentence saying why not.
   *
   * Following compares the real cube against the state each move produces, so it needs one state
   * per step; a TRUSTED chain (the move stream is in the CUBE's frame — following an unverified one
   * advances the guide on turns that may not be the ones being made); and a walk about the cube in
   * your hand — one that starts where the model is, or one worked out from where the model was when
   * it was asked for (`startedFrom`), whose turns since are then progress along it. That last rule
   * is what makes a random cube unfollowable while a scramble from a solved cube is perfectly
   * followable — and why a solved cube used to complete a random solve instantly.
   */
  const judge = ({ moves, steps }) => {
    if (steps.length !== moves.length + 1) return t('Needs a solve worked out on this screen');
    if (!chainTrusted()) {
      return t('Read the cube first — %1', unverifiedWhy());
    }
    const at = seed()?.asString();
    if (!at) return t('Waiting to hear from your cube…');
    if (at === steps[0] || startedFrom === steps[0]) return null;
    return t('This is not the cube in your hand — read your cube to follow along');
  };

  /** Let the cube lead, from wherever it has got to on the walk. Locality first: the near window
   *  resolves a repeated state toward where the cube actually is. */
  const lead = () => {
    refusal = null;
    const loc = locate(liveModel.asString());
    if (loc.kind === 'step') cubePos = loc.idx;
    setFollow(true);
  };

  /** A walk refused on a trusted chain is judged again with every reading, so a cube turned back to
   *  where the walk starts may lead it. Only ever lifted here: a refusal for a lapse of trust keeps
   *  its own sentence until the load that follows the trust being given back. */
  const rejudge = () => {
    if (!followBtn || refusal === null || !chainTrusted()) return;
    if (judge(walkNow()) === null) lead();
  };

  /** The track of a walk. Built only from a COMPLETE step array: with steps short (a walk judge()
   *  refuses), steps[i] is undefined for the tail — which once turned "follow is refused" into "the
   *  whole screen fails to mount". */
  const buildMidpoints = ({ moves, steps }) => {
    track = steps.length === moves.length + 1 ? trackOf(steps, moves.map((m) => parse(m))) : null;
  };

  /**
   * Put following back at the start of a walk the session has just committed: its positions reset,
   * the midpoints of its half turns built, and whether the cube may lead judged for THIS walk. The
   * model is not touched — it is where the cube in your hand is, and a new walk does not move it.
   */
  function rebase(walk) {
    cubePos = 0;
    drawn = 0;
    lastSerial = null;
    clearNote();
    // Following is judged per walk, so a session that was following must be stood down before
    // the new walk is judged — otherwise setFollow(true) below sees `mode` already 'cube',
    // returns early, and never re-bases the drawing on the new plan.
    setFollow(false);
    buildMidpoints(walk);
    if (!followBtn) return;
    refusal = judge(walk);
    if (refusal === null) lead(); else paintFollow();
  }

  return Object.freeze({
    takeOver,
    /** The walk it was following is being replaced: stand down, forget its plan, and refuse the
     *  toggle — there is nothing to follow while the next walk is searched for. Where the cube is
     *  NOW is kept (`startedFrom`), because the walk being searched for is about that cube. */
    standDown() {
      track = null;
      startedFrom = seed()?.asString() ?? null;
      refuseFollow(t('Needs a solve worked out on this screen'));
      clearNote();
    },
    refuse: refuseFollow,
    rebase,
    /** The model's arrangement when it holds turns no snapshot has confirmed, or null. */
    aheadOfSnapshot: () => (liveMoved && liveModel ? liveModel.asString() : null),
    following: () => mode === 'cube',
    model: () => liveModel,
    liveMove, liveUpdate, liveGap, onTrustLost,
  });
}
