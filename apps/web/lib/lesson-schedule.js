// An episode's cube, as a PURE FUNCTION OF TIME. No DOM, no renderer, no clock.
//
// This is the half of the course runtime worth owning, and the reason it lives here rather than
// inside a build script's template string: every interesting rule in it — where a segment starts,
// when a turn lands, where the camera is halfway through a swing, how far a count has rolled — is
// arithmetic on the cue list, and arithmetic is testable in a millisecond without a browser.
// `lesson-player.js` is the thin part that writes the answer onto an element.
//
// WHY PURE MATTERS HERE. An episode is an audio track plus a cube, and the cube must agree with
// the audio wherever the listener drops the needle. Seeking backwards, seeking forwards and
// playing through must all give the SAME picture at the same `t`. Anything that eases from
// "wherever the cube is now" cannot promise that — which is the same argument that made
// `<cubus-cube>`'s orientation channel a phase rather than an animation.

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (p) => p * p * (3 - 2 * p);

/** The corner-on teaching angle the whole app is framed for. */
export const CAM_DEFAULT = Object.freeze([35, 45]);
/** Seconds a camera swing takes. A change is a SWING, never a cut: a camera that teleports reads
 *  as an unexplained jump, and the narration describes the move as it happens. */
export const CAM_EASE = 1.4;
/** Seconds the ghosts take to fly out. They do not appear — a lesson that has just said "let's
 *  lift them out where you can watch them" has to actually lift them. */
export const GHOST_REVEAL = 2.2;
/** Where a floating ghost ends up, matching the app's own `CUBE_VIEW.hintElev`. */
export const GHOST_ELEV = 9;
/** Seconds between the turns of an untimed sequence. */
export const QUARTER_GAP = 0.55;

/**
 * Everything derived from the cue list once, so `viewAt` is a lookup rather than a scan of scans.
 *
 * @param {{cues: Array<object>}} episode — already checked and with `spanning` resolved.
 */
