// The clock a narrated episode runs on: one `<audio>`, and the loop that turns its time into a cube.
//
// `lesson-player.js` deliberately owns no clock — "the caller supplies `t` … which is what makes
// playing, seeking and paused inspection the same code path". This is that caller. It owns the
// media element and nothing else: it does not know what an episode is, does not validate one, and
// never decides what to draw.
//
// PARKED, NOT REBUILT — the `parkCube` precedent (`lib/cube-drawing.js`), for a different reason
// worth stating because it is not the same one. A `<cubus-cube>` is parked because building a WebGL
// context costs 21–24 ms. An `<audio>` element is cheap to build; what is expensive is what it
// HOLDS — a media resource that must be fetched and decoded again, and a playback position that a
// rebuilt element simply loses. So the element is kept for its contents, and `recycle()`'s
// equivalent here is putting the source and the position back to nothing.
//
// THE LOOP IS requestAnimationFrame, NOT `timeupdate`. `timeupdate` fires about four times a
// second, which is fine for a progress bar and useless for a cube that turns at 60 Hz: the
// schedule would be read in ~250 ms steps and every turn would land late and in a jump. The audio's
// `currentTime` is still the only source of truth — the frame loop is just how often it is asked.
//
// A SCRUB IS A SEEK, NEVER A PAINT. `lesson-player.js` animates a turn only when the cube is
// exactly one behind (`ONE_BEHIND`); anything further is placed without animation. Dragging a
// scrubber across a minute of lesson must therefore go through `seek()`, or the cube would try to
// animate every turn between where it was and where the finger went.

/** At most one, held between mounts. The same rule as the parked cube: one page, one element. */
let parked = null;
/**
 * WHICH LESSON the parked element belongs to, so returning to it can keep its position.
 *
 * The episode's identity AND its media, not the media alone: two lessons may legitimately share an
 * audio file, and keying on the file meant leaving lesson A at eight seconds and opening lesson B
 * started B eight seconds in, with its cube already past the beginning. Reproduced through the
 * real mount before it was fixed.
 */
let parkedKey = '';

/**
 * The parked element, wiped back to nothing — or a new one when there is none.
 *
 * `removeAttribute('src')` and a `load()` rather than `src = ''`: an empty string resolves against
 * the document's URL, so the element would go and fetch the PAGE and fail to decode it, which is a
 * network request and a console error for the sake of clearing a field.
 */
function reuseAudio(make, key = '') {
  const el = parked ?? make();
  const was = parkedKey;
  parked = null;
  parkedKey = '';
  // THE SAME LESSON KEEPS ITS MEDIA AND ITS POSITION. Resetting unconditionally threw away exactly
  // what parking exists to hold — the decoded resource and where the listener had got to — so
  // stepping out to Settings and back restarted the lesson from zero and re-fetched several MB.
  // Only a CHANGE of content is a reason to clear it.
  if (el && was && key && was === key) return el;
  try {
    el.pause?.();
    el.removeAttribute?.('src');
    el.load?.();
  } catch {
    // A media element that will not reset is not one to keep. Fall back to a fresh one rather than
    // hand back something in an unknown state.
    return make();
  }
  return el;
}

/**
 * Drive `player` from an `<audio>`.
 *
 * Everything is injectable — the element, the frame scheduler, the document — because none of this
 * is testable otherwise: happy-dom has no media element that plays, and a real one in a browser
 * cannot be stepped deterministically. The shipped path passes none of them.
 */
