"""cubedet — the permissively-licensed sticker detector this repository trains and ships.

Depends on PyTorch (BSD-3) and torchvision (BSD-3) and nothing else. See
`ml/DETECTOR_PROVENANCE.md` for what was read while writing it and what was not.
"""

from .model import NUM_CLASSES, REG_MAX, STRIDES, CubeDet, ExportWrapper, count_parameters

__all__ = ["CubeDet", "ExportWrapper", "NUM_CLASSES", "REG_MAX", "STRIDES", "count_parameters"]
