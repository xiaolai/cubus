// The clock a narrated episode runs on, driven deterministically.
//
// The property behind most of these: **a scrub is a seek, never a paint.** `lesson-player.js`
// animates a turn only when the cube is exactly one behind (`ONE_BEHIND`), so dragging across a
// minute of lesson has to place the cube without animating everything in between. A version of this
// file that only checked "the cube ends up in the right place" would pass against a scrub that ran
// the whole backlog as an animation — which is the failure worth pinning.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createEpisodeAudio, parkedAudio, releaseParkedAudio } from '../lib/episode-audio.js';

/**
 * A media element with the surface this module touches — and with the BEHAVIOUR that surface has.
 *
 * The first version of this fake was more forgiving than a real element, which is the most
 * dangerous kind of fake: `src` was an inert property, so assigning it did not reload or reset the
 * position. An audit mutated the production guard away — the one that avoids re-assigning the same
 * source — and all seventeen cases still passed. A fake that cannot express the failure is a test
 * that reports safety which is not there.
 *
 * So `src` is an accessor here: assigning a DIFFERENT source loads and resets, exactly as the media
 * element does, and assigning the same one is still a load — which is why production must not do it.
 */
function fakeAudio() {
  const listeners = new Map();
  let source = '';
  return {
    preload: '',
    currentTime: 0,
    duration: NaN,
    paused: true,
    ended: false,
    played: 0,
    removed: 0,
    loaded: 0,
    get src() { return source; },
    set src(value) {
      source = value;
      // Assigning `src` at all begins a load and drops the position — including when the value is
      // the one already there. That is the whole reason the production path checks first.
      this.loaded += 1;
      this.currentTime = 0;
    },
    addEventListener(type, fn) { (listeners.get(type) ?? listeners.set(type, []).get(type)).push(fn); },
    removeEventListener(type, fn) {
      const fns = listeners.get(type) ?? [];
      const i = fns.indexOf(fn);
      if (i >= 0) fns.splice(i, 1);
    },
    emit(type) { for (const fn of [...(listeners.get(type) ?? [])]) fn(); },
    count(type) { return (listeners.get(type) ?? []).length; },
    /** Every listener still attached, of any type — so "all of them" can actually be asserted. */
    totalListeners() { return [...listeners.values()].reduce((n, fns) => n + fns.length, 0); },
    listenerTypes() { return [...listeners.entries()].filter(([, fns]) => fns.length).map(([type]) => type); },
    async play() { this.played += 1; this.paused = false; this.emit('play'); },
    pause() { this.paused = true; this.emit('pause'); },
    // `load()` resets the playback position, as a real media element does.
    load() { this.loaded += 1; this.currentTime = 0; },
    getAttribute(name) { return name === 'src' ? (source || null) : null; },
    removeAttribute() { source = ''; },
    remove() { this.removed += 1; },
  };
}

/** A player that records what it was asked to do, in order. */
function fakePlayer() {
  const calls = [];
  return {
    calls,
    paint: (t) => calls.push(['paint', t]),
    seek: (t) => calls.push(['seek', t]),
  };
}

/**
 * A frame scheduler a test drives by hand: nothing runs until `step()` is called.
 *
 * Callbacks are kept BY ID, and `cancelFrame` cancels only the matching request. The first version
 * held one callback and ignored the id entirely — so an audit replaced the production cancellation
 * with `cancelFrame(-12345)` and all seventeen cases passed. Cancelling the wrong request is
 * precisely the defect this fake exists to expose.
 */
function manualFrames() {
  const queued = new Map();
  let id = 0;
  return {
    frame: (fn) => { id += 1; queued.set(id, fn); return id; },
    cancelFrame: (which) => { queued.delete(which); },
    /** Run every callback scheduled for this frame, as a real scheduler does. */
    step(n = 1) {
      for (let i = 0; i < n; i += 1) {
        const due = [...queued.entries()];
        queued.clear();
        for (const [, fn] of due) fn();
      }
    },
    get pending() { return queued.size > 0; },
    get pendingCount() { return queued.size; },
  };
}

test.beforeEach(() => releaseParkedAudio());

test('playing paints every frame from the audio clock', () => {
  const el = fakeAudio();
  const player = fakePlayer();
  const frames = manualFrames();
  const audio = createEpisodeAudio({ player, el, ...frames });

  audio.play();
  el.currentTime = 0.5;
  frames.step();
  el.currentTime = 1.25;
  frames.step();

  // Every entry is a PAINT — the ordinary playing path animates, and the times are the audio's.
  assert.deepEqual(player.calls, [['paint', 0], ['paint', 0.5], ['paint', 1.25]]);
  audio.dispose();
});

