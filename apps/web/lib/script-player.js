// The script player's LOAD CONTRACT: one route at a time, and nothing from a superseded one applied.
//
// dev-docs/tutorial-capability-plan.md item 3.5; ADR 0005 decision 3. A host loads a script — often a
// promise of one, because a route is searched for — and loads again when the subject changes. Two loads
// can be in flight at once (a reconnect answered while a die's search is still running), and the slower
// one finishes last. The contract, which the cube screen learned one bug at a time (AGENTS.md, "commit
// after the freshness check, never before"), is kept here once for every host:
//
//   A load SUPERSEDES the previous route the moment it is asked for. The previous route's transitions
//   stop applying then — a handle a page kept for a delayed `next()` does nothing — and a script that
//   resolves after a newer load was asked for is never applied at all.
//
//   The LIVE MODEL is not the route's. A report or a snapshot on a trusted chain belongs to the
//   connection: it survives a load, including one still being searched for, and is located on the new
//   route when that route arrives. Trust lapsing drops it, whatever is loaded.
//
// What stays with the host: the search, the live distance, trust itself and scanning. The host keeps
// its own generation checks for those (the cube screen's `walkGen`, `liveGen`); this only promises that
// the player cannot be the thing that applies a stale answer.
import { buildScript } from './script-view.js';
import { createStopDriver, defaultSchedule } from './script-drive.js';
import { locate } from './script-track.js';

const thenable = (x) => typeof x?.then === 'function';

/**
 * A player over one element (or none: a host that draws for itself still gets the route and the position).
 *
 * `trusted()` is the host's word on the live chain, asked at every report. `onLoad(view)` is told when a
 * route has been applied — after the live model has been located on it.
 *
 * `owned` and `schedule` belong to the DRIVER and pass straight through, because a host that hands over
 * its element has to be able to say what about that element is still its own, and what its walk's clock
 * is. Held here rather than rebuilt per load: they are facts about the host, and a route is not (plan
 * item 6.5 — the cube screen owns the view a child tuned, and paces its play from the element's own
 * turns rather than from a metronome).
 */
export function createScriptPlayer({
  cube = null, owned = [], schedule = defaultSchedule, trusted = () => true, onLoad = () => {},
} = {}) {
  let generation = 0;
  let route = null;        // { generation, built, track, driver }
  let live = null;         // the connection's latest trusted arrangement, as 54 facelets

  const apply = (mine, script) => {
    const built = buildScript(script);
    const driver = createStopDriver(built, { cube, owned, schedule });
    // The driver's own track, not a second one built here: they are the same conversion of the same
    // script, and two of them are two answers about where the cube is (Codex audit, 2026-09-16).
    route = { generation: mine, built, track: driver.track, driver };
    if (live !== null) route.driver.observe(live);
    onLoad(route.driver.view);
    return true;
  };

  /**
   * Put the current route down: its transitions stop, AND so does the cube it was driving.
   *
   * Dropping `route` alone stopped only the half the host can see. The element had been handed a stop
   * group and went on playing the superseded walk's moves — through the whole of the search for the
   * replacement, which is exactly when nobody is watching for it (Codex audit, 2026-09-16). The cube is
   * left at the position the route had reached rather than reset: what supersedes it will load its own.
   */
  const supersede = () => {
    route?.driver.halt();
    route = null;
  };

  /** Operations on the route that is current NOW, refused once a newer load has been asked for. */
  const handle = (mine) => {
    const current = () => route !== null && route.generation === mine && generation === mine;
    const via = (fn) => (...args) => (current() ? fn(...args) : null);
    return Object.freeze({
      get current() { return current(); },
      next: via(() => route.driver.next()),
      back: via(() => route.driver.back()),
      seek: via((k) => route.driver.seek(k)),
    });
  };

  return Object.freeze({
    /**
     * Load a script, or a promise of one. Resolves true when it was applied, false when a newer load was
     * asked for first — in which case nothing of it ever reaches the element or the position.
     *
     * A plain script is applied before this returns, so a host that already has its route can read the
     * player's position on the next line.
     */
    load(source) {
      const mine = ++generation;
      supersede();                                   // the superseded route's transitions stop here
      // ONE SHAPE OF FAILURE, whichever way the script arrived. A plain script is applied before this
      // returns — a host with its route in hand can read the position on the next line — but a script
      // that does not check threw SYNCHRONOUSLY out of `load()`, so `player.load(script).catch(…)` caught
      // a promised script's refusal and not a plain one's (Codex audit, 2026-09-16). The application is
      // still immediate; only the failure is handed back the way the signature promises.
      if (!thenable(source)) {
        try { return Promise.resolve(apply(mine, source)); } catch (err) { return Promise.reject(err); }
      }
      return Promise.resolve(source).then(
        (script) => (mine === generation ? apply(mine, script) : false),
        (err) => { if (mine === generation) throw err; return false; },
      );
    },

    /**
     * An arrangement the connection reported. Kept as the live model on a trusted chain — whatever is
     * loaded, and while nothing is — and located on the route when there is one.
     */
    observe(facelets) {
      if (!trusted()) {
        live = null;
        return Object.freeze({ kind: 'untrusted', position: route?.driver.position ?? null });
      }
      live = facelets;
      if (!route) return Object.freeze({ kind: 'waiting', position: null });
      return route.driver.observe(facelets);
    },

    /** Where an arrangement is on the current route, without moving to it: `{ kind, idx }`. */
    locate(facelets, from = route?.driver.position ?? 0) {
      return route ? locate(route.track, facelets, from) : Object.freeze({ kind: 'off' });
    },

    /**
     * Supersede the route with none: the host has started looking for a replacement and has no promise to
     * hand over. Everything a `load` promises about the old route holds from here.
     */
    unload() { generation++; supersede(); },

    /** Trust lapsed: the live model is not knowledge of anything any more, whatever is loaded. */
    dropLive() { live = null; },

    get live() { return live; },
    get loaded() { return route !== null; },
    get position() { return route?.driver.position ?? null; },
    get view() { return route?.driver.view ?? null; },
    get built() { return route?.built ?? null; },

    /** A handle on the route loaded now. Its transitions refuse to apply once that route is superseded. */
    route: () => handle(generation),
    next: () => route?.driver.next() ?? null,
    back: () => route?.driver.back() ?? null,
    seek: (k) => route?.driver.seek(k) ?? null,

    /**
     * Walking the route on a clock, and stopping where it has got to.
     *
     * Pass-throughs on purpose: playing is the DRIVER's, and a second implementation here would be a
     * second answer about whether the walk is running. With no route loaded there is nothing to play,
     * and `playing` is false rather than an error — a host may press Play while its walk is still
     * being searched for.
     */
    play: (opts) => route?.driver.play(opts) ?? null,
    pause: () => route?.driver.pause() ?? null,
    get playing() { return route?.driver.playing ?? false; },
    /** Stop where the route believes the cube is: what the element is mid-way through still lands. */
    halt: () => route?.driver.halt() ?? null,
  });
}
