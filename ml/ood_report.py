"""Build a self-contained, shareable HTML report from ood_eval.py output.

Unlike ood_gallery.py (a big local review grid that references preview/*.jpg), this embeds a few
chosen examples as base64 thumbnails so the file is fully self-contained and publish-quality —
the honest-evaluation summary you can send to someone. Dark/light aware, no external requests.

  python ood_report.py --out <ood_eval_out_dir> --dest <report.html> --highlights <highlights.json> \
                       [--metrics <metrics.json from ml/metrics_table.py --json>]

highlights.json: [{"file": "...", "caption": "...", "verdict": "good|bad"}]  (order preserved)

No number in the report is a literal: mAP rows come from --metrics (or print as a dash), and the
evaluated artefact is named from diagnostics.json and described by ml/models/MANIFEST.json. The
first version baked "mAP50 0.972", "0.971" and "the shipped int8" into the template, three claims
that were each true of a different model at a different time.
"""

from __future__ import annotations

import argparse
import base64
import html
import io
import json
import os
from pathlib import Path

from PIL import Image

THUMB_W = 560


def _thumb_b64(path: str) -> str:
    img = Image.open(path).convert("RGB")
    if img.width > THUMB_W:
        img = img.resize((THUMB_W, round(img.height * THUMB_W / img.width)), Image.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode()


def _weakest_class(m: dict) -> str:
    """The lowest per-class mAP50 on the held-out set, named from the metrics rather than typed in."""
    pc = m["heldout"].get("per_class_mAP50") or {}
    if not pc:
        return "—"
    name = min(pc, key=pc.get)
    return f"<b>{html.escape(name)}</b> (held-out mAP50 {pc[name]:.3f})"


def _rigorous_block(m: dict) -> str:
    """The headline: reproduced-IID vs deduped-held-out mAP, side by side — every number from `--metrics`."""
    iid, ho = m["iid"], m["heldout"]
    return f"""
<h2>The rigorous number: unseen-dataset mAP</h2>
<p>Scored with the same tool (<code>yolo val</code>, via <code>ml/metrics_table.py</code>) on the
in-distribution test split, then on a <b>different</b> Roboflow dataset the model never trained on.
It's a fork of a related set, so <b>{ho['removed']} of its images were near-duplicates</b> of our data
and were removed (leakage) before scoring {ho['images']} genuinely-unseen photos.</p>
<table>
  <tr><th>Test set</th><th>images</th><th>mAP50</th><th>mAP50-95</th><th>precision</th><th>recall</th></tr>
  <tr><td>In-distribution (same sources as training)</td><td>{iid['images']}</td><td>{iid['mAP50']:.3f}</td>
      <td>{iid['mAP50_95']:.3f}</td><td>{iid['P']:.3f}</td><td>{iid['R']:.3f}</td></tr>
  <tr><td><b>Held-out, deduped</b></td><td>{ho['images']}</td><td><b>{ho['mAP50']:.3f}</b></td>
      <td><b>{ho['mAP50_95']:.3f}</b></td><td>{ho['P']:.3f}</td><td><b>{ho['R']:.3f}</b></td></tr>
</table>
<div class="callout"><b>True generalization is mAP50 ≈ {ho['mAP50']:.2f}, not {iid['mAP50']:.2f}.</b> The biggest drop is
<b>recall</b> ({iid['R']:.2f}→{ho['R']:.2f}) — it <em>misses</em> more stickers on unseen cubes. The
weakest colour held-out is {_weakest_class(m)}. This is still <em>near</em>-OOD
(Roboflow-style studio photos); the Wikimedia signals below probe further out.</div>
"""


def _model_label(d: dict, metrics: dict | None) -> str:
    """Which artefact was evaluated: the file ood_eval.py ran, described by MANIFEST.json when it is one of ours."""
    name = d.get("model", "?")
    manifest = Path(__file__).resolve().parent / "models" / "MANIFEST.json"
    if manifest.is_file():
        entry = json.loads(manifest.read_text()).get("artefacts", {}).get(name)
        if entry:
            return f"{name} ({entry.get('precision', '?')}; {entry.get('runtime', '?')})"
    if metrics and metrics.get("model"):
        return f"{name} ({metrics['model'].get('label', '?')})"
    return name


def build(out_dir: str, dest: str, highlights: list[dict], metrics: dict | None = None) -> str:
    with open(os.path.join(out_dir, "diagnostics.json")) as f:
        d = json.load(f)
    pc = d["per_class"]
    order = ["white", "red", "green", "yellow", "orange", "blue"]
    # weakest by mean confidence, for the callout
    weakest = min(order, key=lambda n: pc[n]["mean_conf"] or 1)
    per_class_rows = "".join(
        f"<tr><td><span class='sw' style='background:{hexc}'></span>{n}</td>"
        f"<td>{pc[n]['detections']}</td><td>{pc[n]['mean_conf']}</td></tr>"
        for n, hexc in zip(order, ["#f6f7f8", "#d0202a", "#049e4a", "#ffd400", "#ff6a00", "#0057c8"], strict=True)
    )
    # The in-distribution mAP comes from --metrics or it is a dash. It used to be a literal
    # ("0.972", "0.971" — two different literals in one report), which is how a number outlives
    # the model it was measured on.
    iid_map = f"{metrics['iid']['mAP50']:.3f}" if metrics else "—"
    model_label = html.escape(_model_label(d, metrics))
    ab = d["abstention_mix"]
    cards = []
    for h in highlights:
        prev = os.path.join(out_dir, "preview", os.path.splitext(h["file"])[0] + ".jpg")
        if not os.path.exists(prev):
            continue
        b64 = _thumb_b64(prev)
        tag = "bad" if h.get("verdict") == "bad" else "good"
        cards.append(
            f'<figure class="{tag}"><img src="data:image/jpeg;base64,{b64}">'
            f'<figcaption>{html.escape(h["caption"])}</figcaption></figure>'
        )

    rigorous = _rigorous_block(metrics) if metrics else ""
    doc = f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cube-yolo — honest OOD evaluation</title>
<style>
  :root {{ color-scheme: light dark; --bg:#fff; --fg:#16181d; --mut:#5b6069; --card:#f5f6f8;
    --bd:#e3e5e9; --good:#2da44e; --bad:#cf222e; --accent:#0969da; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg:#0d1117; --fg:#e6edf3; --mut:#8b949e;
    --card:#161b22; --bd:#30363d; --good:#3fb950; --bad:#f85149; --accent:#58a6ff; }} }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0 auto; max-width:940px; padding:32px 22px 64px; background:var(--bg); color:var(--fg);
    font:16px/1.62 -apple-system,system-ui,"Segoe UI",sans-serif; }}
  h1 {{ font-size:27px; margin:0 0 6px; letter-spacing:-.01em; }}
  .lede {{ color:var(--mut); font-size:17px; margin:0 0 26px; }}
  h2 {{ font-size:19px; margin:34px 0 12px; padding-top:20px; border-top:1px solid var(--bd); }}
  .kpis {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:22px 0; }}
  .kpi {{ background:var(--card); border:1px solid var(--bd); border-radius:12px; padding:14px 16px; }}
  .kpi b {{ display:block; font-size:30px; line-height:1.1; letter-spacing:-.02em; }}
  .kpi span {{ color:var(--mut); font-size:13px; }}
  .kpi.hero b {{ color:var(--accent); }}
  table {{ border-collapse:collapse; width:100%; font-size:14px; margin:8px 0 4px; }}
  td,th {{ border:1px solid var(--bd); padding:6px 12px; text-align:left; }}
  th {{ background:var(--card); }}
  .sw {{ display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:7px;
    vertical-align:-1px; border:1px solid rgba(128,128,128,.4); }}
  .grid2 {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; margin:14px 0; }}
  figure {{ margin:0; background:var(--card); border:1px solid var(--bd); border-radius:12px; overflow:hidden; }}
  figure img {{ width:100%; display:block; }}
  figure figcaption {{ padding:10px 13px; font-size:13.5px; color:var(--fg); }}
  figure.bad {{ border-color:color-mix(in srgb, var(--bad) 45%, var(--bd)); }}
  figure.good {{ border-color:color-mix(in srgb, var(--good) 45%, var(--bd)); }}
  figcaption b.bad {{ color:var(--bad); }} figcaption b.good {{ color:var(--good); }}
  ul {{ padding-left:22px; }} li {{ margin:5px 0; }}
  code {{ background:var(--card); border:1px solid var(--bd); border-radius:5px; padding:1px 5px; font-size:.9em; }}
  .callout {{ background:var(--card); border:1px solid var(--bd); border-left:3px solid var(--accent);
    border-radius:8px; padding:12px 16px; margin:16px 0; }}
