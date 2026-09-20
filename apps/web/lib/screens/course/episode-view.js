// A narrated lesson on screen: the cube, the transport, and the two things that are optional.
//
// The composition is the layout contract's four regions (`dev-docs/stage-contract.md`, "Regions per
// screen"), not a pair of scrolling columns: **primary** is the cube, locked to the reference box,
// and **aux** is the transport, always directly under it and OUTSIDE anything that scrolls. That
// last part is the correction — the Drill screen's `.flow` scrolls the whole portrait composition,
// so it does not guarantee a control stays reachable, and a Play button that can be scrolled off a
// phone is a lesson a child cannot start.
//
// Four rulings this implements, taken 2026-09-20 on the owner's behalf:
//
//   1. **No autoplay.** A lesson does not begin talking because it was opened. The child needs the
//      moment to pick their cube up, and a media element that will not start without a gesture is a
//      screen that looks broken. A refused play leaves a usable Play control and says what happened.
//   2. **Captions off by default**, behind a toggle beside the transport, remembered for the
//      session. This app is built for a child who may not read yet — reading must never be required
//      to proceed — but text helps an older child, a parent, and anyone who cannot hear it.
//   3. **Sections collapsed** behind a disclosure, in both compositions. They are for going back to
//      a demonstration, not a menu a beginner has to answer before starting.
//   4. **The total is the MEDIA's, and a dash until it is known.** The schedule's own length
//      includes animation time and is not what the audio will play for; showing it would be a
//      number describing something else.
//
// And one trap, measured rather than assumed: **`viewAt().say` keeps the previous line between
// cues.** An episode whose first cue ends at 10.15 s still reports `"line 0"` at 11.9 s, because a
// view is what is TRUE at `t` and the last thing said is still the last thing said. A caption is a
// claim about speech happening NOW, so it is cleared outside its cue's own `start`–`end` window —
// otherwise it shows a sentence nobody is speaking, for as long as the silence lasts.

import { $, escHtml, icon } from '../../app-state.js';
import { newCube } from '../../cube-drawing.js';
import { createEpisodeAudio } from '../../episode-audio.js';
import { resolveSpanning } from '../../lesson-format.js';
import { createLessonPlayer } from '../../lesson-player.js';
import { buildSchedule } from '../../lesson-schedule.js';
import { t } from '../../i18n.js';
import { SOLVED_FACELETS } from '../../solved.js';

/**
 * Whether captions are on, for this page only.
 *
 * Not persisted on purpose: it is a preference about one sitting, and the Settings screen is where
 * durable choices live. Module scope so it survives a re-mount of the screen, which is what
 * "remembered for the session" has to mean when a screen is rebuilt on every navigation.
 */
let captionsOn = false;

/** The subject a lesson's cube stands for: not the learner's cube, and not claimed to be. */
const LESSON_SUBJECT = Object.freeze({
  facelets: SOLVED_FACELETS, moves: [], isPhysical: false, setupAlg: '', solution: '',
});

/** mm:ss, or a dash when there is no number to show. Never a guess, never NaN on screen. */
export function clockText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The episode's section markers, in order: where to go back to, and what it is called. */
export function sectionsOf(episode) {
  const out = [];
  for (const cue of episode?.cues ?? []) {
    if (typeof cue.section === 'string' && cue.section.trim()) out.push({ at: cue.start, label: cue.section });
  }
  return out;
}

/**
 * The line being spoken at `t`, or empty.
 *
 * The window check is the whole point — see the trap at the top of this file.
 */
export function lineAtTime(schedule, t) {
  const cues = schedule?.cues ?? [];
  for (const cue of cues) {
    if (t >= cue.start && t <= cue.end) return typeof cue.say === 'string' ? cue.say : '';
  }
  return '';
}

