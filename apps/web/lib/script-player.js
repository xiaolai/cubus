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
import { createStopDriver } from './script-drive.js';
import { locate, trackFor } from './script-track.js';

const thenable = (x) => typeof x?.then === 'function';

/**
 * A player over one element (or none: a host that draws for itself still gets the route and the position).
 *
 * `trusted()` is the host's word on the live chain, asked at every report. `onLoad(view)` is told when a
 * route has been applied — after the live model has been located on it.
 */
export function createScriptPlayer({ cube = null, trusted = () => true, onLoad = () => {} } = {}) {
  let generation = 0;
  let route = null;        // { generation, built, track, driver }
  let live = null;         // the connection's latest trusted arrangement, as 54 facelets

  const apply = (mine, script) => {
    const built = buildScript(script);
    route = { generation: mine, built, track: trackFor(built), driver: createStopDriver(built, { cube }) };
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
      if (!thenable(source)) return Promise.resolve(apply(mine, source));
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
  });
}
