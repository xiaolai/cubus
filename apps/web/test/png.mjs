// PNG in and out for the appearance goldens, with node:zlib and nothing else.
//
// Only what this suite writes is read back: 8-bit RGBA, no interlace. The encoder writes filter 0
// on every row; the decoder undoes all five filters, so a golden re-saved by an image editor still
// reads — and refuses any other colour type or bit depth rather than guessing at it.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** `rgba` is `width * height * 4` bytes, top row first. */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error(`png: ${rgba.length} bytes is not ${width}x${height} RGBA`);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** `{ width, height, rgba }` from a PNG this suite could have written, or a screenshot an engine took: 8-bit RGBA, or 8-bit
 *  RGB (expanded to RGBA, opaque), without interlace. */
export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('png: not a PNG');
  let at = 8; let width = 0; let height = 0; let bpp = 4; const idat = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[12] !== 0) throw new Error('png: only 8-bit RGB or RGBA without interlace is read');
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0; const b = prev ? prev[x] : 0; const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } else if (filter !== 0) throw new Error(`png: unknown filter ${filter}`);
      out[x] = v & 0xff;
    }
  }
  if (bpp === 4) return { width, height, rgba: pixels };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * 3]; rgba[i * 4 + 1] = pixels[i * 3 + 1]; rgba[i * 4 + 2] = pixels[i * 3 + 2]; rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}
