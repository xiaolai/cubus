// A script lesson on screen: the cube, the step controls, and what the lesson is waiting for.
//
// The same composition as a narrated episode (`episode-view.js`), for the same reasons: the cube is the
// primary region, the controls sit in `aux` directly under it and OUTSIDE anything that scrolls, and the
// words are optional. What differs is the transport. An episode is one track and a scrubber; a script
// lesson has no single timeline (dev-docs/adr/0007-the-course-plays-scripts-a-clip-per-line.md), so it is
// moved a STEP at a time — back, play, next, and say it again — and it stops for the child: six faces to
// pick when it asks a question, and a Done button when it hands them the cube.
//
// The episode view's rulings hold here too: no autoplay, captions off by default and shared with the
// episode view for the sitting, sections behind a disclosure. And every sentence below is the APP's,
// never the course's — the course's words arrive as data and are only ever shown as captions (ADR 0006
// decision 7).

import { $, escHtml, icon } from '../../app-state.js';
import { newCube } from '../../cube-drawing.js';
import { t } from '../../i18n.js';
import { hooks } from '../../screen-slots.js';
import { createScriptLesson } from '../../script-lesson.js';
import {
  LESSON_SUBJECT, bindCaptions, captionButtonHtml, captionCardHtml, captionsShown, createMediaSlot, createNumberSlot, createPlayLabel, createTextSlot, lessonCubeHtml, mediaLayerHtml, numberOverlayHtml, sectionsHtml, titleCardHtml,
} from './lesson-chrome.js';

/** The faces a child may pick, in the order they are drawn — the Drill screen's order. */
const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

/**
 * How long a step waits for the cube to stop turning before it goes on regardless. A bound, because an
 * element that never reports landing — a window hidden mid-turn pauses its frames — must not leave a
 * child in front of a lesson that has silently stopped.
 */
export const SETTLE_BOUND_MS = 8000;

/** One sentence per verdict. `unknown` is never "wrong" — nobody can be wrong about what is hidden. */
export function verdictLine(verdict) {
  if (verdict === 'right') return t('That is it.');
  if (verdict === 'wrong') return t('Not quite. Watch.');
  if (verdict === 'unknown') return t('This picture does not show that piece, so there is nothing to be right about.');
  return '';
}

/** What went wrong with a step's recording, in words a child or a parent can act on. */
export function problemLine(reason) {
  if (reason === 'NotAllowedError') return t('This device would not start the sound on its own. Press play again.');
  if (reason === 'refused') return t('This line names a recording outside the course, so it was not played. Press next to go on.');
  if (reason === 'NotSupportedError') return t('This line’s recording will not play here — it may be missing from the course. Press next to go on.');
  return t('This line’s recording did not play. Press next to go on.');
}

/**
 * One `<audio>` for the whole lesson, playing a recording per step.
 *
 * ONE element, not one per line: the first recording is started inside the child's press, and the same
 * element playing the next one is what a platform's autoplay rule then allows. `speak` resolves how the
 * recording ended — `'ended'`, `'stopped'`, `'refused'` for a reference the course door would not let
 * through, or the media's own error name — and a `resume` the platform refuses resolves the recording it
 * was continuing with that refusal, so a lesson is never left waiting on a promise nothing will settle.
 */
/**
 * How long a recording may make NO PROGRESS before the lesson stops waiting on it.
 *
 * A bound on progress, never on length: a long recording advances `currentTime` and is left alone,
 * while a stalled one sits at the same instant however long it is. Measured against what stalling
 * actually looks like (CI, 2026-10-06): `play()` resolved, `paused` false, `readyState` 2,
 * `currentTime` 0, `error` null — the element believes it is playing and no event will ever come.
 * Eight seconds is far past a local recording's first frames and far short of the twenty a person
 * would spend wondering whether the app is broken.
 */
const STALL_MS = 8000;

