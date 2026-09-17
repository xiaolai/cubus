"""The identity of a model artefact: the one definition export.py writes and the golden gate checks.

A file is its bytes. A directory (an .mlpackage) is its sorted relative paths and their contents, with
one exception: the package's Manifest.json names its two items by UUIDs that coremltools draws at
random on every save. Hashed as bytes, those made the recorded hash of the CoreML artefact impossible
to reproduce -- re-exporting the shipped checkpoint on 2026-09-17 gave a byte-identical model spec,
byte-identical weights, the same fp32 ONNX and the same TFLite, and a different CoreML hash, so
anyone checking the manifest's provenance would have concluded the CoreML artefact was not what the
checkpoint produces. The manifest is therefore hashed with each item named by its path, which is what
the identifiers stand for; every other field, and which item is the root, still counts.

Standard library only, so the golden gate can import it without the export stack.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

PACKAGE_MANIFEST = "Manifest.json"


def artefact_sha256(path: Path) -> str:
    """Hash a file by its bytes, or a directory by its paths and contents (see the module docstring)."""
    h = hashlib.sha256()
    if path.is_dir():
        for p in sorted(path.rglob("*")):
            if not p.is_file():
                continue
            relative = str(p.relative_to(path))
            h.update(relative.encode())
            h.update(_canonical_package_manifest(p) if relative == PACKAGE_MANIFEST else p.read_bytes())
    else:
        h.update(path.read_bytes())
    return h.hexdigest()


def _canonical_package_manifest(path: Path) -> bytes:
    """An .mlpackage's Manifest.json with its random item identifiers replaced by the items' paths."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    items = doc.get("itemInfoEntries", {})
    canonical = {
        "items": sorted(items.values(), key=lambda item: item.get("path", "")),
        "root": items.get(doc.get("rootModelIdentifier"), {}).get("path"),
        "rest": {k: v for k, v in doc.items() if k not in ("itemInfoEntries", "rootModelIdentifier")},
    }
    return json.dumps(canonical, sort_keys=True).encode()