export function buildSchedule(episode) {
  const cues = episode.cues;

  // A cue carrying `setup` starts a new POSITION, and its turns belong to it. Seeking into a
  // segment rebuilds from THAT scramble rather than replaying everything before it, which is what
  // keeps the cube a pure function of time across a jump cut.
  const segments = [];
  cues.forEach((c, i) => {
    if (i === 0 || c.setup !== undefined) {
      segments.push({ from: i, at: c.start, scramble: c.setup || '', moves: [] });
    }
    const seg = segments[segments.length - 1];
    const qs = c.quarters || [];
    // A TIMED cue owns its wall-clock duration: its moves are spaced `secs/n` apart on the AUDIO
    // clock. Never chained off the renderer's completion event — that resets its own t0 without
    // correcting overshoot, so chaining accumulates a few ms per move and a 3.51s sequence lands
    // at about 3.67s, drifting off the sentence it is illustrating.
    const step = c.secs ? c.secs / qs.length : QUARTER_GAP;
    qs.forEach((q, j) => seg.moves.push({ q, at: c.end + j * step, step }));
  });

  // Where each RUN of an unchanged value begins, so a reveal or a count-up is a function of t and
  // scrubbing into the middle of one lands mid-roll rather than restarting it.
  //
  // ONE forward pass per value, carrying the run's first index. The backward walk this replaces
  // was run three times over the same cues — and re-scanned the whole run from every member, which
  // is quadratic in the length of a run for an answer each pass already had.
  const runIndex = (pick) => {
    const out = new Array(cues.length).fill(null);
    let startAt = -1;
    for (let i = 0; i < cues.length; i += 1) {
      const v = pick(cues[i]);
      if (!v) { startAt = -1; continue; }
      if (startAt < 0 || pick(cues[i - 1]) !== v) startAt = i;
      out[i] = startAt;
    }
    return out;
  };
  const ghostAt = runIndex((c) => (c.ghosts ? true : null));
  const numberAtIndex = runIndex((c) => c.number ?? null);
  const ghostFrom = ghostAt.map((k) => (k === null ? null : cues[k].start));
  const numberFrom = numberAtIndex.map((k) => (k === null ? null : cues[k].start));
  // A `counting` run rolls across its own animation's window rather than a fixed tween, so the
  // count and the moves are linear in t over the same interval and cannot drift apart.
  const numberRoll = numberAtIndex.map((k) => {
    if (k === null) return null;
    return cues[k].counting && cues[k].secs ? { at: cues[k].end, dur: cues[k].secs } : null;
  });

  // Camera keyframes: one per CHANGE, so a swing runs between the two angles either side of it
  // rather than restarting at every line.
  // CONTIGUOUS runs. Taking the first and last tour cue made two tours separated by ordinary
  // camera work into ONE interval spanning both, so every ordinary cue in between was swallowed by
  // the revolving branch and its angle never drawn.
  const tours = [];
  cues.forEach((c, i) => {
    if (c.cam !== 'tour') return;
    const last = tours[tours.length - 1];
    if (last && last.throughIndex === i - 1) { last.end = c.end; last.throughIndex = i; }
    else tours.push({ at: c.start, end: c.end, throughIndex: i });
  });
  const cams = [];
  // A keyframe is dropped when it says the same thing as the one before it — EXCEPT across a tour,
  // which moves the camera away and so makes the repeat a real instruction to come back. Without
  // this exception `[10,135] → tour → [10,135]` dropped the second one and left the camera at the
  // teaching angle the tour ended on, never returning to the angle the lesson asked for twice.
  let tourSince = false;
  cues.forEach((c) => {
    if (c.cam === 'tour') { tourSince = true; return; }
    const [lat, lon] = c.cam || CAM_DEFAULT;
    const up = c.camUp || 'U';
    const orientation = c.orientation || null;
    const last = cams[cams.length - 1];
    const same = last && last.lat === lat && last.lon === lon && last.up === up
      && last.orientation === orientation;
    if (!same || tourSince) {
      cams.push({ at: c.start, lat, lon, up, orientation });
      tourSince = false;
    }
  });

  // Where each swing actually STARTS, precomputed.
  //
  // Interpolating from the previous keyframe's DESTINATION is wrong whenever the previous swing had
  // not finished: the camera is part-way to it, and the next swing then jumps to the old
  // destination before starting — measured as a jump from longitude 71.24° to 135°. Taking the
  // camera's live position instead would fix the picture and break the property the whole file
  // exists for, because the answer would depend on what had been played.
  //
  // So it is computed from the SCHEDULE: walk the keyframes forward, and each one's start is where
  // the previous swing had reached at that moment. Pure, deterministic, and the same whether it is
  // reached by playing, seeking or landing cold.
  for (let i = 0; i < cams.length; i += 1) {
    // A TOUR between two ordinary keyframes resets where the camera is. The sweep ends one full
    // revolution round, back at the teaching angle, so a keyframe after a tour swings from there —
    // not from the ordinary keyframe before the tour, which the camera left long ago. Without this
    // the angle jumped from [35, 405] just before the tour ended to [10, 135] the instant after.
    const since = i === 0 ? -Infinity : cams[i - 1].at;
    const tourBetween = tours.some((x) => x.end > since && x.end <= cams[i].at);
    if (tourBetween) {
      [cams[i].fromLat, cams[i].fromLon] = CAM_DEFAULT;
      continue;
    }
    const prev = cams[i - 1];
    if (!prev) {
      // An episode OPENS at its stated angle rather than swinging into it from somewhere nobody
      // was looking. But a first keyframe that is not at the start — the one after an opening
      // tour, say — has the default behind it and must swing from there, or it cuts.
      const opens = cams[i].at <= cues[0].start;
      cams[i].fromLat = opens ? cams[i].lat : CAM_DEFAULT[0];
      cams[i].fromLon = opens ? cams[i].lon : CAM_DEFAULT[1];
      continue;
    }
    const e = smooth(clamp01((cams[i].at - prev.at) / CAM_EASE));
    let d = prev.lon - prev.fromLon;
    d -= 360 * Math.round(d / 360);
    cams[i].fromLat = prev.fromLat + (prev.lat - prev.fromLat) * e;
    cams[i].fromLon = prev.fromLon + d * e;
  }

  return Object.freeze({
    cues,
    segments,
    ghostFrom,
    numberFrom,
    numberRoll,
    cams,
    tours,
    // The last thing that HAPPENS, not the last thing that is said — and "happens" is every
    // animation, not only the turns. The first fix here covered the moves and still truncated the
    // rest: measured on a purpose-built episode, the ghosts stopped at 2.15 of 9, a camera swing
    // ended half way, and a counter froze at 28,000 of 1,000,000, because each of those runs on a
    // clock of its own that starts at a cue and finishes after it.
    duration: Math.max(
      cues[cues.length - 1].end,
      ...segments.flatMap((s) => s.moves.map((m) => m.at + m.step)),
      ...ghostFrom.filter((x) => x !== null).map((at) => at + GHOST_REVEAL),
      ...cams.map((c) => c.at + CAM_EASE),
      ...tours.map((x) => x.end),
      ...numberRoll.map((r, i) => (r ? r.at + r.dur : (numberFrom[i] ?? -Infinity) + 1)),
    ) + 0.6,
  });
}

