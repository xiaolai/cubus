// The algorithm video tool, and the two ways it lied while looking perfect.
//
// Both failures below happened while building it, and neither was visible from the outside:
//
//   1. Six files, correct codecs, exactly the right frame count — and every frame BLANK. A run that
//      reports "48 frames at 30fps" and writes six playable files is indistinguishable from a
//      working one unless something looks at the pixels. (The GL flags in use at the time were
//      blamed and then ruled out — re-adding them reproduces nothing. The cause is unknown and it
//      has not recurred, which is precisely why the guard stays.)
//   2. The background flatten painted the right colour under a fully TRANSPARENT alpha, because
//      `drawbox` keeps the alpha it finds. mp4 and webm discard alpha, so they looked right; only
//      the gif showed it, as a background quantised to an arbitrary brown.
//
// So these tests are mostly about pixels and bytes rather than about exit codes. There is no PNG
// decoder here, and adding one for this would be a dependency bought for a test — but neither bug
// needs one: blank frames are all IDENTICAL to each other and compress to almost nothing, which is
// exactly what the distinctness and size floors below measure.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { DEFAULTS, capture, encode } from '../../../scripts/alg-video.mjs';

// Small and slow-framed on purpose: this is a correctness test, not a render. 128px at 10fps keeps
// a four-move algorithm around a second while still being a real WebGL draw.
const SMALL = { size: 128, fps: 10, hold: 0.1, tempo: 1 };
const ALG = "R U R' U'";

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tmp = mkdtempSync(join(tmpdir(), 'alg-video-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('capture', () => {
  test('renders frames that actually contain a cube', async () => {
    const { frames, moves } = await capture({ alg: ALG, ...SMALL });
    assert.equal(moves, 4);

    // THE BLANK-VIDEO TEST. An empty canvas gives byte-identical PNGs and each is tiny; a drawn
    // one differs frame to frame as the layer turns. These are the two properties that separate
    // the blank run described above from a real one — not a reproduction of its cause, which was
    // never established, but a guard on the symptom that made it invisible.
    const distinct = new Set(frames.map((f) => f.toString('base64'))).size;
    assert.ok(distinct > 4, `only ${distinct} distinct frames of ${frames.length} — the canvas is not drawing`);
    const median = [...frames.map((f) => f.length)].sort((a, b) => a - b)[Math.floor(frames.length / 2)];
    assert.ok(median > 2000, `median frame is ${median} bytes — a transparent 128px PNG is smaller than this`);
  });

  test('the same algorithm renders to the same bytes', async () => {
    // The point of driving the clock instead of recording real time. Without it every render
    // differs and no output can be diffed, cached, or reviewed.
    const a = await capture({ alg: ALG, ...SMALL });
    const b = await capture({ alg: ALG, ...SMALL });
    assert.equal(a.frames.length, b.frames.length);
    for (let i = 0; i < a.frames.length; i++) {
      assert.ok(a.frames[i].equals(b.frames[i]), `frame ${i} differs between two identical renders`);
    }
  });

  test('the frame count follows the tempo, not the wall clock', async () => {
    // 190ms per quarter turn at tempo 1 (cubus-cube.js), so half the tempo is about twice the
    // moving frames. The holds are fixed and sit outside that, hence comparing the middles.
    const hold = Math.round(SMALL.hold * SMALL.fps) * 2;
    const fast = await capture({ alg: ALG, ...SMALL, tempo: 2 });
    const slow = await capture({ alg: ALG, ...SMALL, tempo: 1 });
    const moving = (r) => r.frames.length - hold;
    assert.ok(moving(fast) < moving(slow), `tempo 2 took ${moving(fast)} frames, tempo 1 took ${moving(slow)}`);
    assert.ok(moving(slow) >= 4, 'a four-move algorithm cannot animate in fewer frames than it has moves');
  });

  test('an algorithm that is not one is refused, not rendered as nothing', async () => {
    await assert.rejects(() => capture({ alg: 'NOT A MOVE', ...SMALL }), /did not finish|valid/);
  });
});

describe('encode', () => {
  // ffmpeg-dependent, so it SKIPS rather than passes when absent — a check that silently succeeds
  // without its tool is the shape AGENTS.md warns about. The capture tests above still gate.
  const it = hasFfmpeg ? test : test.skip;

  it('writes every format, and the flatten is opaque where it must be', async (t) => {
    if (!hasFfmpeg) return t.skip('ffmpeg is not installed');
    const { frames } = await capture({ alg: ALG, ...SMALL });
    const written = encode(frames, {
      outDir: tmp,
      name: 'v',
      fps: SMALL.fps,
      background: DEFAULTS.background,
      formats: ['mp4', 'webm', 'apng', 'gif', 'png'],
    });
    for (const f of written) {
      assert.ok(existsSync(f), `${f} was not written`);
      assert.ok(readFileSync(f).length > 500, `${f} is ${readFileSync(f).length} bytes — too small to be real`);
    }
    // The stills keep alpha: PNG signature plus a colour type of 6 (truecolour with alpha) at a
    // fixed offset in the IHDR. Cheaper than decoding, and it is the property that matters.
    const still = readFileSync(join(tmp, 'v.start.png'));
    assert.equal(still.subarray(1, 4).toString(), 'PNG');
    assert.equal(still[25], 6, 'the still lost its alpha channel — the stills are the transparent output');
  });

  it('refuses a format it cannot write rather than skipping it quietly', async (t) => {
    if (!hasFfmpeg) return t.skip('ffmpeg is not installed');
    const { frames } = await capture({ alg: 'R', ...SMALL });
    assert.throws(
      () => encode(frames, { outDir: '/does/not/exist/at/all', name: 'v', fps: 10, background: '#fff', formats: ['mp4'] }),
      /ffmpeg failed|ENOENT|EACCES/,
    );
  });
});
