// What both lesson views share: the parts of the composition around the transport, the caption toggle and
// its choice for the sitting, and the Play button's label (ADR 0007).
//
// An episode and a script lesson differ in their TRANSPORT — one track and a scrubber, against a step at a
// time — and in nothing a child sees around it. So everything around the transport is drawn and wired here,
// once. It had been written twice, and the two copies had already begun to differ in their layout and in
// what the caption toggle wrote (audit, 2026-09-21). Ids are the caller's, because each view's tests and
// styles address its own elements.

import { escHtml, icon } from '../../app-state.js';
import { t } from '../../i18n.js';
import { SOLVED_FACELETS } from '../../solved.js';

/**
 * Whether captions are on, for this page only — one choice for the sitting, so a choice made while
 * watching an episode holds for a script lesson and the other way round. Not persisted on purpose: it is a
 * preference about one sitting, and Settings is where durable choices live. Module scope, so it survives
 * a re-mount of the screen, which is what "remembered for the session" means when a screen is rebuilt.
 */
let captionsOn = false;
export const captionsShown = () => captionsOn;
export const showCaptions = (on) => { captionsOn = Boolean(on); };

/** The subject a lesson's cube stands for: not the learner's cube, and not claimed to be. */
export const LESSON_SUBJECT = Object.freeze({
  facelets: SOLVED_FACELETS, moves: [], isPhysical: false, setupAlg: '', solution: '',
});

/** The primary region: the lesson's cube, locked to the reference box, and whatever a view draws over it. */
export const lessonCubeHtml = (cubeId, overlay = '') => `<div class="card primary" style="display:flex;flex-direction:column;align-items:center;position:relative">
      <div style="flex:1;min-height:0;width:100%"><div class="cube-slot" id="${cubeId}" style="height:100%"></div></div>${overlay}
    </div>`;

/**
 * A figure a lesson puts on screen (the `number` cue), drawn over the cube.
 *
 * Over the PRIMARY region rather than in a card of its own, because it is about the cube being shown and a
 * lesson that says "forty-three quintillion" wants the digits beside the thing it is counting. It takes no
 * pointer events and wraps rather than widening: the longest figure a cube has to show is twenty-six
 * characters, and the narrowest supported client is a 320px column.
 */
export const numberOverlayHtml = (id) => `<div class="num" id="${id}" hidden aria-live="off"
        style="position:absolute;top:0;left:0;right:0;padding:6px 10px;text-align:center;font-weight:600;
               font-size:var(--fs-title);line-height:1.15;color:var(--ink);pointer-events:none;overflow-wrap:anywhere"></div>`;

/** The title card, with whatever the view says under the title. */
export const titleCardHtml = (title, below = '') => `<div class="card"><div class="eyebrow">${escHtml(t('LESSON'))}</div>
        <div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:2px">${escHtml(title)}</div>
        ${below}
      </div>`;

/** The caption toggle, for a transport row. */
export const captionButtonHtml = (id) => `<button class="pill" style="flex:none;min-width:44px" id="${id}" aria-pressed="${captionsOn}" title="${escHtml(t('Show the words being spoken'))}">${escHtml(t('Captions'))}</button>`;

/** The words being spoken, in a card that is hidden while captions are off. */
export const captionCardHtml = (boxId, textId) => `<div class="card" id="${boxId}"${captionsOn ? '' : ' hidden'}>
        <div class="eyebrow">${escHtml(t('WORDS'))}</div>
        <div class="sub" id="${textId}" style="color:var(--ink-3);margin-top:8px;line-height:1.6;min-height:3em"></div>
      </div>`;

/**
 * Sections behind a disclosure — for going back to a demonstration, never a menu a beginner has to answer
 * before starting. `attr` names the data attribute a press reads, and `valueOf` what it holds: a time for an
 * episode, a step for a script.
 */
export function sectionsHtml(boxId, sections, attr, valueOf) {
  if (!sections.length) return '';
  return `<details class="card" id="${boxId}">
        <summary style="cursor:pointer;font-weight:600">${escHtml(t('Sections'))}</summary>
        <div style="padding-top:8px;display:flex;flex-direction:column;gap:2px">
          ${sections.map((s) => `<button class="pill" data-${attr}="${escHtml(String(valueOf(s)))}" style="text-align:left">${escHtml(s.label)}</button>`).join('')}
        </div>
      </details>`;
}

/**
 * Wire the caption toggle: flip the sitting's choice, show or hide the card, and fill it with `words()`.
 *
 * `write` is the view's OWN writer for the caption — the cached slot its frame loop writes through. The
 * toggle wrote the element directly, so the slot's cache went stale: line A shown, captions off, a jump to
 * line B, captions on (B written past the cache), a jump back to A — and the slot, still believing A was
 * showing, left B on screen (verify pass, 2026-09-21). One element, one writer.
 */
export function bindCaptions({ button, box, write, words, signal }) {
  if (button && typeof write !== 'function') throw new TypeError('bindCaptions: the caption needs its view\'s writer');
  button?.addEventListener('click', () => {
    showCaptions(!captionsOn);
    button.setAttribute('aria-pressed', String(captionsOn));
    if (box) box.hidden = !captionsOn;
    write(captionsOn ? words() : '');
  }, { signal });
}

/**
 * The Play button's state: icon, accessible name and tooltip from ONE label, written only when it changes.
 * The tooltip stayed "Play the lesson" while the button announced "Pause the lesson", and the icon was
 * rebuilt through `innerHTML` on every frame whether or not anything had changed (audit, 2026-09-21).
 */
export function createPlayLabel(button) {
  let shown = null;
  return (playing) => {
    if (!button || shown === playing) return;
    shown = playing;
    const label = playing ? t('Pause the lesson') : t('Play the lesson');
    button.innerHTML = icon(playing ? 'pause' : 'play', 18);
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  };
}

