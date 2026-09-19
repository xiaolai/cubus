// The fake camera the scan shot is taken with: the golden frame as a looping video, in the frame's own
// proportions (2026-09-19).
//
// Pure except `headOf`, so `site.test.mjs` can hold the rule without ffmpeg: the feed must be the
// photo's shape to within the one pixel yuv420p's even sizes take off. A distorted feed makes the
// scanner refuse every frame, and the page would then photograph a scanner that "cannot read" — a claim
// about the app made by the tool (it happened: photo-00 went from 649×720 to 720×480 and the old fixed
// `scale=648:720` stretched it 1.67×).
import { closeSync, openSync, readSync } from 'node:fs';

/** ffmpeg's filter for the feed: each side rounded down to even, and nothing else changed. */
export const EVEN_SIZE = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

const PNG_SIGNATURE = '89504e470d0a1a0a';

/** A PNG's size, from its IHDR — or an error, for bytes that are not a PNG's head. */
export function pngSize(head) {
  if (head.length < 24 || head.subarray(0, 8).toString('hex') !== PNG_SIGNATURE || head.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG: no signature and IHDR at its head');
  }
  return positive({ width: head.readUInt32BE(16), height: head.readUInt32BE(20) }, 'the PNG');
}

/** A Y4M's size, from its stream header — or an error when either is missing or not a positive whole number. */
export function y4mSize(head) {
  const text = head.toString('latin1');
  if (!text.startsWith('YUV4MPEG2 ')) throw new Error('not a Y4M: no YUV4MPEG2 stream header');
  // The header ends at its newline; one read past its end, or cut short, is not a header to trust.
  const end = text.indexOf('\n');
  if (end < 0) throw new Error('not a whole Y4M stream header: it has no terminating newline');
  const line = text.slice(0, end);
  const field = (tag) => Number(new RegExp(` ${tag}(\\d+)(?= |$)`).exec(line)?.[1]);
  return positive({ width: field('W'), height: field('H') }, 'the Y4M');
}

/** The feed `EVEN_SIZE` makes of a picture: each side rounded DOWN to even, and otherwise unchanged. */
export const evenFeedOf = (photo) => ({ width: photo.width - (photo.width % 2), height: photo.height - (photo.height % 2) });

/**
 * Refuse a feed that is not exactly what `EVEN_SIZE` makes of the photo. Exact, not "within a pixel":
 * a tolerance would pass an odd side rounded UP or an even side changed, neither of which the filter
 * does, so either means the feed came from somewhere else (audit, 2026-09-19).
 */
export function assertSameShape(photo, feed, name) {
  const want = evenFeedOf(photo);
  if (feed.width !== want.width || feed.height !== want.height) {
    throw new Error(`the camera feed is ${feed.width}×${feed.height} but ${name} is ${photo.width}×${photo.height}, which the feed should show as ${want.width}×${want.height}: the scanner would be shown a distorted cube`);
  }
}

/**
 * Make the feed and CHECK it: ffmpeg's arguments, the run, and the refusal of a feed that is not the
 * photo's shape, in one place the test can drive.
 *
 * `run` is the runner — `execFileSync` in the script, a stand-in in the test — because the rule above
 * is worth nothing unless the path that makes the feed actually applies it, and a test that reads the
 * script for `'-vf', EVEN_SIZE` is satisfied by a comment (audit, 2026-09-19).
 */
export function makeCameraFeed(photo, out, run) {
  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-i', photo,
    '-t', '2', '-r', '15',
    // yuv420p needs even dimensions, so each side is rounded down to even — and nothing more.
    '-vf', EVEN_SIZE,
    '-pix_fmt', 'yuv420p',
    out,
  ]);
  assertSameShape(pngSize(headOf(photo, 32)), y4mSize(headOf(out, 128)), photo);
  return out;
}

/** The first `bytes` of a file — its header, without reading a video's worth of frames to get it. */
export function headOf(path, bytes = 64) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    return buf.subarray(0, readSync(fd, buf, 0, bytes, 0));
  } finally {
    closeSync(fd);
  }
}

function positive(size, what) {
  if (!(Number.isInteger(size.width) && size.width > 0 && Number.isInteger(size.height) && size.height > 0)) {
    throw new Error(`${what} does not say a size: ${size.width}×${size.height}`);
  }
  return size;
}
