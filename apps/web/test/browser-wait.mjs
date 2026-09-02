// One wall-clock bound for every browser wait in this suite, in one place, with the reason once.
//
// These bounds are LIVENESS bounds: they exist to stop a hung page from hanging the run, not to
// assert how fast the app is. Nothing in the browser suite measures latency — the tests that care
// about cost measure it directly (main-thread block time, GL context count, Kociemba search
// counts), and those assertions are unaffected by how long a wait is allowed to take.
//
// They were all calibrated on a developer Mac and they were all wrong for CI, which is the point of
// keeping one number rather than nineteen. `#randCube` is behind a full Kociemba solve, because
// Home paints only once the die has solved ("the die solves before it swaps", AGENTS.md); on a
// two-core runner, under `--test-concurrency=6`, with several WebKit instances alive at once, that
// is comfortably past 15 s. It cost two red CI cycles to learn twice: the first fix raised the one
// timeout named in the log, the next run failed on three more of exactly the same shape, in the
// same file. Two failures of one shape are one defect — so the number lives here now, and a new
// browser test gets it by calling `pace(page)` rather than by picking a number of its own.
//
// If a future test needs to assert that something does NOT appear, it must pass an explicit short
// timeout at the call site. That is a different kind of bound and it does not belong to this one.
export const BROWSER_WAIT_MS = 60_000;

// NAVIGATION gets its own, larger bound, and it lives here for the reason the whole file exists.
//
// Two call sites set `context.setDefaultNavigationTimeout(120_000)` with a comment explaining why a
// page load needs longer than an in-page wait — and then called `pace(page)` on the next line,
// which set the PAGE's default timeout. Playwright resolves navigation in the order
// page-navigation > page-default > context-navigation > context-default, so the page-level 60 s won
// and the 120 s both sites asked for had never applied to anything. Measured, not reasoned: a
// `page.goto` that ran out reported `Timeout 60000ms exceeded`, naming the number nobody set for it.
//
// So navigation is paced here too. A load that is merely slow — a saturated runner, a machine that
// has gone to swap — is then slow rather than red, which is what the 120 s was for.
export const BROWSER_NAV_MS = 120_000;

/** Give `page` the suite's shared liveness bounds. Returns the page, so it can wrap `newPage()`. */
export function pace(page) {
  page.setDefaultTimeout(BROWSER_WAIT_MS);
  page.setDefaultNavigationTimeout(BROWSER_NAV_MS);
  return page;
}
