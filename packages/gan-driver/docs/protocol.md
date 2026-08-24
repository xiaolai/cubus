# GAN16 ui — BLE application protocol

Status legend: **VERIFIED** (proven on this physical GAN16 ui), **UPSTREAM**
(from afedotov/gan-web-bluetooth, MIT), **INFERRED**, **UNKNOWN**.

Device under test: `GAN16ui_C8D3`, hardware v1.0, software v2.4, product date
2026-01-09. All captures under `captures/`, fixtures under `tests/fixtures/`.

## Verdict: H1 (Gen4-compatible) with mild H2 extensions

The GAN16 ui runs the **GAN Gen4** application protocol. Transport, encryption,
framing, and the MOVE / FACELETS / GYRO event layouts are **bit-identical** to
upstream Gen4 — a single offline decrypt of live packets produced valid events
on the first try (kills H3). The only departures are additive and confined to
the hardware-info response (H2):

- GAN16 emits hardware sub-events `0xF5`, `0xF6`, `0xFF` that upstream Gen4 does
  not define. `0xFF` carries the MAC/serial bytes. **VERIFIED.**
- Gyro streams continuously, though the hardware name is `GAN16ui`; upstream
  only enables gyro for hardware name `GAN12uiM`. **VERIFIED.**
- No new MOVE / FACELETS / GYRO semantics observed; no partial-turn angular
  event type seen in captures so far. Partial-turn probe (Experiment H) is the
  remaining open question. **UNKNOWN.**

## GATT structure — VERIFIED

| Service | Characteristic | Properties | Purpose | Verified |
|---|---|---|---|---|
| `00000010-0000-FFF7-FFF6-FFF5FFF4FFF0` (Gen4) | FFF4 | read,write | unknown (init `0x38`) | partial |
| | FFF5 | read,write,writeNoResp | **command** (write encrypted) | ✓ |
| | FFF6 | read,notify | **state/events** (notify encrypted) | ✓ |
| | FFF7 | read,writeNoResp,notify | unknown (init `1305…`) | partial |
| `FEE0` | FEE1 | read,write,writeNoResp | unused by driver | — |

FFF5/FFF6 are the command/state pair; FFF4/FFF7 are present but not needed for
moves, state, gyro, or hardware info.

## Device discovery & MAC recovery — VERIFIED

macOS CoreBluetooth hides the peripheral MAC (random per-Mac UUID). GAN cubes
broadcast the MAC in advertisement manufacturer data. On this cube:

```
manufacturerData = 0100 00000000 d3c889506c54 64636f6e00 ffffffffffff
                   \__/           \__________/
                company 0x0001     MAC bytes (reversed) -> 54:6C:50:89:C8:D3
```

- Company id = little-endian first 2 bytes; GAN uses `0xXX01`. **UPSTREAM+VERIFIED**
- Strip the 2 company bytes; MAC = payload bytes `[3..8]` read in reverse.
- Cross-check: MAC tail `C8:D3` == device-name suffix `_C8D3`. **VERIFIED**

`blew` does not surface manufacturer data, so discovery uses a compiled
CoreBluetooth helper (`scripts/scan-adv.swift`) that dumps every advertisement
field as JSON. **VERIFIED.**

## Encryption — UPSTREAM + VERIFIED

AES-128-CBC over two 16-byte chunks of each message (start chunk, and the chunk
aligned to the end — they overlap for 20-byte messages). Decrypt end-chunk
first then start-chunk; encrypt start-chunk first then end-chunk.

Base key/iv (shared Gen2/3/4). The first 6 bytes of both are salted per device:
`k[i] = (base[i] + salt[i]) % 0xFF`, where `salt` = the 6 MAC bytes in reverse
of the MAC string order (i.e. the bytes exactly as broadcast).

Derived for this cube:
```
key = d4cacb789de516072005185442111253
iv  = e4cbbb788d5576272095781432120243
```
Evidence: `scripts/decrypt-probe.mjs` decrypts live FFF6 packets into valid
events; `tests/gen4-decode.test.ts` round-trips `encrypt(decrypt(x)) == x`.

## Message framing — VERIFIED

Decrypted message: `byte0 = eventType`, `byte1 = dataLength`, fields packed
MSB-first at explicit bit offsets (multi-byte timestamps/serials little-endian).

