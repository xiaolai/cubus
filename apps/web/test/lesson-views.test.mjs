// The two lesson views' moving parts, each tested where its defect lived (the 2026-09-21 audit of the
// course-player branch). The browser suites mount the views whole and walk the happy path; these hold the
// edges a real device reaches and a happy path never does: a play that answers late, a Pause that aborts a
// play in flight, frames that stop, a recording refused mid-lesson, a control pressed after disposal.
import assert from 'node:assert/strict';
import test from 'node:test';

import { bindEpisodeTransport, lineAtTime } from '../lib/screens/course/episode-view.js';
import {
  COUNT_MS, bindCaptions, captionsShown, createMediaSlot, createNumberSlot, createPlayLabel, createTextSlot, groupDigits, showCaptions,
} from '../lib/screens/course/lesson-chrome.js';
import {
  bindScriptControls, createLessonVoice, createSettle, problemDetail,
} from '../lib/screens/course/script-lesson-view.js';

/** A control that really dispatches, so listeners removed through an AbortSignal are really gone. */
class FakeControl extends EventTarget {
  constructor(data = {}) { super(); this.dataset = data; this.attrs = new Map(); this.hidden = false; this.value = '0'; this.textContent = ''; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  click() { this.dispatchEvent(new Event('click')); }
}
/** A root whose querySelector answers from a table of ids, and whose querySelectorAll finds data buttons. */
function fakeRoot(ids, datasets = []) {
  return {
    querySelector: (sel) => ids[sel] ?? null,
    querySelectorAll: (sel) => datasets.filter((b) => sel === `[data-${Object.keys(b.dataset)[0]}]`),
  };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function deferred() { let settle; const promise = new Promise((resolve) => { settle = resolve; }); return { promise, resolve: settle }; }

test('the caption at the seam of two cues is the line that has just STARTED', () => {
  const schedule = { cues: [{ start: 0, end: 1, say: 'first' }, { start: 1, end: 2, say: 'second' }] };
  assert.equal(lineAtTime(schedule, 1), 'second', 'a jump to the second line showed the first');
  assert.equal(lineAtTime(schedule, 0.5), 'first');
  assert.equal(lineAtTime(schedule, 2.5), '', 'silence after the last line');
});

test("Play's tooltip says what its accessible name says, and nothing is rewritten that has not changed", () => {
  let writes = 0;
  const button = { set innerHTML(_) { writes += 1; }, attrs: new Map(), setAttribute(k, v) { this.attrs.set(k, v); } };
  const label = createPlayLabel(button);
  label(true);
  assert.equal(button.attrs.get('title'), button.attrs.get('aria-label'), 'the tooltip and the name disagree');
  assert.match(button.attrs.get('title'), /Pause/);
  label(true); label(true);
  assert.equal(writes, 1, 'an unchanged Play button was rebuilt');
  let texts = 0;
  const slot = createTextSlot({ set textContent(_) { texts += 1; } });
  slot('0:01'); slot('0:01'); slot('0:02');
  assert.equal(texts, 2, 'an unchanged time was rewritten');
});

/** The episode transport over a fake root and audio: every play answers when the test says. */
function episodeRig() {
  const play = new FakeControl();
  const section = new FakeControl({ seek: '12' });
  const root = fakeRoot({ '#epPlay': play, '#epScrub': new FakeControl(), '#epBack': new FakeControl() }, [section]);
  const plays = [];
  const audio = {
    playing: false, at: 0, seeks: [],
    view() { return { playing: this.playing, at: this.at, total: 60 }; },
    play() { const d = deferred(); plays.push(d); return d.promise; },
    pause() { this.playing = false; },
    seek(t) { this.seeks.push(t); },
  };
  const said = [];
  const chrome = { say: (w) => said.push(w), set dragging(_) {} };
  const listeners = new AbortController();
  const bound = bindEpisodeTransport(root, { audio, chrome, schedule: { cues: [] }, onBack() {}, signal: listeners.signal });
  const notices = () => said.filter(Boolean);
  return { play, section, audio, plays, notices, bound, leave: () => { bound.invalidate(); listeners.abort(); } };
}

test('a caption turned off, moved past, and turned back on shows the line being spoken, not the one before', () => {
  // The verify pass's sequence (2026-09-21): line A shown, captions off, a jump to B, captions on, a jump back
  // to A. The toggle wrote the element past the painter's cache, so the cache still said A and B stayed up.
  const shown = { textContent: '' };
  const caption = createTextSlot(shown);
  const button = new FakeControl();
  const box = { hidden: true };
  let speaking = 'line A';
  const paint = () => { if (captionsShown()) caption(speaking); };
  const was = captionsShown();
  showCaptions(false);
  try {
    bindCaptions({ button, box, write: caption, words: () => speaking });
    button.click();                      // on
    paint();
    assert.equal(shown.textContent, 'line A');
    button.click();                      // off
    speaking = 'line B';
    paint();                             // captions off: nothing is written
    button.click();                      // on again, while B is being said
    assert.equal(shown.textContent, 'line B');
    speaking = 'line A';
    paint();
    assert.equal(shown.textContent, 'line A', 'the caption kept a line nobody is saying');
  } finally {
    showCaptions(was);
  }
});

test('a caption toggle with no writer of its own is refused at wiring, not discovered at the first press', () => {
  assert.throws(() => bindCaptions({ button: new FakeControl(), box: null, words: () => '' }), TypeError);
});

test('a Pause that cuts a pending play short is not reported as the device refusing', async () => {
  const r = episodeRig();
  r.play.click();                        // a play, in flight
  r.audio.playing = true;
  r.play.click();                        // Pause
  r.plays[0].resolve('AbortError');
  await flush();
  assert.deepEqual(r.notices(), [], 'the aborted play was reported as a refusal');
});

test("a play cut short by a pause from OUTSIDE the transport -- the system's media controls -- is not a refusal", async () => {
  const r = episodeRig();
  r.play.click();                        // the only request; nothing here pressed Pause
  r.plays[0].resolve('AbortError');
  await flush();
  assert.deepEqual(r.notices(), [], 'an abort nobody here asked for was reported as the device refusing');
});

test("an older play's late refusal cannot overwrite a newer play that succeeded", async () => {
  const r = episodeRig();
  r.play.click();
  r.play.click();                        // pressed again before the first answered
  r.plays[1].resolve(true);
  r.plays[0].resolve('NotAllowedError');
  await flush();
  assert.deepEqual(r.notices(), [], 'a stale refusal overwrote the notice');
});

test('a refused play from a section jump is explained, like one from Play', async () => {
  const r = episodeRig();
  r.audio.playing = true;
  r.section.click();
  assert.deepEqual(r.audio.seeks, [12]);
  r.plays[0].resolve('NotSupportedError');
  await flush();
  assert.equal(r.notices().length, 1, 'the section jump dropped the refusal');
});

test('a play still pending when the view is disposed says nothing to a screen that has gone', async () => {
  const r = episodeRig();
  r.play.click();
  r.leave();
  r.plays[0].resolve('NotAllowedError');
  await flush();
  assert.deepEqual(r.notices(), []);
  r.play.click();
  assert.equal(r.plays.length, 1, 'a control on a disposed view still played');
});

test('the settle bound is a timer of its own: a cube whose frames stop still lets the lesson go on', async () => {
  const timers = [];
  const win = {
    requestAnimationFrame: () => 1,      // frames that never come -- a hidden window
    cancelAnimationFrame() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
  };
  const settling = createSettle({ cube: { animating: true }, win });
  let landed = false;
  settling.settle().then(() => { landed = true; });
  await flush();
  assert.equal(landed, false);
  timers.forEach((fn) => fn());          // the bound elapses, with no frame ever having run
  await flush();
  assert.equal(landed, true, 'the bound was only ever checked inside a frame');
  let cancelled = false;
  settling.settle().then(() => { cancelled = true; });
  settling.cancelAll();
  await flush();
  assert.equal(cancelled, true, 'disposal left a wait pending');
});

test("a failed reveal line is reported as THAT recording, not the round's question", () => {
  assert.match(problemDetail({ step: 4, reveal: 1, ref: 'reveal-1.m4a' }), /step 5 · .*1 · reveal-1\.m4a$/);
  assert.equal(problemDetail({ step: 0, ref: 'v/0.m4a' }), 'step 1 · v/0.m4a');
  assert.match(problemDetail({ step: 2 }), /—$/);
});

test('disposal removes every control listener, so a pressed control cannot restart the lesson', () => {
  const ids = Object.fromEntries(['#slPlay', '#slBack', '#slNext', '#slReplay', '#slDone', '#slCaptions', '#slLeave'].map((id) => [id, new FakeControl()]));
  const calls = [];
  const lesson = new Proxy({ view: { playing: false, phase: 'ready', words: '' } }, {
    get: (target, name) => (name === 'view' ? target.view : () => calls.push(name)),
  });
  const listeners = new AbortController();
  bindScriptControls(fakeRoot(ids), { lesson, onBack: () => calls.push('back-to-shelf'), signal: listeners.signal, caption: () => {} });
  ids['#slReplay'].click();
  assert.deepEqual(calls, ['replay']);
  listeners.abort();
  for (const control of Object.values(ids)) control.click();
  assert.deepEqual(calls, ['replay'], 'a control on a disposed lesson still acted');
});

/** A media element whose play() answers when the test says, or throws when asked to. */
function fakeAudio() {
  const el = new FakeControl();
  el.plays = [];
  el.pauses = 0;
  el.throwOnPlay = null;
  el.play = () => {
    if (el.throwOnPlay) throw el.throwOnPlay;
    const d = deferred(); el.plays.push(d); return d.promise;
  };
  el.pause = () => { el.pauses += 1; };
  Object.defineProperty(el, 'src', { set(v) { el.setAttribute('src', v); }, get() { return el.getAttribute('src'); } });
  el.removeAttribute = (k) => el.attrs.delete(k);
  el.load = () => {};
  el.remove = () => { el.removed = true; };
  return el;
}
const voiceOver = (el, resolve = (ref) => `https://course.test/${ref}`) => createLessonVoice({ doc: { createElement: () => el }, resolve });

test('a recording that neither ends nor fails is not waited on for ever', async (t) => {
  // THE STATE THAT HUNG THE LESSON, measured on CI 2026-10-06 and reproduced here: `play()` resolved,
  // `paused` false, `readyState` 2, `currentTime` 0, `error` null. The element believes it is playing,
  // so no `ended` and no `error` will ever come — and `speak` settles on exactly those three things.
  // The lesson waited for ever, with no problem shown, no progress, and a Play button already pressed.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const el = fakeAudio();
  el.paused = false;
  el.currentTime = 0;
  const voice = voiceOver(el);
  const said = voice.speak('a.m4a');
  el.plays[0].resolve();               // the start succeeded, which is what makes this a stall
  await flush();
  t.mock.timers.tick(9000);
  assert.equal(await said, 'stalled', 'a stalled recording never gave the lesson an answer');
  assert.ok(el.pauses > 0, 'the stalled element was left playing');
});

test('a recording that is making progress, or paused, is left alone', async (t) => {
  // The bound is on PROGRESS, not on length: the watchdog must not cut a recording short just because
  // it is long, and a lesson the child paused is not a lesson that stalled.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const el = fakeAudio();
  el.paused = false;
  el.currentTime = 0;
  const voice = voiceOver(el);
  let result = 'pending';
  voice.speak('a.m4a').then((r) => { result = r; });
  el.plays[0].resolve();
  await flush();
  for (let i = 0; i < 30; i++) { el.currentTime += 0.5; t.mock.timers.tick(1000); }
  await flush();
  assert.equal(result, 'pending', 'a recording that was playing normally was called a stall');

  el.paused = true;
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(result, 'pending', 'a paused lesson was called a stall');
});

test('a play() that throws at once is a recording that failed, by name', async () => {
  const el = fakeAudio();
  el.throwOnPlay = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
  assert.equal(await voiceOver(el).speak('a.m4a'), 'NotAllowedError');
});

test('a replacement the course door refuses stops the recording it replaces', async () => {
  const el = fakeAudio();
  const voice = voiceOver(el, (ref) => (ref === 'outside.m4a' ? '' : `https://course.test/${ref}`));
  const first = voice.speak('a.m4a');
  const before = el.pauses;
  assert.equal(await voice.speak('outside.m4a'), 'refused');
  assert.equal(await first, 'stopped');
  assert.ok(el.pauses > before, 'the replaced recording was reported stopped and left playing');
});

test("an old recording's late rejection cannot end the recording that replaced it", async () => {
  const el = fakeAudio();
  const voice = voiceOver(el);
  const first = voice.speak('a.m4a');
  let second = 'pending';
  voice.speak('b.m4a').then((r) => { second = r; });
  assert.equal(await first, 'stopped');
  el.plays[0].resolve(Promise.reject(Object.assign(new Error('late'), { name: 'AbortError' })));
  await flush();
  assert.equal(second, 'pending', "the replaced recording's rejection ended the new one");
});

test('a resume the platform refuses ends the recording it was continuing, with that refusal', async () => {
  const el = fakeAudio();
  const voice = voiceOver(el);
  const spoken = voice.speak('a.m4a');
  el.plays[0].resolve(undefined);        // it started
  await flush();
  voice.pause();
  voice.resume();
  el.plays[1].resolve(Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })));
  assert.equal(await spoken, 'NotAllowedError');
});

