# Project Instructions

> cubus-im

## Guidelines

A beginner/kids Rubik's Cube tutor. You show your cube to a webcam, it reads the stickers, and
it walks you through solving it.

- **Language**: always reply to the user, and write all code comments and
  documentation, in English — regardless of the language the user writes in.
- **Layout** (pnpm + Cargo monorepo): the AI scanner at `packages/cube-scanner/`, the web SPA at
  `apps/web/`, and the Tauri desktop app at `apps/desktop/` — which is `apps/web` in a native
  window and nothing more. Its Rust side is a shell: no commands, because a command would mean the
  web build and the desktop build had stopped being the same app.
  - **The one deliberate exception, accepted 2026-08-26**: native camera capture and native model
    inference (CoreML/Vision on Apple, LiteRT/TFLite on Android; the browser keeps `getUserMedia` +
    onnxruntime-web). These are Tauri plugins, so they ARE commands — but each sits behind a seam
    the browser build also implements (a `RawFrame` source; an injected model run), so the two
    builds stay the same app in behaviour while one gets native acceleration and cameras the webview
    cannot reach. That is the line: a capability seam both builds satisfy is allowed; a screen that
    only exists on one build is not. The plan, the artefacts per platform, and the checks that must
    pass before the native work starts are in `dev-docs/native-capture-and-inference.md`.
  - **Second seam, accepted 2026-08-27**: `tauri-plugin-opener`, for external links only (the
    About card's website/author anchors). A webview does nothing with `target="_blank"`, so a
    delegated click handler in `app.js` hands the URL to `__TAURI__.opener.openUrl` when that API
    is injected; in the browser the same anchors work natively. Same test as above: both builds
    satisfy the seam, neither gains a screen.
  - **Third seam, accepted 2026-08-27 with the layout contract**: the desktop window's
    orientation. `set_orientation` / `get_orientation` (commands in `lib.rs`) re-size and
    re-centre the fixed window to the other reference and remember the choice in a file the
    window is built from at the next launch — a file, because the window exists before the
    webview does. The Settings row that calls them is drawn only where the Tauri API is injected
    on a desktop platform; the browser build has no window to shape and a phone rotates in the
    hand. Same test as above: no screen exists on one build only.
  - **Fourth seam, accepted 2026-08-29 with the owner's execution of
    `dev-docs/optimal-solver-plan.md`**: the optimal solver. Proving a solution minimal needs
    ~86 MB of pattern databases whose generation is native work (a parallel BFS: 3.6 s and a
    281 MB peak on a laptop since the level-synchronous generator of 2026-09-05; 23 s and 804 MB
    before it),
    which a webview cannot do — that, not size, was always the barrier. The capability is "how
    short can this be, and can you prove it": the desktop answers with a native proof
    (`crates/optimal-solver` behind prepare/prove/cancel commands), the browser answers with the
    two-phase tiers' honest "the shortest I found" and the precomputed proven library that ships
    everywhere. Same test as every seam: no screen exists on one build only — the prove
    affordance follows the orientation-row precedent in full (drawn only where the API is
    injected AND the platform is a desktop: `apps/web/lib/host.js`, which exists because the
    mobile shells inject the identical API, and `optimal_prepare` refuses on mobile too). It is
    also **off by default** (`settings.proveMinimum`, 2026-08-30): a proof is minutes to hours on
    a typical cube, which is not something to put in front of a beginner who did not ask, so the
    Settings row that turns it on states the cost and is itself drawn only where the capability
    is. A proof reports the contours it has RULED OUT as it goes (`optimal-proof-progress`), so
    the wait shows a rising lower bound rather than a spinner, and it can be stopped.
    **A minimality claim has exactly two sources, and `optimal.test.mjs` enforces it by name**:
    the native proof, and the shipped library whose entries were proved offline and re-checked
    against the cubejs oracle at load. Never the two-phase engine. A third region that merely
    NAMES the feature (the button, the toggle) is sanctioned separately and asserts nothing —
    the categories are the point, or the test degrades into one exception per string.
    Provenance discipline as for the two-phase engine:
    `dev-docs/optimal-solver-provenance.md`, written before the Rust.
  - **Dev tooling, accepted 2026-08-27, never shipped**: `tauri-plugin-mcp` (git dep, pinned rev)
    — the control socket that lets an AI agent drive the app for verification: screenshots,
    selector clicks, DOM queries, JS eval. Triple-gated because it is control-everything: the
    `mcp` cargo feature (`pnpm dev` passes it, `tauri build` does not, so release binaries never
    compile the crate), `debug_assertions`, and a `CUBUS_MCP=1` runtime opt-in. The MCP server
    side is registered in `.mcp.json` (`tauri-mcp`, pinned npm version); the guest JS is vendored
    to `apps/web/vendor/tauri-mcp-guest.js` and loaded only under Tauri, inert without the Rust
    side. To use: `CUBUS_MCP=1 pnpm dev:desktop`, then the `tauri-mcp` MCP tools in a fresh
    agent session. **Never call `manage_window clear_browsing_data` (or any storage clear) on the
    dev app**: its localStorage IS the user's data — settings, the hidden-nav choice, the cube
    registry, recent solves, the `cubeView` tuning — and on 2026-08-27 one such call, made to bust
    a cached bundle, wiped all of it with no backup. If a rebuilt bundle does not show after a
    reload, restart the dev app; the cache dies with the process, the data does not.
    **`manage_window focus` before any screenshot of a `<cubus-cube>`**: an occluded window
    reports `document.visibilityState === 'hidden'` and WebKit pauses `requestAnimationFrame`,
    so the renderer keeps its FIRST frame — a camera or ghost attribute set after mount is never
    repainted. On 2026-08-28 that made the solved cube on Home look twice its size with no
    ghosts, and cost an hour of chasing a renderer bug that did not exist.
- **Smart-cube support returned, deliberately** (removed 2026-08-26, merged back 2026-08-28).
  The removal's reasoning is the bar the return is held to: a cube adds an axis — present or
  absent, trusted or not — that every screen has to answer, and for this audience that axis was
  where the app got lost. The return answers it rather than modelling it away: trust is a
  visible state, never inferred from "connected"; one camera scan repairs tracking with no
  solving (the offset, `apps/web/lib/cube-trust.js`); and a reconnect asks the one question a
  beginner can answer — "Is this your cube right now?" — backed by a two-adjacent-side camera
  check (`apps/web/lib/cube-reconnect.js`). Capability, never a mode: every screen works with no
  cube, the camera stays first-class, and no screen exists only with hardware. The design and
  its refute passes: `dev-docs/cube-trust-design.md` and `dev-docs/smart-cube-ux-prd.md`
  (delivery status per phase). The removal-era code history remains on **`v0`**.
- **Design system**: the approved UI kit lives in `dev-docs/design/` — read
  `dev-docs/design/README.md` before any `apps/web` UI work. Adopted into the app:
  `apps/web/tokens.css` (warm-paper tokens, light/dark) and `<cubus-cube>` (a purpose-built
  three.js renderer that replaced twisty-player; draws only — state/solving stay with
  cubejs + the two-phase engine). Fonts are system stacks only (decided 2026-08-27): numerals/times/algs use
  the system mono stack, UI text `system-ui` — no web fonts, no embedded fonts, and index.html
  loads nothing remote (a test enforces it).
- **Layout contract** (decided 2026-08-27): two compositions keyed only on orientation — a 4:3
  landscape reference and a 3:4 portrait reference — each with a locked primary region (the cube,
  or the live scan face) and a sheet that absorbs the long-axis surplus, so a phone's extra height
  is sheet, never paper. Every platform runs the same two; the desktop window is fixed-size,
  non-resizable, sized from the monitor's work area, and can be either shape (a persisted toggle).
  The browser tab is a test harness, not a supported viewport. No viewport width/height media
  queries anywhere in `apps/web` — a test enforces it; `@container`, `orientation`, `prefers-*`
  and `pointer` are the allowed queries. Contract, fit rule, fixture table, desktop formulas,
  and the build order: `dev-docs/stage-contract.md`.
- **A screen changing its SUBJECT is not a navigation** (measured 2026-08-29). Pressing Random on
  Home re-enters the screen — `stage.innerHTML` is replaced and every element rebuilt — and that
  was reported as the page jittering. Measured in WebKit, nothing moves: the boxes are identical
  before and after, and the best-matching pixel shift between consecutive frames is (0,0)
  everywhere. It was four other things, and each needed its own fix.
  **The last UI-thread search left on 2026-09-05**: `Cube.initSolver()` is gone from
  `loadSolver()` (it built cubejs's tables for `deriveCube`'s `cube.solve()`, a 723 ms block right
  after first paint, measured in WebKit; 40 ms after, all of it the renderer's first WebGL
  build). The setup alg is now `invertAlg(solution)` of the pool's answer, checked with
  `reaches()` in `finishSolve`; legality is arithmetic from cubejs's parser (`isCubeState`),
  never the engine's null, because that null cannot tell "out of budget" from "not a cube" and
  so must never become a verdict. A screen may say an ARRANGEMENT is unreachable (parity proves
  it, `.unsolvable-card`); it still may never say a MOVE COUNT is. Pinned by
  `initsolver-off-main-thread.test.mjs` (a spy appended to the cubejs bundle itself, and the
  tables asserted null) and a screen-swap case that records what the renderer was ASKED to draw.
  **Two Kociemba searches for one cube**: `randomScramble()` searched a random state for its
  scramble alg, then `deriveCube()` searched the same state for the same answer. Fixed by
  carrying the alg with the cube and CHECKING it rather than trusting it (`reaches` /
  `takeDerivation`: applying it to a solved cube must reproduce the facelets — microseconds
  against the search it replaces).
  **A THIRD search, in cubing.js's worker**: the solution was searched for again, when inverting
  the setup alg already IS one (`invertAlg` is an involution, so one search yields both). The
  oracle rule is unchanged, only which side plays which part — the oracle VERIFIES a generated
  cube's solution by APPLYING it, no search. (cubing.js held that part when this was measured;
  the in-house two-phase engine has since replaced it as the solver, so cubejs plays it —
  `finishSolve` applies the carried solution and blocks on a definite refutation.) Never let this
  become one implementation checking itself: `state.cube.crossChecked` exists precisely because
  "solution is set" no longer implies "someone else agreed", and it is true only when the oracle
  actually SAID yes — an oracle that could not run has verified nothing.
  **A presented frame with an empty solution**: the screen was replaced first and solved second,
  so one composited frame showed the new cube beside an empty chip grid under a count reading
  "working…". The die solves before it swaps now.
  **A first drawing framed for the wrong view**: ghosts and camera were set after `appendChild`,
  and `connectedCallback` draws immediately, so the first drawing was fitted to a cube with no
  ghost faces — visibly larger. It never reached the screen only because the element's own
  animation frame happened to run later in the same frame as the mount, which is the engine's
  ordering to change and nothing tested it. Attributes go on before connecting now.
  Result: the synchronous click went from 55–271 ms to **0–1 ms**, the longest main-thread block
  from 59–272 ms to 14–33 ms, and Kociemba searches on the UI thread to **zero**.
  Pinned by `apps/web/test/screen-swap.test.mjs`, whose assertions are all about a frame that
  must NOT exist or a search that must NOT run; five of its eight fail against the old code.
