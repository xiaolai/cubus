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
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const ctx = {
    state, currentTime: 0, destination: {}, resumed: 0, made,
    resume() { ctx.resumed += 1; ctx.state = 'running'; return Promise.resolve(); },
    createGain: () => ({ gain: param(), connect: (to) => to }),
    createOscillator() {
      // `stops` holds the time each stop was asked for — `undefined` for "now", which is what
      // `stopAll()` asks: a note scheduled to end and a note cut short are not the same event.
      const osc = {
        type: '', frequency: param(), started: null, stops: [], onended: null,
        connect: (to) => to, start(t) { osc.started = t; }, stop(t) { osc.stops.push(t); },
      };
      made.push(osc);
      return osc;
    },
  };
  return { ctx, made };
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
 *   whether sounds are on for this test.
 */
export function installSoundStandIns({ sound, speech, settings, sounds = true }) {
  const { ctx, made } = audioStandIn();
  const voice = speechStandIn();
  const wasAudio = sound.useAudioContextFactory(() => ctx);
  const wasVoice = speech.useSpeechEngine(voice.make);
  const wasSounds = settings.sounds;
  settings.sounds = sounds;
  return {
    ctx,
    made,
    voice,
    restore() {
      settings.sounds = wasSounds;
      sound.useAudioContextFactory(wasAudio);
      speech.useSpeechEngine(wasVoice);
    },
  };
}

