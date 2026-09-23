// The capture gate, tested without a camera, a detector, a timer or a DOM element.
//
// That is the whole reason it is a class. The rule lived as three fields and a condition inside
// onTick, so reaching it meant driving the entire scan loop, and the timing half — the part most
// likely to be wrong — could only be exercised by advancing fake timers through a fake detector.
import { describe, expect, it } from 'vitest';
import { classify, Stillness } from '../view/stillness.js';

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

  it('says which colours a lone flickering sticker changes between, and forgets them with the subject', () => {
    // The panel's sentence names the pair, and adds the light remark only for a pair the light
    // is known to confuse — so the pair has to be what the sticker actually showed, not a guess.
    const { gate: s } = flickering(2);
    expect(s.flickering()).toBe(2);
    expect(s.flickerColours(2)).toEqual([1, 4]);
    expect(s.flickerColours(0)).toEqual([]); // never broke a run alone
    // Two positions changing at once is a cube that moved: it names no pair.
    s.offer([5, 0, 1, 5, 0, 0, 0, 0, 0], 700);
    expect(s.flickerColours(0)).toEqual([]);

    // A RESET NO LONGER FORGETS IT (D8, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3). The panel
    // resets on every abstaining frame, and a side that will not settle abstains constantly — so
    // wiping the history there meant the count could never reach the three breaks `flickering()`
    // asks for, and the one specific thing the scan can tell a person was replaced by "hold still"
    // for as long as they were willing to hold it. The history is about a SUBJECT, not a run.
    s.reset();
    expect(s.flickerColours(2)).toEqual([1, 4]);
    expect(s.flickering()).toBe(2);

    // The caller says when the subject really changed — a side captured, a camera switched, the
    // scan restarted — and then it is forgotten, count and colours together. Kept across that, it
    // would go on naming a sticker of a cube the gate has never seen (audit, 2026-09-19).
    s.forgetFlicker();
    expect(s.flickerColours(2)).toEqual([]);
    expect(s.flickering()).toBeNull();
  });

  it('names the pair a sticker is swapping between NOW, not every colour it ever showed', () => {
    // With the history surviving resets, a set would accumulate: a sticker that alternated
    // yellow/orange early and white/blue later would be reported as all four, and the light remark
    // — added only for a pair the light is known to confuse — would attach itself to a sticker that
    // never showed that pair.
    const base = [0, 1, 2, 3, 4, 5, 0, 1, 2];
    const at = (i: number, c: number) => base.map((v, k) => (k === i ? c : v));
    const s = new Stillness(3, 500);
    for (let n = 0; n < 4; n++) {
      s.offer(at(2, n % 2 === 0 ? 3 : 4), 1000 + n * 100);
    }
    expect(s.flickerColours(2)).toEqual([3, 4]);
    s.reset();
    for (let n = 0; n < 4; n++) {
      s.offer(at(2, n % 2 === 0 ? 0 : 5), 2000 + n * 100);
    }
    expect(s.flickerColours(2)).toEqual([0, 5]);
    // …and the COUNT accumulated across the reset, which is the whole point of D8.
    expect(s.flickering()).toBe(2);
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

  it('forgets a flicker on another side when the centre and two more stickers changed', () => {
    // A centre belongs to its side, so a changed centre beside real outer change is a new subject —
    // two sides of a near-solved cube can share all but a couple of stickers (audit, 2026-09-19).
    //
    // THE THRESHOLD MOVED FROM ONE OUTER STICKER TO TWO (2026-09-20), and the reason is that the run
    // is now keyed on the eight: a centre is free to differ WITHIN a run, so a centre change is no
    // longer evidence that the subject changed. At one, a logo cap alternating beside a single
    // flickering corner was read as a new side on every frame — the flicker history was wiped each
    // time and the corner could never be named, while the corner itself kept the run from settling.
    // At two, that cube is served and this case still is: turning to a near-identical side changes
    // more than one sticker in the ring.
    const { gate: s } = flickering(2);
    expect(s.flickerColours(2)).toEqual([1, 4]);
    s.offer([0, 0, 4, 5, 3, 0, 0, 5, 0], 700); // another side: its centre and two stickers differ
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

describe('Stillness — the centre is one of the nine (2026-09-23)', () => {
  const W = 0;
  const B = 5;
  /** A white side whose middle sticker reads `centre` on this frame. */
  const white = (centre: number) => [W, W, W, W, centre, W, W, W, W];

  it('a centre that alternates breaks the run, exactly as any other sticker does', () => {
    // WHAT CHANGED, AND WHY. Between 2026-09-20 and 2026-09-23 the run was keyed on the EIGHT so
    // that a white cap with a blue logo could still be captured: the side was filed with its centre
    // unread and placed by elimination once six were in. The owner took that machinery out — it
    // never converged on the cube it was written for — and with nowhere left to put a side that
    // names no colour, a centre that will not settle must stop the capture again rather than
    // produce one nobody can place.
    const logo = new Stillness(3, 500);
    for (const [i, c] of [B, W, B, W, B, W].entries()) {
      expect(logo.offer(white(c), 1000 + i * 200)).toBe(false);
    }
    // And a plain white centre settles over the same frames, so it is the alternation that stops
    // it and not the duration or the count.
    const plain = new Stillness(3, 500);
    const settled = [B, W, B, W, B, W].map((_, i) => plain.offer(white(W), 1000 + i * 200));
    expect(settled).toContain(true);
  });

  it('names the centre as the flickering sticker, because that is what it measured', () => {
    // The one thing the scan can honestly say about this cube: which sticker keeps changing. It is
    // not a diagnosis of a logo — nothing here can see a logo — it is the position that broke the
    // run and the two colours it broke between.
    const s = new Stillness(3, 500);
    for (const [i, c] of [B, W, B, W, B, W].entries()) s.offer(white(c), 1000 + i * 200);
    expect(s.flickering(2)).toBe(4);
    expect(s.flickerColours(4)).toEqual([W, B].sort((a, b) => a - b));
  });

  it('a cube being turned through the frame cannot settle', () => {
    // The guard the key exists for: a face on its way past changes far more than one sticker.
    const s = new Stillness(3, 500);
    const faces = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [2, 2, 2, 2, 2, 2, 2, 2, 2],
      [3, 3, 3, 3, 3, 3, 3, 3, 3],
    ];
    faces.forEach((f, i) => {
      expect(s.offer(f, 1000 + i * 300)).toBe(false);
    });
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
    'position %i is in the key: flickering there blocks the capture, and is named',
    (position) => {
      // EVERY position, the centre among them. A position dropped from the key by accident would
      // leave a sticker that cannot stop a capture — a side filed on a colour nobody saw twice —
      // and a suite testing position 0 alone would stay green through it (audit, 2026-09-20).
      const s = new Stillness(3, 500);
      const ring = (colour: number) => {
        const face = [W, W, W, W, W, W, W, W, W];
        face[position] = colour;
        return face;
      };
      for (const [i, c] of [1, 2, 1, 2, 1, 2].entries()) {
        expect(s.offer(ring(c), 1000 + i * 200)).toBe(false);
      }
      expect(s.flickering(2)).toBe(position);
    },
  );
});

describe('Stillness — a flickering centre beside a flickering outer sticker', () => {
  const W = 0;
  const B = 5;

  it('calls it another side, and so names neither', () => {
    // A CHANGED CENTRE BESIDE ANYTHING ELSE IS A DIFFERENT SIDE. A centre is fixed to its side, so
    // this is the honest reading of two frames that disagree about one; what it costs is a sentence
    // on the cube whose centre AND one corner are both unreliable, where the scan can say only that
    // it is reading nothing (the panel's stall bound). Recorded rather than argued: this was the
    // regression the eight-key was introduced to fix, and taking the eight-key out brings it back.
    const s = new Stillness(3, 500);
    const read = (corner: number, centre: number) => [corner, W, W, W, centre, W, W, W, W];
    const frames: Array<[number, number]> = [
      [1, B],
      [2, W],
      [1, B],
      [2, W],
      [1, B],
      [2, W],
    ];
    frames.forEach(([corner, centre], i) => {
      expect(s.offer(read(corner, centre), 1000 + i * 200)).toBe(false);
    });
    expect(s.flickering(2)).toBe(null);
  });

  it('still calls it another side when the eight change with the centre', () => {
    // The case `anotherSide` exists for: a near-solved cube's sides can share most stickers, so a
    // changed centre beside other changed stickers is a different side, and the last side's flicker
    // history says nothing about this one.
    const s = new Stillness(3, 500);
    s.offer([1, 1, W, W, W, W, W, W, W], 1000);
    s.offer([2, 1, W, W, W, W, W, W, W], 1200); // one sticker: a flicker, recorded
    expect(s.flickering(1)).toBe(0);
    s.offer([3, 3, W, W, B, W, W, W, W], 1400); // two outer + the centre: another side, wiped
    expect(s.flickering(1)).toBe(null);
  });
});

describe('classify — the transition rule, read on its own', () => {
  const ring = (...changed: number[]) => {
    const face = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const i of changed) face[i] = 1;
    return face;
  };
  const still = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  it('one sticker is a flicker worth naming, wherever it is', () => {
    expect(classify(still, ring(2))).toEqual({ only: 2, forget: false });
    // The centre included: it is the sticker a printed logo makes unreliable, and naming it is the
    // one specific thing the scan can say about that cube.
    expect(classify(still, ring(4))).toEqual({ only: 4, forget: false });
  });

  it('one sticker beside a changed centre is another side, not a flicker', () => {
    // A centre is fixed to its side, so two frames that disagree about it are two sides — however
    // few of the other stickers changed, which on a near-solved cube can be one.
    expect(classify(still, ring(2, 4))).toEqual({ only: null, forget: true });
    expect(classify(still, ring(2, 5, 4)).forget).toBe(true);
  });

  it('four changed positions is a cube that moved, centre or not', () => {
    expect(classify(still, ring(0, 1, 2, 3)).forget).toBe(true);
  });

  it('a side turned in the hand is forgotten, however few places it changed', () => {
    const before = [0, 1, 0, 0, 0, 0, 0, 0, 0];
    const quarter = [0, 0, 0, 0, 0, 0, 0, 1, 0].map(
      (_, i) => before[[6, 3, 0, 7, 4, 1, 8, 5, 2][i]!]!,
    );
    expect(classify(before, quarter).forget).toBe(true);
  });
});

/**
 * D2 (`dev-docs/scan-pipeline-audit-2026-09-23.md` §3): one physical frame is one observation,
 * however many ticks it is served to.
 *
 * The defect these pin is not hypothetical. `Camera.latestFrame()` re-serves its cached frame for
 * up to `frameStaleAfter` — a full second, sixteen ticks at the native rate — and the browser's
 * `<video>` repeats its last painted frame whenever the loop outruns the stream. The gate asks for
 * three identical reads spanning 500 ms, and ONE frame re-served satisfies both halves on its own:
 * the count because the reads are identical by construction, the duration because wall-clock time
 * passes regardless. A side could therefore be captured, and reported as a run of three, on a
 * single look at the cube.
 */
describe('Stillness and the identity of the frame a read came from', () => {
  it('will not settle on one frame re-served, however long it is offered', () => {
    const s = new Stillness(3, 500);
    // Sixteen ticks over a second — the native path's behaviour exactly — all one frame.
    for (let t = 0; t <= 1000; t += 60) {
      expect(s.offer(READ, 1000 + t, 7), `tick at ${t} ms settled on one frame`).toBe(false);
    }
    expect(s.status(2000).run).toBe(1);
  });

  it('settles on three DISTINCT frames spanning the duration', () => {
    const s = new Stillness(3, 500);
    expect(s.offer(READ, 1000, 1)).toBe(false);
    expect(s.offer(READ, 1300, 2)).toBe(false);
    expect(s.offer(READ, 1600, 3)).toBe(true);
  });

  it('counts a repeat once, not once per tick, and resumes on the next real frame', () => {
    const s = new Stillness(3, 500);
    s.offer(READ, 1000, 1);
    for (let i = 0; i < 9; i++) s.offer(READ, 1000 + i * 10, 1);
    expect(s.status(1100).run, 'a re-served frame was counted more than once').toBe(1);
    s.offer(READ, 1200, 2);
    expect(s.status(1200).run).toBe(2);
    expect(s.offer(READ, 1600, 3)).toBe(true);
  });

  it('counts every read when the source cannot identify its frames', () => {
    // A runtime that does not know must not have an answer invented for it, and must behave
    // exactly as it did before this existed — Windows and Android still speak wire version 1.
    const s = new Stillness(3, 500);
    expect(s.offer(READ, 1000)).toBe(false);
    expect(s.offer(READ, 1300)).toBe(false);
    expect(s.offer(READ, 1600)).toBe(true);
  });

  it('keeps refusing a repeat across a reset, and accepts it again after forgetFrames', () => {
    // A reset says the RUN is void; it does not say the camera delivered something new. Forgetting
    // the numbering there would hand a re-served frame a fresh vote after every abstention — on
    // the native path, sixteen votes a second.
    const s = new Stillness(3, 500);
    s.offer(READ, 1000, 5);
    s.reset();
    s.offer(READ, 1100, 5);
    expect(s.status(1100).run, 'a reset let the same frame count again').toBe(0);
    // A camera change DOES reset the numbering: its ids mean nothing here, and a new frame that
    // happened to reuse the last id would otherwise be discarded as a repeat.
    s.forgetFrames();
    s.offer(READ, 1200, 5);
    expect(s.status(1200).run).toBe(1);
  });
});