export function createLessonVoice({ doc, resolve }) {
  const audio = doc.createElement('audio');
  audio.preload = 'auto';
  audio.hidden = true;
  let pending = null;
  let watchdog = null;
  const stopWatching = () => { if (watchdog !== null) { clearInterval(watchdog); watchdog = null; } };
  /**
   * A RECORDING THAT NEITHER ENDS NOR FAILS used to leave the lesson waiting for ever: `speak`'s promise
   * settles on `ended`, on `error`, or on a refused start, and a stall is none of the three. The screen
   * then showed no problem, no progress and a Play button that had already been pressed — the app simply
   * stopped, which is the one thing AGENTS.md says a wait may not do.
   *
   * Paused time does not count: the lesson pauses deliberately, and a pause is not a stall.
   */
  const watch = () => {
    stopWatching();
    if (typeof setInterval !== 'function') return;
    let last = -1;
    let still = 0;
    watchdog = setInterval(() => {
      if (!pending) { stopWatching(); return; }
      if (audio.paused) { still = 0; return; }
      if (audio.currentTime !== last) { last = audio.currentTime; still = 0; return; }
      still += 1000;
      if (still >= STALL_MS) { audio.pause(); finish('stalled'); }
    }, 1000);
    watchdog.unref?.();
  };
  const finish = (result) => { stopWatching(); const p = pending; pending = null; p?.(result); };
  const onEnded = () => finish('ended');
  // MEDIA_ERR_SRC_NOT_SUPPORTED is also what a missing file reports — the element cannot tell a 404 from
  // an undecodable file, so neither can this.
  const onError = () => finish(audio.error?.code === 4 ? 'NotSupportedError' : 'Error');
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', onError);
  const start = () => {
    let started;
    try { started = Promise.resolve(audio.play()); } catch (err) { started = Promise.reject(err); }
    return started.then(() => true, (err) => err?.name || 'Error');
  };
  return {
    el: audio,
    speak(ref) {
      // THE PREVIOUS RECORDING STOPS HERE, whatever happens next. It was reported 'stopped' without being
      // paused, so a replacement the course door refused left it playing on under a lesson that had moved
      // on (audit, 2026-09-21). The result is now true of the element, not only of its caller's intent.
      audio.pause();
      finish('stopped');
      const url = resolve(ref);
      if (!url) return Promise.resolve('refused');
      return new Promise((settle) => {
        pending = settle;
        // Assigned only when it differs: the same recording again ("say it again") restarts it instead.
        if (audio.getAttribute('src') !== url) audio.src = url;
        else audio.currentTime = 0;
        watch();
        start().then((r) => { if (r !== true && pending === settle) finish(r); });
      });
    },
    pause() { audio.pause(); },
    resume() {
      const mine = pending;
      if (!mine) return;
      start().then((r) => { if (r !== true && pending === mine) finish(r); });
    },
    stop() { audio.pause(); finish('stopped'); },
    dispose() {
      audio.pause();
      finish('stopped');
      stopWatching();
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      // `removeAttribute`, never `src = ''`, which resolves against the page and fetches it.
      audio.removeAttribute('src');
      audio.load?.();
      audio.remove();
    },
  };
}

