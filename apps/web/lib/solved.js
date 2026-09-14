// The solved cube, as a facelet string — written once.
//
// Three modules spelled out the same 54 characters: lib/app-state.js as SOLVED,
// lib/cube-trust.js as IDENTITY and lib/solve-timer.js as SOLVED. Identical literals are how a
// cube comes to be solved in one place and not in another, so they read this one. A library
// module that imports nothing, so every pure module can use it (test/app-source.mjs files it
// under LIBRARY_SOURCES).
//
// Not lib/cube-pieces.js's SOLVED, which is the solved cube as PIECES — a different shape of the
// same fact, used by the engines.

/** The solved cube in Kociemba's URFDLB facelet order. */
export const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