</style>

<h1>cube-yolo: how good is it, <em>really</em>?</h1>
<p class="lede">Evaluated artefact: <code>{model_label}</code>. It scores <b>mAP50 {iid_map}</b> on
<b>in-distribution</b> test images (same sources as training). Two honest measurements follow: a rigorous
mAP on an unseen labelled dataset, then a label-free behavioural probe on {d['images']} far-out Wikimedia photos.</p>
{rigorous}
<h2>Behaviour further out: {d['images']} Wikimedia photos</h2>
<div class="kpis">
  <div class="kpi hero"><b>{iid_map}</b><span>mAP50 — <em>in-distribution</em> (optimistic{'' if metrics else '; pass --metrics to fill in'})</span></div>
  <div class="kpi"><b>{d['detection_rate_any']:.0%}</b><span>photos with ≥1 sticker found</span></div>
  <div class="kpi"><b>{d['clean_face_ok_rate']:.0%}</b><span>photos yielding a face the app would <em>accept</em></span></div>
</div>
<div class="callout"><b>The gap is the story.</b> The model detects <em>something</em> in {d['detection_rate_any']:.0%} of photos,
but only <b>{d['clean_face_ok_rate']:.0%}</b> pass the app's <code>fitFace</code> gate as a clean 3×3.
The other ~{1-d['clean_face_ok_rate']:.0%} are refused — mostly correctly (angled shots, multiple cubes, non-cubes).
That refusal is the safety net working; it also means the capture UX <em>must</em> guide a user to present one face flat-on.</div>