/** The script lesson composition: primary, aux, and an aside that may scroll. */
export function scriptLessonHtml({ title, sections }) {
  // `walking`: the grid modifier that places an aux row under the primary — see `episode-view.js`.
  return `<div class="cols walking">
    ${lessonCubeHtml('slCube', mediaLayerHtml('slMedia') + numberOverlayHtml('slNumber'))}
    <div class="card aux">
      <div class="transport" id="slTransport">
        <button class="tbtn" id="slBack" title="${escHtml(t('The step before'))}" aria-label="${escHtml(t('The step before'))}">${icon('chevron-left', 18)}</button>
        <button class="tbtn primary" id="slPlay" title="${escHtml(t('Play the lesson'))}" aria-label="${escHtml(t('Play the lesson'))}">${icon('play', 18)}</button>
        <button class="tbtn" id="slNext" title="${escHtml(t('The next step'))}" aria-label="${escHtml(t('The next step'))}">${icon('chevron-right', 18)}</button>
        <button class="tbtn" id="slReplay" title="${escHtml(t('Say that again'))}" aria-label="${escHtml(t('Say that again'))}">${icon('repeat', 18)}</button>
        <span class="num sub" id="slCount" role="status" aria-live="off" style="color:var(--ink-4);min-width:64px;text-align:right;flex:1">—</span>
        ${captionButtonHtml('slCaptions')}
        <button class="pill" style="flex:none;min-width:44px" id="slLeave" title="${escHtml(t('Back to the lessons'))}">${escHtml(t('Back'))}</button>
      </div>
      <div class="transport" id="slAsk" hidden style="justify-content:center;margin-top:6px" role="group" aria-label="${escHtml(t('Pick the faces'))}">
        ${FACES.map((f) => `<button class="tbtn" data-face="${f}" aria-pressed="false" aria-label="${escHtml(t('Face %1', f))}">${f}</button>`).join('')}
      </div>
      <div class="transport" id="slYours" hidden style="justify-content:center;margin-top:6px">
        <button class="btn primary" id="slDone" style="min-width:120px">${icon('check', 18)} ${escHtml(t('Done'))}</button>
      </div>
    </div>
    <div class="aside">
      ${titleCardHtml(title, '<div class="sub" id="slSection" style="color:var(--ink-4);margin-top:4px"></div>')}
      <div class="card" id="slStatusBox" hidden>
        <div class="eyebrow" id="slStatusHead"></div>
        <div class="sub" id="slStatus" style="color:var(--ink-3);margin-top:8px;line-height:1.5"></div>
      </div>
      ${captionCardHtml('slCaptionBox', 'slCaption')}
      ${sectionsHtml('slSections', sections, 'step', (s) => s.step)}
      <div class="card" id="slNotice" hidden>
        <div class="sub" style="color:var(--err-ink);line-height:1.5" id="slNoticeText"></div>
        <div class="sub num" style="color:var(--ink-5);margin-top:6px;font-size:var(--fs-caption)" id="slNoticeDetail"></div>
      </div>
    </div></div>`;
}

/**
 * A promise that resolves when the cube has finished turning — read from the element's own `animating`,
 * which stays true for the whole of a group because the element feeds a group's next turn from the last
 * one's end.
 *
 * THE BOUND IS A TIMER OF ITS OWN. It was checked only inside animation-frame callbacks, so when frames
 * stopped — a hidden window pauses them — neither the bound nor disposal was ever looked at, and the wait
 * never ended (audit, 2026-09-21: still pending 16 s after disposal). `cancelAll` settles every wait now.
 */
export function createSettle({ cube, win }) {
  const frame = win?.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 16));
  const unframe = win?.cancelAnimationFrame?.bind(win) ?? ((id) => clearTimeout(id));
  const later = win?.setTimeout?.bind(win) ?? setTimeout;
  const unlater = win?.clearTimeout?.bind(win) ?? clearTimeout;
  const waits = new Set();
  const settle = () => new Promise((resolve) => {
    let handle = null;
    const done = () => {
      if (!waits.delete(done)) return;
      unlater(bound);
      if (handle !== null) unframe(handle);
      resolve();
    };
    const bound = later(done, SETTLE_BOUND_MS);
    const check = () => {
      handle = null;
      if (!cube.animating) done();
      else handle = frame(check);
    };
    waits.add(done);
    handle = frame(check);
  });
  return { settle, cancelAll: () => { for (const done of [...waits]) done(); } };
}

/** Where a recording that failed belongs, for whoever wrote the lesson: the step, the reveal line if it was
 *  one, and the recording by name -- the lesson's own record of it, never one rebuilt from the outer step. */
export function problemDetail({ step, reveal, ref }) {
  const where = reveal === undefined ? t('step %1', step + 1) : `${t('step %1', step + 1)} · ${t('answer, line %1', reveal)}`;
  return `${where} · ${ref || '—'}`;
}

/**
 * What the lesson's state LOOKS like — split by what each part shows, so each is small enough to read. It
 * was one 49-line function inside a 137-line mount (audit, 2026-09-21).
 */
