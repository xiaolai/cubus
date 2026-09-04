#!/usr/bin/env python
"""The golden-frame parity harness: every runtime must read every fixture the way it was pinned to.

    ml/venv/bin/python ml/golden_frames.py                       # every leg this platform has (all five on macOS)
    ml/venv/bin/python ml/golden_frames.py --write-expected --yes [--repin-checkpoint REASON]   # re-pin, guarded
    ml/venv/bin/python ml/golden_frames.py --write-expected --yes --fixture NAME.png            # re-pin ONE fixture
    ml/venv/bin/python ml/golden_frames.py --parity --legs onnx onnx-int8 tflite   # Linux CI
    ml/venv/bin/python ml/golden_frames.py --parity --legs onnx coreml native      # macOS CI

TWO MODES, because only one of the things this compares is reproducible off the pinning host.

  PINNED (default) — every leg must reproduce `golden/expected.json` EXACTLY, fixture by fixture.
  This is the gate AGENTS.md requires before a model is vendored, and it is only meaningful on the
  machine the pin was written on: `pinned_on` records that host for a reason. A read is the output
  of floating-point inference, and the arithmetic is not portable — ONNX's dynamic-int8 kernels
  differ between x86 (AVX-512/VNNI) and Apple Silicon (NEON), and CoreML dispatches to ANE, GPU or
  CPU by what the machine has. Near a decision boundary that flips the decoded class.

  PARITY (--parity) — for CI, on hardware that is not the pinning host. It asserts the RELATIONS
  between legs, both sides computed in the same run on the same machine, plus the two things that
  ARE portable: the model bytes (MANIFEST.json) and the letterbox sha (integer image work). See
  `parity()` for the measurements that forced the split.

Each fixture in `golden/frames/` goes through the app's exact letterbox, one runtime, then the app's
exact post-processing (decode → NMS → fitFace). What is compared is the DECODED READ — the verdict
and the nine sticker classes — not raw scores: quantisation and fp16 move scores a little, and a class
that survives that is what the app actually depends on.

The legs:
  * onnx        — the fp32 reference (Python / onnxruntime). This IS the shipped web model: the
                  browser, Windows, Linux and the Android WebView all serve this graph.
  * onnx-int8   — the dynamic-int8 ONNX, via onnxruntime. NOT shipped anywhere (the label used to
                  say "web / Windows / Linux runtime"; those serve fp32); kept as the bounded leg
                  because it is the export that misreads, and a gate should hold the worst artefact.
  * coreml      — the .mlpackage through coremltools (Python), the Apple runtime's model.
  * tflite      — the weight-only (dynamic-range) int8 TFLite, via ai-edge-litert. Bundled in the
                  Android APK but gated off (`verifiedOnDevice=false` in VisionPlugin.kt).
  * native      — the PLUGIN's own path: crates/cube-vision's Swift letterbox + CoreML, driven through
                  `cube-vision-probe`. This is the one that proves the shipped native code — not a
                  Python stand-in — reads frames identically, with no Tauri and no camera.

`golden/expected.json` pins, per fixture, the SHA-256 of the letterboxed tensor (tying the Python,
TypeScript and Swift letterboxes to the same bytes) and EACH runtime's read. A leg passes only if
every fixture matches its OWN pin, so the gate catches drift in any single runtime over time. It also
pins WHICH MODEL the reads belong to (`model`: the checkpoint sha256 and the fp32 sha256 from
MANIFEST.json) — without that, a checkpoint swap made through export.py regenerated the manifest and
nothing compared the new manifest to the pins. Two facts are then asserted from the pins, because
they are the decision the harness defends:

  * CoreML and the native plugin (both fp16 on Apple) never read a face DIFFERENTLY from fp32, and
    never commit to a face fp32 refused. They MAY refuse a frame fp32 reads. The rule is directional,
    not "exact": on this pinning host it is exact (0/20), on a GitHub M1-class runner one fixture
    abstains where fp32 reads it — see `parity()` for the measurement.
  * int8 may diverge from fp32, but only within the pinned bound recorded here, and only on frames
    already pinned as misreads: a NEW misread — a refusal that turned into a face, a face that turned
    into a different one — fails the gate even when the count stays inside the bound
    (`new_misreads`). tflite is held to the same rule with a bound of 0.

Exit status is the verdict: 0 when every requested leg matches its pins, 1 otherwise. A requested leg
that cannot run (no CoreML off macOS, a missing model or probe binary) is a FAILURE, not a skip — a
gate that quietly skips is not a gate. The default leg set is everything this PLATFORM has (all
five on macOS, the three Python legs elsewhere), never "everything that happens to be installed":
a missing probe or runtime fails, and the legs not run are printed on every run. Runs `os._exit` at
the end because coremltools aborts in a static destructor at normal interpreter shutdown; the exit
code is taken first, so nothing is masked.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import struct
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cube_infer  # noqa: E402

MODELS = HERE / "models"
FRAMES = HERE / "golden" / "frames"
EXPECTED = HERE / "golden" / "expected.json"
PROBE = HERE.parent / "crates" / "cube-vision" / "swift" / ".build" / "release" / "cube-vision-probe"
ALL_LEGS = ("onnx", "onnx-int8", "coreml", "tflite", "native")
FAITHFUL_LEGS = ("onnx", "coreml", "native")
# The strings expected.json carries for the bounded legs — written from here on every re-pin, so
# the file cannot describe a shipping state the code no longer believes (it did, for months).
BOUNDED_LEGS = {
    "onnx-int8": "NOT shipped (web, Windows, Linux and the Android WebView serve the fp32 graph); onnxruntime dynamic int8 — QInt8 weights, uint8 activations",
    "tflite": "bundled in the Android APK, gated off (verifiedOnDevice=false); weight-only (dynamic-range) int8, fp32 activations",
}


def read_string(read: cube_infer.FaceRead) -> str:
    """The compact pinned form: an abstention name, or 'OK' + the nine class digits."""
    return read.verdict if read.colors is None else "OK " + "".join(str(c) for c in read.colors)


class Leg:
    """One runtime behind a common `evaluate(png) -> (letterbox_sha256, read_string)` face.

    Box coordinates are passed through untouched: the read (decode → NMS → fit) is invariant to a
    global scale on the boxes — every gap in the grid fit is compared to the mean sticker size — so
    whether a runtime emits boxes in [0,1] or in 640-space the nine classes come out identical. Only
    the tensor ORIENTATION is normalised, since that reorders the data rather than scaling it.
    """

    def __init__(self, name: str, models: Path, compute_units: str, probe: Path):
        self.name = name
        self.models = models
        self.compute_units = compute_units
        self.probe = probe
        if name in ("onnx", "onnx-int8"):
            import onnxruntime as ort

            path = models / ("cube-yolo.onnx" if name == "onnx" else "cube-yolo.int8.onnx")
            if not path.is_file():
                raise FileNotFoundError(f"{path} — run export.py")
            self.session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
            self.input = self.session.get_inputs()[0].name
        elif name == "coreml":
            if platform.system() != "Darwin":
                raise RuntimeError("the coreml leg needs macOS (CoreML cannot execute anywhere else)")
            import coremltools as ct

            units = {"all": ct.ComputeUnit.ALL, "cpu_and_gpu": ct.ComputeUnit.CPU_AND_GPU, "cpu_only": ct.ComputeUnit.CPU_ONLY, "cpu_and_ne": ct.ComputeUnit.CPU_AND_NE}[compute_units]
            path = models / "cube-yolo.mlpackage"
            if not path.exists():
                raise FileNotFoundError(f"{path} — run export.py")
            self.model = ct.models.MLModel(str(path), compute_units=units)
            spec = self.model.get_spec()
            self.cml_in = spec.description.input[0].name
            self.cml_out = spec.description.output[0].name
        elif name == "tflite":
            from ai_edge_litert.interpreter import Interpreter

            path = models / "cube-yolo.tflite"
            if not path.is_file():
                raise FileNotFoundError(f"{path} — run export.py")
            self.interp = Interpreter(model_path=str(path), num_threads=4)
            self.interp.allocate_tensors()
            self.in_detail = self.interp.get_input_details()[0]
            self.out_detail = self.interp.get_output_details()[0]
            if self.in_detail["dtype"] != np.float32 or self.out_detail["dtype"] != np.float32:
                raise RuntimeError(f"tflite I/O must be float32 (export.py picks the float-I/O graph); got in={self.in_detail['dtype']} out={self.out_detail['dtype']}")
        elif name == "native":
            if platform.system() != "Darwin":
                raise RuntimeError("the native leg needs macOS (CoreML)")
            if not probe.is_file():
                raise FileNotFoundError(f"{probe} — build it: (cd crates/cube-vision/swift && swift build -c release)")
            if not (models / "cube-yolo.mlpackage").exists():
                raise FileNotFoundError(f"{models / 'cube-yolo.mlpackage'} — run export.py")
        else:
            raise ValueError(name)

    def _out(self, chw: np.ndarray) -> np.ndarray:
        if self.name in ("onnx", "onnx-int8"):
            return self.session.run(None, {self.input: chw[None]})[0][0]
        if self.name == "coreml":
            out = self.model.predict({self.cml_in: chw[None]})[self.cml_out]
            return np.asarray(out, dtype=np.float32).reshape(out.shape[-2], out.shape[-1])
        # tflite
        shape = tuple(self.in_detail["shape"])
        x = chw[None] if len(shape) == 4 and shape[1] == 3 else np.ascontiguousarray(chw.transpose(1, 2, 0)[None])
        self.interp.set_tensor(self.in_detail["index"], np.ascontiguousarray(x, dtype=np.float32))
        self.interp.invoke()
        out = np.asarray(self.interp.get_tensor(self.out_detail["index"]), dtype=np.float32)
        while out.ndim > 2 and out.shape[0] == 1:
            out = out[0]
        if out.shape[0] != 4 + cube_infer.NUM_CLASSES and out.shape[1] == 4 + cube_infer.NUM_CLASSES:
            out = out.T
        return out

    def evaluate(self, png: Path) -> tuple[str, str]:
        if self.name == "native":
            with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tf:
                out_bin = Path(tf.name)
            try:
                r = subprocess.run([str(self.probe), str(self.models / "cube-yolo.mlpackage"), str(png), str(out_bin), self.compute_units], capture_output=True, text=True)
                if r.returncode != 0:
                    raise RuntimeError(f"cube-vision-probe failed on {png.name}: {r.stderr.strip()[:200]}")
                sha = r.stdout.strip()
                raw = out_bin.read_bytes()
                rows, anchors = struct.unpack("<ii", raw[:8])
                data = np.frombuffer(raw[8:], dtype="<f4").reshape(rows, anchors)
            finally:
                out_bin.unlink(missing_ok=True)
            return sha, read_string(cube_infer.read_face(data))
        chw = cube_infer.letterbox(cube_infer.load_rgb(str(png)))
        return cube_infer.tensor_sha256(chw), read_string(cube_infer.read_face(self._out(chw)))


def sha256_of(path: Path) -> str:
    """Hash a file, or a directory (an .mlpackage) by its sorted relative paths and contents.

    Deliberately the same method as ml/export.py's `sha256`, because it is that function's output
    this compares against — MANIFEST.json is written by export.py. Duplicated rather than imported
    so the gate does not drag ultralytics and torch into a CI job that only needs to read bytes; if
    the two ever disagree the manifest check goes red, which is the loud failure, not a silent one.
    """
    h = hashlib.sha256()
    if path.is_dir():
        for p in sorted(path.rglob("*")):
            if p.is_file():
                h.update(str(p.relative_to(path)).encode())
                h.update(p.read_bytes())
    else:
        h.update(path.read_bytes())
    return h.hexdigest()


def reads_a_face(read: str) -> bool:
    """True when a read commits to nine stickers, false when it abstains.

    `read_string` emits either an abstention's verdict name or 'OK ' + nine digits, so committing is
    exactly the 'OK ' prefix. This is the categorical distinction the faithfulness check turns on:
    between two reads that disagree, one that ABSTAINS is a different kind of event from one that
    names a different cube.
    """
    return read.startswith("OK ")


def classify_faithful(reads: dict[str, str], ref: dict[str, str]) -> tuple[list[str], list[str]]:
    """Split a faithful leg's disagreements with fp32 into (wrong, refused).

    The split turns on what the fp16 leg COMMITTED to, never on what fp32 did. If fp16 named a face
    and the two disagree, then either fp32 named a different one or fp32 refused outright — both are
    the defect a user would feel. If fp16 refused, the disagreement is a refusal whatever fp32 said,
    and refusing is what the app is supposed to do when it cannot validate a read.

    Pure, and separated from `parity` on purpose: this is the whole content of the faithfulness
    claim, and `--self-check` exercises it directly so an inverted comparison cannot pass by being
    buried behind a manifest read and five legs of inference. It was in fact inverted when first
    written — it ORed in the fp32 side, which failed the very case the CI measurement had just
    shown to be acceptable.
    """
    div = [n for n in ref if reads.get(n) != ref[n]]
    wrong = [n for n in div if reads_a_face(reads.get(n, ""))]
    return wrong, [n for n in div if n not in wrong]


def new_misreads(live: dict[str, str], ref: dict[str, str], pinned_live: dict[str, str], pinned_ref: dict[str, str]) -> list[str]:
    """Fixtures a bounded leg MISREADS now that it did not misread when it was pinned.

    The count bound in `parity()` is necessary and not sufficient: int8 diverging on five fixtures
    was pinned as a bound of 5, and a run in which one pinned REFUSAL had become a committed face,
    or one pinned agreement had become a different cube, still counted five. Same number, new
    defect. So the divergences are classified with the same rule the faithful legs get
    (`classify_faithful`: a misread is a committed face that fp32 does not share), and the set of
    misreads is compared to the set pinned — a bounded leg may stop misreading a frame, and may
    refuse one it used to read, but it may not misread a frame it did not misread at pin time.
    Which frames are pinned is the point: the pinned reads are in expected.json, so the rule needs
    no new field and cannot be satisfied by a count alone.
    """
    wrong_now, _ = classify_faithful(live, ref)
    wrong_then, _ = classify_faithful(pinned_live, pinned_ref)
    return [n for n in wrong_now if n not in wrong_then]


def self_check() -> int:
    """Exercise the faithfulness rule, and the bounded-leg rule, on synthetic reads. No model, no runtime, no hardware."""
    ref = {"a": "OK 012345678", "b": "BAD_GEOMETRY"}
    cases = [
        ("fp16 refuses where fp32 read a face", {"a": "BAD_GEOMETRY", "b": "BAD_GEOMETRY"}, 0, 1),
        ("fp16 names a different cube", {"a": "OK 087654321", "b": "BAD_GEOMETRY"}, 1, 0),
        ("fp16 commits to a face fp32 refused", {"a": "OK 012345678", "b": "OK 012345678"}, 1, 0),
        ("fp16 agrees exactly", {"a": "OK 012345678", "b": "BAD_GEOMETRY"}, 0, 0),
        ("both refuse, by different names", {"a": "OK 012345678", "b": "NO_FACE"}, 0, 1),
    ]
    bad = 0
    for label, reads, want_wrong, want_refused in cases:
        wrong, refused = classify_faithful(reads, ref)
        ok = (len(wrong), len(refused)) == (want_wrong, want_refused)
        print(f"[self-check] {'ok  ' if ok else 'XX  '}{label}: wrong={len(wrong)} refused={len(refused)}"
              + ("" if ok else f"  expected wrong={want_wrong} refused={want_refused}"))
        bad += 0 if ok else 1

    # The bounded rule. Pinned: int8 misreads "a" (a different cube) and refuses "c"; agrees on "b".
    pref = {"a": "OK 012345678", "b": "BAD_GEOMETRY", "c": "OK 111222333"}
    pint8 = {"a": "OK 087654321", "b": "BAD_GEOMETRY", "c": "PARTIAL_FACE"}
    bounded = [
        ("same misread as pinned, inside the bound", {"a": "OK 087654321", "b": "BAD_GEOMETRY", "c": "PARTIAL_FACE"}, []),
        ("a pinned refusal became a face — same count, new misread", {"a": "OK 087654321", "b": "BAD_GEOMETRY", "c": "OK 999888777"}, ["c"]),
        ("a pinned agreement became a face fp32 refuses", {"a": "OK 087654321", "b": "OK 000000000", "c": "PARTIAL_FACE"}, ["b"]),
        ("a pinned misread became a refusal — allowed", {"a": "NO_FACE", "b": "BAD_GEOMETRY", "c": "PARTIAL_FACE"}, []),
        ("a pinned misread now agrees — allowed", {"a": "OK 012345678", "b": "BAD_GEOMETRY", "c": "PARTIAL_FACE"}, []),
        ("a pinned misread reads yet another cube — still the pinned frame, allowed", {"a": "OK 000000001", "b": "BAD_GEOMETRY", "c": "PARTIAL_FACE"}, []),
    ]
    for label, live, want in bounded:
        got = new_misreads(live, pref, pint8, pref)
        ok = got == want
        print(f"[self-check] {'ok  ' if ok else 'XX  '}bounded: {label}: new misreads={got}" + ("" if ok else f"  expected {want}"))
        bad += 0 if ok else 1

    if bad:
        print(f"FAIL: {bad} synthetic case(s) wrong — the rules are not what the docstrings claim")
        return 1
    print(f"PASS: the faithfulness rule and the bounded-leg rule hold on all {len(cases) + len(bounded)} synthetic cases")
    return 0


def fixtures(frames: Path) -> list[Path]:
    fx = sorted(frames.glob("*.png"))
    if not fx:
        sys.exit(f"no fixtures in {frames} — run golden/build_fixtures.py")
    return fx


def default_legs() -> list[str]:
    """Every leg this PLATFORM has — not every leg that happens to be installed.

    This used to be `runnable_legs`: tflite only if the .tflite existed, native only if the probe
    was built. So the mandated pinned run (no --legs) silently dropped legs and printed
    "PASS: 3 leg(s)", and `--write-expected` pinned only what was runnable at the time. On macOS
    all five are the default now and a missing artefact or probe FAILS the leg; off macOS the two
    CoreML legs cannot exist and are reported as not run, every time.
    """
    return list(ALL_LEGS) if platform.system() == "Darwin" else ["onnx", "onnx-int8", "tflite"]


def announce_legs(legs: list[str]) -> None:
    """Say which legs run and which do not, on every run — a skipped leg must never be silent."""
    not_run = [n for n in ALL_LEGS if n not in legs]
    why = "not requested" if len(not_run) and platform.system() == "Darwin" else "not runnable off macOS (CoreML)"
    print(f"legs: {', '.join(legs)}" + (f"; NOT run: {', '.join(not_run)} ({why})" if not_run else "; NOT run: none"))


def model_identity(models: Path) -> dict[str, str]:
    """The two hashes that name the model, read from MANIFEST.json: the checkpoint and the fp32 bytes."""
    manifest = json.loads((models / "MANIFEST.json").read_text())
    return {"checkpoint_sha256": manifest["checkpoint"]["sha256"], "fp32_sha256": manifest["artefacts"]["cube-yolo.onnx"]["sha256"]}


def check_identity(doc: dict, models: Path) -> int:
    """The pins must belong to the model beside them; returns the number of failures.

    Before 2026-09-04 nothing compared expected.json to MANIFEST.json. A checkpoint swap made
    through export.py regenerated the manifest, the artefact bytes matched it, every leg moved
    together, and parity mode passed — the gate's headline purpose ("a model change is not
    verified until golden_frames.py has run") defeated by the documented way of changing a model.
    """
    pinned = doc.get("model")
    if pinned is None:
        print("[model] XX expected.json records no model identity — re-pin with --write-expected --yes --repin-checkpoint REASON")
        return 1
    manifest_path = models / "MANIFEST.json"
    if not manifest_path.is_file():
        print(f"[model] XX {manifest_path} missing — cannot tell which model these pins belong to")
        return 1
    live = model_identity(models)
    bad = 0
    for key in ("checkpoint_sha256", "fp32_sha256"):
        if live[key] != pinned.get(key):
            print(f"[model] XX {key}: manifest {live[key][:12]} vs pinned {str(pinned.get(key))[:12]} — the model changed; if deliberate, re-pin with --write-expected --yes --repin-checkpoint REASON")
            bad += 1
    if not bad:
        print(f"[model] ok — checkpoint {live['checkpoint_sha256'][:12]}, fp32 {live['fp32_sha256'][:12]}: the pinned model")
    return bad


def divergence_table(frames: dict[str, dict]) -> dict[str, int]:
    """Per leg, how many pinned reads differ from the pinned fp32 read — derived from the frames, never typed in."""
    legs = [n for n in ALL_LEGS if any(n in fr["legs"] for fr in frames.values())]
    return {n: sum(1 for fr in frames.values() if fr["legs"].get(n) != fr["legs"]["onnx"]) for n in legs}


def guard_write(args, existing: dict | None) -> dict[str, str]:
    """The three refusals before a re-pin, and the identity the pin will carry.

    `--write-expected` rewrites the ground truth every other gate is judged against, and it used
    to do so with no question asked — the exact motion the "never --write-expected to make a
    failure go away" rule in AGENTS.md exists for. So: (1) `--yes`, because a flag typed on purpose
    is a smaller hazard than one in a shell history; (2) `ml/models` committed, because pins written
    against bytes that are not in git describe a model nobody can recover; (3) the manifest's
    checkpoint equals the pinned one, or `--repin-checkpoint REASON` says why not, and the reason
    is written into expected.json beside the new identity.
    """
    if not args.yes:
        sys.exit("refusing to re-pin: --write-expected rewrites the gate's ground truth; pass --yes to confirm you mean it")
    try:
        status = subprocess.run(["git", "status", "--porcelain", "--", str(args.models)], cwd=HERE, capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        sys.exit(f"refusing to re-pin: cannot tell whether {args.models} is committed (git status failed: {e})")
    if status.strip():
        sys.exit(f"refusing to re-pin: {args.models} has uncommitted changes — commit the model and MANIFEST.json first, so the pins describe bytes that exist in history:\n{status}")
    live = model_identity(args.models)
    pinned = (existing or {}).get("model")
    if existing is not None and (pinned is None or pinned.get("checkpoint_sha256") != live["checkpoint_sha256"]) and not args.repin_checkpoint:
        was = "no checkpoint recorded" if pinned is None else f"checkpoint {pinned['checkpoint_sha256'][:12]}"
        sys.exit(f"refusing to re-pin: the manifest's checkpoint is {live['checkpoint_sha256'][:12]} and expected.json was written for {was} — a re-pin across a model change needs --repin-checkpoint REASON")
    return live


def write_expected(args) -> int:
    existing = json.loads(args.expected.read_text()) if args.expected.is_file() else None
    identity = guard_write(args, existing)
    fx = fixtures(args.frames)
    if args.fixture:
        # One fixture, every other entry byte-for-byte as it was: the case for a replaced frame.
        if existing is None:
            sys.exit("--fixture needs an existing expected.json to leave the other entries in")
        if not (args.frames / args.fixture).is_file():
            sys.exit(f"--fixture {args.fixture}: no such file in {args.frames}")
        fx = [args.frames / args.fixture]
    legs = default_legs()
    announce_legs(legs)
    print(f"pinning {len(fx)} fixture(s) × {len(legs)} legs — a leg that cannot run is a failure, not a smaller pin")
    instances = {n: Leg(n, args.models, args.compute_units, args.probe) for n in legs}
    frames: dict[str, dict] = dict(existing["frames"]) if args.fixture else {}
    for f in fx:
        reads: dict[str, str] = {}
        sha: str | None = None
        for n in legs:
            s, r = instances[n].evaluate(f)
            reads[n] = r
            # Every leg recomputes the letterbox sha; they must all agree (that IS the letterbox-parity claim).
            if sha is None:
                sha = s
            elif s != sha:
                sys.exit(f"letterbox sha disagrees on {f.name}: {n} gave {s[:12]} vs {sha[:12]} — a letterbox drifted")
        frames[f.name] = {"preprocess_sha256": sha, "legs": reads}
    if args.fixture:
        frames = {name: frames[name] for name in sorted(frames)}
        gone = [n for n in frames if not (args.frames / n).is_file()]
        if gone:
            sys.exit(f"expected.json pins fixtures that no longer exist: {gone} — a full --write-expected is the honest fix")
    divergence = divergence_table(frames)
    doc = {
        "reference": "onnx (fp32)",
        "pinned_on": {"host": platform.platform(), "python": platform.python_version()},
        "model": identity,
        "faithful_legs": list(FAITHFUL_LEGS),
        "bounded_legs": dict(BOUNDED_LEGS),
        "divergence_from_fp32": divergence,
        "frames": frames,
    }
    if args.fixture:
        # Keep the host the OTHER 19 reads were pinned on: this run re-read one frame, not the set.
        doc["pinned_on"] = existing.get("pinned_on", doc["pinned_on"])
    if existing and existing.get("repin") and not args.repin_checkpoint:
        doc["repin"] = existing["repin"]  # the last model change stays on record until the next one
    if args.repin_checkpoint:
        doc["repin"] = {
            "when": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "reason": args.repin_checkpoint,
            "previous_checkpoint_sha256": ((existing or {}).get("model") or {}).get("checkpoint_sha256"),
        }
    args.expected.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"pinned {len(fx)} fixture(s) × {len(legs)} legs → {args.expected}" + (f" (only {args.fixture}; {len(frames) - 1} entries untouched)" if args.fixture else ""))
    print(f"divergence from fp32: {divergence}")
    return 0


def check(args) -> int:
    if not args.expected.is_file():
        sys.exit(f"{args.expected} missing — run with --write-expected once")
    doc = json.loads(args.expected.read_text())
    pins = doc["frames"]
    fx = fixtures(args.frames)
    missing = [f.name for f in fx if f.name not in pins]
    gone = [n for n in pins if not (args.frames / n).is_file()]
    if missing or gone:
        sys.exit(f"expected.json and frames/ disagree: unpinned {missing}, pinned-but-gone {gone}")

    legs = args.legs or default_legs()
    announce_legs(legs)
    failures = check_identity(doc, args.models)
    live: dict[str, dict[str, str]] = {}

    for name in legs:
        try:
            leg = Leg(name, args.models, args.compute_units, args.probe)
        except Exception as e:  # a requested leg that cannot run is a failure, not a skip
            print(f"[{name}] CANNOT RUN: {e}")
            failures += 1
            continue
        leg_fail = 0
        reads: dict[str, str] = {}
        for f in fx:
            pin = pins[f.name]
            sha, got = leg.evaluate(f)
            reads[f.name] = got
            # The letterbox is integer image work, identical on every host, and every leg in a run
            # must agree on it. Checking it against the pin stays valid in BOTH modes — unlike a
            # read, it is not the output of floating-point inference.
            if sha != pin["preprocess_sha256"]:
                print(f"[{name}] XX {f.name:16s} {'letterbox sha drifted':14s}  {sha[:12]} vs pinned {pin['preprocess_sha256'][:12]}")
                leg_fail += 1
                continue
            if args.parity:
                continue
            want = pin["legs"].get(name)
            if want is None:
                print(f"[{name}] {f.name}: no pin for this leg — re-run --write-expected on a machine that can run it")
                leg_fail += 1
            elif got != want:
                print(f"[{name}] XX {f.name:16s} {got:14s}  expected {want}")
                leg_fail += 1
        live[name] = reads
        if not args.parity:
            print(f"[{name}] {'ok' if leg_fail == 0 else str(leg_fail) + ' FAIL'} over {len(fx)} fixtures")
        elif leg_fail:
            print(f"[{name}] {leg_fail} letterbox FAIL over {len(fx)} fixtures")
        failures += leg_fail

    if args.parity:
        # Normalised to the documented 0/1 verdict: a leg that could not run has already
        # counted a failure here, and parity() counts its own, so the sum can exceed 1.
        return 1 if failures + parity(args, doc, live, legs, fx) else 0

    # Faithfulness, computed from the LIVE reads of this run.
    #
    # This used to read `pins` on both sides of the comparison — the pinned coreml read against the
    # pinned onnx read — so it compared the file to itself and could not fail unless someone hand-
    # edited it. It duly printed "0 divergence(s) (exact class parity)" in the very CI run where
    # coreml disagreed with its own pin on photo-01.png. A gate that cannot fail is not a gate.
    ref = live.get("onnx")
    for faithful in ("coreml", "native"):
        if faithful in live and ref is not None:
            div = [n for n in ref if live[faithful].get(n) != ref[n]]
            print(f"live: {faithful} (fp16) vs fp32 — {len(div)} divergence(s){' : ' + ', '.join(div) if div else ' (exact class parity, as the plan claims)'}")
            if div:
                failures += 1  # the headline faithfulness claim regressed
    if ref is None and any(f in live for f in ("coreml", "native")):
        print("live: no fp32 reference in this run — add `onnx` to --legs to check faithfulness")
    print(f"pinned: divergence from fp32 = {doc.get('divergence_from_fp32')}")

    if failures:
        print(f"FAIL: {failures} problem(s)")
        return 1
    print(f"PASS: {len(legs)} leg(s) match their pins on all {len(fx)} fixtures")
    return 0


def parity(args, doc, live: dict, legs: list[str], fx: list[Path]) -> int:
    """Host-internal mode: assert the RELATIONS between legs, never one host's absolute reads.

    Why CI cannot use the absolute pin. `expected.json` records, in `pinned_on`, the single host it
    was written on, and a read is the output of floating-point inference: ONNX's dynamic-int8 kernels
    differ between x86 (AVX-512/VNNI) and Apple Silicon (NEON), and CoreML dispatches to ANE, GPU or
    CPU by what the machine has. On a fixture sitting near a decision boundary that is enough to flip
    the decoded class. Measured, with the SAME committed model bytes and the SAME pinned runtime
    versions: `render-07.png` reads OK on Linux int8 where this Mac pinned BAD_GEOMETRY, and
    `photo-01.png` reads BAD_GEOMETRY on a GitHub macOS runner where this Mac pinned OK. The
    harness's own docstring claimed decoded classes were "robust to small numerical drift"; two
    fixtures out of twenty say otherwise, so the claim is corrected rather than re-pinned.

    What is asserted here is hardware-independent by construction, because both sides of every
    comparison are computed in the same run on the same machine:

      * the model BYTES match MANIFEST.json, and MANIFEST.json's checkpoint and fp32 hashes match
        the `model` block in expected.json (`check_identity`, both modes). The first half alone
        was claimed to catch "a swapped model" and did not: a swap made through export.py
        regenerates the manifest, so the bytes matched it by construction. The second half is what
        makes the gate's headline purpose ("a model change is not verified until golden_frames.py
        has run") hold for the documented way of changing a model;
      * the letterbox sha matches the pin — integer image work, identical everywhere (checked above);
      * faithful legs (coreml, native) never read a face DIFFERENTLY from this host's own fp32 onnx,
        and never commit to one fp32 refused. They may REFUSE where fp32 read — see below;
      * bounded legs (onnx-int8, tflite) diverge from this host's fp32 no more than the bound already
        recorded in `divergence_from_fp32`, AND misread only frames they were pinned misreading
        (`new_misreads`) — the count alone let a pinned refusal turn into a committed face.

    The absolute per-fixture pin is not weakened, it is relocated: it remains the gate on the pinning
    host, which is where AGENTS.md already requires it to be run before a model is vendored.

    Why the faithful legs allow a REFUSAL but not a different read. "fp16 moves scores but not
    classes" was the plan's premise and it is not universal. Measured 2026-09-01, same model bytes,
    same pinned runtime versions, same macOS major (26), fp16 CoreML against that same host's fp32:

        Apple M5 (this repo's pinning host)  20/20 exact, and on all four --compute-units settings
        Apple M2 Ultra                       20/20 exact
        GitHub macos-26-arm64 (M1-class VM)  19/20 — photo-01.png abstains where fp32 reads it

    Both the coremltools leg and the shipped Swift path diverge together there, so it is the Apple
    fp16 inference and not the harness. And it is the SILICON, not dispatch: the same run with
    `--compute-units cpu_only`, which removes CoreML's choice of ANE/GPU/CPU entirely, refuses
    photo-01 exactly the same way (measured on the runner 2026-09-01, both legs). No configuration
    removes it, so the directional rule below is the answer rather than a stopgap. It is not a generically borderline fixture either: int8, a
    far coarser perturbation than fp16, reads photo-01 identically to fp32. So the honest claim is
    directional rather than exact — and the direction is the one that matters, because refusing a
    frame is what the app is supposed to do when it cannot validate a read ("a reading that cannot
    be validated is a refusal, not a guess"), while naming a different cube is the defect users would
    actually feel.

    The hole this leaves, stated rather than hidden: a model that regressed into refusing far more
    often would satisfy parity mode. It would not satisfy the pinned gate on the pinning host, which
    is where a model change must be verified anyway, and it cannot hide from `divergence_from_fp32`
    there. A numeric bound on refusals in CI would need a number nothing has measured, and inventing
    one would be worse than naming the gap.
    """
    failures = 0

    # The model bytes. Without this, parity mode would pass a wholesale model swap — every leg would
    # move together and the relations would still hold.
    manifest_path = args.models / "MANIFEST.json"
    if not manifest_path.is_file():
        print(f"[manifest] MISSING {manifest_path} — cannot verify the model bytes")
        return failures + 1
    manifest = json.loads(manifest_path.read_text())
    for artefact, meta in manifest.get("artefacts", {}).items():
        path = args.models / artefact
        if not path.exists():
            print(f"[manifest] MISSING {artefact}")
            failures += 1
            continue
        want = meta.get("sha256")
        if not want:
            print(f"[manifest] {artefact}: no sha256 recorded — re-run export.py")
            failures += 1
            continue
        got = sha256_of(path)
        if got != want:
            print(f"[manifest] XX {artefact}: {got[:12]} vs pinned {want[:12]} — the model changed")
            failures += 1
    if not failures:
        print(f"[manifest] ok — {len(manifest.get('artefacts', {}))} artefact(s) match their pinned sha256")

    ref = live.get("onnx")
    if ref is None:
        print("[parity] CANNOT RUN: parity mode needs the `onnx` fp32 leg as its reference — add it to --legs")
        return failures + 1

    bound = doc.get("divergence_from_fp32", {})
    for name in legs:
        if name == "onnx" or name not in live:
            continue
        div = [n for n in ref if live[name].get(n) != ref[n]]
        if name in ("coreml", "native"):  # faithful: never a DIFFERENT read; refusing is allowed
            wrong, refused = classify_faithful(live[name], ref)
            for n in wrong:
                print(f"[{name}] XX {n:16s} {live[name].get(n, '<missing>'):14s}  fp32 here reads {ref[n]}")
            if wrong:
                print(f"[{name}] {len(wrong)} FAIL — fp16 read a face differently from fp32, or read one it refused")
                failures += len(wrong)
            for n in refused:
                print(f"[{name}] .. {n:16s} {live[name].get(n, '<missing>'):14s}  fp32 here reads {ref[n]} — refused, not misread")
            if not div:
                print(f"[{name}] ok — exact class parity with this host's fp32 over {len(fx)} fixtures")
            elif not wrong:
                print(f"[{name}] ok — {len(refused)} refusal(s) where fp32 read a face; no fixture read DIFFERENTLY")
        else:  # bounded: may diverge, but no more than the recorded bound, and on no NEW frame
            allowed = bound.get(name)
            pins = doc["frames"]
            fresh = new_misreads(live[name], ref, {n: pins[n]["legs"].get(name, "") for n in pins}, {n: pins[n]["legs"]["onnx"] for n in pins})
            for n in fresh:
                print(f"[{name}] XX {n:16s} {live[name].get(n, '<missing>'):14s}  fp32 here reads {ref[n]} — a misread this leg was NOT pinned making")
            if fresh:
                print(f"[{name}] {len(fresh)} NEW misread(s) — FAIL, whatever the count")
                failures += len(fresh)
            if allowed is None:
                print(f"[{name}] no divergence bound recorded for this leg — re-pin")
                failures += 1
            elif len(div) > allowed:
                for n in div:
                    print(f"[{name}] .. {n:16s} {live[name].get(n, '<missing>'):14s}  fp32 here reads {ref[n]}")
                print(f"[{name}] {len(div)} divergence(s) from fp32, bound is {allowed} — FAIL")
                failures += 1
            elif not fresh:
                print(f"[{name}] ok — {len(div)} divergence(s) from this host's fp32, within the pinned bound of {allowed}, none on a new frame")

    if failures:
        print(f"FAIL: {failures} problem(s)")
        return 1
    print(f"PASS: host-internal parity holds for {len(legs)} leg(s) on all {len(fx)} fixtures")
    return 0

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", type=Path, default=MODELS)
    ap.add_argument("--frames", type=Path, default=FRAMES)
    ap.add_argument("--expected", type=Path, default=EXPECTED)
    ap.add_argument("--probe", type=Path, default=PROBE, help="the cube-vision-probe binary (native leg)")
    ap.add_argument("--legs", nargs="+", choices=ALL_LEGS, help="legs that MUST run (default: every leg this machine can)")
    ap.add_argument("--compute-units", default="all", choices=["all", "cpu_and_gpu", "cpu_only", "cpu_and_ne"], help="CoreML compute units for the coreml/native legs")
    ap.add_argument("--self-check", action="store_true", help="exercise the faithfulness rule on synthetic reads and exit; needs no model, runtime or hardware")
    ap.add_argument("--parity", action="store_true", help="host-internal mode for CI: assert the RELATIONS between legs on THIS machine, not another host's absolute reads")
    ap.add_argument("--write-expected", action="store_true", help="re-pin expected.json (every leg this platform has); refuses without --yes, a committed ml/models, and the pinned checkpoint")
    ap.add_argument("--yes", action="store_true", help="confirm --write-expected")
    ap.add_argument("--fixture", metavar="NAME.png", help="with --write-expected: re-pin this ONE fixture and leave every other entry byte-identical")
    ap.add_argument("--repin-checkpoint", metavar="REASON", help="with --write-expected: accept that MANIFEST.json's checkpoint differs from the pinned one; REASON is written into expected.json")
    args = ap.parse_args()
    if args.self_check:
        return self_check()
    return write_expected(args) if args.write_expected else check(args)


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)  # coremltools aborts in a static dtor at normal shutdown; skip it, code already decided
