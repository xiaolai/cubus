// How many sides a scanner report says are held (2026-09-19, dev-docs/scan-guidance-plan.md 3.2, 6).
//
// ALL of them: `sides` counts a side whose centre another side also claims, where the named list,
// `captured`, leaves it out until the two are settled — so `captured.length` falls without anything
// being thrown away, and is the wrong count for "was the scan restarted?". The scanner always sends
// `sides` (ScanProgress in packages/cube-scanner); a report without it is refused here, loudly, rather
// than quietly counted the way the count exists to replace (round-3 audit).

/** How many sides a cube has, and so the most a report can hold. */
const SIDES = 6;

/** The report's side count; throws on a report that carries none, or one no cube could have. */
export function sidesIn(report) {
  const { sides } = report;
  if (!Number.isInteger(sides) || sides < 0 || sides > SIDES) {
    throw new TypeError(`scan-progress: a report without a side count (sides: ${String(sides)})`);
  }
  return sides;
}