test('a scrub seeks, and never paints its way there', () => {
  const el = fakeAudio();
  const player = fakePlayer();
  const audio = createEpisodeAudio({ player, el, ...manualFrames() });

  audio.seek(90);

  // THE CASE THIS FILE EXISTS FOR. Ninety seconds of lesson is many turns; if this were a paint,
  // `lesson-player.js` would be more than one behind and the cube would run the backlog.
  assert.deepEqual(player.calls, [['seek', 90]]);
  assert.equal(el.currentTime, 90);
  assert.ok(!player.calls.some(([kind]) => kind === 'paint'), 'a scrub must not paint');
  audio.dispose();
});

test('a seek made by the element itself is placed the same way', () => {
  const el = fakeAudio();
  const player = fakePlayer();
  const audio = createEpisodeAudio({ player, el, ...manualFrames() });

  // The native control, a section press, a finger on the system scrubber.
  el.currentTime = 42;
  el.emit('seeked');

  assert.deepEqual(player.calls, [['seek', 42]]);
  audio.dispose();
});

test('a nonsense time is not passed on', () => {
  const el = fakeAudio();
  const player = fakePlayer();
  const audio = createEpisodeAudio({ player, el, ...manualFrames() });

  audio.seek(-5);
  audio.seek(Number.NaN);

  assert.deepEqual(player.calls, [['seek', 0], ['seek', 0]]);
  audio.dispose();
});

test('pausing stops the loop, and nothing is painted after it', () => {
  const el = fakeAudio();
  const player = fakePlayer();
  const frames = manualFrames();
  const audio = createEpisodeAudio({ player, el, ...frames });

  audio.play();
  frames.step();
  const painted = player.calls.length;
  el.currentTime = 7.5;
  audio.pause();

  assert.ok(!frames.pending, 'a paused episode must not hold a frame');
  // EXACTLY ONE more: the final time. Playback can stop between two animation frames, and anything
  // the schedule reached in that gap would otherwise never be applied — the label reads the end
  // while the cube stands at the previous sample.
  assert.deepEqual(player.calls.slice(painted), [['paint', 7.5]]);
  const afterPause = player.calls.length;
  frames.step(3);
  assert.equal(player.calls.length, afterPause, 'the loop kept painting after the pause');
  audio.dispose();
});

test('disposing stops the audio and takes every listener off it', () => {
  const el = fakeAudio();
  const player = fakePlayer();
  const frames = manualFrames();
  const audio = createEpisodeAudio({ player, el, ...frames });

  audio.play();
  audio.dispose();

  assert.ok(el.paused, 'leaving the screen stops the audio');
  assert.ok(!frames.pending, 'and stops the loop');
  // A re-used element keeps its listeners — the `<cubus-cube>` rule. One left attached would be a
  // dead screen's closure still driving the player it captured.
  //
  // ALL OF THEM, counted — not a list of four types written out by hand. That list silently stopped
  // covering `loadedmetadata` and `durationchange` the moment those were added, so two listeners
  // could outlive every screen and the case named "every listener" would still pass.
  assert.equal(el.totalListeners(), 0, `these listeners outlived the screen: ${el.listenerTypes().join(', ')}`);
  // And a late event from the element reaches nothing.
  const after = player.calls.length;
  el.emit('seeked');
  assert.equal(player.calls.length, after);
});

test('returning does not build a second element', () => {
  const player = fakePlayer();
  const made = [];
  const doc = { createElement: () => { const el = fakeAudio(); made.push(el); return el; } };

  const first = createEpisodeAudio({ player, doc, ...manualFrames() });
  first.dispose();
  assert.equal(parkedAudio(), made[0], 'it is parked for the next mount');

  const second = createEpisodeAudio({ player, doc, ...manualFrames() });
  assert.equal(made.length, 1, 'a second mount built another element');
  assert.equal(second.el, made[0], 'and it is the same one');
  assert.equal(parkedAudio(), null, 'taking it un-parks it');
  second.dispose();
});

test('returning to the SAME lesson keeps its media and its position', () => {
  // This is what parking is FOR. Resetting unconditionally threw away the decoded resource and the
  // listener's position, so stepping out to Settings and back restarted the lesson from zero and
  // re-fetched several MB — the plan's stated rationale, undone by its own implementation.
  const player = fakePlayer();
  const el = fakeAudio();
  const doc = { createElement: () => el };

  const first = createEpisodeAudio({ player, episodeId: '11', src: 'lesson-11.m4a', doc, ...manualFrames() });
  first.el.currentTime = 42;
  first.dispose();
  const loadsAfterFirst = el.loaded; // a fresh element is legitimately reset once

  const again = createEpisodeAudio({ player, episodeId: '11', src: 'lesson-11.m4a', doc, ...manualFrames() });
  assert.equal(again.el, el, 'a different element came back');
  assert.equal(again.el.currentTime, 42, 'the position was thrown away');
  assert.equal(el.loaded, loadsAfterFirst, 'the media was reloaded for the lesson it already held');
  again.dispose();
});