| eventType | Name | len | Notes | Status |
|---|---|---|---|---|
| `0x01` | MOVE | 7 | 32-bit cubeTimestamp @bit16, 16-bit serial @bit48, dir@64(2), face@66(6) | VERIFIED |
| `0xD1` | MOVE_HISTORY | var | gap recovery; face LUT differs from MOVE | UPSTREAM |
| `0xED` | FACELETS | 14 | 16-bit serial; CP/CO/EP/EO with parity checksums | VERIFIED |
| `0xEC` | GYRO | 10 | quaternion (4×16-bit) + angular velocity (3×4-bit) | VERIFIED |
| `0xEF` | BATTERY | — | level at bit `8+len*8` | UPSTREAM |
| `0xEA` | DISCONNECT | — | cube requests disconnect | UPSTREAM |
| `0xFA` | HW product date | 5 | year LE@24, month@40, day@48 → `2026-01-09` | VERIFIED |
| `0xFC` | HW name | 8 | ASCII → `"GAN16ui"` | VERIFIED |
| `0xFD` | HW software ver | 2 | nibble.nibble → `2.4` | VERIFIED |
| `0xFE` | HW hardware ver | 2 | nibble.nibble → `1.0` | VERIFIED |
| `0xF5` `0xF6` `0xFF` | HW extras (GAN16) | var | not in upstream; `0xFF` holds MAC bytes | VERIFIED |

### MOVE decode
```
dir  = bits(64, 2)                       # 0 = CW, 1 = CCW
face = [2,32,8,1,16,4].indexOf(bits(66,6))   # index into "URFDLB"
notation = "URFDLB"[face] + (dir ? "'" : "")
```
Face/direction mapping against physical ground truth: pending Experiment B–E.

### FACELETS decode
Corner permutation/orientation (7 explicit + 1 derived by checksum), edge
permutation/orientation (11 explicit + 1 derived), converted to a 54-char
Kociemba facelet string (URFDLB). Validity checks (valid permutation, 9 of each
colour) pass on captured data. **VERIFIED.**

### GYRO decode
Unit quaternion `(w,x,y,z)`, each 16-bit signed-magnitude / 0x7FFF; angular
velocity 3×4-bit signed-magnitude. Captured quaternions have |q| = 1.0000 and
evolve smoothly. This is **whole-cube orientation**, not face angle. **VERIFIED.**

## Commands (write to FFF5, encrypted) — VERIFIED

| Command | Bytes (pre-encryption) | Safe | Response |
|---|---|---|---|
| REQUEST_FACELETS | `DD 04 00 ED 00 00` | yes | `0xED` FACELETS |
| REQUEST_HARDWARE | `DF 03 00 00 00` | yes | `0xFA/FC/FD/FE` (+ GAN16 extras) |
| REQUEST_BATTERY | `DD 04 00 EF 00 00` | yes | `0xEF` BATTERY |
| REQUEST_RESET | `D2 0D 05 39 77 00 00 01 23 45 67 89 AB 00 00 00` | **NO — encoded but unsendable** | rewrites solved reference |

### REQUEST_RESET — encoding verified, behaviour NOT verified

This row used to read `D2 0D 05 …`. The elision was not harmless: it meant the
one command in the table that is dangerous was also the one nobody could check,
and re-deriving it would have meant guessing protocol bytes.

The full sequence is now pinned by `tests/unsafe-commands.test.ts`, taken from
afedotov/gan-web-bluetooth (MIT) — the same source as the three safe packets,
which match this repo byte for byte. That agreement, plus the `D2 0D 05` prefix
recorded here already, is the whole basis for trusting it.

**What is verified:** the packet is formed as upstream forms it.
**What is not:** anything the physical cube does in response. No GAN16 has been
sent this command from this codebase. A fixture test cannot establish it.

It is therefore encoded in `buildUnsafeCommand()` and deliberately excluded from
the `SafeCommand` union that `CubeDriver.send()` accepts, so no code path can
transmit it. Tests assert that containment and fail if it is added to
`SafeCommand`, referenced from the driver, or re-exported from `src/index.ts`.

Why the care: REQUEST_RESET tells the cube to treat its **current physical
position** as solved. Sent when the cube is not actually solved, the driver's
tracked state and the hardware diverge permanently and silently — precisely what
the state invariant (apply decoded moves → matches hardware facelets) exists to
catch. Before wiring it up, confirm on hardware that the cube is solved at the
moment it is sent, and re-establish the invariant immediately afterwards.

`REQUEST_HARDWARE` verified live: returned name `GAN16ui`, hw 1.0, sw 2.4, date
2026-01-09, plus extras 0xF5/0xF6/0xFF.

The cube also emits FACELETS periodically (~1 Hz) with no command, so state can
be read passively (no write required). **VERIFIED.**

## macOS transport note — VERIFIED

Two separate `blew` processes (persistent `sub` + a `write`) DO share one cube
connection and the command response arrives on the subscribed stream — but only
if the write is sent **after** the subscription is live (the driver waits for
the first notification before writing; otherwise the response is lost to a
subscribe/write race).
