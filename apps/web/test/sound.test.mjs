// The app's sounds (lib/sound.js), against the shared stand-in AudioContext (test/sound-stand-ins.mjs
// — happy-dom has none, and the real one's unlock is asked of a real engine in test/browser/sound.test.mjs).
//
// What is held here is the contract the scan's chime rests on: no sound before a gesture has unlocked
// audio (and none queued to burst out after it), none while sounds are off, every note stopped when a
// screen is left, a note that ended on its own forgotten rather than stopped again, and an unknown
// sound refused rather than silently skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioStandIn } from './sound-stand-ins.mjs';

// app-settings reads localStorage at import; a stand-in store is enough for it.
const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
};
const { settings } = await import('../lib/app-settings.js');
const { audioState, play, stopAll, unlockOnGestures, useAudioContextFactory } = await import('../lib/sound.js');

/** A page to gesture on. */
const page = () => new EventTarget();

test('no sound before a gesture, and none saved up for after it', () => {
  const { ctx } = audioStandIn();
  useAudioContextFactory(() => ctx);
  settings.sounds = true;
  const target = page();
  unlockOnGestures(target);
  assert.equal(audioState(), 'none');
  assert.equal(play('capture'), false, 'a sound was made before any gesture');
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(ctx.resumed, 1, 'the first gesture did not start audio');
  assert.equal(audioState(), 'running');
  assert.equal(ctx.made.length, 0, 'the sound asked for before the gesture was kept and played late');
  target.dispatchEvent(new Event('keydown'));
  assert.equal(ctx.resumed, 1, 'audio already running was resumed again by the next gesture');
});

test('each sound is its own rising notes; sounds off makes none; a left screen silences what still sounds', () => {
  const { ctx } = audioStandIn();
  useAudioContextFactory(() => ctx);
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  settings.sounds = true;
  assert.equal(play('capture'), true);
  const capture = ctx.made.map((o) => ({ hz: o.frequency.value, at: o.started }));
  assert.equal(capture.length, 2, 'the capture chime is two notes');
  assert.equal(play('done'), true);
  const done = ctx.made.slice(2).map((o) => ({ hz: o.frequency.value, at: o.started }));
  assert.equal(done.length, 4, 'the checked-out sound is four more');
  // Each sound is its own: both rise, both are played one note after another, and they do not begin
  // alike — comparing the two lists as wholes passes on their different LENGTHS alone (audit, 2026-09-19).
  for (const [name, notes] of [['capture', capture], ['done', done]]) {
    for (let i = 1; i < notes.length; i++) {
      assert.ok(notes[i].hz > notes[i - 1].hz, `${name} note ${i} does not rise`);
      assert.ok(notes[i].at > notes[i - 1].at, `${name} note ${i} does not follow the one before it`);
    }
  }
  assert.notEqual(done[0].hz, capture[0].hz, 'the two sounds begin on the same note');
  assert.notDeepEqual(done.slice(0, 2).map((n) => n.hz), capture.map((n) => n.hz),
    'the checked-out sound opens with the capture chime');
  stopAll();
  assert.ok(ctx.made.every((o) => o.stops.length === 2), 'a note still sounding was not stopped');
  settings.sounds = false;
  assert.equal(play('capture'), false, 'a sound was made with sounds off');
  assert.equal(ctx.made.length, 6);
  settings.sounds = true;
  assert.throws(() => play('fanfare'), /no sound called "fanfare"/);
});

test('a note that ends on its own is forgotten, not stopped a second time later', () => {
  // The oscillators a sound made are held only until they end; a leak would have `stopAll()` reaching
  // into nodes the engine has already finished with, for the life of the page (audit, 2026-09-19).
  const { ctx } = audioStandIn();
  useAudioContextFactory(() => ctx);
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  settings.sounds = true;
  assert.equal(play('capture'), true);
  const notes = ctx.made.slice();
  assert.ok(notes.every((o) => typeof o.onended === 'function'), 'a note cannot say when it ended');
  for (const o of notes) o.onended();
  stopAll();
  assert.ok(notes.every((o) => o.stops.length === 1), 'a note that had ended was stopped again');
});

test('a platform with no Web Audio makes no sound and raises nothing', () => {
  useAudioContextFactory(() => null);
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(audioState(), 'none');
  assert.equal(play('capture'), false);
});

test('a refused first resume is tried again on the next gesture, and a context suspended later is woken', async () => {
  // Unlocking is not one-shot (audit, 2026-09-19): a platform can refuse the first resume, and a
  // phone suspends audio behind a call or a backgrounded page — the next touch wakes it.
  let refuse = true;
  const { ctx } = audioStandIn();
  ctx.resume = () => {
    ctx.resumed += 1;
    if (refuse) return Promise.reject(new Error('not allowed'));
    ctx.state = 'running';
    return Promise.resolve();
  };
  useAudioContextFactory(() => ctx);
  settings.sounds = true;
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(audioState(), 'suspended');
  assert.equal(play('capture'), false);
  refuse = false;
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(audioState(), 'running', 'a refused first resume was never tried again');
  ctx.state = 'suspended'; // the platform suspends it
  target.dispatchEvent(new Event('touchend'));
  assert.equal(audioState(), 'running', 'a context suspended later stayed silent');
  assert.equal(ctx.resumed, 3);
});

test('waking a context suspended mid-chime does not play the rest of the chime', () => {
  // A suspended context keeps its notes scheduled; resuming it would play their tails for a moment
  // that has passed (round-3 audit). They are stopped BEFORE the resume.
  const { ctx } = audioStandIn();
  useAudioContextFactory(() => ctx);
  settings.sounds = true;
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(play('done'), true);
  const notes = ctx.made.slice();
  ctx.state = 'suspended'; // the page went to the background mid-chime
  const stoppedAtResume = [];
  const resume = ctx.resume;
  ctx.resume = () => { stoppedAtResume.push(notes.every((o) => o.stops.length === 2)); return resume(); };
  target.dispatchEvent(new Event('pointerdown'));
  assert.deepEqual(stoppedAtResume, [true], 'a note scheduled before the suspension was still due when audio woke');
  assert.equal(audioState(), 'running');
});
