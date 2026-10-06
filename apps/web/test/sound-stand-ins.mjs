// A stand-in for the platform's audio — the ONE every node suite uses (happy-dom has none). It
// records exactly what the app's sounds are asserted on: every note made, when it was started,
// every time it was stopped, and whether each reaches the destination through a gain that was
// actually opened. ONE implementation, because two fakes of one platform API drift apart and then
// two suites disagree about what the platform does (audit, 2026-09-19).
//
// There were two until 2026-09-30: the scan read eleven lines aloud through `speechSynthesis` and
// this stood in for that too. The spoken prompts are gone — a sound per state replaced them — so
// there is one platform left to imitate.

/**
 * An AudioContext. Suspended until a gesture resumes it, as a real one is, and counting its resumes;
 * `made` lists every oscillator it made, in order. A test that needs a refused resume replaces
 * `ctx.resume` — everything else here is the platform's own shape.
 */
export function audioStandIn({ state = 'suspended' } = {}) {
  const made = [];
  const gains = [];
  // EVERY ENVELOPE CALL IS KEPT (audit, 2026-09-20). The old param discarded them, so a chime whose
  // gain never rose above zero — audible to nobody — passed every assertion about "a sound was made".
  // `ops` is what was asked of the param, in order; `peak` is the loudest value it was ever given.
  const param = () => {
    const ops = [];
    const self = {
      value: 0,
      ops,
      get peak() {
        return ops.reduce((hi, [, v]) => Math.max(hi, v), 0);
      },
      /** Where the envelope ENDS — the value it was last asked to reach. */
      get last() {
        return ops.length ? ops[ops.length - 1][1] : 0;
      },
      /** Whether it rose above where it ends. `peak > 0` is not enough: a note decays TOWARDS a
       *  small positive value (an exponential ramp cannot reach zero), so a gain that never opened
       *  still had a peak above zero and passed (mutation-checked, 2026-09-20). */
      get opens() {
        return self.peak > self.last;
      },
      setValueAtTime(v, t) { ops.push(['set', v, t]); self.value = v; return self; },
      linearRampToValueAtTime(v, t) { ops.push(['linear', v, t]); return self; },
      exponentialRampToValueAtTime(v, t) { ops.push(['exp', v, t]); return self; },
    };
    return self;
  };
  const ctx = {
    state, currentTime: 0, destination: {}, resumed: 0, suspended: 0, made, gains,
    /**
     * Move the clock on, as a running context's does.
     *
     * A FIXED `currentTime` IS AN UNFAITHFUL FAKE, and it hid a whole class: `lib/sound.js` decides
     * whether a scheduled note's moment has passed by asking whether the clock has moved since it
     * was scheduled, which on a stand-in frozen at 0 is never. A wrong answer there is a chime cut
     * before it sounds, or a tail played into the next screen (verify, 2026-09-29). Kept at 0 by
     * default so every existing case still reads note offsets against a known origin.
     */
    advance(seconds) { ctx.currentTime += seconds; return ctx; },
    resume() { ctx.resumed += 1; ctx.state = 'running'; return Promise.resolve(); },
    /** Counted as well as performed: the app suspends when nothing is playing, and "it suspended"
     *  and "it suspended once" are different claims. */
    suspend() { ctx.suspended += 1; ctx.state = 'suspended'; return Promise.resolve(); },
    createGain() {
      // `into` records the graph: a note connected nowhere reaches no speaker, and a fake that
      // returned its argument without noting it could not tell the difference.
      const node = { gain: param(), into: [], connect(to) { node.into.push(to); return to; } };
      gains.push(node);
      return node;
    },
    createOscillator() {
      // `stops` holds the time each stop was asked for — `undefined` for "now", which is what
      // `stopAll()` asks: a note scheduled to end and a note cut short are not the same event.
      const osc = {
        type: '', frequency: param(), started: null, stops: [], onended: null, into: [],
        connect(to) { osc.into.push(to); return to; },
        start(t) { osc.started = t; },
        stop(t) { osc.stops.push(t); },
      };
      made.push(osc);
      return osc;
    },
  };
  /** Whether every note made reaches the destination through a gain that was actually opened —
   *  the audible path, which "an oscillator exists" does not establish. */
  const audible = () =>
    made.length > 0 &&
    made.every((osc) => {
      const gain = osc.into.find((node) => gains.includes(node));
      return Boolean(gain) && gain.into.includes(ctx.destination) && gain.gain.opens;
    });
  return { ctx, made, gains, audible };
}

/**
 * Install the audio stand-in over the app's platform seam, and hand back what it records and a way
 * to put back what was there.
 *
 * Every suite that drives the scan's sounds needs the same lines and the same teardown, and each
 * writing its own is how one of them came to leave the next suite a platform with no audio at all
 * (audit, 2026-09-19).
 *
 * THE SPEECH HALF IS GONE (owner, 2026-09-30). This installed a speech engine too, because the
 * scan read eleven lines aloud; the spoken prompts were judged worse than nothing and replaced by
 * a sound per state, so there is one platform left to stand in for. The gesture that unlocks audio
 * stays with the caller: it belongs to the caller's own document.
 *
 * @param {object} deps the `lib/sound.js` module, the `settings` object, and `soundMode` for this
 *   test — 'chime' (sounds) or 'off'.
 */
export function installSoundStandIns({ sound, settings, soundMode = 'chime' }) {
  // A typo, or the `voice` that no longer exists, would otherwise install a configuration the app
  // cannot be in and the test would pass for the wrong reason (audit, 2026-09-20).
  if (!['chime', 'off'].includes(soundMode)) {
    throw new TypeError(`installSoundStandIns: soundMode ${JSON.stringify(soundMode)} is not chime or off`);
  }
  const { ctx, made, audible } = audioStandIn();
  const wasAudio = sound.useAudioContextFactory(() => ctx);
  const wasMode = settings.soundMode;
  settings.soundMode = soundMode;
  return {
    ctx,
    made,
    audible,
    restore() {
      settings.soundMode = wasMode;
      sound.useAudioContextFactory(wasAudio);
    },
  };
}