test('disposal during a pending recording ends it and leaves nothing listening', async () => {
  const el = fakeAudio();
  const voice = voiceOver(el);
  const spoken = voice.speak('a.m4a');
  voice.dispose();
  assert.equal(await spoken, 'stopped');
  assert.equal(el.removed, true);
  assert.equal(el.getAttribute('src'), null, 'the source was left set');
});

// A lesson's figure on screen (the `number` cue), and the count-up it may ask for. The figure this exists
// for is twenty digits long, so every value is held as a BigInt: a float loses the last five, which are the
// ones a child is being shown.
/** A slot whose frames a test drives by hand, and a clock it moves itself. */
function numberSlot({ reduced = false } = {}) {
  const el = { hidden: true, textContent: '' };
  const frames = [];
  let at = 0;
  const slot = createNumberSlot(el, {
    frame: (fn) => frames.push(fn),
    now: () => at,
    reducedMotion: () => reduced,
  });
  return { el, slot, frames, run: (ms) => { at = ms; const due = frames.splice(0, frames.length); for (const fn of due) fn(); } };
}

test('a figure counts up to itself and lands on every digit', () => {
  const { el, slot, run } = numberSlot();
  slot.show('43,252,003,274,489,856,000', true);
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, '0', 'a count-up that starts at its answer is not a count-up');
  run(COUNT_MS / 2);
  const half = BigInt(el.textContent.replaceAll(',', ''));
  assert.ok(half > 0n && half < 43252003274489856000n, `mid-roll it showed ${el.textContent}`);
  assert.match(el.textContent, /^\d{1,3}(,\d{3})*$/, 'the rolling figure lost its grouping');
  run(COUNT_MS);
  assert.equal(el.textContent, '43,252,003,274,489,856,000', 'the count did not land on the figure');
  run(COUNT_MS + 1000);
  assert.equal(el.textContent, '43,252,003,274,489,856,000', 'it kept counting past its own end');
});

