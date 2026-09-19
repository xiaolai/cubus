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

  it('reports where the run stands without changing what the gate decides', () => {
    // `status` is for the scan trace. It must read the same fields the gate reads, on the same
    // clock, and asking it must not move the run — or watching a scan would change it.
    const s = new Stillness(3, 500);
    expect(s.status(0)).toEqual({ run: 0, heldMs: 0 });
    s.offer(READ, 1000);
    s.offer(READ, 1200);
    expect(s.status(1300)).toEqual({ run: 2, heldMs: 300 });
    expect(s.status(1300)).toEqual({ run: 2, heldMs: 300 }); // asking twice changes nothing
    expect(s.offer(READ, 1400)).toBe(false); // three reads, 400 ms: short of 500 exactly as before
    expect(s.offer(READ, 1500)).toBe(true);
    s.offer(OTHER, 1600); // a new run
    expect(s.status(1650)).toEqual({ run: 1, heldMs: 50 });
    s.reset();
    expect(s.status(9999)).toEqual({ run: 0, heldMs: 0 });
  });
  /**
   * A gate with a flicker already in it: position `at` alternating between colours 1 and 4 over six
   * reads, every other sticker the same. One seeding for every case below, so a change to it cannot
   * be applied to two of them and missed in the third (audit, 2026-09-19).
   */
  const flickering = (at: number, rest: readonly number[] = new Array(9).fill(0)) => {
    const s = new Stillness(3, 500);
    const a = [...rest];
    const b = [...rest];
    a[at] = 1;
    b[at] = 4;
    for (let i = 0; i < 6; i++) s.offer(i % 2 === 0 ? a : b, i * 100);
    return { gate: s, a, b };
  };

  it('says which colours a lone flickering sticker changes between, and forgets them on reset', () => {
    // The panel's sentence names the pair, and adds the light remark only for a pair the light
    // is known to confuse — so the pair has to be what the sticker actually showed, not a guess.
    const { gate: s } = flickering(2);
    expect(s.flickering()).toBe(2);
    expect(s.flickerColours(2)).toEqual([1, 4]);
    expect(s.flickerColours(0)).toEqual([]); // never broke a run alone
    // Two positions changing at once is a cube that moved: it names no pair.
    s.offer([5, 0, 1, 5, 0, 0, 0, 0, 0], 700);
    expect(s.flickerColours(0)).toEqual([]);
    s.reset();
    expect(s.flickerColours(2)).toEqual([]);
    // …and the COUNT is forgotten with the colours: kept, it would go on naming that sticker for a
    // cube the gate has never seen (audit, 2026-09-19).
    expect(s.flickering()).toBeNull();
  });

  it('forgets a flicker when the subject changes, and keeps it through a noisy frame', () => {
    // Most of the face changing is a cube that moved: another side's stickers must not be described
    // by the last one's flicker. Two positions at once is a noisy frame and keeps the history, or a
    // real flicker with the odd bad frame could never be named (audit, 2026-09-19).
    const { gate: s, b } = flickering(2);
    const noisy = [...b];
    noisy[0] = 2;
    noisy[3] = 5; // exactly two stickers misread for a frame, and neither is the centre
    expect(noisy.filter((c, i) => c !== b[i]).length).toBe(2);
    s.offer(noisy, 700);
    expect(s.flickerColours(2)).toEqual([1, 4]);
    // Neither of the two names a pair of its own: a frame is not a flicker.
    expect(s.flickerColours(0)).toEqual([]);
    expect(s.flickerColours(3)).toEqual([]);
    s.offer([5, 5, 5, 5, 5, 5, 0, 0, 0], 800); // a different face
    expect(s.flickerColours(2)).toEqual([]);
    expect(s.flickering()).toBeNull();
  });

  it('forgets a flicker on another side even when only the centre and one more sticker changed', () => {
    // A centre belongs to its side, so a changed centre beside any other change is a new subject —
    // two sides of a near-solved cube can share all but a couple of stickers (audit, 2026-09-19).
    const { gate: s } = flickering(2);
    expect(s.flickerColours(2)).toEqual([1, 4]);
    s.offer([0, 0, 4, 0, 3, 0, 0, 5, 0], 700); // another side: its centre and one sticker differ
    expect(s.flickerColours(2)).toEqual([]);
    expect(s.flickering()).toBeNull();
  });

  it('forgets a flicker when the side is turned in the hand, through any quarter of a turn', () => {
    // A near-symmetric side turned changes in only a few places, all of them moved stickers: the
    // history names positions that no longer hold what it saw (round-3 audit). Each turned frame is
    // written out by hand — derived from the production permutation, one wrong mapping would satisfy
    // both sides of the test (audit, 2026-09-19). One sticker above the centre, which travels round
    // the edges, so every turn moves exactly two positions and only the turn rule can clear it:
    //
    //     . 4 .        . . .        . . .        . . .
    //     . . .   -->  . . 4   -->  . . .   -->  4 . .
    //     . . .        . . .        . 4 .        . . .
    //      still      a quarter      a half    three quarters
    const turns = [
      { name: 'a quarter', frame: [0, 0, 0, 0, 0, 4, 0, 0, 0] },
      { name: 'a half', frame: [0, 0, 0, 0, 0, 0, 0, 4, 0] },
      { name: 'three quarters', frame: [0, 0, 0, 4, 0, 0, 0, 0, 0] },
    ];
    for (const { name, frame } of turns) {
      const { gate: s, b } = flickering(1);
      expect(s.flickering()).toBe(1);
      expect(frame.filter((c, i) => c !== b[i]).length, name).toBe(2); // the case is the one it claims to be
      expect(frame[4], name).toBe(b[4]); // and the centre did not move
      s.offer(frame, 700);
      expect(s.flickerColours(1), name).toEqual([]);
      expect(s.flickering(), name).toBeNull();
    }
  });
});
