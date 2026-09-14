// The native minimality proof on the cube screen: its wording (a sanctioned source — optimal.test.mjs
// finds it by name), the prove button's controller, and the count a walk says beside its heading.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import {
  cancel as optimalCancel, capability as optimalCapability, prepare as optimalPrepare,
  prove as optimalProve, status as optimalStatus,
} from './optimal.js';
import { plural, t } from './i18n.js';
import { routeSentence } from './stage-report.js';

import { $, state } from './app-state.js';
import { settings } from './app-settings.js';
import { Cube } from './solver-service.js';

/** How long a proof may run before it has to account for itself.
 *
 *  Proof cost tracks DEPTH, not the incumbent: a cube a few turns from solved proves in
 *  milliseconds, a random one at depth 17 takes about a minute, and depth 18 — which is 67% of
 *  random states — has been measured at over an hour (optimal-solver-plan.md). So there is no
 *  threshold worth guessing in advance, and no percentage worth inventing: the proof simply
 *  earns its waiting state by taking one. Under this, a press looks instant, which for a
 *  shallow cube it is; over it, the button starts saying what it has ruled out and how long it
 *  has been at it, and a stop appears beside it. */
const PROOF_WAIT_VISIBLE_MS = 250;

/** Every place the app NAMES the prove feature, as opposed to making a claim with it.
 *
 *  The distinction is the whole point, and it is what keeps the wording invariant meaningful as
 *  the feature grows: `provenMinimumLabel` and the native prover's gated block assert something
 *  about a particular cube, and may only ever run after a proof. These strings assert nothing —
 *  they are a button that offers to start one and a toggle that decides whether the button is
 *  drawn. Kept together so there is one region to sanction rather than a new one per string, and
 *  named rather than reworded to slip under the check: a toggle should be named after the button
 *  it turns on, not after what a regex will tolerate.
 *
 *  `button` is also the button's RESTING label in three states — the markup, the per-walk
 *  rewiring, and the return from a stopped proof — which had drifted apart as three literals. */
export const PROVE_COPY = {
  button: 'prove the minimum',
  settingLabel: 'Offer to prove the minimum',
  settingBlurb: 'A button on the solution that proves no shorter solution exists. The first run builds 86 MB of tables, and a proof can take minutes to hours',
};

/** The one sentence the SHIPPED library may put on a screen, and the second of exactly two
 *  places in this file where the word "proved" is allowed to originate (the other is the
 *  native prover's gated block). It is a named function rather than a slice of a ternary so
 *  the wording invariant in optimal.test.mjs can sanction it precisely instead of loosening
 *  to a pattern that would let a third source through unnoticed. Its guard is checked there
 *  too: the only call must sit behind `showingProof` — the cube is proved AND the Solution is
 *  the object on screen. */
const provenMinimumLabel = (moves) => `${moves} — proved the minimum`;

/** Which run of `runProof` owns the shared prove/stop buttons.
 *
 *  A proof's cleanup can land long after a newer proof has taken those controls over: a status
 *  reply that arrives late, a native call that settles after a retarget replaced the walk. The
 *  `finally` runs for the OLD proof either way, and it used to hide the stop button and clear its
 *  handler unconditionally — so the proof actually running could no longer be called off, and
 *  the button that would have done it was gone from the screen (found by audit, 2026-09-05).
 *
 *  A counter rather than a flag, because ownership is "the latest run", and the question is asked
 *  from a cleanup that must still release ITS OWN timers and listeners whatever the answer is. */
let proofRun = 0;

/** Every proof the native prover finished, by the arrangement it is about. A proof is a fact about
 *  the CUBE, so showing any proved cube again must neither drop the sentence nor offer hours of
 *  search for an answer already held. Only the last one was kept, so proving a second cube lost the
 *  first (verification, 2026-09-14). */
const nativeProofs = new Map();

/** Whether the tables a proof needs are ready — building them first when they are not, with the
 *  percentage the build reports on the button. False when the walk went while it waited. */