/** Which line is being spoken at `t`. */
export function lineAt(schedule, t) {
  let k = 0;
  for (let i = 0; i < schedule.cues.length; i += 1) if (t >= schedule.cues[i].start) k = i;
  return k;
}

/** Which position the cube is built from at `t`. */
export function segmentAt(schedule, t) {
  let s = schedule.segments[0];
  for (const g of schedule.segments) if (t >= g.at) s = g;
  return s;
}

/**
 * Where the camera is at `t` — a pure function like everything else, so a seek lands at the right
 * angle instead of easing toward it from wherever the last play left off.
 *
 * Longitude is an ANGLE, so 45 to 315 is a quarter turn one way and not three quarters the other.
 * Interpolating the raw numbers once swung the camera 270° to show a quarter regrip: the right
 * destination reached by the wrong journey, which reads as the cube spinning for no reason.
 */
export function cameraAt(schedule, t, { reducedMotion = false } = {}) {
  const tour = schedule.tours.find((x) => t >= x.at && t < x.end);
  if (tour) {
    // Reduced motion holds the tour still at the teaching angle. The point of a tour is to show
    // that only three faces are ever visible at once, and a reader who asked for less motion is
    // not helped by a cube that revolves for twenty seconds regardless — the branch used to return
    // before the preference was ever consulted.
    if (reducedMotion) return { lat: CAM_DEFAULT[0], lon: CAM_DEFAULT[1], up: 'U', orientation: null };
    const e = smooth(clamp01((t - tour.at) / (tour.end - tour.at)));
    // One full revolution while the latitude swings high, low and back, so all six faces pass the
    // camera. 405 and 45 are the same angle, so the sweep ends exactly where the rest sits.
    return {
      lat: +(CAM_DEFAULT[0] * Math.cos(2 * Math.PI * e)).toFixed(2),
      lon: +(CAM_DEFAULT[1] + 360 * e).toFixed(2),
      up: 'U',
      orientation: null,
    };
  }
  // -1 until a keyframe has actually STARTED. Defaulting to 0 meant that between the end of a tour
  // and the start of the next ordinary cue, the camera was drawn at that cue's angle — a keyframe
  // one second in the future, reproduced at 2s for a cue starting at 3s.
  let k = -1;
  for (let i = 0; i < schedule.cams.length; i += 1) if (t >= schedule.cams[i].at) k = i;
  // A tour that ENDED after the selected keyframe began is the more recent event, and it leaves
  // the camera at the teaching angle. Falling back to the keyframe instead redrew an angle from
  // before the tour — measured as a jump from [35, 405] to [10, 135] the instant the tour ended.
  const endedAfter = schedule.tours.some((x) => x.end <= t && x.end > (schedule.cams[k]?.at ?? -Infinity));
  if (endedAfter) return { lat: CAM_DEFAULT[0], lon: CAM_DEFAULT[1], up: 'U', orientation: null };
  const to = schedule.cams[k] ?? {
    at: 0, lat: CAM_DEFAULT[0], lon: CAM_DEFAULT[1], fromLat: CAM_DEFAULT[0],
    fromLon: CAM_DEFAULT[1], up: 'U', orientation: null,
  };
  // Reduced motion LANDS the angle rather than dropping the move: the angle is the content — it is
  // what "hold it like this" points at — and only the swing is decoration.
  const e = smooth(reducedMotion ? 1 : clamp01((t - to.at) / CAM_EASE));
  let d = to.lon - to.fromLon;
  d -= 360 * Math.round(d / 360);
  return {
    lat: +(to.fromLat + (to.lat - to.fromLat) * e).toFixed(2),
    lon: +(to.fromLon + d * e).toFixed(2),
    // The roll and the grip are RELABELLINGS, not sweeps: there is no half-way between held-up and
    // held-over, and easing through one draws the cube lying on its side for a second. They land
    // at the start of the swing, which is where the narration says they happen.
    up: to.up,
    orientation: to.orientation,
  };
}

