"""cubedet — the permissively-licensed sticker detector that replaces the Ultralytics-trained one.

Depends on PyTorch (BSD-3) and torchvision (BSD-3) and nothing else. See
`ml/PERMISSIVE_DETECTOR_PROVENANCE.md` for what was read while writing it and what was not.
"""

from .model import NUM_CLASSES, REG_MAX, STRIDES, CubeDet, ExportWrapper, count_parameters

__all__ = ["CubeDet", "ExportWrapper", "NUM_CLASSES", "REG_MAX", "STRIDES", "count_parameters"]
