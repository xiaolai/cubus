// The two registries that let code beneath the screens reach them without importing them: `hooks`,
// installed by the mounted screen, and `shell`, filled in by the screen shell when it loads.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

/** The hooks a mounted screen installs and the code beneath the screens calls.
 *
 *  One object rather than five module-level `let`s, because three screens and the shell assign
 *  them and a module cannot assign a binding it imports. `renderScreen` clears every one on each
 *  navigation, so a hook can never outlive the screen that installed it. */
export const hooks = {
  /** The cube screen installs these while following. Moves are the SIGNAL — the cube reports one
   * per turn, immediately. Facelet snapshots arrive at ~1Hz and are the CORRECTION: they say where
   * the cube really is when the move stream and the guide have drifted apart. */
  liveMove: null,
  liveGap: null,
  /** A screen's reaction to trust LAPSING — gap, disconnect, a report that failed validation, a
   *  contradicted scan. One hook covers them all because they all pass through markStale, which is
   *  the whole point of routing trust through one function. Cleared on navigation. */
  onTrustLost: null,
  cleanup: null,
  // Set by a screen that can take a new cube state in place, so a fresh scan repaints rather than
  // re-mounting — which on the cube screen would restart an animation the user is halfway through.
  liveUpdate: null,
};

/** The shell's own calls, for the code BENEATH the screens — the smart cube's session and the
 *  window chrome — which must not import the shell that imports them. The shell registers the
 *  real functions when it loads; a call before that is a bug in the load order, and says so. */
export const shell = {
  go: () => { throw new Error('shell.go was called before the screen shell registered it'); },
  refreshScreen: () => { throw new Error('shell.refreshScreen was called before the screen shell registered it'); },
  renderScreen: () => { throw new Error('shell.renderScreen was called before the screen shell registered it'); },
};