test('a small figure, and reduced motion, are shown rather than counted to', () => {
  const small = numberSlot();
  small.slot.show('8', true);
  assert.equal(small.el.textContent, '8', 'counting to eight is a slot machine announcing the number six');
  assert.equal(small.frames.length, 0);

  const still = numberSlot({ reduced: true });
  still.slot.show('43,252,003,274,489,856,000', true);
  assert.equal(still.el.textContent, '43,252,003,274,489,856,000');
  assert.equal(still.frames.length, 0, 'reduced motion still booked a frame');
});

test('however a lesson writes its digits, the figure reads the same', () => {
  const grouped = numberSlot();
  grouped.slot.show('43,252,003,274,489,856,000');
  const bare = numberSlot();
  bare.slot.show('43252003274489856000');
  assert.equal(bare.el.textContent, grouped.el.textContent);
  assert.equal(groupDigits('1234567'), '1,234,567');
});

test('a figure replaced mid-count drops the count, and a cleared one hides the slot', () => {
  const { el, slot, run } = numberSlot();
  slot.show('43,252,003,274,489,856,000', true);
  run(COUNT_MS / 4);
  slot.show('20');
  assert.equal(el.textContent, '20');
  run(COUNT_MS);   // the dropped roll's frames must write nothing
  assert.equal(el.textContent, '20', 'a superseded count-up went on writing');

  slot.show(null);
  assert.equal(el.hidden, true, 'a lesson that cleared its figure still shows one');
});

