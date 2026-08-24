#!/usr/bin/env python3
"""Assemble a multi-resolution .ico with explicit per-member encoding.

ImageMagick writes every member as an uncompressed BMP, which for a 256x256
32-bit entry is 270KB on its own and took this app's icon.ico to 372KB. The
ICO container has supported PNG-compressed members since Windows Vista, and
the 256 member in particular is expected to be one.

Encoding is chosen per size rather than globally, because the two ends of the
ladder have different consumers:

  <= 64px   BMP. Small members are read by the widest range of consumers,
            including old shell code paths and third-party extractors that
            never learned about PNG-in-ICO. They are small anyway, so there is
            nothing to gain by compressing them.

  >= 128px  PNG. This is where the size actually lives, and every consumer of
            a 128 or 256 member is modern enough to decode it.

Usage:  make-ico.py <out.ico> <png> [<png> ...]
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

from PIL import Image

PNG_FROM = 128  # members at or above this size are stored PNG-compressed


def bmp_member(im: Image.Image) -> bytes:
    """A BITMAPINFOHEADER DIB as the ICO format expects it.

    Two details bite here. The header's height is DOUBLE the real height,
    because it describes the XOR bitmap and the AND mask stacked. And the rows
    are bottom-up.
    """
    w, h = im.size
    px = im.load()

    # XOR bitmap: BGRA, bottom-up. 32bpp rows are already 4-byte aligned.
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))

    # AND mask: 1bpp, bottom-up, each row padded to a 4-byte boundary. With a
    # 32bpp XOR bitmap Windows uses the alpha channel, so the mask is all
    # zeros — but it must still be present and correctly sized or the member
    # is rejected.
    row_bytes = ((w + 31) // 32) * 4
    and_mask = bytes(row_bytes * h)

    header = struct.pack(
        "<IiiHHIIiiII",
        40,  # biSize
        w,  # biWidth
        h * 2,  # biHeight — XOR plus AND
        1,  # biPlanes
        32,  # biBitCount
        0,  # biCompression = BI_RGB
        len(xor) + len(and_mask),  # biSizeImage
        0,  # biXPelsPerMeter
        0,  # biYPelsPerMeter
        0,  # biClrUsed
        0,  # biClrImportant
    )
    return header + bytes(xor) + and_mask


def build(out: Path, sources: list[Path]) -> None:
    entries: list[tuple[int, int, bytes]] = []
    for src in sources:
        im = Image.open(src).convert("RGBA")
        w, h = im.size
        if w != h:
            raise SystemExit(f"make-ico: {src} is {w}x{h}, expected a square")
        if w > 256:
            raise SystemExit(f"make-ico: {src} is {w}px; ICO members cap at 256")
        if w >= PNG_FROM:
            payload = src.read_bytes()
            if payload[:4] != b"\x89PNG":
                raise SystemExit(f"make-ico: {src} is not a PNG file")
        else:
            payload = bmp_member(im)
        entries.append((w, h, payload))

    entries.sort(key=lambda e: e[0])

    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = len(header) + 16 * len(entries)
    directory = b""
    blob = b""
    for w, h, payload in entries:
        directory += struct.pack(
            "<BBBBHHII",
            0 if w == 256 else w,  # 256 is encoded as 0
            0 if h == 256 else h,
            0,  # colour count — 0 for true colour
            0,  # reserved
            1,  # colour planes
            32,  # bits per pixel
            len(payload),
            offset,
        )
        blob += payload
        offset += len(payload)

    out.write_bytes(header + directory + blob)
    kinds = ", ".join(
        f"{w}={'PNG' if w >= PNG_FROM else 'BMP'}" for w, _, _ in entries
    )
    print(f"  wrote {out.name}: {len(entries)} members ({kinds}), "
          f"{out.stat().st_size} bytes")


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    build(Path(sys.argv[1]), [Path(p) for p in sys.argv[2:]])
    return 0


if __name__ == "__main__":
    sys.exit(main())
