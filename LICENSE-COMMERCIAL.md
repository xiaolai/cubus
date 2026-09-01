# Commercial licensing

cubus is released under the **GNU Affero General Public License v3.0** (see `LICENSE`).
That is the right licence for most people: use it, study it, modify it, run it, share it.

AGPL-3.0 asks one thing in return. If you distribute cubus, or a modified version, or you let
users interact with one over a network, you must offer those users the complete corresponding
source under the same terms. For a great many uses that is no burden at all.

If it is a burden for yours — if you want to build cubus into a closed product, ship it inside
proprietary software, or offer it as a service without publishing your source — then **a separate
commercial licence is available**. The copyright is held in one place, so it can be granted on
other terms.

**Contact:** open an issue at <https://github.com/xiaolai/cubus/issues> and say what you have in
mind, or reach the author through the address on the GitHub profile.

## Why the project is AGPL rather than permissive

Not as a philosophical position, and worth stating plainly because it constrains anyone who
forks: the sticker detector shipped in this repository — `apps/web/vendor/cube-yolo.onnx` — is a
YOLO model trained with [Ultralytics](https://github.com/ultralytics/ultralytics), which is
itself AGPL-3.0. Ultralytics' stated position is that the licence reaches models trained with
their software and applications that use those models. A permissive licence here would not be
honest about that.

Everything else the application ships is MIT: cubejs, three.js, onnxruntime-web, and
smartcube-web-bluetooth. `packages/gan-driver` is likewise MIT and stays that way — it is a
standalone Bluetooth driver that touches none of the model code, and part of it derives from
MIT-licensed upstream work (`packages/gan-driver/THIRD_PARTY.md`).

A commercial licence for cubus covers cubus. It does not, and cannot, grant rights to
Ultralytics' work: a closed-source product built on this detector needs an Ultralytics
Enterprise Licence too, or a detector trained on a stack that is not copyleft.