test('a count-up stopped with the view writes nothing more', () => {
  const { el, slot, run } = numberSlot();
  slot.show('43,252,003,274,489,856,000', true);
  slot.stop();
  run(COUNT_MS);
  assert.equal(el.textContent, '0', 'a stopped count-up kept writing to a view that had gone');
});

// Found by playing the real lesson in a browser: a painter repaints on every change a lesson makes, and a
// cue stays in force across all of them — so a figure was counted up again in the middle of the lesson,
// twice, long after it had landed.
test('a figure already on show is not counted up again by the next repaint', () => {
  const { el, slot, run, frames } = numberSlot();
  slot.show('43,252,003,274,489,856,000', true);
  run(COUNT_MS);
  assert.equal(el.textContent, '43,252,003,274,489,856,000');
  const booked = frames.length;
  for (let repaint = 0; repaint < 5; repaint++) slot.show('43,252,003,274,489,856,000', true);
  assert.equal(frames.length, booked, 'a repaint booked another count-up');
  assert.equal(el.textContent, '43,252,003,274,489,856,000', 'a repaint restarted the figure at zero');
  // A figure cleared and asked for again is a new one, and counts.
  slot.show(null);
  slot.show('43,252,003,274,489,856,000', true);
  assert.equal(el.textContent, '0', 'a figure shown again after being cleared did not count up');
});