/** The episode composition: primary, aux, and an aside that may scroll. */
export function episodeHtml({ title, sections, playable }) {
  const sectionList = sections.length
    ? `<details class="card" id="sectionsBox">
        <summary style="cursor:pointer;font-weight:600">${escHtml(t('Sections'))}</summary>
        <div style="padding-top:8px;display:flex;flex-direction:column;gap:2px">
          ${sections.map((s, i) => `<button class="pill" data-seek="${s.at}" style="text-align:left">${escHtml(s.label)}</button>`).join('')}
        </div>
      </details>`
    : '';
  // `walking` is the grid modifier that PLACES an aux row — without it `.aux` has no grid area at
  // all on a coarse-pointer portrait window and is auto-placed, which squashed the transport's
  // controls to 32px wide. The class is named for the cube screen's walk, where it first appeared;
  // what it means to the grid is "this composition has a transport under the primary".
  return `<div class="cols walking">
    <div class="card primary" style="display:flex;flex-direction:column;align-items:center;position:relative">
      <div style="flex:1;min-height:0;width:100%"><div class="cube-slot" id="episodeCube" style="height:100%"></div></div>
    </div>
    <div class="card aux">
      <div class="transport" id="epTransport">
        <button class="tbtn primary" id="epPlay" title="${escHtml(t('Play the lesson'))}" aria-label="${escHtml(t('Play the lesson'))}"${playable ? '' : ' disabled'}>${icon('play', 18)}</button>
        <input type="range" id="epScrub" min="0" max="1000" value="0" step="1"
               aria-label="${escHtml(t('How far through the lesson'))}"${playable ? '' : ' disabled'}
               style="flex:1;min-width:110px;height:44px">
        <span class="num sub" id="epTime" role="status" aria-live="off" style="color:var(--ink-4);min-width:88px;text-align:right">—</span>
        <button class="pill" style="flex:none;min-width:44px" id="epCaptions" aria-pressed="${captionsOn}" title="${escHtml(t('Show the words being spoken'))}">${escHtml(t('Captions'))}</button>
        <button class="pill" style="flex:none;min-width:44px" id="epBack" title="${escHtml(t('Back to the lessons'))}">${escHtml(t('Back'))}</button>
      </div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">${escHtml(t('LESSON'))}</div>
        <div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:2px">${escHtml(title)}</div>
        ${playable ? '' : `<div class="sub" style="color:var(--ink-4);margin-top:8px;line-height:1.5">${escHtml(t('This lesson has no audio with it, so there is nothing to play.'))}</div>`}
      </div>
      <div class="card" id="epCaptionBox"${captionsOn ? '' : ' hidden'}>
        <div class="eyebrow">${escHtml(t('WORDS'))}</div>
        <div class="sub" id="epCaption" style="color:var(--ink-3);margin-top:8px;line-height:1.6;min-height:3em"></div>
      </div>
      ${sectionList}
      <div class="card" id="epNotice" hidden><div class="sub" style="color:var(--err-ink);line-height:1.5" id="epNoticeText"></div></div>
    </div></div>`;
}

/**
 * Mount the lesson: build the schedule, park a cube under it, and wire the transport.
 *
 * Returns a disposer. The caller owns when that runs, because the screen it belongs to does.
 */