function createScriptPainter(root, caption, { frame, now, reducedMotion, doc, resolve } = {}) {
  const el = (id) => $(id, root);
  const number = createNumberSlot(el('#slNumber'), { frame, now, reducedMotion });
  // A picture that cannot be shown is SAID, never left as a blank panel with the lesson talking over it.
  let mediaFailed = null;
  const media = createMediaSlot(el('#slMedia'), { doc, resolve, reducedMotion, onFail: (f) => { mediaFailed = f; } });
  const playLabel = createPlayLabel(el('#slPlay'));
  const count = createTextSlot(el('#slCount'));
  const sectionLbl = createTextSlot(el('#slSection'));
  const statusHead = createTextSlot(el('#slStatusHead'));
  const status = createTextSlot(el('#slStatus'));
  const noticeText = createTextSlot(el('#slNoticeText'));
  const noticeDetail = createTextSlot(el('#slNoticeDetail'));
  const askRow = el('#slAsk');

  const asking = (view) => view.phase === 'asking' || (view.phase === 'revealing' && Boolean(view.round));

  const transport = (view) => {
    // The figure the lesson is showing, over the cube it is about. A count-up runs once, on arrival: the
    // painter is called many times a step, and `createNumberSlot` writes only what changed.
    number.show(view.number, view.counting);
    if (!view.media) mediaFailed = null;
    media.show(view.media);
    count(view.steps ? `${Math.min(view.step + 1, view.steps)} / ${view.steps}` : '—');
    playLabel(view.playing && view.phase !== 'ended');
    if (el('#slBack')) el('#slBack').disabled = view.step === 0 && view.phase === 'ready';
    if (el('#slNext')) el('#slNext').disabled = view.phase === 'ended';
    sectionLbl(view.section ?? '');
    if (captionsShown()) caption(view.words);
  };

  const faces = (view) => {
    if (!askRow) return;
    askRow.hidden = !asking(view);
    for (const b of askRow.querySelectorAll('[data-face]')) {
      b.setAttribute('aria-pressed', String(view.round?.picked?.includes(b.dataset.face) ?? false));
      b.disabled = !view.round || view.round.locked;
    }
    if (el('#slYours')) el('#slYours').hidden = view.phase !== 'yours';
  };

  /** What the lesson is waiting for, in a heading and a line — or nothing, while it is simply playing. */
  const waitingFor = (view) => {
    if (view.phase === 'yours') {
      return [t('YOUR TURN'), view.yours?.wrong
        ? t('That was a different turn. Turn it back, then make the move.')
        : t('Make the move on your cube, then press Done.')];
    }
    if (asking(view)) return [t('THE QUESTION'), view.round?.locked ? verdictLine(view.round.verdict) : t('Pick the faces, then watch.')];
    if (view.phase === 'ended') return [t('THE END'), t('Press play to go through it again.')];
    return ['', ''];
  };

  const statusCard = (view) => {
    const [head, line] = waitingFor(view);
    if (el('#slStatusBox')) el('#slStatusBox').hidden = !head;
    statusHead(head);
    status(line);
  };

  /**
   * A recording that did not play: what to do, and — for whoever wrote the lesson — which step and WHICH
   * FILE. The file is the lesson's own record of the recording that failed. It was rebuilt from the outer
   * step, so a reveal line that failed was reported as the round's question recording (audit, 2026-09-21).
   */
  const notice = (view) => {
    // A RECORDING that did not play comes first: the lesson has stopped for it, and a picture that failed
    // has not stopped anything. Both are said, never only counted.
    const shown = view.problem ?? (mediaFailed ? { media: mediaFailed } : null);
    if (el('#slNotice')) el('#slNotice').hidden = !shown;
    if (!shown) return;
    if (shown.media) {
      noticeText(shown.media.reason === 'refused'
        ? t('This lesson names a picture outside the course, so it was not shown.')
        : t('This lesson\u2019s picture would not load.'));
      noticeDetail(shown.media.src || '—');
      return;
    }
    noticeText(problemLine(view.problem.reason));
    noticeDetail(problemDetail(view.problem));
  };

  const draw = (view) => { transport(view); faces(view); statusCard(view); notice(view); };
  // A count-up in flight, and a clip playing, are the painter's — so stopping them is too: either left
  // running writes to, or plays into, a view that has gone.
  draw.stop = () => { number.stop(); media.clear(); };
  return draw;
}