- **`<cubus-cube>` is parked and re-used, not rebuilt** (2026-08-29). It used to dispose on the
  way out of the DOM and return early on the way back in, so it could never be re-inserted and
  every screen render built a new WebGL context — 21–24 ms for the same picture. Now
  `disconnectedCallback` only stops the loop, `dispose()` is explicit, and `recycle()` puts every
  observed attribute back to its default; `app.js` parks exactly one between renders, so a whole
  session runs on **one** GL context. Three things this rests on, all load-bearing: a re-used
  element keeps its LISTENERS, so anything a mount adds to it carries `screenAbort`'s signal or it
  arrives at the next screen still driving the last one's DOM; a detached, unparked cube releases
  itself on the next tick, because a quiet GL-context leak is worse than a rebuild; and
  `isRenderer()` gates the whole thing, because until `vendor/cubus-cube.js` has upgraded the tag
  it is a plain unknown element — assuming otherwise took out 21 tests at once, all one mechanism.
- **A scramble is WCA-standard on BOTH halves, and rolling it is a solve** (2026-08-31; the
  separate scramble worker of 2026-08-29 is gone). The STATE was always right — a uniform draw
  from a cryptographic source (`lib/random-state.js`), which is TNoodle's method — and TNoodle's
  other rule is enforced now too: a state already solved or one turn from it is redrawn
  (`trivialState`, ~4 in 10^19, asked of the STATE and never of the solver, because two-phase
  does not promise an optimal route and "the answer came back short" would be a different
  question). The LENGTH was the half that was wrong: the scramble was cubejs's `solve()`
  inverted, and **that method's default bound is 22**, so 96% of scrambles exceeded God's number
  and 79.5% were exactly 22 (n=200). It now goes through `solveWithinGodsNumber` — the SAME
  promise the solve path keeps, lifted out of `refine` so there is one implementation and a
  scramble and a solution cannot come to disagree about what 20 means. Inversion preserves
  length, so ≤ 20 solution ⇒ ≤ 20 scramble.
  **Asking cubejs for 20 instead is the obvious one-argument fix and is a trap**: measured mean
  5,644 ms and worst 66 s per scramble, against 4 ms median through the two-phase engine, which
  searches six interleaved views under a node budget rather than depth-limited IDA* on one.
  Rolling therefore goes to the SOLVER POOL, and `lib/scramble-worker.js` was deleted with
  `warmRoller()`: a second worker carrying its own ~34 MB of cubejs tables and 3–6 s of build,
  beside a pool already holding warm two-phase tables, was the app paying twice for one
  capability. `schedulePreroll()` still rolls one ahead of the press, and the die never depends
  on it having finished. What comes back is still untrusted input checked with `reaches()` — and
  that check is worth MORE now, because cubejs is a different implementation from the one that
  produced the answer, where before it was cubejs checking cubejs.
  Two traps this left behind, both fixed in the same pass and both invisible until rolling
  became a solve. `spawnSolveWorker` fell back to the inline on-thread worker only when `Worker`
  was UNDEFINED, not when the constructor threw — a CSP or a blocked URL took solving down, and
  now the die with it. And the inline worker did not report `depth`/`view`, which `pickWinner`
  REQUIRES: a pooled solve on inline workers found answers, discarded every one, spent all eight
  budget escalations and threw. The single-worker client ignores those fields, which is why
  nothing noticed.
