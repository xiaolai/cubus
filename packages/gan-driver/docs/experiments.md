# Experiments log

Reproducible captures under `captures/`. Each is decoded offline with the MAC
`54:6C:50:89:C8:D3`. Analysis tools: `scripts/analyze-capture.ts`,
`scripts/facelet-diff.ts`, `scripts/invariant-check.ts`.

| # | Experiment | Physical action | Result | Status |
|---|---|---|---|---|
| Disc | Discovery | wake + scan | name `GAN16ui_C8D3`, MAC recovered, GATT dumped | DONE |
| Smoke | Random twists | ~15 hand turns | 15 MOVE + 30 FACELETS + 320 GYRO decoded; state invariant 12/12 | DONE |
| A | Idle | motionless ~10 s | 107 GYRO + 10 FACELETS, **no MOVE**; FACELETS periodic ~1 Hz | DONE |
| G | Whole-cube rotation | rotate cube in space, no face turns | 373 GYRO, FACELETS serial **constant**, **no MOVE** | DONE |
| HW | Hardware query | REQUEST_HARDWARE (active write) | name GAN16ui, hw 1.0, sw 2.4, date 2026-01-09, +extras 0xF5/F6/FF | DONE |
| B–E | Labeled single moves R/R'/U/U'… | one face, one direction | superseded by state invariant (proves face+direction) | COVERED |
| H | Partial face turn (held mid-turn) | slow turn, frozen ~3s halfway, then completed | **no intermediate angle data**; only completed MOVE + steady GYRO/FACELETS; extra field = checksum | DONE |

## Key results

**Smoke (ground truth via invariant).** Rather than hand-label individual moves,
correctness was proven with the self-consistency invariant: for every pair of
consecutive FACELETS snapshots, replaying the MOVE events between them through
cubejs reproduces the later snapshot. 12/12 spans matched. This is a stronger
check than eyeballing "did R print R", because any face/direction error desyncs
the predicted state.

**A / G (negative controls).** Idle and whole-cube rotation both produce GYRO
without MOVE, and the FACELETS serial does not advance — confirming GYRO encodes
orientation only, and that face turns (not spatial rotation) drive MOVE/state.

**HW (active command path).** A single-connection write to FFF5 (persistent
subscription + a second-process write, sent only after the subscription is live)
elicits the hardware sub-events. Confirms the command channel works and returns
GAN16-specific extras.

## Experiment H — result (RESOLVED, H1)

Question: does a *slow partial face turn* emit intermediate angular data over
BLE, or only the completed-move event at ~90°?

Method: two captures — one continuous-turn (22 moves), one "hold test" where a
layer was frozen mid-turn for ~3 s repeatedly (2 completed moves, 22 still-hold
windows). Analysed with `scripts/analyze-partial.ts`, `scripts/analyze-hold.ts`,
`scripts/gyro-bytes.ts`.

Findings:
1. **No event type outside {MOVE 0x01, GYRO 0xEC, FACELETS 0xED}** across 900+
   packets.
2. **During every frozen mid-turn hold**, only steady GYRO + unchanged FACELETS
   serial were sent — nothing tracks the held angle.
3. The only GYRO field upstream leaves undecoded, **bytes 18-19, is a checksum**:
   deterministic from bytes 0-17 (320 packets, 238 payloads, 0 collisions) and
   varies during whole-cube rotation where no layer moved. Bytes 10-17 were zero.

Conclusion: **H1.** The cube exposes no partial-turn/sub-detent angle over BLE;
face turns surface only as completed MOVE events. GAN16 "high-resolution
tracking" = the continuous gyro orientation stream + accurate move detection.

Captures: `captures/notifications/*-expH-partial-turn.kv`, `*-expH-hold-test.kv`.
