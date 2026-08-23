# GAN16 ui — findings

Every claim is tagged: **VERIFIED** (proven on the physical cube this session),
**UPSTREAM** (from gan-web-bluetooth), **INFERRED**, **UNKNOWN**.

## Headline

The GAN16 ui is a **GAN Gen4** cube (hypothesis **H1**). Transport, encryption,
message framing, and the MOVE / FACELETS / GYRO decoders from the open-source
Gen4 implementation work on it unchanged. The only differences are additive
(**H2**) and live only in the hardware-info response.

Evidence chain (all reproducible from `captures/` + `tests/`):

1. **UUID match** — advertised service `00000010-0000-FFF7-FFF6-FFF5FFF4FFF0`
   equals the Gen4 service. UPSTREAM + VERIFIED. *(Not sufficient alone — hence
   the decrypt test below.)*
2. **Decryption** — the upstream Gen4 base key/iv, salted with this cube's MAC
   (`54:6C:50:89:C8:D3`, recovered from the advertisement), decrypt live FFF6
   packets into structurally valid events on the first try. Kills **H3**.
   VERIFIED (`scripts/decrypt-probe.mjs`, `tests/gen4-decode.test.ts`).
3. **Semantic validity** — decoded GYRO quaternions have |q| = 1.0000; decoded
   FACELETS are valid permutations with passing parity checksums. VERIFIED.
4. **State invariant** — seeding cubejs from a hardware FACELETS snapshot and
   replaying the decoded MOVE events reproduces the *next* hardware FACELETS
   state, **12/12 times** across a capture. A wrong face or flipped direction
   would desync immediately, so this proves the move decoder (face **and**
   direction) is correct. VERIFIED (`tests/state-invariant.test.ts`).

## Deliverables answered

1. **Current cube state** — FACELETS event `0xED` → 54-char Kociemba string.
   Cube emits it ~1 Hz unprompted, and on demand via REQUEST_FACELETS. VERIFIED.
2. **Completed face moves** — MOVE event `0x01` → face, direction, serial,
   hardware timestamp. Notation verified via the state invariant. VERIFIED.
3. **Timestamps** — each MOVE carries a 32-bit cube-hardware timestamp (ms) plus
   a host receive time. VERIFIED.
4. **Orientation / gyro** — GYRO event `0xEC` → unit quaternion + 3-axis angular
   velocity, streamed continuously (~10–15 Hz). This is **whole-cube
   orientation**. VERIFIED.
5. **Partial-turn / angular data** — **confirmed absent (Experiment H, VERIFIED).**
   Captured slow face turns *held frozen mid-turn* for several seconds. During
   every hold only steady GYRO (whole-cube orientation) + unchanged FACELETS
   were sent; no event type outside {MOVE, GYRO, FACELETS} ever appeared; MOVE
   fires only at a completed quarter-turn. The one undecoded varying field
   (GYRO bytes 18-19) was proven to be a **checksum**, not angle data — see
   below. GAN16-ui "high-resolution tracking" over BLE = the continuous gyro
   orientation stream + accurate completed-move detection, **not** intermediate
   layer angles. The driver reports only completed moves and does not fabricate
   continuous motion.

## H2 extensions (GAN16-specific, additive)

- Hardware-info response includes sub-events `0xF5`, `0xF6`, `0xFF` beyond
  upstream Gen4's `0xFA/FC/FD/FE`. `0xFF` carries the MAC/serial bytes.
  VERIFIED — surfaced by the driver as `hardwareExtra`, never dropped.
- Gyro streams although the hardware name is `GAN16ui`; upstream's static
  allowlist only enables gyro for `GAN12uiM`. The driver detects gyro support
  empirically instead. VERIFIED.
- **GYRO packet carries a 2-byte trailer checksum (bytes 18-19)** that upstream
  Gen4 does not decode. Proven by: (a) it is a deterministic function of bytes
  0-17 (320 packets, 238 distinct payloads, zero collisions), and (b) it varies
  during whole-cube rotation where no layer moved — so it is neither a counter
  nor layer angle. Not needed for decoding; documented so the field is not
  mistaken for hidden data. VERIFIED. Bytes 10-17 were zero in these captures
  (velocity ~0 at slow speeds); their full use is UNKNOWN.

## Device facts (this unit)

| Field | Value | Source |
|---|---|---|
| name | GAN16ui_C8D3 | advertisement |
| MAC | 54:6C:50:89:C8:D3 | advertisement mfg data (VERIFIED, name-suffix cross-check) |
| hardware name | GAN16ui | REQUEST_HARDWARE `0xFC` |
| hardware version | 1.0 | `0xFE` |
| software version | 2.4 | `0xFD` |
| product date | 2026-01-09 | `0xFA` |

## Known limitations / open items

- **GYRO bytes 10-17** were all-zero in captures (slow speeds → velocity ~0);
  their full range of use is UNKNOWN. Not required for orientation decoding.
- **Move-history gap recovery** (`0xD1` request/response) is decoded but the
  active re-request path is not yet wired; the driver instead emits a loud
  `gap` event so missed moves are never silent. Sufficient for Phase 1;
  full recovery is a reliability follow-up.
- **FFF4 / FFF7** characteristics exist (initial values `0x38`, `1305…`) but are
  unused by moves/state/gyro/hardware. Purpose UNKNOWN.
- **Live-session choreography** — the cube stops advertising ~1 s after coming
  to rest, so live connects require continuous motion. Offline fixture tests are
  the authoritative verification and need no hardware.
