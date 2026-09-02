// scripts/check-on-clone.sh moves gitignored directories aside for the length of a run, which
// means for that length the ONLY copy of the maintainer's notes is wherever the script put them.
// It had no test at all, and its data paths are where the damage lives:
//
//   - an interrupted run that leaves the stash behind, which the next run must recover;
//   - a collision between a recovered stash and a live directory, which it must REFUSE rather
//     than resolve — resolving it used to `mv ./dev-docs stash/dev-docs` onto an existing
//     directory, i.e. INSIDE it, so the restore then handed back one dev-docs with a second
//     dev-docs nested in it, holding two runs' notes merged into one tree;
//   - a Ctrl-C, which must restore AND stop, not restore and carry on running "clone" checks
//     against a tree that is no longer a clone.
//
// The real script is copied into a throwaway fixture and run there. It cds to its own parent's
// parent, so a copy at <tmp>/scripts/ operates entirely on <tmp> — no hook in the script, and the
// file under test is the file that ships. The checks it runs are stubbed to trivial commands on
// PATH, because what is being tested is what happens to the directories, not what pnpm says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../../scripts/check-on-clone.sh', import.meta.url));
const STASH = '.check-on-clone-stash';

/** A fixture repo with the script in it, plus stubs so its five checks succeed cheaply. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'clone-check-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(SCRIPT, join(root, 'scripts/check-on-clone.sh'));
  mkdirSync(join(root, 'bin'));
  for (const tool of ['pnpm', 'python3', 'git']) {
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
  const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` };
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
      assert.doesNotMatch(r.stdout, /^(PASS|FAIL):/m);
      // The exit code is the conventional one for the signal, so a caller in a pipeline can tell
      // an interrupted run from a failing one.
      assert.match(r.stdout, new RegExp(`exit=${code}`), r.stdout + r.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