- **A screen takes a new subject in place; only a new COMPOSITION is a new screen** (2026-08-29).
  `renderScreen()` was the app's only way to say "something about the cube changed", so a dozen
  callers destroyed and rebuilt the whole screen to change one fact about it — the die, both
  reconnect answers, the silence report, the snapshot fallback. The app had already drawn this
  line once, for `liveUpdate` ("a fresh scan repaints rather than re-mounting — which on the cube
  screen would restart an animation the user is halfway through"), and then left every
  subject change on the wrong side of it. `refreshScreen()` is the missing half: a screen may
  offer `update()`, and one that cannot take the change in place returns false and is rebuilt
  exactly as before. `cubeScreen`'s mount defines everything once and `loadWalk()` replaces the
  walk underneath it; `walking` flipping is still a rebuild, because with no walk there is nowhere
  to put one. Longest main-thread block per press: **9–13 ms**, inside a single 60 Hz frame.
  Three traps, each of which was a real bug before it was a comment. **Commit after the freshness
  check, never before**: two loads can overlap (a reconnect answered while the die is still
  solving), and assigning the shared `moves`/`steps`/`target` inside the search left the DOM
  showing one cube while every closure that reads them held the other. **`beginWalk()` runs before
  the search, not after**: the moment the subject changes the old chips describe a cube that is no
  longer there, and where the answer is already known nothing yields in between, so no frame is
  ever painted in that state. **The heading and the open question are not part of the walk** — they
  are written synchronously, or a reconnect on a screen with no solver keeps asking a question the
  user has answered. Per-walk state is `let` at mount scope on purpose: a `const` there puts the
  app straight back to needing a new screen for a new cube.
- **Verification is the contract**: a claim in a comment or a doc must be backed by a test that
  fails when the claim stops being true. The habit that mattered most on the driver — assert what
  must NOT happen, not only what should — applies just as well to a scan and a solve.
- **`cubejs` is a deliberate independent test oracle**, not a redundant dep. Do not
  "consolidate" it into the solver; a different implementation is what makes the invariant a real
  cross-check. It is also the facelet parser and the state-brain.
- **The solver is our own two-phase engine (2026-08-29): `apps/web/lib/two-phase.js`** —
  Kociemba's algorithm implemented from the published method, no existing solver's source
  opened (the record: `dev-docs/two-phase-provenance.md`; the plan and its acceptance stamps:
  `dev-docs/two-phase-plan.md`). It replaced the vendored min2phase, whose licence was
  contradictory and unresolved — `apps/web/vendor/min2phase.PROVENANCE.md` stays as that
  record. The bounds are the feature and are why the app owns its solver: `solLen` (an
  EXCLUSIVE length bound), `probeMax` (a budget in SEARCH NODES — deterministic across
  machines and proportional to time, ~20 ns each), and null when out of budget, never an error
  string. `lib/solver-engine.js` enforces that contract at the boundary; the search runs six
  interleaved views (three axes × normal/inverse); the measured ladder and its retuning
  history live in `dev-docs/solver-move-count.md` §7. **cubing is gone entirely** — not even a
  devDependency. Bring it back only for something it is actually needed for — WCA-event
  scrambles are the obvious candidate, and note that `randomScrambleForEvent` was never
  vendored, so nothing lost it. `<cubus-cube>` is the renderer and never touched any of this
  (see Design system above).
- **Scrambles are random-STATE, from a cryptographic source** (`apps/web/lib/random-state.js`):
  the position is drawn uniformly from all 43 quintillion legal ones via `crypto.getRandomValues`
  and then solved, and the scramble is that solution inverted. Never random turns — those leave a
  distribution with structure and cubes easier than they look. There is no fallback to
  `Math.random()`; a platform without a crypto source fails loudly instead of quietly weakening.
- **One solver, one question (decided 2026-08-29 — the explaining solver was removed).** The
  app answers *just restore it*: the two-phase engine, behind a single Settings choice — a
  solution-length ceiling (≤ 20 / ≤ 19 / ≤ 18 / shortest). The method solver ("why is this
  move right", 118 moves in 21 steps with a reason each) and its reason line were removed by
  the owner's call: in practice the explanations did not reduce a learner's burden. The
  two-solvers argument it reversed, the measured ladders, the completeness proof over all
  62,208 last-layer states, and the dead-ends table are all preserved in
  `dev-docs/solver-research.md` — read it before re-deriving anything, and before any attempt
  to bring explanation back (hold a return to the same bar the smart-cube return met). The
  code history is in git (removal commit, 2026-08-29).
  - **The ceiling is a ceiling, not a stopping place**: once the target is met, `refine`
    keeps asking for shorter at a small bonus budget, so a cube a few turns from solved gets
    its real few-move answer instead of the target length. The day this was missing, a 7-turn
    cube was answered with ~20 moves — `lib/solve-target.js` records the mechanism.
- **A search that ran out of budget is not a cube that cannot be solved** (2026-08-30). God's
  number is 20, so `<= 20` is a PROMISE the app keeps rather than a target it aims at: a refusal
  above a promised target doubles the budget and asks again (`GODS_NUMBER`,
  `MAX_PROMISE_ESCALATIONS` in `lib/solve-target.js`), because `solvePattern` deepens phase-1 to
  `solLen - 1` and canonical pruning is proved to delete no optimal path. What that does NOT
  make the engine is *complete* (corrected 2026-09-05): phase 1 refuses a maneuver whose last
  move is a G1 move, and phase 2 is capped at `MAX_PHASE2 = 12`, so a length-L solution is
  inside the enumeration at exactly one split — before its maximal trailing run of G1 moves —
  and only if that run is ≤ 12. The honest guarantee is "every ≤ 20 solution whose trailing G1
  run is ≤ 12, in each of six independent views"; nothing has been observed to fail it and
  nothing proves it cannot (`two-phase.test.mjs` demonstrates the mechanism with the cap knob;
  derivation in `dev-docs/solver-move-count.md` §4.1). The rule below never rested on
  completeness: a refusal is a statement about the SEARCH, never about the cube. Eight refusals raise, stating the work actually spent;
  there is deliberately no "give up and call it impossible" branch. **No screen may state that a
  move count is impossible.** Two-phase cannot prove a minimum, so it cannot prove one absent:
  the wording is about the search ("couldn't get to 18"), never about the cube. The old sentence
  was false always at `<= 20` and, measured on 30 random states, false roughly eighteen times in
  nineteen at `<= 18`. A comment-stripped sweep in `solve-tier-wiring.test.mjs` forbids the claim
  reaching a screen while leaving the history of the wording recordable in the source.
- **A gate nothing runs is not a gate** (2026-08-30, twice in one branch). `verify-icons.py`
  measured every shipped icon and was in no CI job at all — which is why the iOS and Android
  projects carried Tauri's placeholder mark from the day the mobile shells landed. It could not
  be gated, either: it shelled out to `sips`/`assetutil`/`ictool` with no guards and raised on
  anything but a Mac. Tool-dependent checks skip as informational now (never pass), it runs in
  CI, and the whole mobile set still gates there. Guard the tool-using PART, never the whole
  function — a guard wide enough to skip a check that needs no tool trades a crash for a silent
  gap, which is the same bug one level finer.
- **Never invent data**: a statistic that cannot be computed is a dash, not a number; a reading
  that cannot be validated is a refusal, not a guess. A plausible figure is worse than a blank.
- **A misread scan may say HOW MANY, and may only point when it is one** (decided 2026-08-28).
  Two legal cube colourings are never closer than three stickers, so a one-sticker misread is the
  only one whose repair is provably unique — above that, the nearest legal cube need not be the
  user's, and pointing would sometimes accuse a correctly-read sticker. So `decodeMisread`
  (`packages/cube-scanner/src/misread-decode.ts`) reports a count that is a proven lower bound and
  is never an overstatement, and `suspects` is populated only at distance 1. Above it the app says
  "at least N stickers were misread" and asks for a side again. This is "Never invent data" applied
  to a place it was previously being broken: the old copy asserted a single misread in exactly the
  branch the code had already ruled one out. The derivation, the measurements, the refutation pass,
  and the three measurements still owed: `dev-docs/misread-decoding.md`.
- **Fail loud**: an unreadable scan, a state that cannot be solved, a storage write that did not
  land — each surfaces where it happens, never silently.
- **The version is one number in TEN sites across eight files** (counted 2026-09-05; this said
  "eight in seven" until the iOS plist pair was included) — `apps/web/lib/app.js`
  (`VERSION`, what the About card shows; the web app has no build step to read a manifest at
  runtime), both `package.json`s under `apps/`, `tauri.conf.json`, the desktop `Cargo.toml`,
  `Cargo.lock`, **`gen/apple/project.yml`, which carries two** —
  `CFBundleShortVersionString` and `CFBundleVersion` — and **the committed
  `gen/apple/cubus-desktop_iOS/Info.plist`, which carries the same two** (xcodegen's output,
  added to the bump tool 2026-09-01, f0d4b45). `pnpm bump X.Y.Z` moves them all
  (`scripts/bump-version.mjs`, tested; it refuses rather than half-bumps), and a wiring test
  fails if any drifts from `VERSION`. Never edit one by hand.
  **The iOS pair was missed for as long as iOS existed** (found 2026-08-31, during the first
  cross-platform release): the bump moved six places while the iPhone bundle stayed at 0.1.3, so
  a TestFlight build would have reported a version the app itself denied. `project.yml` is the
  SOURCE — xcodegen builds `Info.plist` from it — so the plist is an output that is nonetheless
  committed and ships until someone regenerates it; the wiring test asserts both.
  Adding it also exposed a defect in the bump tool itself: every site computed its replacement
  from the ORIGINAL file text, so two sites in one file meant the second write clobbered the
  first — and it reported BOTH as bumped, which is the worst way a version tool can fail. Each
  file is now read once and every site applied to the same evolving text.
- **A model change is not verified until `ml/golden_frames.py` has run.** It is the parity gate —
  every fixture through the app's exact letterbox, one runtime, the app's exact post-processing —
  and CI enforces it, but `pnpm check` does NOT, so it is the gate you can ship past locally. On
  2026-08-29 a model was swapped, declared verified on two hand-picked benchmarks, committed and
  pushed; the gate then failed **8 of 20 fixtures**, including one where the new model stopped
  abstaining on input it should refuse. **The benchmarks you choose yourself are the ones least
  likely to surprise you.** Run `ml/venv/bin/python ml/golden_frames.py` before vendoring a model,
  and never reach for `--write-expected` to make a failure go away — re-pinning is for a change you
  have already explained, not a way to turn CI green.
- **Which machine renders, which machine trains** (measured 2026-08-29). The hosts are named in
  the maintainer's private ssh config, not here; what transfers is the shape of the decision.
  **Render on the many-core desktop** — 16 performance cores, and it already holds Blender, the
  200 HDRIs and the render venv. 2.7 img/s, so a 32k set takes ~3.5 h. **Never render on the
  fanless laptop**: 4 performance cores, 5.2× slower — and it is the machine you are being asked
  to keep usable. Check `ssh` config for hosts before assuming the local machine is the right one;
  a whole night was spent tuning worker counts on the laptop while the desktop sat idle.
  **Train on the near GPU box** — same hardware as the far one, but reachable at 2.4 MB/s, so a
  2.6 GB dataset moves in ~20 min, and its containers resolve DNS so images can be built there.
  **The far box is identical silicon at ~109 ms and 0.1 MB/s** — 7 h for that same dataset — so
  use it only for work whose data is already on it; it holds every historical dataset and the
  v3/v4 runs, which makes it the right host for baseline evals and parallel jobs. Its container
  DNS is broken, so build images on the near box or `docker commit` a finished run.
  **Never change Blender or ultralytics versions mid-comparison** — either puts a renderer or
  training-code difference inside an experiment meant to isolate something else. `ml/train.sh`
  prefers the pinned `cube-train:1`; `ml/Dockerfile.train` pins the stack and asserts the pin took.
  Timings, traps and the reasoning: `dev-docs/red-orange-fine-tune.md`.
- **Quality gate** is `pnpm check`, and it is two different things:
  `packages/cube-scanner` runs strict `tsc` + Biome + a type-aware ESLint pass + vitest;
  `apps/web` runs `node --test` over `apps/web/test/` (it has no build step to typecheck, and
  provisions its vendored libs first). Keep both green. CI enforces them on push, plus
  `cargo fmt`/`clippy`/`check` for the desktop shell, and a step that rebuilds every vendored
  bundle and fails on any diff — those bundles are committed and have drifted from their sources
  four times.
- **The 2026-09-04 audit, and what it changed (2026-09-05).** Nine read-only reviewers over
  every slice, then one fix pass; the full record is `dev-docs/audit-2026-09-04.md`. The
  class-level lessons, each now pinned by a test or a gate:
  - **A test that asserts `met` or a non-null answer under a budget must not draw its state.**
    Escalation turns a lottery into a four-minute wait, not into safety; the frozen states, their
    provenance and their measured cost in NODES live in `apps/web/test/fixtures/solver-cubes.mjs`.
    The contract tests once spread a fixed `probeMax` AFTER the options, so escalation never
    reached the engine and the raise reported a budget nobody spent — 73× the nodes for nothing.
  - **A superseded search is stopped through the stop word (`STOP_NOW`, -1), never by
    terminating a worker**: it is shallower than any depth a winner can publish, so it needs no
    second channel and no table rebuild. `refine` carries `signal` INSIDE the bounds; an adapter
    that destructures them loses cancellation silently.
  - **The scanner keeps ONE detector per page, parked between `<ai-scan-panel>` mounts** — the
    `<cubus-cube>` rule for the same reason: a rebuilt element meant a new `InferenceSession` and
    a 1–5 s model load per visit, the old one unreachable for the life of the page.
  - **`fitFace`'s geometry bounds are set by `ml/golden/frames/`, not by intuition** (measured
    worst legitimate step 1.54, column spread 1.95, area ratio 3.42); the symmetric-looking
    column rule at 1× refuses seven of the twenty. Any change re-runs the golden parity AND
    compares reads. "At least N stickers were misread" presumes the six CENTRES were read
    right; two swapped centres inflate the count and no reading can detect it.
  - **A camera scan repairs untracked DRIFT, not a relabelled decoder.** The offset is
    constant for a missed move (`H·D·H⁻¹`); a decoder in a rotated frame yields a commutator
    that moves with the cube (constant for exactly the six U/D turns). So the camera layer needs
    TWO scans and its rule is constancy, re-baselined only across a reconciliation failure.
    That layer was never wired from `app.js` — `TRUSTED` was unreachable — and a REFUSED
    session's reports still drove the walk; one predicate (`cubeRefused()`) gates all of it now.
  - **A verdict designed not to move cannot also be how a change is reported** — a trusted
    cube survives a lost packet by design, so the loss has its own channel (`onMovesLost`). A
    declared capability the stream contradicts is reported, never absorbed.
  - **A refusal is lifted when a platform is PROVEN, never when it builds**: iOS BLE had been
    offered on a compile alone. Tear down in the order the bytes travel: the JS session disposed
    the bridge BEFORE sending the goodbye, so `ble_disconnect` was never issued — the desktop
    and Android disconnect paths ran for the first time on 2026-09-05.
  - **App commands are under the ACL**: a command in `generate_handler!` must be in `build.rs`
    `COMMANDS` and in exactly one capability or it is unreachable (`app-acl.test.mjs`). The CSP
    lives in `tauri.conf.json` only; Tauri appends a nonce to `style-src`, which makes browsers
    ignore `'unsafe-inline'` for style attributes, so `dangerousDisableAssetCspModification:
    ["style-src"]` is load-bearing (13 violations at boot without it). `devCsp` is inert under
    `tauri dev` with `devUrl`; a CSP check needs a `tauri build --debug --no-bundle` binary.
  - **MSRV is 1.88** (the tree needs it; `1.77.2` was a claim nothing tested) and CI checks it.
    The Android frame rotation and the iOS connection rotation are implemented but UNVERIFIED on
    hardware; the native camera path on a phone is not done until a device says so.
  - **The updater manifest is a table per INSTALLER** (`linux-x86_64-deb`, `-rpm`,
    `-appimage`, `windows-x86_64-msi`, `-nsis`, then the bare key): the plugin looks up the
    installer key first and `install_deb`/`install_rpm` refuse foreign bytes, so a bare-key-only
    manifest gave every `.deb` user a daily prompt whose install always failed. The test asks
    the client's question. A release tag is annotated, never moved, and CI-green — the gate
    enforces all three. `@env:` is altool's syntax; notarytool has none. tauri-cli does the iOS
    keychain/profile dance itself — hand it the secrets. `tauri.settings.gradle` is
    tauri-build's output, not `tauri android init`'s. A backticked phrase inside a
    double-quoted `echo` is a command (the commit-message rule's sibling — it ran in the tap
    workflow).
  - **Never hand a shipped artefact to another tool in place**: onnx2tf saved its simplified
    graph back over the fp32 the int8 had been quantised from. `export.py` now converts a copy
    and asserts `int8 == quantize_dynamic(fp32)` (tested); `--write-expected` refuses without
    `--yes`, a committed `ml/models` and the pinned checkpoint; `expected.json` pins the model's
    identity so a checkpoint swap fails CI; every eval script letterboxes through
    `cube_infer.letterbox`; the 207-photo held-out set carries 36 dihedral copies of training
    images — a dataset decision still owed.
  - **A status colour cannot be both a fill and a sentence**: `--ok`/`--warn`/`--err` are
    fills at 3:1, `--ok-ink`/`--warn-ink`/`--err-ink` are text at 4.5:1, and `tokens.test.mjs`
    computes the contrast of every text token on both surfaces in all three themes. A test seam
    must pass through the same gates the driver does. A weekday alone is a date that lies past
    a week. `prefers-reduced-motion` stops decoration and only SHORTENS the cube's turns — the
    turn is the thing being taught.
  - **Gates that ran nothing, now running**: coverage thresholds (both TS `check` scripts run
    `vitest --coverage`), `cargo test -p cube-ble`, `--features mcp`, macOS clippy/tests, the
    iOS target check, the Kotlin unit tests, `ml/test_pipeline.py`, `pnpm audit --prod`,
    `cargo audit` with a documented allowlist, gitleaks, shellcheck, actionlint, the
    third-party-notices freshness check, and dist exclusions asserted on OUTPUT.

## Shared Memory

**Always write new instructions, rules, and memory to `AGENTS.md` only.**

Never modify `CLAUDE.md` directly — it only imports `AGENTS.md`.
This keeps Claude Code, Codex CLI, and Antigravity CLI (`agy`) on the same
context; Codex and `agy` both read `AGENTS.md` natively.

## Project Structure

- `.claude/` — Claude Code skills, agents, rules, hooks, commands
- `.agents/skills/` — symlink to `.claude/skills/` (Codex skill scan path)
- `.codex/prompts/` — Codex slash-command prompts
- `.codex/hooks.json` / `.codex/config.toml` — Codex hooks/config (optional)
- `.mcp.json` — MCP server registrations (Claude Code + Codex)
