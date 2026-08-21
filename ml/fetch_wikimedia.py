"""Fetch real Rubik's-cube photos from Wikimedia Commons for the OOD / hard-case pool.

Commons has cubes across brands, materials (stickered/stickerless), eras, and even partially
twisted states — exactly the tail diversity a synthetic renderer can't cover. It's no-auth (the
MediaWiki API), but every file is individually licensed, so we record the license + attribution
for each into a manifest and NEVER assume a blanket license.

  python fetch_wikimedia.py --out ~/datasets/real_cube/wikimedia --category "Rubik's Cube" --recurse 1

Stdlib only. Skips files already on disk (resumable). Writes manifest.csv alongside the images.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia's UA policy wants a descriptive client + contact; a bare UA gets 403/429.
UA = {"User-Agent": "cubus-ml/1.0 (https://github.com/xiaolai/cubus; Rubik's cube OOD dataset research)"}
IMG_EXT = (".jpg", ".jpeg", ".png")
DELAY = 0.5  # polite gap between API calls; Commons rate-limits bursts with HTTP 429


def _safe_name(title: str) -> str:
    """Remote titles are untrusted → reduce to a bare filename (no path traversal via ../ or /)."""
    name = title[len("File:") :] if title.startswith("File:") else title
    name = os.path.basename(name.replace(" ", "_").replace("\\", "/"))  # kill any path components
    name = name.lstrip(".") or ""  # no leading dots (., ..)
    return name


def _csv_safe(value: str) -> str:
    """Neutralize spreadsheet formula injection (a field starting with = + - @ can execute)."""
    value = value or ""
    return "'" + value if value[:1] in ("=", "+", "-", "@") else value


def _fetch(url: str, timeout: int = 60, tries: int = 5) -> bytes:
    """GET with exponential backoff on 429/503 (Commons throttles bursts). Raises on give-up."""
    if urllib.parse.urlparse(url).scheme not in ("http", "https"):
        raise ValueError(f"refusing non-http(s) URL: {url!r}")  # SSRF guard (file://, ftp://, …)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < tries - 1:
                time.sleep(2 ** attempt)  # 1, 2, 4, 8 s
                continue
            raise
    raise RuntimeError("unreachable")


def _api(params: dict) -> dict:
    params = {**params, "format": "json"}
    url = API + "?" + urllib.parse.urlencode(params)
    time.sleep(DELAY)
    return json.loads(_fetch(url, timeout=30))


def category_members(category: str, recurse: int) -> tuple[list[str], list[str]]:
    """Return (file titles, subcategory titles) for a category, recursing `recurse` levels."""
    files: list[str] = []
    subcats: list[str] = []
    cmcontinue = None
    while True:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": f"Category:{category}",
            "cmtype": "file|subcat",
            "cmlimit": "500",
        }
        if cmcontinue:
            params["cmcontinue"] = cmcontinue
        data = _api(params)
        for m in data.get("query", {}).get("categorymembers", []):
            title = m["title"]
            if title.startswith("Category:"):
                subcats.append(title[len("Category:") :])
            elif os.path.splitext(title)[1].lower() in IMG_EXT:
                files.append(title)
        cmcontinue = data.get("continue", {}).get("cmcontinue")
        if not cmcontinue:
            break
    if recurse > 0:
        for sc in list(subcats):
            sub_files, _ = category_members(sc, recurse - 1)
            files.extend(sub_files)
    return files, subcats


def image_info(titles: list[str]) -> dict[str, dict]:
    """url + license + attribution for up to 50 file titles per call."""
    out: dict[str, dict] = {}
    for i in range(0, len(titles), 50):
        batch = titles[i : i + 50]
        data = _api({
            "action": "query",
            "titles": "|".join(batch),
            "prop": "imageinfo",
            "iiprop": "url|extmetadata",
        })
        for page in data.get("query", {}).get("pages", {}).values():
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata", {})
            out[page["title"]] = {
                "url": info.get("url"),
                "license": (meta.get("LicenseShortName", {}) or {}).get("value", "unknown"),
                "artist": (meta.get("Artist", {}) or {}).get("value", ""),
            }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--category", default="Rubik's Cube")
    ap.add_argument("--recurse", type=int, default=1, help="how many subcategory levels to descend")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    files, subcats = category_members(args.category, args.recurse)
    files = sorted(set(files))
    print(f"found {len(files)} files across '{args.category}' + {len(subcats)} subcategories")
    info = image_info(files)

    manifest = os.path.join(args.out, "manifest.csv")
    ok = fail = skip = 0
    with open(manifest, "w", newline="", encoding="utf-8") as mf:
        w = csv.writer(mf)
        w.writerow(["filename", "source_url", "license", "attribution_html"])
        out_abs = os.path.abspath(args.out)
        for title in files:
            meta = info.get(title, {})
            url = meta.get("url")
            if not url:
                fail += 1
                continue
            safe = _safe_name(title)
            dest = os.path.join(args.out, safe)
            # defense in depth: never write outside the output dir
            if not safe or os.path.commonpath([os.path.abspath(dest), out_abs]) != out_abs:
                fail += 1
                continue
            w.writerow([_csv_safe(safe), _csv_safe(url), _csv_safe(meta.get("license", "unknown")),
                        _csv_safe(meta.get("artist", ""))])
            if os.path.exists(dest) and os.path.getsize(dest) > 0:
                skip += 1
                continue
            try:
                with open(dest + ".part", "wb") as f:
                    f.write(_fetch(url, timeout=120))
                os.replace(dest + ".part", dest)
                ok += 1
            except Exception as e:  # noqa: BLE001
                fail += 1
                print(f"  FAIL {safe}: {e}")
    have = len([f for f in os.listdir(args.out) if os.path.splitext(f)[1].lower() in IMG_EXT])
    print(f"done: ok={ok} skip={skip} fail={fail} | {have} images in {args.out} | manifest: {manifest}")


if __name__ == "__main__":
    main()
