// T6 (pure parts): the canonical R2↔RR event normalization (§12/#21) and the
// release-gating metrics incl. the separately-measured false-commit rate (§12/#20).
// Recorded ground-truth sessions + the clock-sync fit are the hardware-bound parts.
import { describe, expect, it } from 'vitest';
import type { Move } from '../src/cube.js';
import { eventsMatch, scoreSession, toQuarterTurns } from '../src/harness.js';

describe('event normalization (R2 ↔ R R)', () => {
  it('expands a half-turn into two quarter-turns', () => {
    expect(toQuarterTurns(['R2'] as Move[])).toEqual(['R', 'R']);
    expect(toQuarterTurns(['R', "U'"] as Move[])).toEqual(['R', "U'"]);
  });
  it('matches a tracker R2 against an oracle R R, and rejects a genuine mismatch', () => {
    expect(eventsMatch(['R2'] as Move[], ['R', 'R'] as Move[])).toBe(true);
    expect(eventsMatch(['R'] as Move[], ['U'] as Move[])).toBe(false);
  });
});

describe('session metrics', () => {
  it('a perfect prediction has recall 1 and false-commit rate 0', () => {
    const truth = ['R', 'U', "F'", 'D2'] as Move[];
    const m = scoreSession([...truth], truth);
    expect(m.moveRecall).toBe(1);
    expect(m.falseCommitRate).toBe(0);
    expect(m.missed).toBe(0);
  });
  it('an extra wrong move counts as a false commit', () => {
    const truth = ['R', 'U'] as Move[];
    const m = scoreSession(['R', 'L', 'U'] as Move[], truth);
    expect(m.falseCommits).toBeGreaterThanOrEqual(1);
  });
  it('a missed move lowers recall', () => {
    const truth = ['R', 'U', 'F'] as Move[];
    const m = scoreSession(['R', 'F'] as Move[], truth);
    expect(m.missed).toBeGreaterThanOrEqual(1);
    expect(m.moveRecall).toBeLessThan(1);
  });
  it('an "always-hold" tracker (predicts nothing) fails move recall (§12/#20)', () => {
    const truth = ['R', 'U', 'F', 'D'] as Move[];
    const m = scoreSession([] as Move[], truth);
    expect(m.moveRecall).toBe(0); // the DoD gate must reject this
    expect(m.falseCommitRate).toBe(0); // ...even though false-commit rate is trivially 0
  });
});