/**
 * Wire the controls to the lesson. Every listener carries `signal`, so disposing the view removes them.
 * `caption` is the painter's own writer for the caption, so the toggle and the painter never disagree.
 */
export function bindScriptControls(root, { lesson, onBack, signal, caption }) {
  const on = (target, fn) => target?.addEventListener('click', fn, { signal });
  on($('#slPlay', root), () => {
    const v = lesson.view;
    if (v.playing && v.phase !== 'waiting' && v.phase !== 'ended') lesson.pause();
    else lesson.play();
  });
  on($('#slBack', root), () => lesson.back());
  on($('#slNext', root), () => lesson.next());
  on($('#slReplay', root), () => lesson.replay());
  on($('#slDone', root), () => lesson.done());
  for (const b of $('#slAsk', root)?.querySelectorAll('[data-face]') ?? []) on(b, () => lesson.select(b.dataset.face));
  for (const b of root.querySelectorAll('[data-step]')) on(b, () => lesson.seekStep(Number(b.dataset.step) || 0));
  bindCaptions({
    button: $('#slCaptions', root), box: $('#slCaptionBox', root), write: caption,
    words: () => lesson.view.words, signal,
  });
  on($('#slLeave', root), () => onBack());
}

/**
 * Mount the lesson over a built script: park a cube under it, give it a voice, and wire the controls.
 *
 * `resolveFile(ref)` is the course door's answer for where a file inside the course is — a recording, a
 * picture, a clip. The view never decides that.
 * `from` is where the lesson last rested (`progress()`), restored paused. Returns a disposer, which the
 * screen runs when it goes away, and the lesson, whose progress the screen keeps.
 */
export function mountScriptLessonView(root, { built, from = null, resolveFile = () => '', onBack = () => {} } = {}) {
  const doc = root.ownerDocument ?? globalThis.document;
  const win = doc?.defaultView ?? null;
  const cube = newCube({ subject: LESSON_SUBJECT });
  cube.setAttribute('aria-label', t('The lesson’s cube, which turns as the lesson talks'));
  $('#slCube', root)?.appendChild(cube);

  const voice = createLessonVoice({ doc, resolve: resolveFile });
  $('#slTransport', root)?.appendChild(voice.el);

  let gone = false;
  const settling = createSettle({ cube, win });
  // ONE writer for the caption, shared by the painter and the toggle (see `bindCaptions`).
  const caption = createTextSlot($('#slCaption', root));
  const draw = createScriptPainter(root, caption, {
    doc,
    resolve: resolveFile,
    frame: win?.requestAnimationFrame?.bind(win),
    now: () => win?.performance?.now?.() ?? Date.now(),
    // Through the element's own window, never a bare global: the node mount tests expose a LIST of browser
    // globals and `matchMedia` is not among them.
    reducedMotion: () => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
  });
  const paint = (view) => { if (!gone) draw(view); };
  const lesson = createScriptLesson(built, { cube, voice, settle: settling.settle, onChange: paint, from });

  // DISPOSAL REMOVES EVERY LISTENER. Left installed, a retained or re-mounted root's controls could restart
  // the disposed lesson: a Replay press after disposal set it playing again (audit, 2026-09-21).
  const listeners = new AbortController();
  bindScriptControls(root, { lesson, onBack, signal: listeners.signal, caption });

  // A smart cube's turns, followed only while the lesson has handed the cube to the child. The hook is
  // cleared by the shell on every navigation; it is cleared here too, when the lesson goes, so a turn made
  // after leaving the lesson but before the next render cannot reach a disposed one.
  const follow = (m) => lesson.turn(m?.notation);
  hooks.liveMove = follow;

  paint(lesson.view);

  return {
    dispose() {
      gone = true;
      draw.stop();
      listeners.abort();
      if (hooks.liveMove === follow) hooks.liveMove = null;
      lesson.dispose();
      settling.cancelAll();
      voice.dispose();
    },
    lesson,
  };
}
