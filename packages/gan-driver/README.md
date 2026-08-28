# gan-driver

A verified BLE driver and diagnostic CLI for the **GAN16 ui** smart Rubik's cube
on macOS.

**Result:** the GAN16 ui speaks the **GAN Gen4** protocol (hypothesis **H1**),
with small additive extensions to the hardware-info response (**H2**). Moves,
full cube state, whole-cube orientation (gyro), and hardware info all decode and
are covered by tests built from real captures. See `docs/protocol.md` for the
wire protocol and `docs/findings.md` for the evidence trail.

Protocol reference and crypto/decode logic derive from
[afedotov/gan-web-bluetooth](https://github.com/afedotov/gan-web-bluetooth)
(MIT) — see `THIRD_PARTY.md`.

## What it exposes

- **Cube state** — 54-char Kociemba facelet string, read passively (the cube
  emits state ~1 Hz) or on demand.
- **Completed face moves** — notation (`R`, `U'`, …), face, direction, quarter
  turn, move serial, and cube-hardware timestamp.
- **Orientation / gyro** — unit quaternion + angular velocity (whole-cube
  orientation; **not** per-face angle).
- **Hardware info** — model name, hardware/software version, product date.
- **Partial-turn angular data** — *not observed* in captures so far; see the
  open question in `docs/findings.md`.

## Requirements

- macOS with Bluetooth (grant the terminal Bluetooth permission on first run).
- `blew` — `brew install stass/tap/blew` (BLE transport).
- Node ≥ 20. Install deps: `npm install`.
- One-time: compile the advertisement scanner (recovers the cube MAC, which
  CoreBluetooth hides):
  ```
  swiftc -O -o scripts/scan-adv scripts/scan-adv.swift
  ```

## CLI

```
npx tsx src/cli.ts <command>

  scan               discover the cube; print id, MAC, RSSI
  inspect            dump the GATT tree + initial characteristic reads
  state              connect and print the current facelet state
  monitor            live human-readable events (MOVE / STATE / ORIENT)
  raw [char]         timestamped raw + decrypted packets (default FFF6)
  record <name>      save a lossless capture under captures/recordings/
```

Wake the cube by twisting before running any command; keep it moving during
live commands (it stops advertising within ~1 s of rest and cannot be
connected while asleep).

## Tests

```
npm test        # vitest — decodes real captured packets, no hardware needed
```

## Architecture

```
advertisement ──▶ scan-adv (Swift) ──▶ MAC recovery (src/mac.ts)
BLE FFF6 notify ─▶ BlewTransport ─▶ GanGen4Cipher (decrypt) ─▶ decodeGen4 ─▶ events
events ─▶ GanCube driver (serial-gap detection, hardware accumulation) ─▶ CLI
```

The protocol layer (`src/gen4/`) is transport-agnostic and has no I/O, so every
decode path is testable from fixtures. Swapping `blew` for a native BLE module
means implementing one `Transport` interface.