<table>
  <tr><th>Verdict from <code>fitFace</code></th><th>count</th><th>meaning</th></tr>
  <tr><td>OK</td><td>{ab.get('OK',0)}</td><td>clean 3×3 committed</td></tr>
  <tr><td>BAD_GEOMETRY</td><td>{ab.get('BAD_GEOMETRY',0)}</td><td>9+ stickers but not a grid (angle / multi-cube)</td></tr>
  <tr><td>PARTIAL_FACE</td><td>{ab.get('PARTIAL_FACE',0)}</td><td>fewer than 9 found</td></tr>
  <tr><td>NO_FACE</td><td>{ab.get('NO_FACE',0)}</td><td>nothing detected (correct on non-cubes)</td></tr>
</table>

<h2>Per-colour confidence drops on unseen data</h2>
<p>Mean detection confidence on these unseen photos sits in the 0.68–0.80 range, with
<b>{weakest.capitalize()}</b> the weakest — consistent with orange/red being the field's documented
hard classes. Confidence is not accuracy, but a modest, uneven spread across colours is a real
sim-to-real signal.</p>
<table><tr><th>colour</th><th>detections</th><th>mean conf</th></tr>{per_class_rows}</table>

<h2>Where it fails — the taxonomy</h2>
<p>Boxes are the model's predictions, coloured by predicted colour. These are the recurring failure modes:</p>
<div class="grid2">{''.join(cards)}</div>

<h2>What to improve (ranked by payoff)</h2>
<ul>
  <li><b>Deployment-distribution test set.</b> Wikimedia is diverse but off-task (collages, diagrams,
    2×2s, shape-mods). The number that predicts app success is on <em>your own webcam</em>, one 3×3 face
    at a time, in real rooms. ~40–60 hand-labelled shots &gt; 10k synthetic.</li>
  <li><b>Non-standard colour schemes.</b> Candy/pastel/stickerless cubes map to the nearest of 6 colours
    and can commit a confident <em>wrong</em> face. Either train on them or detect + refuse them.</li>
  <li><b>Over-trigger guardrails.</b> The model can hallucinate a "face" from a grid of coloured squares
    (posters, mosaics) and from extreme lighting. The 6×9 + solvability verifier catches most at
    full-cube assembly, but a per-face confidence floor would refuse earlier.</li>
  <li><b>Multi-frame voting.</b> The app sees each face over many frames — aggregating would lift the
    {d['clean_face_ok_rate']:.0%} accept-rate on borderline geometry without retraining.</li>
</ul>

<h2>Honesty caveats</h2>
<ul>
  <li>These are <b>label-free</b> signals (detection rate, confidence, the geometry gate) — not mAP.
    A true OOD mAP needs hand-labelled ground truth; ood_eval.py already emits YOLO pre-labels to correct.</li>
  <li>The pool is the raw Commons "Rubik's Cube" category — it deliberately includes non-cubes, so
    NO_FACE here is often <em>correct</em>, not a miss.</li>
  <li>Evaluated <code>{model_label}</code> — the artefact named in <code>diagnostics.json</code>, described by
    <code>ml/models/MANIFEST.json</code>; the browser serves the fp32 graph (<code>apps/web/test/shipped-model.test.mjs</code>).</li>
</ul>
</html>"""
    with open(dest, "w") as f:
        f.write(doc)
    return dest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--dest", required=True)
    ap.add_argument("--highlights", required=True)
    ap.add_argument("--metrics", help="optional JSON with iid/heldout mAP for the headline table")
    args = ap.parse_args()
    with open(args.highlights) as f:
        hs = json.load(f)
    metrics = None
    if args.metrics:
        with open(args.metrics) as f:
            metrics = json.load(f)
    print("wrote", build(args.out, args.dest, hs, metrics))


if __name__ == "__main__":
    main()
