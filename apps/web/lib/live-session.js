// The session the app is connected through, if any — its one handle on the live cube — and the
// two questions every layer asks of it: has it refused the cube, and how many turns has the cube
// reported.
//
// It sits beneath everything that asks, so trust, the reports and the connection all read it
// without reaching up. The handle changes only through holdSession — when a session is connected,
// when the connection ends, and in the test seam's stand-in; everything else reads `conn` live.
//
// Lifted out of lib/cube-connection.js on 2026-09-13, so trust and the reports could leave it too.
import { VERDICT } from './cube-session.js';

// The live session (lib/cube-session.js), or null. It owns the transport, the protocol layer
// and the self-check; the app only ever holds this one handle, here.
export let conn = null;

/** Has the session PROVED this cube's own reports do not add up?
 *
 *  One predicate, because it now gates three different things — the report stream, the repair
 *  scan, and re-trusting after one — and three copies of a verdict comparison is how a refusal
 *  comes to mean different things per screen. A session that is not there refuses nothing:
 *  "no cube" and "a cube known to be wrong" are not the same state. */
export const cubeRefused = () => conn?.verdict === VERDICT.REFUSED;

/** How many turns this connection has reported, as the SESSION counts them. The self-check is
 *  shown every MOVE event before any listener of ours is, so this is the cube's own record rather
 *  than a tally of what happened to reach this file — which is exactly what makes it worth asking
 *  a second time at the report. Zero with no session, and zero for a session that counts nothing:
 *  a count that cannot move can only ever say "nothing turned", which is what a cube reporting no
 *  moves at all is in fact saying. */
export const turnsReported = () => conn?.evidence?.moveReports ?? 0;

/** Hold `session` as the live one, or let go of it with null. Called only where the handle changes:
 *  a session connected, the connection ending, and the test seam's stand-in. */
export function holdSession(session) {
  conn = session;
}