async function tablesReady({ proveBtn, fresh, signal }) {
  let readiness = await optimalStatus();
  if (!fresh()) return false;
  if (readiness === 'ready') return true;
  proveBtn.textContent = 'preparing…';
  let unlisten = null;
  const letGo = () => { const off = unlisten; unlisten = null; off?.(); };
  // Let go the moment the walk is gone, not when the native side next answers: generation is
  // minutes, and the heartbeat outlived its walk for all of them (verification, 2026-09-14).
  signal?.addEventListener('abort', letGo, { once: true });
  try {
    try {
      unlisten = await window.__TAURI__?.event?.listen?.('optimal-progress', (ev) => {
        const p = ev?.payload;
        if (fresh() && p?.total) proveBtn.textContent = `${p.stage} ${Math.round((p.done / p.total) * 100)}%`;
      });
    } catch (err) {
      console.warn('optimal: no progress events; preparation will look quiet', err);
    }
    if (!fresh()) return false;
    await optimalPrepare();
    for (;;) {
      if (!fresh()) return false;
      readiness = await optimalStatus();
      if (!fresh()) return false;
      if (readiness === 'ready') return true;
      if (readiness !== 'preparing') throw new Error(`optimal: preparation ended ${readiness}, not ready`);
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    signal?.removeEventListener('abort', letGo);
    letGo();
  }
}

/**
 * Run one native minimality proof, from the press to the state it leaves the button in.
 *
 * Lifted out of `loadWalk` (2026-09-05), which had grown to hold a whole second lifecycle inside
 * a walk load: two waits with different shapes, an optional table generation with a percentage, a
 * readiness poll, two event subscriptions, a stop, and exactly one cleanup path. Everything it
 * needs is an argument, and `fresh()` is the one thing that ties it back to the screen — the walk
 * it was wired for must still be the walk on show, or it writes nothing at all. `signal` is that
 * walk's abort, which is when what it listens to is let go.
 *
 * `sayProved` comes IN rather than being written here; the reason is at the line that passes it.
 *
 * @param {{proveBtn: HTMLElement, cancelBtn: HTMLElement|null, startFacelets: string,
 *          shown: number, fresh: () => boolean, signal: AbortSignal|undefined,
 *          sayProved: (proof: object) => void}} o
 */
async function runProof({ proveBtn, cancelBtn, startFacelets, shown, fresh, signal, sayProved }) {
  // Two waits with different shapes, and they must not be dressed the same. Table
  // GENERATION is known-slow and has a denominator, so it announces itself and shows
  // a percentage. The PROOF has neither: it is milliseconds on a shallow cube and
  // hours on a deep one, and no fraction of it is knowable — so it stays silent until
  // it has actually taken time, and then reports the only honest number it has.
  let unlistenProof = null;
  let ticking = null;
  let reveal = null;
  let ruledOut = null;
  const startedAt = Date.now();
  // Taken synchronously with the press: from here on, this run owns the buttons until another
  // press takes them. `fresh()` cannot answer this — it is about the WALK, and two proofs about
  // two different walks are exactly the case where the older one's cleanup arrives last.
  const myRun = ++proofRun;
  const owns = () => myRun === proofRun;

  const clock = () => {
    const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  };
  // "at least N" is a fact, not a spinner: every contour the native side reports has
  // been exhausted, so the answer really is longer than it. Before the first one
  // lands there is nothing true to say beyond the clock.
  const paintWait = () => {
    if (!fresh()) { clearInterval(ticking); ticking = null; return; }
    proveBtn.textContent = ruledOut === null
      ? `proving… ${clock()}`
      : `at least ${ruledOut + 1} · ${clock()}`;
  };
  const showWaiting = () => {
    if (!fresh()) return;
    proveBtn.title = 'A deep cube can take hours to prove. Stop whenever you like — nothing is lost.';
    if (cancelBtn) { cancelBtn.hidden = false; cancelBtn.disabled = false; cancelBtn.textContent = 'stop'; }
    paintWait();
    ticking ??= setInterval(paintWait, 1000);
  };
  const endWaiting = () => {
    // OWNED unconditionally: this run's timer and its reveal stop when this run ends, whoever
    // holds the buttons. Releasing them is never someone else's business, and skipping it would
    // leave a superseded proof repainting a button it no longer writes to.
    clearTimeout(reveal); clearInterval(ticking); ticking = null;
    // SHARED, so only while this run still owns them. A stop hidden by the previous proof's
    // cleanup is a proof that cannot be called off — minutes to hours of native work with
    // nothing on screen to end it.
    if (!owns()) return;
    proveBtn.title = '';
    if (cancelBtn) { cancelBtn.hidden = true; cancelBtn.onclick = null; }
  };

  const letGoContours = () => { const off = unlistenProof; unlistenProof = null; off?.(); };
  proveBtn.disabled = true;
  // Let go of the contours the moment the walk is gone. Leaving calls the proof off, but a stop the
  // native side does not take leaves it running for hours (verification, 2026-09-14).
  signal?.addEventListener('abort', letGoContours, { once: true });
  try {
    // Ask before announcing. Preparation is minutes, so a run that needs it says so at
    // once; a run that does not must never flash the word at a person for whom it is
    // already done.
    if (!(await tablesReady({ proveBtn, fresh, signal }))) return;

    try {
      unlistenProof = await window.__TAURI__?.event?.listen?.('optimal-proof-progress', (ev) => {
        const depth = ev?.payload?.ruled_out;
        if (!fresh() || ev?.payload?.proof !== myRun || !Number.isInteger(depth)) return;
        ruledOut = depth;
        if (ticking) paintWait(); // only once the wait is on screen; before that, nothing to repaint
      });
    } catch (err) {
      console.warn('optimal: no proof progress; a long proof will show only its clock', err);
    }
    if (!fresh()) return;

    // The stop is wired BEFORE the proof starts, so there is no window in which a
    // proof is running and cannot be called off.
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'stopping…';
        void optimalCancel().catch((err) => {
          console.warn('optimal cancel failed', err);
          if (!owns() || !fresh()) return;
          cancelBtn.disabled = false;
          cancelBtn.textContent = 'stop — try again';
        });
      };
    }
    reveal = setTimeout(showWaiting, PROOF_WAIT_VISIBLE_MS);
    const proof = await optimalProve(startFacelets, { Cube, upperBound: shown, proof: myRun });
    if (!fresh()) return; // the finally below is the ONE cleanup path

    // The sentence is the CALLER's to write, and it is written inside the capability-gated
    // block this controller was lifted out of. A minimality claim may originate in exactly two
    // places (AGENTS.md, fourth seam), and optimal.test.mjs sanctions those two BY REGION — so a
    // controller that worded its own result would be a third. This runs the proof; it never says
    // what the proof means.
    sayProved(proof);
    proveBtn.hidden = true;
  } catch (err) {
    if (!fresh()) return;
    // Stopping is a choice, not a failure: the affordance comes back saying what it
    // said before, so a person who changes their mind can simply press it again.
    const stopped = /cancelled/i.test(String(err?.message ?? err));
    proveBtn.textContent = stopped ? PROVE_COPY.button : 'could not prove';
    proveBtn.disabled = false;
    if (stopped) console.info('optimal: the proof was stopped');
    else console.error('optimal proof failed', err);
  } finally {
    endWaiting();
    signal?.removeEventListener('abort', letGoContours);
    letGoContours();
  }
}