/**
 * The whole picture at `t`, as plain data. No element is touched and no clock is read.
 *
 * `moves` is how many of the segment's turns have landed, not which one is animating: a player
 * that has fallen behind steps to the count, and one that has jumped seeks to it.
 */
export function viewAt(schedule, t, { reducedMotion = false } = {}) {
  const li = lineAt(schedule, t);
  const cue = schedule.cues[li];
  const seg = segmentAt(schedule, t);
  const cam = cameraAt(schedule, t, { reducedMotion });
  const ghostsOn = Boolean(cue.ghosts);
  const revealed = ghostsOn
    ? clamp01(reducedMotion ? 1 : (t - schedule.ghostFrom[li]) / GHOST_REVEAL)
    : 0;
  return {
    line: li,
    say: cue.say,
    section: cue.section ?? null,
    scramble: seg.scramble,
    alg: seg.moves.map((m) => m.q).join(' '),
    moves: seg.moves.filter((m) => t >= m.at).length,
    segment: schedule.segments.indexOf(seg),
    highlight: cue.hl || 'none',
    focus: cue.focus ?? null,
    ghosts: ghostsOn,
    ghostElevation: ghostsOn ? +(GHOST_ELEV * smooth(revealed)).toFixed(2) : 0,
    camera: cam,
    move: cue.move ?? null,
    number: numberAt(schedule, t, { reducedMotion, line: li }),
    progress: clamp01(t / schedule.duration),
  };
}

/**
 * The on-screen count at `t`, as a string, or null.
 *
 * BigInt because 43,252,003,274,489,856,000 is past `Number.MAX_SAFE_INTEGER` — the whole reason
 * the band exists is to make a huge number feel huge, and a huge number that is subtly wrong is
 * worse than no number at all.
 */
export function numberAt(schedule, t, { reducedMotion = false, line } = {}) {
  // `line` is an optional hint from `viewAt`, which has already computed it. It is NOT positional:
  // a third positional parameter here meant `numberAt(s, t, {reducedMotion: true})` silently passed
  // the options object as a line index, and the only symptom was a crash deep inside this function.
  const li = line ?? lineAt(schedule, t);
  const cue = schedule.cues[li];
  if (!cue.number) return null;
  const target = BigInt(String(cue.number).replace(/,/g, ''));
  // A counter ticking 1..6 does not need a roll, and rolling it looks like a slot machine
  // announcing the number six.
  if (reducedMotion || target <= 10000n) return String(cue.number);
  const roll = schedule.numberRoll[li];
  const at = roll ? roll.at : schedule.numberFrom[li];
  const dur = roll ? roll.dur : 1;
  const p = smooth(clamp01((t - at) / dur));
  // Scaled in BigInt throughout: converting to a float loses the last digits of a twenty-digit
  // number, and those digits are the point.
  const scaled = (target * BigInt(Math.round(p * 1e6))) / 1000000n;
  return scaled.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
