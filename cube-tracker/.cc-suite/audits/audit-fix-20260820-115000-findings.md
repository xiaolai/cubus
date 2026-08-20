# Audit Findings

**Run**: audit-fix 20260820-115000 | **Scope**: commit 29c0b74 (cube-tracker localize.ts + live.ts) | **Audit type**: mini (5-dim)
**Auditor**: Codex (mcp codex-cli) | **Fixer**: Claude | **Rounds**: 3
**Audit thread**: 01a01d52 | **Verify threads**: r1 01a01d67, r2 01a01d75
**Result**: ACCEPTED — all findings + all fix-introduced regressions resolved. Final gate: `npm run check` green, 84 tests, 97.9% line coverage, biome + eslint clean.

## Original findings (Codex audit)

| # | File | Severity | Dimension | Finding | Status | Round |
|---|------|----------|-----------|---------|--------|-------|
| F1 | localize.ts | High | correctness | bilinear sampling not perspective-correct | fixed (real Heckbert homography + projectQuad) | 1 |
| F2 | localize.ts | High | correctness | out-of-frame samples clamp to border → fabricated stickers | fixed (round before bounds-check; null → unknown) | 1→2 |
| F3 | live.ts | High | correctness | full-frame motion fooled by background / tiny cube | fixed (localize-first + ROI-restricted luma diff) | 1 |
| F4 | localize.ts | Medium | correctness | fixed 3×3 patch beaten by logo/glare | fixed (8-point center-skipping annulus, sticker-scaled) | 1 |
| F5 | localize.ts | Medium | correctness | static palette, no rolling-palette provider | fixed (centersOf provider, read per frame) | 1 |
| F6 | live.ts | Medium | correctness | prev holds mutable Frame; reused buffer → zero diff | fixed (owned toLuma snapshot) | 1 |
| F7 | live.ts/tracker | Medium | correctness | off-frame never surfaces lost | fixed (empty-frame timeout → lost, belief preserved) | 1 |
| F8 | tests | Medium | testing | perspective test didn't warp | fixed (numeric projective check + warped fixture) | 1→2 |
| F9 | tests | Medium | testing | live test only aligned happy path | fixed (discriminating ROI / unaligned / off-frame tests) | 1→2 |
| F10 | localize.ts | Low | performance | unbounded public `ring` param | fixed (radius derived from sticker size; param removed) | 1 |
| F11 | live.ts | Low | performance | invalid stability options unchecked | fixed (StabilityGate validates positive-int / finite) | 1 |

## Regressions introduced by fixes (found by verify, then fixed)

| # | File | Finding | Status | Round |
|---|------|---------|--------|-------|
| REG1 | tracker.ts | emptyStreak/wasStable/ambiguousCandidates not reset on seed()/reset() → cross-session lost | fixed (reset in both) | 2 |
| REG2 | motion.ts | ROI with no lattice points → lumaDiff returns Infinity forever | fixed (full-frame fallback) | 2 |
| REG3 | motion.ts | different-size frames with equal grid dims compared as zero motion | fixed (guard on original w/h) | 2 |
| REG4 | localize.ts | degenerate quad det≈0 → NaN/Infinity | fixed (affine fallback on near-zero det) | 2 |
| REG5 | localize.ts | fully-offscreen face emits 9 unknown cells → suppresses lost; negative ROI | fixed (skip all-null faces; clamp ROI ≥0) | 2 |
| REG6 | motion.ts | lumaDiff ignored `step` → different lattices compared | fixed (guard includes step) | 3 |
| REG7 | tests | REG1 test did reset()+seed() together (couldn't isolate) | fixed (seed()-only + reused-tracker move test) | 3 |