test('a DIFFERENT lesson resets the element it inherits', () => {
  const player = fakePlayer();
  const el = fakeAudio();
  const doc = { createElement: () => el };

  createEpisodeAudio({ player, episodeId: '11', src: 'lesson-11.m4a', doc, ...manualFrames() }).dispose();
  const before = el.loaded;
  const next = createEpisodeAudio({ player, episodeId: '12', src: 'lesson-12.m4a', doc, ...manualFrames() });
  assert.ok(el.loaded > before, 'a different lesson must reset the element it inherits');
  assert.equal(next.el.src, 'lesson-12.m4a');
  next.dispose();
});

test('a DIFFERENT lesson sharing one audio file does not inherit its position', () => {
  // Parking keyed on the media alone, so two lessons that legitimately share a file were the same
  // lesson to it: leaving A at eight seconds and opening B started B eight seconds in, with its
  // cube already past the beginning. The key is the lesson AND the media.
  const player = fakePlayer();
  const el = fakeAudio();
  const doc = { createElement: () => el };

  const a = createEpisodeAudio({ player, episodeId: 'lesson-a', src: 'shared.m4a', doc, ...manualFrames() });
  a.el.currentTime = 8;
  a.dispose();

  const b = createEpisodeAudio({ player, episodeId: 'lesson-b', src: 'shared.m4a', doc, ...manualFrames() });
  assert.equal(b.el.currentTime, 0, 'a different lesson started part-way through');
  b.dispose();
});

test('a re-used element comes back carrying nothing of the last lesson', () => {
  const player = fakePlayer();
  const el = fakeAudio();
  el.src = 'lesson-11.m4a';
  const doc = { createElement: () => el };

  createEpisodeAudio({ player, doc, ...manualFrames() }).dispose();
  const next = createEpisodeAudio({ player, doc, ...manualFrames() });

  assert.equal(next.el.src, '', 'the previous media was still attached');
  assert.ok(el.loaded >= 1, 'the element was reset, not merely blanked');
  next.dispose();
});

test('an element that will not reset is replaced rather than re-used', () => {
  const player = fakePlayer();
  const bad = fakeAudio();
  bad.load = () => { throw new Error('this element is wedged'); };
  const good = fakeAudio();
  let handed = 0;
  const doc = { createElement: () => (handed++ === 0 ? bad : good) };

  createEpisodeAudio({ player, doc, ...manualFrames() }).dispose();
  const next = createEpisodeAudio({ player, doc, ...manualFrames() });

  assert.equal(next.el, good, 'a wedged element must not be handed to the next lesson');
  next.dispose();
});

test('the view reports what is known and refuses to invent a total', () => {
  const el = fakeAudio();
  const audio = createEpisodeAudio({ player: fakePlayer(), el, ...manualFrames() });

  // `duration` is NaN until metadata loads. NaN is not a number to show anybody.
  assert.deepEqual(audio.view(), { playing: false, at: 0, total: null });

  el.duration = 431.5;
  el.currentTime = 12;
  el.paused = false;
  assert.deepEqual(audio.view(), { playing: true, at: 12, total: 431.5 });
  audio.dispose();
});

test('a refused play is reported rather than swallowed', async () => {
  const el = fakeAudio();
  el.play = async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }); };
  const audio = createEpisodeAudio({ player: fakePlayer(), el, ...manualFrames() });

  // A browser may refuse without a gesture. The screen has to know, or it shows a playing state
  // over an element that never started — and it has to know WHICH refusal: a policy refusal is
  // answered by pressing again, a file that cannot be decoded never will be, and returning a bare
  // `false` made those the same sentence.
  assert.equal(await audio.play(), 'NotAllowedError');
  audio.dispose();
});

test('a file that will never play is not reported as a policy refusal', async () => {
  const el = fakeAudio();
  el.play = async () => { throw Object.assign(new Error('bad codec'), { name: 'NotSupportedError' }); };
  const audio = createEpisodeAudio({ player: fakePlayer(), el, ...manualFrames() });
  assert.equal(await audio.play(), 'NotSupportedError');
  audio.dispose();
});

test('a duration learned from metadata reaches the view', () => {
  // With autoplay deliberately off, nothing else touches the view between mount and the first
  // press — so without this the total stayed an em dash with the real number on the element.
  const el = fakeAudio();
  const seen = [];
  const audio = createEpisodeAudio({ player: fakePlayer(), el, onChange: (v) => seen.push(v.total), ...manualFrames() });
  assert.equal(audio.view().total, null);
  el.duration = 443;
  el.emit('loadedmetadata');
  assert.equal(seen.at(-1), 443, 'the view was never told the duration');
  audio.dispose();
});

test('it refuses a player it cannot drive', () => {
  assert.throws(() => createEpisodeAudio({ el: fakeAudio() }), /needs a player/);
  assert.throws(() => createEpisodeAudio({ player: { paint() {} }, el: fakeAudio() }), /needs a player/);
});
