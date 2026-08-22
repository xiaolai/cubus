"""Build a local HTML review gallery from ood_eval.py output.

The point of an OOD test set is to SEE the failures, not just read an aggregate number. This
groups the annotated previews by the model's verdict (clean face / partial / no-face) so a human
can scan them fast, spot the wrong colours and missed stickers, and pick which images are worth
hand-correcting into a real labelled test set.

References preview/*.jpg by relative path (a 100+ image gallery can't be base64-inlined), so keep
the HTML inside the eval output dir. Dark/light aware.

  python ood_gallery.py --out <ood_eval_out_dir>   # reads diagnostics.json, writes gallery.html
"""

from __future__ import annotations

import argparse
import html
import json
import os

ORDER = ["OK", "PARTIAL_FACE", "BAD_GEOMETRY", "NO_FACE"]
TITLE = {
    "OK": "Clean face detected — a 3×3 the app would accept",
    "PARTIAL_FACE": "Partial — fewer than 9 stickers found",
    "BAD_GEOMETRY": "Bad geometry — 9+ found but not a grid",
    "NO_FACE": "No face — nothing detected (correct on non-cubes; a miss on real cubes)",
}


def build(out_dir: str) -> str:
    with open(os.path.join(out_dir, "diagnostics.json")) as f:
        diag = json.load(f)
    groups: dict[str, list[dict]] = {k: [] for k in ORDER}
    for r in diag["records"]:
        groups.setdefault(r["face"], []).append(r)

    pc = diag["per_class"]
    per_class_rows = "".join(
        f"<tr><td>{n}</td><td>{pc[n]['detections']}</td><td>{pc[n]['mean_conf']}</td></tr>"
        for n in ["white", "red", "green", "yellow", "orange", "blue"]
    )

    cards = []
    for k in ORDER:
        recs = groups.get(k, [])
        if not recs:
            continue
        cards.append(f'<h2>{html.escape(TITLE.get(k, k))} <span class="count">{len(recs)}</span></h2>')
        cards.append('<div class="grid">')
        for r in sorted(recs, key=lambda x: -x["detections"]):
            stem = os.path.splitext(r["file"])[0]
            src = f"preview/{html.escape(stem)}.jpg"
            cap = f"{r['detections']} stickers"
            cards.append(
                f'<figure><a href="{src}" target="_blank"><img loading="lazy" src="{src}"></a>'
                f'<figcaption>{cap}<br><span class="fn">{html.escape(r["file"])[:34]}</span></figcaption></figure>'
            )
        cards.append("</div>")

    doc = f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cube-yolo — OOD review</title>
<style>
  :root {{ color-scheme: light dark; --bg:#fff; --fg:#111; --mut:#666; --card:#f4f4f5; --bd:#e4e4e7; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg:#0d1117; --fg:#e6edf3; --mut:#8b949e; --card:#161b22; --bd:#30363d; }} }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; padding:24px; background:var(--bg); color:var(--fg);
    font:15px/1.55 -apple-system,system-ui,sans-serif; }}
  h1 {{ font-size:22px; margin:0 0 4px; }} .sub {{ color:var(--mut); margin:0 0 18px; }}
  .kpis {{ display:flex; flex-wrap:wrap; gap:12px; margin:0 0 18px; }}
  .kpi {{ background:var(--card); border:1px solid var(--bd); border-radius:10px; padding:10px 14px; }}
  .kpi b {{ display:block; font-size:22px; }} .kpi span {{ color:var(--mut); font-size:12px; }}
  table {{ border-collapse:collapse; margin:0 0 18px; font-size:13px; }}
  td,th {{ border:1px solid var(--bd); padding:4px 10px; text-align:left; }}
  h2 {{ font-size:16px; margin:22px 0 10px; border-top:1px solid var(--bd); padding-top:14px; }}
  h2 .count {{ color:var(--mut); font-weight:400; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:12px; }}
  figure {{ margin:0; background:var(--card); border:1px solid var(--bd); border-radius:10px; overflow:hidden; }}
  figure img {{ width:100%; display:block; aspect-ratio:1; object-fit:cover; }}
  figcaption {{ padding:6px 8px; font-size:12px; color:var(--mut); }}
  .fn {{ font-size:10px; opacity:.7; }}
  .note {{ background:var(--card); border:1px solid var(--bd); border-radius:10px; padding:12px 16px; margin:0 0 18px; }}
</style>
<h1>cube-yolo — out-of-distribution review</h1>
<p class="sub">Model <code>{html.escape(diag['model'])}</code> on {diag['images']} unseen Wikimedia Commons photos.
Boxes are the model's predictions, coloured by predicted colour. This is a <em>behavioural</em> read
(no ground-truth labels yet) — scan for wrong colours &amp; missed stickers.</p>
<div class="kpis">
  <div class="kpi"><b>{diag['detection_rate_any']:.0%}</b><span>found ≥1 sticker</span></div>
  <div class="kpi"><b>{diag['full_face_rate_9plus']:.0%}</b><span>found ≥9 (a full face)</span></div>
  <div class="kpi"><b>{diag['clean_face_ok_rate']:.0%}</b><span>clean 3×3 (app would accept)</span></div>
</div>
<div class="note"><b>How to read this:</b> the OK group is where the app would commit a face — check those
colours hardest. NO_FACE is correct on the non-cube photos Commons mixes in, but each real cube in there
is a real miss. Open any image to see it full-size; the ones worth hand-labelling are the OK/PARTIAL cubes.</div>
<table><tr><th>colour</th><th>detections</th><th>mean conf</th></tr>{per_class_rows}</table>
{''.join(cards)}
</html>"""
    dest = os.path.join(out_dir, "gallery.html")
    with open(dest, "w") as f:
        f.write(doc)
    return dest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    print("wrote", build(args.out))


if __name__ == "__main__":
    main()