export function mountEpisodeView(root, { episode, episodeId = '', audioSrc = '', onBack = () => {} } = {}) {
  const prepared = { ...episode, cues: resolveSpanning(episode.cues) };
  const schedule = buildSchedule(prepared);

  const cube = newCube({ subject: LESSON_SUBJECT });
  // The subject is a stand-in — the lesson drives this cube, so its facelets are whatever `t` says
  // and never the solved ones the subject carries. Announcing "A solved cube" for the whole lesson
  // is the same defect the drill had.
  cube.setAttribute('aria-label', t('The lesson\u2019s cube, which turns as the lesson talks'));
  $('#episodeCube', root)?.appendChild(cube);

  // Through the element's own window, never a bare global: the node mount tests expose a LIST of
  // browser globals and `matchMedia` is not on it, so a bare call throws there and nowhere else.
  const win = root.ownerDocument?.defaultView ?? null;
  const reducedMotion = () => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

  const player = createLessonPlayer(cube, schedule, { reducedMotion });
  const caption = $('#epCaption', root);
  const captionBox = $('#epCaptionBox', root);
  const timeLbl = $('#epTime', root);
  const scrub = $('#epScrub', root);
  const playBtn = $('#epPlay', root);
  const notice = $('#epNotice', root);
  const noticeText = $('#epNoticeText', root);

  let dragging = false;
  let gone = false;

  const say = (words) => {
    if (!noticeText || !notice) return;
    noticeText.textContent = words;
    notice.hidden = !words;
  };

  const paintChrome = (view) => {
    if (timeLbl) timeLbl.textContent = `${clockText(view.at)} / ${clockText(view.total ?? Number.NaN)}`;
    if (playBtn) {
      playBtn.innerHTML = icon(view.playing ? 'pause' : 'play', 18);
      playBtn.setAttribute('aria-label', view.playing ? t('Pause the lesson') : t('Play the lesson'));
    }
    if (scrub && !dragging && view.total) scrub.value = String(Math.round((view.at / view.total) * 1000));
    if (caption && captionsOn) caption.textContent = lineAtTime(schedule, view.at);
  };

  const audio = createEpisodeAudio({
    player,
    src: audioSrc,
    episodeId,
    doc: root.ownerDocument ?? globalThis.document,
    onChange: paintChrome,
  });

  // IN THE DOCUMENT, hidden. A media element the screen owns but never attaches is invisible to
  // everything — including to any check that it is not autoplaying, which is why the case asserting
  // exactly that was vacuous: `document.querySelectorAll('audio')` found nothing and
  // `[].every(...)` is true. Attaching it is also simply what a media element is for; `dispose`
  // removes it again.
  audio.el.hidden = true;
  $('#epTransport', root)?.appendChild(audio.el);

  // The first picture, before anything is pressed: a seek, so nothing animates its way there from a
  // cube nobody has seen — and to WHERE THE AUDIO ALREADY IS, not to zero. Seeking to 0 here threw
  // away the position the parked element had just preserved, which undid the whole point of keeping
  // it: leaving for Settings and coming back restarted the lesson.
  audio.seek(audio.view().at);

  playBtn?.addEventListener('click', async () => {
    if (audio.view().playing) { audio.pause(); return; }
    say('');
    const started = await audio.play();
    // The screen may be gone by the time a rejection arrives — navigating away while `play()` is
    // pending and then having it reject wrote to the old screen's DOM.
    if (gone) return;
    if (started === true) return;
    // A refusal leaves a usable control and an explanation, and the two refusals are not the same
    // sentence: a policy refusal is answered by pressing again, and a file that cannot be decoded
    // never will be — telling a child to press again would be a lie.
    say(started === 'NotSupportedError'
      ? t('This lesson\u2019s sound will not play on this device.')
      : t('This device would not start the sound on its own. Press play again.'));
  });

  scrub?.addEventListener('input', () => {
    const total = audio.view().total;
    if (!total) return;
    dragging = true;
    audio.seek((Number(scrub.value) / 1000) * total);
  });
  scrub?.addEventListener('change', () => { dragging = false; });

  $('#epCaptions', root)?.addEventListener('click', (e) => {
    captionsOn = !captionsOn;
    e.currentTarget.setAttribute('aria-pressed', String(captionsOn));
    if (captionBox) captionBox.hidden = !captionsOn;
    if (caption) caption.textContent = captionsOn ? lineAtTime(schedule, audio.view().at) : '';
  });

  for (const b of root.querySelectorAll('[data-seek]')) {
    b.addEventListener('click', async () => {
      // Where the child was — playing or stopped — is preserved across the jump: a section press is
      // "show me that bit again", never "start playing" and never "stop".
      const wasPlaying = audio.view().playing;
      audio.seek(Number(b.dataset.seek) || 0);
      if (wasPlaying) await audio.play();
    });
  }

  $('#epBack', root)?.addEventListener('click', () => onBack());

  paintChrome(audio.view());

  return {
    dispose() {
      gone = true;
      audio.dispose();
    },
    // For tests and for the screen: what is on show, without reading the DOM back.
    view: () => audio.view(),
  };
}
