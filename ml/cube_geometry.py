"""Cube sticker geometry — pure, no Blender, so it's unit-testable off-GPU.

A 3x3x3 cube centred at the origin with half-size 1.0. Each of the 6 faces carries a 3x3
grid of 9 sticker quads, slightly raised off the body so they read as coloured tiles with
black gaps between them (the real look). This module only produces the geometry (where each
sticker sits and how it's oriented); the BlenderProc generator turns each into a coloured
plane and the renderer projects them to 2D labels.

Face frame convention (right-handed, Blender Z-up):
    R +X, L -X, U +Z, D -Z, F +Y, B -Y
Each sticker has a center and two in-plane half-axes (u, v) so a quad's four corners are
center ± u ± v.
"""

from __future__ import annotations

from dataclasses import dataclass

HALF = 1.0  # cube half-size (body spans [-1, 1] on each axis)
GAP = 0.06  # fraction of a cell left as the black gap between stickers
RAISE = 0.005  # lift stickers off the body to avoid z-fighting

# 6 faces: name, outward normal, and the two in-plane unit axes (u = "column"/x, v = "row"/y).
_FACES: list[tuple[str, tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]] = [
    ("R", (1, 0, 0), (0, 1, 0), (0, 0, 1)),
    ("L", (-1, 0, 0), (0, -1, 0), (0, 0, 1)),
    ("U", (0, 0, 1), (1, 0, 0), (0, 1, 0)),
    ("D", (0, 0, -1), (1, 0, 0), (0, -1, 0)),
    ("F", (0, 1, 0), (-1, 0, 0), (0, 0, 1)),
    ("B", (0, -1, 0), (1, 0, 0), (0, 0, 1)),
]

FACE_NAMES = [f[0] for f in _FACES]


@dataclass(frozen=True)
class Sticker:
    face: str  # 'U','R','F','D','L','B'
    row: int  # 0..2
    col: int  # 0..2
    center: tuple[float, float, float]
    u: tuple[float, float, float]  # in-plane half-axis (half a sticker wide)
    v: tuple[float, float, float]
    size: float  # full sticker edge length


def _scale(v: tuple[float, float, float], s: float) -> tuple[float, float, float]:
    return (v[0] * s, v[1] * s, v[2] * s)


def _add(*vs: tuple[float, float, float]) -> tuple[float, float, float]:
    return (sum(v[0] for v in vs), sum(v[1] for v in vs), sum(v[2] for v in vs))


def stickers() -> list[Sticker]:
    """The 54 stickers (9 per face) with positions on the cube surface, in reading order."""
    cell = (2 * HALF) / 3.0  # a face is 2 units wide → 3 cells of 2/3
    size = cell * (1.0 - GAP)
    half_cell = cell / 2.0
    out: list[Sticker] = []
    for name, n, u, v in _FACES:
        base = _scale(n, HALF + RAISE)  # face plane, raised slightly
        for row in range(3):
            for col in range(3):
                # cell centers at offsets {-cell, 0, +cell} along u and v
                cu = _scale(u, (col - 1) * cell)
                cv = _scale(v, (row - 1) * cell)
                center = _add(base, cu, cv)
                out.append(
                    Sticker(
                        face=name,
                        row=row,
                        col=col,
                        center=center,
                        u=_scale(u, half_cell * (1.0 - GAP)),
                        v=_scale(v, half_cell * (1.0 - GAP)),
                        size=size,
                    )
                )
    return out
