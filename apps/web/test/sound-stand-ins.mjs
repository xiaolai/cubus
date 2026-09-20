// Stand-ins for the platform's sound and voice — the ONE pair every node suite uses (happy-dom has
// neither). Between them they record exactly what the app's sounds and lines are asserted on: every
// note made, when it was started and every time it was stopped; every line said, in which language,
// and which line was being said at each cut-off. One implementation of each, because two fakes of one
// platform API drift apart and then two suites disagree about what the platform does (audit,
// 2026-09-19).

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
    state, currentTime: 0, destination: {}, resumed: 0, made, gains,
    resume() { ctx.resumed += 1; ctx.state = 'running'; return Promise.resolve(); },
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
 * A speech engine for `useSpeechEngine`. `log` is every call in order (`['speak', text, lang]`,
 * `['cancel']`), `said` the lines alone, `cuts` the line being said at each cancel (null when the
 * platform was already silent), and `fail(error)` has the platform fail the line under way — as its
 * `error` event would — or a named earlier one, for a failure that arrives after its line was replaced.
 */
export function speechStandIn() {
  const log = [];
  const said = [];
  const cuts = [];
  const utterances = [];
  /** The line the platform is saying, as it sees it: set by `speak`, cleared by `cancel` and by a failure. */
  let speaking = null;
  // An EventTarget, because that is what a platform utterance is: the app listens for `error` rather
  // than assigning `onerror`, which anything else touching the utterance could replace (2026-09-19).
  class Utterance extends EventTarget {
    constructor(text) {
      super();
      this.text = text;
    }
  }
  const synth = {
    speak: (u) => { utterances.push(u); said.push(u.text); speaking = u; log.push(['speak', u.text, u.lang]); },
    cancel: () => { cuts.push(speaking?.text ?? null); speaking = null; log.push(['cancel']); },
  };
  const fail = (error, utterance = speaking) => {
    if (!utterance) throw new Error('speechStandIn: no line is being said, so none can fail');
    if (utterance === speaking) speaking = null;
    utterance.dispatchEvent(Object.assign(new Event('error'), { error }));
  };
  /** The platform finished saying a line. Nothing is being said afterwards, so a cancel that follows
   *  is attributed to no line — a finished line is not one anybody cut off (audit, 2026-09-19). */
  const finish = (utterance = speaking) => {
    if (!utterance) throw new Error('speechStandIn: no line is being said, so none can finish');
    if (utterance === speaking) speaking = null;
    utterance.dispatchEvent(new Event('end'));
  };
  return { log, said, cuts, utterances, fail, finish, make: () => ({ synth, Utterance }) };
}

/**
 * Install both stand-ins over the app's platform seams, and hand back what they record and a way to
 * put back what was there.
 *
 * Every suite that drives the scan's sounds needs the same four lines and the same teardown, and each
 * writing its own is how one of them came to leave the next suite a platform with no audio at all
 * (audit, 2026-09-19). The gesture that unlocks audio stays with the caller: it belongs to the
 * caller's own document.
 *
 * @param {object} deps the `lib/sound.js` and `lib/speech.js` modules, the `settings` object, and
 *   `soundMode` for this test — 'voice' (bell and words), 'chime' (bell alone) or 'off'.
 */
export function installSoundStandIns({ sound, speech, settings, soundMode = 'voice' }) {
  // A typo, or the boolean this replaced, would otherwise install a configuration the app cannot be
  // in — chimes on and speech off, or both off while the caller believed otherwise — and the test
  // would pass for the wrong reason (audit, 2026-09-20).
  if (!['voice', 'chime', 'off'].includes(soundMode)) {
    throw new TypeError(`installSoundStandIns: soundMode ${JSON.stringify(soundMode)} is not voice, chime or off`);
  }
  const { ctx, made } = audioStandIn();
  const voice = speechStandIn();
  const wasAudio = sound.useAudioContextFactory(() => ctx);
  const wasVoice = speech.useSpeechEngine(voice.make);
  const wasMode = settings.soundMode;
  settings.soundMode = soundMode;
  return {
    ctx,
    made,
    voice,
    restore() {
      settings.soundMode = wasMode;
      sound.useAudioContextFactory(wasAudio);
      speech.useSpeechEngine(wasVoice);
    },
  };
}

