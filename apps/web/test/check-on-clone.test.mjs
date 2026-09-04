// scripts/check-on-clone.sh moves gitignored files aside for the length of a run, which means for
// that length the ONLY copy of the maintainer's notes is wherever the script put them. It had no
// test at all, and its data paths are where the damage lives:
//
//   - an interrupted run that leaves the stash behind, which the next run must recover;
//   - a collision between a recovered stash and a live directory, which it must REFUSE rather
//     than resolve — resolving it used to `mv ./dev-docs stash/dev-docs` onto an existing
//     directory, i.e. INSIDE it, so the restore then handed back one dev-docs with a second
//     dev-docs nested in it, holding two runs' notes merged into one tree;
//   - a Ctrl-C, which must restore AND stop, not restore and carry on running "clone" checks
//     against a tree that is no longer a clone.
//
// And, since 2026-09-05, what it HIDES and what it SAYS: every ignored input a clone lacks, not
// only the two directories that first bit; a check whose tool is missing reported as skipped, never
// as passed; and the design kit's copy of the icon source compared against the source while both
// are in view.
//
// The real script is copied into a throwaway fixture and run there. It cds to its own parent's
// parent, so a copy at <tmp>/scripts/ operates entirely on <tmp> — no hook in the script, and the
// file under test is the file that ships. The checks it runs are stubbed to trivial commands on
// PATH, because what is being tested is what happens to the directories, not what pnpm says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../../scripts/check-on-clone.sh', import.meta.url));
const STASH = '.check-on-clone-stash';
// Every tool the script's checks declare they need. The icons check needs rsvg-convert as well as
// python3: verify-icons.py reports its renderer-dependent measurements as informational without
// it, and a run that could only be informational is a skip, not a pass.
const TOOLS = ['pnpm', 'python3', 'git', 'rsvg-convert'];

/** A fixture repo with the script in it, plus stubs so its checks succeed cheaply. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'clone-check-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(SCRIPT, join(root, 'scripts/check-on-clone.sh'));
  mkdirSync(join(root, 'bin'));
  for (const tool of TOOLS) {
    writeFileSync(join(root, 'bin', tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  return root;
}

/** Two directories with a recognisable file in each, so a merge or a loss is visible. */
function contents(root, marker) {
  for (const dir of ['dev-docs', '.codex']) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'note.md'), marker);
  }
}

function run(root, { signal = null } = {}) {
  // The fixture's stubs, then the system directories the script's own commands live in (mv, find,
  // cmp, tr …) — and NOT the developer's PATH, where a real pnpm or rsvg-convert would answer for
  // a stub the test deliberately removed.
  const env = { ...process.env, PATH: `${join(root, 'bin')}:/usr/bin:/bin` };
  if (signal === null) {
    return spawnSync('bash', [join(root, 'scripts/check-on-clone.sh')], {
      cwd: root, env, encoding: 'utf8',
    });
  }
  // Interrupt the run mid-check. Only the FIRST check blocks, so a script that wrongly carries on
  // afterwards finishes quickly and is caught by what it printed rather than by a timeout.
  writeFileSync(
    join(root, 'bin/pnpm'),
    `#!/bin/sh\n[ -e "${root}/.slept" ] && exit 0\ntouch "${root}/.slept"\nsleep 5\n`,
    { mode: 0o755 },
  );
  // `set -m` puts the script in its own process group, and the signal goes to the GROUP — which
  // is what a terminal does on Ctrl-C, and the only way the blocking child dies too. Signalling
  // the script alone just queues the trap behind a `sleep` that bash will not interrupt.
  return spawnSync(
    'bash',
    ['-c', `set -m; "$1" & pid=$!; sleep 1; kill -${signal} -"$pid"; wait "$pid"; echo "exit=$?"`,
     'sh', join(root, 'scripts/check-on-clone.sh')],
    { cwd: root, env, encoding: 'utf8', timeout: 60_000 },
  );
}

