"""Fetch a diverse set of CC0 HDRI environment maps from Poly Haven for domain randomization.

Each HDRI drives both the scene lighting (image-based lighting) and the visible background, so
variety here is what teaches the detector to ignore lighting/background. Poly Haven is CC0
(no attribution required) and serves a public JSON API + CDN, so this needs no key.

  python3 fetch_hdris.py --out ~/datasets/hdris --count 200 --res 1k

Idempotent: an HDRI already on disk is skipped, so re-running resumes an interrupted fetch.
Stdlib only (urllib) — no runtime deps, matching the rest of the pipeline.
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API = "https://api.polyhaven.com"
UA = {"User-Agent": "cubus-ml/1.0 (synthetic cube dataset; CC0 HDRI fetch)"}


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def list_hdri_slugs(count: int) -> list[str]:
    """All HDRI slugs, evenly sampled to `count` so we span the library (indoor/outdoor/studio)."""
    assets = _get_json(f"{API}/assets?type=hdris")
    slugs = sorted(assets.keys())
    if count >= len(slugs):
        return slugs
    step = len(slugs) / count  # even stride across the sorted list → a spread, not the first N
    return [slugs[int(i * step)] for i in range(count)]


def file_url(slug: str, res: str) -> str | None:
    """The .hdr download URL for a slug at resolution `res` (fall back to 2k, then any hdr res)."""
    files = _get_json(f"{API}/files/{slug}")
    hdri = files.get("hdri", {})
    for candidate in (res, "2k", "1k", "4k"):
        entry = hdri.get(candidate, {}).get("hdr")
        if entry and entry.get("url"):
            return entry["url"]
    return None


def download(slug: str, res: str, out_dir: str) -> tuple[str, str]:
    """Return (slug, status). Skips existing files; reports failures instead of raising."""
    dest = os.path.join(out_dir, f"{slug}.hdr")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return slug, "skip (exists)"
    try:
        url = file_url(slug, res)
        if not url:
            return slug, "no hdr url"
        req = urllib.request.Request(url, headers=UA)
        tmp = dest + ".part"
        with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
            f.write(r.read())
        os.replace(tmp, dest)  # atomic → an interrupted download never looks complete
        return slug, f"ok ({os.path.getsize(dest) // 1024} KB)"
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
        return slug, f"FAIL {e}"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True, help="output folder for .hdr files")
    p.add_argument("--count", type=int, default=200)
    p.add_argument("--res", default="1k", help="1k is plenty for lighting; bigger = sharper bg")
    p.add_argument("--workers", type=int, default=8)
    args = p.parse_args()

    os.makedirs(args.out, exist_ok=True)
    slugs = list_hdri_slugs(args.count)
    print(f"selected {len(slugs)} HDRIs (res {args.res}) → {args.out}")

    ok = fail = skip = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(download, s, args.res, args.out): s for s in slugs}
        for i, fut in enumerate(as_completed(futs), 1):
            slug, status = fut.result()
            if status.startswith("ok"):
                ok += 1
            elif status.startswith("skip"):
                skip += 1
            else:
                fail += 1
                print(f"  [{i}/{len(slugs)}] {slug}: {status}")
            if i % 25 == 0:
                print(f"  … {i}/{len(slugs)} (ok={ok} skip={skip} fail={fail})")

    have = len([f for f in os.listdir(args.out) if f.endswith(".hdr")])
    print(f"done: ok={ok} skip={skip} fail={fail} | {have} .hdr files on disk in {args.out}")


if __name__ == "__main__":
    main()