/**
 * The layer a picture or a clip is drawn on: over the cube, filling the primary region.
 *
 * OVER rather than INSTEAD OF: the cube element stays mounted and laid out underneath, so coming back to it
 * costs nothing and the renderer is never resized to zero and back (the parked-cube rule, AGENTS.md). The
 * layer is opaque, so what is underneath is not half-visible through it.
 */
export const mediaLayerHtml = (id) => `<div id="${id}" hidden
        style="position:absolute;inset:0;display:grid;place-items:center;padding:10px;
               background:var(--panel);border-radius:inherit;overflow:hidden"></div>`;

/**
 * The picture or clip on show, and nothing else: one element, replaced only when the file changes.
 *
 * A CLIP IS ALWAYS SILENT. A lesson's sound is its narration, recorded a line at a time; a clip with its own
 * sound would talk over it. Muted also means a clip may start on its own, which is what a moving picture has
 * to do — except under reduced motion, where it stands still at its first frame instead.
 *
 * `resolve` is the course door's answer for where a file is; a reference it refuses is not shown, and
 * `onFail` is told, because a layer that is simply blank says nothing to the person who wrote the lesson.
 */
export function createMediaSlot(el, { doc = globalThis.document, resolve = (ref) => ref, reducedMotion = () => false, onFail = () => {} } = {}) {
  let shown = null;          // `${kind}\n${src}` of what is on screen
  let node = null;
  const clear = () => {
    if (node?.pause) { try { node.pause(); } catch { /* a node being dropped anyway */ } }
    node?.remove?.();
    node = null;
    shown = null;
    if (el) el.hidden = true;
  };
  return {
    clear,
    /** Show `{ kind, src, alt }`, or nothing when it is null. */
    show(media) {
      if (!media) { clear(); return; }
      const key = `${media.kind}\n${media.src}`;
      if (key === shown) return;
      const url = resolve(media.src);
      if (!url) {
        clear();
        onFail({ kind: media.kind, src: media.src, reason: 'refused' });
        return;
      }
      clear();
      shown = key;
      const still = media.kind === 'image';
      node = doc.createElement(still ? 'img' : 'video');
      node.style.maxWidth = '100%';
      node.style.maxHeight = '100%';
      node.style.objectFit = 'contain';
      if (still) {
        node.alt = media.alt;
      } else {
        // Silent, looping, inline, and describing itself — a clip is a moving picture, never a film.
        node.muted = true;
        node.loop = true;
        node.playsInline = true;
        node.setAttribute('aria-label', media.alt);
        node.autoplay = !reducedMotion();
      }
      node.addEventListener('error', () => onFail({ kind: media.kind, src: media.src, reason: 'unreadable' }), { once: true });
      node.src = url;
      el?.appendChild(node);
      if (el) el.hidden = false;
      if (!still && !reducedMotion()) { const started = node.play?.(); started?.catch?.(() => {}); }
    },
  };
}

/** Digits grouped in threes, however the lesson wrote them: `"43252003274489856000"` and `"43,252,..."`
 *  are one figure, and a count that rolls has to agree with the figure it lands on. */
export const groupDigits = (digits) => String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** How long a figure takes to count up to itself. Long enough to read as counting, short enough to wait through. */
export const COUNT_MS = 1200;

/** A figure small enough that counting to it looks like a slot machine announcing the number six. */
export const COUNT_FLOOR = 10000n;

/**
 * The slot a lesson's figure is written into, and the count-up when it asks for one (`counting`).
 *
 * BigInt throughout: the figure this exists for is twenty digits long, and a float loses the last five of
 * them — which are the point. A new figure, reduced motion, or a small one lands at once; a roll in flight
 * is dropped when anything replaces it, so two figures can never be counting at the same time.
 */
export function createNumberSlot(el, { frame = globalThis.requestAnimationFrame, now = () => Date.now(), reducedMotion = () => false } = {}) {
  let shown = null;
  let asked = null;
  let rolling = 0;
  const write = (text) => { if (el && shown !== text) { shown = text; el.textContent = text; } };
  const stop = () => { rolling += 1; };
  return {
    stop,
    /** Show `number` (a string of digits, grouped or not), counting up to it when `counting` asks. */
    show(number, counting = false) {
      // ASKED FOR ONCE. A painter repaints on every change a lesson makes — a step, a pick, a turn — and a
      // cue stays in force across all of them, so acting on each call counted the same figure up again and
      // again, mid-lesson, in front of the child (found by playing the real lesson in a browser).
      const same = asked !== null && asked.number === number && asked.counting === counting;
      if (same) return;
      asked = { number, counting };
      stop();
      if (number === null || number === undefined || number === '') {
        if (el) el.hidden = true;
        shown = null;
        return;
      }
      if (el) el.hidden = false;
      const digits = String(number).replace(/,/g, '');
      const target = BigInt(digits);
      if (!counting || reducedMotion() || target <= COUNT_FLOOR) { write(groupDigits(digits)); return; }
      const mine = rolling;
      const began = now();
      const tick = () => {
        if (mine !== rolling) return;                       // something else is being shown now
        const p = Math.min(1, Math.max(0, (now() - began) / COUNT_MS));
        const at = (target * BigInt(Math.round(p * 1e6))) / 1000000n;
        write(groupDigits(at.toString()));
        if (p < 1) frame(tick);
      };
      write(groupDigits('0'));
      frame(tick);
    },
  };
}

/** A text node's content, written only when it changes — the same rule as the Play button's. */
export function createTextSlot(el) {
  let shown = null;
  return (value) => {
    if (!el || shown === value) return;
    shown = value;
    el.textContent = value;
  };
}