/**
 * The count beside a walk's heading, and the offer to prove it minimal.
 *
 * Lifted out of the cube screen's walk load with the rest of the walk session, and deliberately NOT
 * into `lib/walk-session.js`: a minimality claim has exactly three sources (AGENTS.md, fourth seam),
 * and `optimal.test.mjs` finds the app's two BY NAME in this file — the capability-gated prove
 * block below, and `provenMinimumLabel` behind `showingProof` — and refuses a second copy of the
 * prove condition anywhere in the app's source. The session decides what the walk is; this is
 * where the app says what may be claimed about it.
 *
 * `stageTargetNow` is the session's reader, passed rather than its answer, so the route's sentence
 * asks at the moment it always did. `signal` is the walk's abort, handed to a proof pressed for it.
 */
export function sayWalkLength({ root, setStatus, scrambling, route, stageTargetNow, lesson, total, steps, fresh, signal }) {
  // Just the number, unless the search fell short of the tier — and then a sentence about
  // the SEARCH, never about the cube. This used to read "18 was not possible here", which
  // two-phase has no way to know: it cannot prove a minimum, so it cannot prove one absent
  // (solver-move-count.md section 4). Measured on 30 random states, the <= 18 tier fell
  // short 19 times while only ~3.5% of positions are genuinely optimal-19-or-20 — so that
  // sentence was false roughly eighteen times out of nineteen. At <= 20 it was false
  // always, God's number being 20; solve-target now keeps that promise by escalating, so
  // this branch cannot be reached from a promised tier at all.
  // A scramble walk never ran the solver, so any verdict on state.cube is a LEFTOVER
  // from an earlier solve — shown here it would caption a fresh scramble with an old
  // cube's shortfall.
  const verdict = scrambling ? null : state.cube.solveResult;
  // Whether this arrangement has been PROVED minimal is a fact about the cube. Whether the
  // screen is showing that proof is a fact about which object is selected. They were one
  // expression, so an already-proved cube became eligible for the (hours-long) proof button
  // again the moment the learner switched to Lesson — the proof it already had did not stop
  // counting because a different object was on screen.
  const proved = verdict?.key === 'solve.provenMinimum';
  const showingProof = proved && !lesson;
  setStatus(
    // A REPAIR SAYS WHAT KIND OF ANSWER IT IS, first, because the three sources make three
    // different claims and only one of them may call itself the shortest. The sentences are
    // `STAGE_COPY` in lib/stage-report.js — one named region, which is how `optimal.test.mjs`
    // can hold the app to them (AGENTS.md: a minimality claim has three sources).
    route ? routeSentence(route, stageTargetNow())
    // Both counts through `plural`, because both can be 1. A one-move lesson read
    // "1 moves · 1 steps" — and this is the file whose i18n note says a hard-coded English
    // plural is both untranslatable and wrong for most languages.
    : lesson ? t('%1 · %2',
      plural(total, { one: '%1 move', other: '%1 moves' }),
      plural(lesson.steps.length, { one: '%1 step', other: '%1 steps' }))
      : showingProof ? provenMinimumLabel(total)
        : verdict && verdict.key === 'solve.targetMissed' && verdict.stopped === 'exhausted'
          ? `${total} — couldn't get to ${verdict.target}`
          : String(total),
  );

  // The optimal seam's affordance (AGENTS.md, fourth seam): drawn only where the native
  // prover is injected AND a desktop is behind it — the whole orientation-row precedent,
  // since the mobile shells inject the same commands — and the words "proved" / "minimum"
  // can reach this screen only from optimal.js's oracle-checked proof. In the browser and
  // mobile builds the button never appears and the wording above stands as the honest
  // answer: the shortest found, no claim of minimality. Re-wired per WALK: a retarget
  // replaced the subject, so the button must come back for the new one.
  // `!proved`: the library already carries this state's proof, so there is nothing left to
  // ask the native prover for — offering minutes of search to re-derive a fact we shipped
  // would be the opposite of why the file exists. It is `proved` and not `showingProof`
  // because the proof is a fact about the CUBE: gating on the label made an already-proved
  // arrangement eligible for hours of search again the moment the learner switched to
  // Lesson, where the sentence is not shown.
  // `settings.proveMinimum`: off by default. Proving is minutes to hours on a typical cube
  // (optimal-solver-plan.md), so the OFFER is not something to put in front of a beginner who
  // did not ask for it — it is opt-in from Settings, where the row explains the cost. It gates
  // the offer and nothing else: a proof already held is a fact about the cube, and turning the
  // offer off unsaid one (found by verification, 2026-09-14). Everything else about the gate is
  // unchanged: the commands must be injected, a desktop must be behind them, and a state the
  // library already proved has nothing left to ask for.
  const proveBtn = $('#proveBtn', root);
  // `!route`: the native prover proves a WHOLE CUBE minimal. A repair is a route into a set of
  // millions of cubes, so there is nothing here for it to be asked about, and offering it
  // would put a whole-cube claim under a stage-route count.
  if (proveBtn && optimalCapability() && !scrambling && !proved && !route) {
    // The pair being proved is the WALK's, captured at wiring: steps[0] IS the start
    // state this walk displays and total IS its length. Reading state.cube at click
    // time would race live ingestion (a snapshot can swap the subject or zero the move
    // list under the button), and a re-solve replaces the walk through loadWalk, which
    // re-wires this handler with the new pair.
    const startFacelets = steps[0] ?? state.cube.facelets;
    const shown = total;
    const cancelBtn = $('#proveCancel', root);
    // The press hands off to the controller: the proof's lifecycle is its own, and a walk
    // load is not the place to keep one. What stays here is the pair being proved and the
    // SENTENCE, which may only be said from a region the wording invariant sanctions.
    const sayProved = (proof) => {
      const saved = proof.tablesPersisted ? '' : ' · tables not saved';
      setStatus((proof.moves === shown
        ? `${shown} — proved the minimum`
        : `${shown} shown — the minimum is ${proof.moves}, proved`) + saved);
    };
    const held = nativeProofs.get(startFacelets);
    if (held && held.moves <= shown) {
      proveBtn.hidden = true;
      if (!lesson) sayProved(held);
      return;
    }
    if (!settings.proveMinimum) {
      proveBtn.hidden = true;
      return;
    }
    proveBtn.hidden = false;
    proveBtn.disabled = false;
    proveBtn.textContent = PROVE_COPY.button;
    proveBtn.onclick = () => void runProof({
      proveBtn, cancelBtn, startFacelets, shown, fresh, signal,
      sayProved: (proof) => {
        nativeProofs.set(startFacelets, proof);
        sayProved(proof);
      },
    // The controller reports every failure a proof can have; this catches the one thing it
    // cannot — itself — rather than leaving a press to end in an unhandled rejection.
    }).catch((err) => console.error('optimal: the proof controller failed', err));
  }
}
