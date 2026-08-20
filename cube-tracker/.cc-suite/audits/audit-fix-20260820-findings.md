# Audit Findings — cube-tracker/src

**Run:** audit-fix 20260820 | **Scope:** cube-tracker/src | **Audit type:** mini (5-dim)
**Fixer:** Claude (Codex CLI runner not provisioned in this project → documented Claude-audit fallback)
**Rounds:** 3 | **Result:** ACCEPTED — all findings fixed and verified via `npm run check` (62 tests, 96.9% line coverage)

| # | File | Severity | Dimension | Finding | Fix | Status | Round |
|---|------|----------|-----------|---------|-----|--------|-------|
| 1 | src/belief.ts, src/tracker.ts | High | correctness | Evidence accumulated across state changes: a move performed after the cube sat still at the prior state was penalised by the pre-move still frames (stale accumulation), delaying/blocking its commit. No evidence-window reset on a motion episode. | Added `Belief.newEpisode()`; the tracker resets the evidence window on the motion→still transition. Added a still-then-move test that fails without the fix. | fixed | 1 |
| 2 | src/cube.ts | Medium | robustness | `applySequence` (a public export) silently crashed with a cryptic `multiply(undefined)` error on an invalid move token from its `string.split()` boundary. | Validate each token against `MOVES` and throw a clear `unknown move` error (fail-loud at the boundary). Added a throws-test. | fixed | 2 |
| 3 | src/tracker.ts | Medium | correctness | When *recovery* reported ambiguous, the tracker discarded the real ambiguous candidate set, so `disambiguationPrompt()` (§12/#22) split the wrong set (the belief's successors) instead of the recovery candidates. | Store the recovery candidates and use them in `disambiguationPrompt` when present, falling back to belief hypotheses otherwise. | fixed | 3 |

## Notes / accepted limitations (not defects)

- Joint `(state, orientation)` resolution in the tracker picks the single best orientation of the best candidate; a maximally color-symmetric state could tie multiple orientations. The belief's per-hypothesis orientation field supports full joint branching as a future enhancement — acceptable for tracking a scrambled cube (unique in practice), and covered by the D4-ambiguity handling in recovery.
- Recovery retains the full depth-≤N ball's scored list; bounded by design (`N_max`), and the compact BigInt key keeps it cheap for the default depth.
