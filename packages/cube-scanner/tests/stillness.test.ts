// The capture gate, tested without a camera, a detector, a timer or a DOM element.
//
// That is the whole reason it is a class. The rule lived as three fields and a condition inside
// onTick, so reaching it meant driving the entire scan loop, and the timing half — the part most
// likely to be wrong — could only be exercised by advancing fake timers through a fake detector.
import { describe, expect, it } from 'vitest';
import { Stillness } from '../view/stillness.js';

const READ = [0, 1, 2, 3, 4, 5, 0, 1, 2];
const OTHER = [5, 4, 3, 2, 1, 0, 5, 4, 3];

describe('Stillness', () => {
  it('needs the count AND the duration, not either alone', () => {
    const s = new Stillness(3, 500);
    expect(s.offer(READ, 1000)).toBe(false); // count 1
    expect(s.offer(READ, 1100)).toBe(false); // count 2
    expect(s.offer(READ, 1200)).toBe(false); // count 3, but only 200 ms have passed
    expect(s.offer(READ, 1500)).toBe(true); // count 4 and 500 ms
  });

  it('a long wait on a changing read never settles', () => {
    // The failure a duration alone would allow: a cube drifting through several readings for as
    // long as you like is not a cube being held still.
    const s = new Stillness(3, 500);
    for (let t = 0; t < 20; t++) {
      expect(s.offer(t % 2 === 0 ? READ : OTHER, 1000 + t * 100)).toBe(false);
    }
  });

  it('a burst of identical reads inside one instant never settles', () => {
    // The failure a count alone would allow, and the reason the count is not enough on the 60 ms
    // native tick: three reads there span 180 ms, which is a glimpse, not a hold.
    const s = new Stillness(3, 500);
    for (let i = 0; i < 10; i++) expect(s.offer(READ, 1000)).toBe(false);
  });

  it('a changed read restarts the clock, not just the count', () => {
    const s = new Stillness(3, 500);
    s.offer(READ, 1000);
    s.offer(READ, 1400);
    expect(s.offer(OTHER, 1500)).toBe(false); // new run begins here
    expect(s.offer(OTHER, 1600)).toBe(false);
    expect(s.offer(OTHER, 1900)).toBe(false); // count 3, but only 400 ms into THIS run
    expect(s.offer(OTHER, 2000)).toBe(true);
  });

  it('after a reset the clock runs from the next read, not from the old run', () => {
    // Four sites in the panel used to reset this state by hand, and three of them cleared the count
    // and the key but left the timestamp. I first wrote this test claiming that was a live defect.
    // It was not, and mutation-testing said so: clearing the key forces the "new run" branch on the
    // very next read, which reassigns the timestamp anyway. The omission was harmless — but only by
    // a coincidence of control flow two branches away, which is precisely the kind of safety that
    // stops holding the moment someone edits that branch. One object with one reset needs no
    // coincidence. What IS worth pinning is the behaviour itself, so here it is.
    const s = new Stillness(3, 500);
    s.offer(READ, 1000); // an old run
    s.reset();
    expect(s.offer(READ, 9000)).toBe(false);
    expect(s.offer(READ, 9100)).toBe(false);
    expect(s.offer(READ, 9200)).toBe(false); // count reached; 9000 is the start, not 1000
    expect(s.offer(READ, 9500)).toBe(true);
  });
});
