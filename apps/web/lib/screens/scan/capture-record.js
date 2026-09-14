// The scan screen's record of WHEN each side the scanner holds was read: over which connection, and
// at which of the cube's reports.
//
// Its own unit because a scanner report says what each side shows and never when it was read — a
// capture is its slot and its stickers, nothing more — and two judgements on this screen need the
// when. The reconnect check may judge only a side read at the report in force
// (lib/screens/scan/reconnect-check.js), and a finished scan may answer for the cube only with
// sides read at the report in force (lib/screens/scan.js). Pinned by test/capture-record.test.mjs.

/** Where each of a side's nine stickers comes from when the side turns a quarter round. */
const QUARTER = [6, 3, 0, 7, 4, 1, 8, 5, 2];
const sameStickers = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Is `next` the side `held` shows, turned a quarter, a half or three quarters round? */
const turnedRound = (held, next) => {
  let side = held;
  for (let k = 1; k < 4; k++) {
    side = QUARTER.map((i) => side[i]);
    if (sameStickers(side, next)) return true;
  }
  return false;
};

/**
 * The record of one mounted scan screen.
 *
 * @param {() => { over: object | null, reported: string | null, turns: number }} now  The
 *   connection in force, or null with none; the cube's latest report, or null before one; and how
 *   many turns the cube has reported — read as a side is read.
 */
export function createCaptureRecord(now) {
  /** Slot → the stickers the side shows, and `now()` as it was read. */
  const readAt = new Map();
  /** The side a sticker painted by hand is to show, until the scanner reports that side changed. */
  let painted = null;
  const isPainted = (c) => painted?.slot === c.face && sameStickers(painted.colors, c.colors);

  /**
   * Take a scanner report's captures. A side is READ when it appears or shows other stickers. One
   * the report no longer holds is forgotten, so a side dropped and read again is a new read however
   * alike it looks: keyed on its stickers alone, a side a turn had not reached came back identical
   * and stayed "read before the turn" for good (found by verification, 2026-09-14).
   *
   * Two changes are not reads, and a side keeps the moment it was read through both: the same side
   * turned round — the scanner settling a finished scan into canonical rotation — and a sticker
   * painted by hand. Taken as reads, each moved a side read before a reconnect onto the new
   * connection, and a scan finished from such sides was trusted (found by verification,
   * 2026-09-14).
   */
  function note(captured) {
    const held = new Set(captured.map((c) => c.face));
    for (const slot of [...readAt.keys()]) if (!held.has(slot)) readAt.delete(slot);
    const at = now();
    for (const c of captured) {
      const was = readAt.get(c.face);
      if (was && sameStickers(was.colors, c.colors)) continue;
      const kept = was && (turnedRound(was.colors, c.colors) || isPainted(c));
      if (painted?.slot === c.face) painted = null;
      readAt.set(c.face, kept
        ? { ...was, colors: [...c.colors] }
        : { colors: [...c.colors], over: at.over, reported: at.reported, turns: at.turns });
    }
  }

  /** Paint sticker `index` of the side in `slot` by hand, through `apply`, which hands the colour
   *  to the scanner: the side it then reports is the side as it was read, corrected. */
  function paint(slot, index, colour, apply) {
    const was = readAt.get(slot);
    painted = was ? { slot, colors: was.colors.map((x, i) => (i === index ? colour : x)) } : null;
    apply();
  }

  /** The slots of the held sides that `before(read, at)` says were read before now. */
  const readWhere = (before) => {
    const at = now();
    return [...readAt].filter(([, read]) => before(read, at)).map(([slot]) => slot);
  };

  return Object.freeze({
    note,
    paint,
    /** The sides read before the cube as it is now — over another connection, before a turn it
     *  counted, or at another report — and none while no cube is connected. A connection's first
     *  report does not overtake a side read before it unless the cube reported a turn in between:
     *  it says where the cube already was, and asking for that side again said the cube had been
     *  turned. The turn COUNT is asked as well as the report, because a turn is counted the moment
     *  the cube reports it and the snapshot that shows it follows about a second later: judged on
     *  the report alone, a side read before the turn stayed current for that second, and two such
     *  sides could take the Yes (found by verification, 2026-09-14). */
    readBeforeReport: () => readWhere((read, at) => at.over !== null && (read.over !== at.over
      || read.turns !== at.turns
      || (read.reported !== at.reported && read.reported !== null))),
    /** The sides read before the connection in force began — and none while no cube is connected,
     *  when a finished scan has no connection to answer for. */
    readBeforeConnection: () => readWhere((read, at) => at.over !== null && read.over !== at.over),
  });
}