test('a clean run hides the directories and puts them back', () => {
  const root = fixture();
  try {
    contents(root, 'original');
    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /hidden: dev-docs \.codex -> \.check-on-clone-stash/);
    // Back where they started, with their contents, and no stash left behind.
    assert.equal(readFileSync(join(root, 'dev-docs/note.md'), 'utf8'), 'original');
    assert.equal(readFileSync(join(root, '.codex/note.md'), 'utf8'), 'original');
    assert.equal(existsSync(join(root, STASH)), false);
    assert.match(r.stdout, /^PASS: /m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The founding defect under other file names: a check that happens to read the agent-tooling
// files, a grill report, the training output or a stray tool's log passes here and fails in CI.
// Files, a nested file, a directory and a SYMLINK — each a different thing to move and put back.
test('every ignored input a clone lacks is hidden and restored, files and symlinks alike', () => {
  const root = fixture();
  try {
    contents(root, 'original');
    writeFileSync(join(root, '.cc-suite.md'), 'suite');
    writeFileSync(join(root, 'grill-report-2026-01-01.md'), 'grill');
    mkdirSync(join(root, '.claude/skills'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.local.json'), '{}');
    mkdirSync(join(root, '.agents'));
    symlinkSync('../.claude/skills', join(root, '.agents/skills'));
    mkdirSync(join(root, 'runs'));
    writeFileSync(join(root, 'runs/last.pt'), 'weights');
    writeFileSync(join(root, 'error.log'), 'some tool');

    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      /hidden: dev-docs \.codex \.cc-suite\.md grill-report-2026-01-01\.md \.claude\/settings\.local\.json \.agents\/skills runs error\.log -> \.check-on-clone-stash/,
      'not every ignored input was hidden, or not in the declared order',
    );
    assert.equal(readFileSync(join(root, '.cc-suite.md'), 'utf8'), 'suite');
    assert.equal(readFileSync(join(root, 'grill-report-2026-01-01.md'), 'utf8'), 'grill');
    assert.equal(readFileSync(join(root, '.claude/settings.local.json'), 'utf8'), '{}');
    assert.equal(readFileSync(join(root, 'runs/last.pt'), 'utf8'), 'weights');
    assert.equal(readFileSync(join(root, 'error.log'), 'utf8'), 'some tool');
    assert.ok(lstatSync(join(root, '.agents/skills')).isSymbolicLink(), 'the symlink came back as something else');
    assert.equal(existsSync(join(root, STASH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A gate nothing runs is not a gate. Before this, a missing tool made the check FAIL (a red that
// says "install X", fine) or — for the icon verifier's renderer — run as informational and read as
// ok. Now a check whose tool is absent is SKIPPED by name, and the run ends INCOMPLETE with its own
// exit code, so a caller can tell "everything passed" from "everything that could run passed".
test('a check whose tool is missing is reported SKIPPED, and the run is not a pass', () => {
  const root = fixture();
  try {
    contents(root, 'original');
    // pnpm, because no system directory ever carries one — a removed stub is a genuinely absent
    // tool on every machine this runs on, which a removed rsvg-convert is not on a Mac with librsvg.
    rmSync(join(root, 'bin/pnpm'));
    const r = run(root);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /=== cube-scanner — check ===\n {2}SKIPPED — needs pnpm/);
    assert.match(r.stdout, /=== icons ===\n {2}ok/, 'the check whose tools are present still ran');
    assert.match(r.stdout, /^INCOMPLETE: .*4 were SKIPPED/m);
    assert.match(r.stdout, /^ {2}cube-scanner — check \(needs pnpm\)$/m);
    assert.match(r.stdout, /^ {2}vendored bundles \(needs pnpm\)$/m);
    assert.doesNotMatch(r.stdout, /^PASS:/m, 'a skipped check was counted as a pass');
    // And the tree was restored regardless of the verdict.
    assert.equal(readFileSync(join(root, 'dev-docs/note.md'), 'utf8'), 'original');
    assert.equal(existsSync(join(root, STASH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// design/icons/ is the tracked source every icon is built from; dev-docs/design/icons/ is the
// design kit's byte-identical copy, and nothing else keeps the two equal. This script is the one
// place both are in view (CI never sees dev-docs), so it compares them before hiding dev-docs.
test('a drifted design-kit copy of the icon source fails the run; an identical one passes', () => {
  const root = fixture();
  try {
    contents(root, 'original');
    mkdirSync(join(root, 'design/icons'), { recursive: true });
    mkdirSync(join(root, 'dev-docs/design/icons'), { recursive: true });
    writeFileSync(join(root, 'design/icons/cubus-icon-flat.svg'), '<svg>source</svg>');
    writeFileSync(join(root, 'dev-docs/design/icons/cubus-icon-flat.svg'), '<svg>edited copy</svg>');
    let r = run(root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /=== design-kit icon copies match design\/icons\/ \(the source\) ===/);
    assert.match(r.stdout, /dev-docs\/design\/icons\/cubus-icon-flat\.svg differs from design\/icons\/cubus-icon-flat\.svg, which is the source/);
    assert.match(r.stdout, /^FAIL: 1 check/m);

    writeFileSync(join(root, 'dev-docs/design/icons/cubus-icon-flat.svg'), '<svg>source</svg>');
    r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /=== design-kit icon copies match design\/icons\/ \(the source\) ===\n {2}ok/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stash left by a killed run is recovered before anything new is hidden', () => {
  const root = fixture();
  try {
    // Exactly the state a `kill -9` leaves: the stash holds the only copy.
    mkdirSync(join(root, STASH, 'dev-docs'), { recursive: true });
    writeFileSync(join(root, STASH, 'dev-docs/note.md'), 'rescued');
    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /recovered \.\/dev-docs from an interrupted run/);
    assert.equal(readFileSync(join(root, 'dev-docs/note.md'), 'utf8'), 'rescued');
    assert.equal(existsSync(join(root, STASH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A nested name (.claude/settings.local.json) leaves an empty .claude/ in the stash after
// recovery; that directory is the script's own and must not read as a stray.
test('a nested file left in a killed run\'s stash is recovered, and its empty parent is not a stray', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, '.claude'));
    mkdirSync(join(root, STASH, '.claude'), { recursive: true });
    writeFileSync(join(root, STASH, '.claude/settings.local.json'), '{"rescued":true}');
    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /recovered \.\/\.claude\/settings\.local\.json from an interrupted run/);
    assert.equal(readFileSync(join(root, '.claude/settings.local.json'), 'utf8'), '{"rescued":true}');
    assert.equal(existsSync(join(root, STASH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a collision stops the run instead of merging the two copies', () => {
  const root = fixture();
  try {
    contents(root, 'live');
    mkdirSync(join(root, STASH, 'dev-docs'), { recursive: true });
    writeFileSync(join(root, STASH, 'dev-docs/note.md'), 'stashed');
    const r = run(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /both \.\/dev-docs and .*dev-docs exist/);
    // Neither copy moved, and above all nothing nested: the old code moved the live tree INSIDE
    // the surviving stash directory and then restored the two of them as one.
    assert.equal(readFileSync(join(root, 'dev-docs/note.md'), 'utf8'), 'live');
    assert.equal(readFileSync(join(root, STASH, 'dev-docs/note.md'), 'utf8'), 'stashed');
    assert.equal(existsSync(join(root, 'dev-docs', 'dev-docs')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stash holding something unexpected is reported, not flung into the repo root', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, STASH), { recursive: true });
    writeFileSync(join(root, STASH, 'someone-elses-file'), 'x');
    const r = run(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /holds something this script did not put there: someone-elses-file/);
    assert.equal(existsSync(join(root, 'someone-elses-file')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a second run refuses while the first is still holding the stash', () => {
  const root = fixture();
  try {
    contents(root, 'original');
    // Exactly what a live run leaves behind: the directories hidden, and a pid that answers.
    mkdirSync(join(root, STASH), { recursive: true });
    writeFileSync(join(root, STASH, '.owner'), String(process.pid));
    for (const dir of ['dev-docs', '.codex']) {
      cpSync(join(root, dir), join(root, STASH, dir), { recursive: true });
      rmSync(join(root, dir), { recursive: true });
    }
    const r = run(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /another run of this script \(pid \d+\) is using/);
    // It touched nothing. Without the lock the root looks like an interrupted run to the second
    // invocation, which recovers the FIRST one's only copy and hides it again under itself —
    // after which whichever finishes first un-hides for both.
    assert.equal(readFileSync(join(root, STASH, 'dev-docs/note.md'), 'utf8'), 'original');
    assert.equal(existsSync(join(root, 'dev-docs')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stash whose owner is gone is still recovered — the lock is not a tombstone', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, STASH, 'dev-docs'), { recursive: true });
    writeFileSync(join(root, STASH, 'dev-docs/note.md'), 'rescued');
    // A pid that cannot answer. `kill -0` is how the two cases are told apart; if the lock were a
    // plain flag, one hard kill would wedge the script for good.
    writeFileSync(join(root, STASH, '.owner'), '21474836');
    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /recovered \.\/dev-docs from an interrupted run/);
    assert.equal(readFileSync(join(root, 'dev-docs/note.md'), 'utf8'), 'rescued');
    assert.equal(existsSync(join(root, STASH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [signal, code] of [['INT', 130], ['TERM', 143]]) {
  test(`SIG${signal} restores the directories AND stops the run`, () => {
    const root = fixture();
    try {
      contents(root, 'original');
      const r = run(root, { signal });
      // Restored…
      assert.equal(readFileSync(join(root, 'dev-docs/note.md'), 'utf8'), 'original', r.stdout);
      assert.equal(existsSync(join(root, STASH)), false);
      // …and STOPPED. The handler used to restore and then RETURN, so bash carried on to the next
      // check — running the rest of a "fresh clone" run against a tree it had just un-hidden, and
      // printing a verdict for a condition it had stopped testing. One header, no verdict.
      assert.equal(r.stdout.match(/^=== /gm)?.length ?? 0, 1, r.stdout);
      assert.doesNotMatch(r.stdout, /^(PASS|FAIL|INCOMPLETE):/m);
      // The exit code is the conventional one for the signal, so a caller in a pipeline can tell
      // an interrupted run from a failing one.
      assert.match(r.stdout, new RegExp(`exit=${code}`), r.stdout + r.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