// A picture or a clip where the cube is (ADR 0007). The browser suite mounts it for real; these are the
// rules a happy path does not show: a clip is silent, reduced motion stands it still, and a file the course
// door refuses is SAID rather than left as a blank panel.
/** A layer whose children a test can read, and elements that record what was set on them. */
function mediaSlot({ reduced = false, resolve = (ref) => `/course/${ref}` } = {}) {
  const made = [];
  const doc = {
    createElement(tag) {
      const node = {
        tag, style: {}, listeners: {}, played: 0, paused: 0, attrs: new Map(), parent: null,
        addEventListener(type, fn) { node.listeners[type] = fn; },
        removeEventListener() {},
        setAttribute(k, v) { node.attrs.set(k, v); },
        remove() { node.parent = null; },
        play() { node.played += 1; return Promise.resolve(); },
        pause() { node.paused += 1; },
      };
      made.push(node);
      return node;
    },
  };
  const el = { hidden: true, children: [], appendChild(n) { n.parent = el; el.children.push(n); } };
  const failures = [];
  const slot = createMediaSlot(el, { doc, resolve, reducedMotion: () => reduced, onFail: (f) => failures.push(f) });
  return { slot, el, made, failures, last: () => made.at(-1) };
}

test('a picture is shown with the words that describe it, and taken down when it is cleared', () => {
  const m = mediaSlot();
  m.slot.show({ kind: 'image', src: 'media/box.jpg', alt: 'A plain blue box' });
  assert.equal(m.el.hidden, false);
  assert.equal(m.last().tag, 'img');
  assert.equal(m.last().src, '/course/media/box.jpg');
  assert.equal(m.last().alt, 'A plain blue box');

  // The same picture again is the same picture: a repaint must not rebuild it (and restart a clip).
  const built = m.made.length;
  m.slot.show({ kind: 'image', src: 'media/box.jpg', alt: 'A plain blue box' });
  assert.equal(m.made.length, built, 'a repaint built the picture again');

  m.slot.show(null);
  assert.equal(m.el.hidden, true, 'the cube never came back');
});

test('a clip is silent, looping and inline, and starts by itself', () => {
  const m = mediaSlot();
  m.slot.show({ kind: 'clip', src: 'media/turning.mp4', alt: 'A hand turning a cube' });
  const clip = m.last();
  assert.equal(clip.tag, 'video');
  assert.equal(clip.muted, true, 'a clip with sound would talk over the narration');
  assert.equal(clip.loop, true);
  assert.equal(clip.playsInline, true);
  assert.equal(clip.autoplay, true);
  assert.equal(clip.attrs.get('aria-label'), 'A hand turning a cube');
  assert.equal(clip.played, 1);
});

test('reduced motion leaves a clip standing still at its first frame', () => {
  const m = mediaSlot({ reduced: true });
  m.slot.show({ kind: 'clip', src: 'media/turning.mp4', alt: 'A hand turning a cube' });
  assert.equal(m.last().autoplay, false);
  assert.equal(m.last().played, 0, 'reduced motion still started the clip');
});

test('a clip that goes away is stopped, not merely dropped', () => {
  const m = mediaSlot();
  m.slot.show({ kind: 'clip', src: 'media/turning.mp4', alt: 'A hand turning a cube' });
  const clip = m.last();
  m.slot.show(null);
  assert.equal(clip.paused, 1, 'a clip went on playing into a view that had gone');
  assert.equal(m.el.hidden, true);
});

test('a file the course door refuses is said, and nothing is drawn over the cube', () => {
  const m = mediaSlot({ resolve: () => '' });
  m.slot.show({ kind: 'image', src: '../outside.jpg', alt: 'Something outside the course' });
  assert.equal(m.el.hidden, true, 'a refused picture left a blank panel over the cube');
  assert.deepEqual(m.failures, [{ kind: 'image', src: '../outside.jpg', reason: 'refused' }]);
});

test('a picture that will not load is said too', () => {
  const m = mediaSlot();
  m.slot.show({ kind: 'image', src: 'media/missing.jpg', alt: 'A picture that is not there' });
  m.last().listeners.error();
  assert.deepEqual(m.failures, [{ kind: 'image', src: 'media/missing.jpg', reason: 'unreadable' }]);
});