export function createEpisodeAudio({
  player,
  src = '',
  /** The lesson this element belongs to. Parking is keyed on it together with the media. */
  episodeId = '',
  el = null,
  doc = globalThis.document,
  frame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  onChange = () => {},
} = {}) {
  if (!player || typeof player.paint !== 'function' || typeof player.seek !== 'function') {
    throw new Error('episode-audio: needs a player with paint() and seek()');
  }
  const parkKey = `${episodeId}\n${src}`;
  const audio = el ?? reuseAudio(() => doc.createElement('audio'), parkKey);
  // Assigned only when it actually differs: setting `src` to the value already there reloads the
  // media and drops the position, which is the same loss by a shorter route.
  if (src && audio.getAttribute?.('src') !== src) audio.src = src;
  // Not `autoplay`: whether a lesson starts talking the moment it opens is a decision the screen
  // makes, not a property of the element (plan item 2.2).
  audio.preload = 'auto';

  let ticking = null;
  let disposed = false;

  /** One frame: ask the audio where it is, put the cube there, book the next. */
  const tick = () => {
    if (disposed) return;
    player.paint(audio.currentTime || 0);
    onChange(view());
    ticking = frame ? frame(tick) : null;
  };

  const stopLoop = () => {
    if (ticking !== null && cancelFrame) cancelFrame(ticking);
    ticking = null;
  };

  const view = () => Object.freeze({
    playing: !audio.paused && !audio.ended,
    at: audio.currentTime || 0,
    // `duration` is NaN until metadata has loaded. NaN is not a number to show anybody, and
    // inventing a total is exactly what this repository refuses — so it is null until it is known.
    total: Number.isFinite(audio.duration) ? audio.duration : null,
  });

  // A seek made by the element itself — a scrubber, a section press, the user dragging the native
  // control — is placed WITHOUT animation, for the ONE_BEHIND reason above.
  const onSeeked = () => { if (!disposed) { player.seek(audio.currentTime || 0); onChange(view()); } };
  const onPlay = () => { if (!disposed) { stopLoop(); tick(); } };
  const onPause = () => {
    if (disposed) return;
    stopLoop();
    // THE FINAL TIME IS PAINTED BEFORE THE LOOP STOPS. Playback can end between two animation
    // frames, and everything the schedule reached in that gap would otherwise never be applied —
    // the label reads the end while the cube still stands at the previous sample.
    player.paint(audio.currentTime || 0);
    onChange(view());
  };
  // A DURATION NOBODY ASKED FOR AGAIN. With autoplay deliberately off, nothing else touches the
  // view between mount and the first press — so without these the total stayed an em dash even
  // after the metadata had arrived and the real number was sitting on the element.
  const onMeta = () => { if (!disposed) onChange(view()); };
  audio.addEventListener?.('loadedmetadata', onMeta);
  audio.addEventListener?.('durationchange', onMeta);
  audio.addEventListener?.('seeked', onSeeked);
  audio.addEventListener?.('play', onPlay);
  audio.addEventListener?.('pause', onPause);
  audio.addEventListener?.('ended', onPause);

  return Object.freeze({
    el: audio,
    view,

    /** Start, and report whether the platform allowed it. A browser may refuse without a gesture. */
    /**
     * Start, and say what happened.
     *
     * `true` when it started. Otherwise the rejection's NAME — `NotAllowedError` is a policy
     * refusal the child can answer by pressing again; `NotSupportedError` is a file that will never
     * play, and telling a child to press again is then a lie. Returning a bare `false` made those
     * the same sentence.
     */
    async play() {
      try {
        await audio.play?.();
        return true;
      } catch (err) {
        return err?.name || 'Error';
      }
    },

    pause() { audio.pause?.(); },

    /** Put the lesson at `t`. Always a seek: see the ONE_BEHIND note at the top. */
    seek(t) {
      const at = Number.isFinite(t) ? Math.max(0, t) : 0;
      audio.currentTime = at;
      // Placed immediately rather than waiting for `seeked`, so a paused scrub updates the cube as
      // the finger moves. The event fires too and places the same picture, which is idempotent.
      player.seek(at);
      onChange(view());
    },

    /**
     * Stop and park for the next mount.
     *
     * The listeners come off first. A re-used element keeps its listeners — the rule `<cubus-cube>`
     * pays for in AGENTS.md — so one left attached would be a dead screen's closure still driving a
     * player that belongs to the screen before last.
     */
    dispose({ park = true } = {}) {
      if (disposed) return;
      disposed = true;
      stopLoop();
      audio.removeEventListener?.('loadedmetadata', onMeta);
      audio.removeEventListener?.('durationchange', onMeta);
      audio.removeEventListener?.('seeked', onSeeked);
      audio.removeEventListener?.('play', onPlay);
      audio.removeEventListener?.('pause', onPause);
      audio.removeEventListener?.('ended', onPause);
      audio.pause?.();
      audio.remove?.();
      if (park) {
        parked = audio;
        parkedKey = parkKey;
      }
    },
  });
}

/** Drop whatever is parked. For a test that must start from nothing, and for a hard teardown. */
export function releaseParkedAudio() {
  try { parked?.pause?.(); } catch { /* an element that cannot be paused is being dropped anyway */ }
  parked = null;
  parkedKey = '';
}

/** Is an element parked? Exported so a test can assert re-use rather than infer it. */
export const parkedAudio = () => parked;
