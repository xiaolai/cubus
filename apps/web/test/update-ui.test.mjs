// The self-update surface as the user meets it: the progress chip, the launch check and the
// Settings press that share it, and the native dialogs that say how it ended.
//
// lib/update-ui.js imports the window chrome, which reads `window.__TAURI__` when it loads, so
// this drives it under happy-dom with a Tauri stub. The stub is ONE object, changed per case,
// because appUpdater() builds its updater once around it, as the app does. Timers and the clock
// are mocked in every case, so the chip's ticker and a notice's timeout never outlive one.
//
// What these pin (the 2026-09-13 audit):
//   * a launch check that was not due takes nothing down: a Settings download had stamped the
//     throttle, and the launch check removed its chip and stall notice mid-download;
//   * an install that failed, or needs a restart, is said on the launch path too, and once
//     when a Settings press shares the flight;
//   * a dialog that is missing or refuses is neither a "no" nor a silence: an unaskable question
//     is `unasked`, and an answer the dialog cannot show is shown in the app's own chip;
//   * the chip and the press themselves, which had only source-text checks.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';

import { Window } from 'happy-dom';

const realSetTimeout = globalThis.setTimeout;
const tick = () => new Promise((r) => realSetTimeout(r, 0));

let win;
let ui;
let LAST_CHECK_KEY;
let STALL_NOTICE_MS;
const tauri = {};

before(async () => {
  win = new Window({ url: 'http://localhost/' });
  win.document.documentElement.dataset.platform = 'macos';
  win.__TAURI__ = tauri;
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement']) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  ui = await import('../lib/update-ui.js');
  ({ LAST_CHECK_KEY, STALL_NOTICE_MS } = await import('../lib/app-update.js'));
});

const clock = (t) => t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_000_000 });

/**
 * Point the Tauri stub at one scenario and start from a clean page. `update` is the newer
 * version on offer (null: nothing newer); `gate` holds the download open until it resolves;
 * `ask`/`message` stand in for the native dialogs, and null means that API is missing.
 * Returns what the updater and the dialogs were asked to do.
 */
function scenario({
  update = null, checkThrows = null, installThrows = null, relaunchThrows = null, gate = null,
  ask = async () => true, message = async () => {},
} = {}) {
  const seen = { asked: [], said: [], installs: 0 };
  tauri.updater = {
    check: async () => {
      if (checkThrows) throw checkThrows;
      if (!update) return { available: false, version: '0.0.1' };
      return {
        available: true,
        version: update,
        downloadAndInstall: async (onEvent) => {
          seen.installs++;
          onEvent({ event: 'Started', data: { contentLength: 47_000_000 } });
          if (gate) await gate;
          if (installThrows) throw installThrows;
          onEvent({ event: 'Finished' });
        },
      };
    },
  };
  tauri.process = { relaunch: async () => { if (relaunchThrows) throw relaunchThrows; } };
  tauri.dialog = {};
  if (ask) tauri.dialog.ask = async (msg, opts) => { seen.asked.push({ msg, opts }); return ask(msg, opts); };
  if (message) tauri.dialog.message = async (msg, opts) => { seen.said.push({ msg, opts }); return message(msg, opts); };
  localStorage.removeItem(LAST_CHECK_KEY);
  ui.hideUpdateProgress();
  document.getElementById('updateStatus')?.remove();
  return seen;
}

const pressButton = () => {
  const button = document.body.appendChild(document.createElement('button'));
  button.textContent = 'Check now';
  return button;
};

/**
 * A gate a case cannot leave closed, and the promises it holds open.
 *
 * appUpdater() is memoised, so every case shares one updater and therefore one flight: a case that
 * fails mid-download leaves that flight pending, and every later check JOINS it and waits for a
 * gate nobody will open — six cases timing out behind the first real failure. Opened and awaited
 * when the case ends, however it ends.
 */
function gateFor(t) {
  let open;
  const gate = new Promise((r) => { open = r; });
  const pending = [];
  t.after(async () => { open(); await Promise.allSettled(pending); });
  return { gate, open: () => open(), track: (p) => { pending.push(p); return p; } };
}

const FAILED = 'The update could not be installed. Try again, or download it from the website.';
const REOPEN = 'The update is installed. Quit and reopen Cubus to use it.';

test('precondition: a Tauri macOS host has an updater', () => {
  assert.ok(ui.appUpdater(), 'no updater, so every case below would test nothing');
});

test('a launch check that was not due leaves a Settings download its chip and its stall notice', async (t) => {
  clock(t);
  t.mock.method(console, 'warn', () => {});
  const g = gateFor(t);
  const seen = scenario({ update: '9.9.9', gate: g.gate });
  const button = pressButton();
  const press = g.track(ui.runUpdatePress(ui.appUpdater(), button));
  await tick();
  assert.equal(seen.installs, 1, 'precondition: the press is downloading');
  assert.ok(document.getElementById('updateStatus'), 'precondition: the download has a chip');

  // The launch timer fires mid-download. The press stamped the throttle, so this one is not due.
  const launch = await ui.runLaunchCheck(ui.appUpdater());
  assert.equal(launch.status, 'not-due', 'precondition: the launch check did not run');
  const chip = document.getElementById('updateStatus');
  assert.ok(chip, "a launch check that did not run took the running download's chip away");
  // Still repainting: the chip's own text is overwritten by the next tick. What that text SAYS is
  // pinned where the clocks agree (the chip case below) — the updater here holds the real Date.now,
  // captured when appUpdater() was built, so a stall measured against a mocked clock means nothing.
  chip.textContent = 'a sentinel the ticker must paint over';
  t.mock.timers.tick(1_000);
  assert.match(chip.textContent, /^Downloading/, 'the stall ticker stopped under a download still running');

  g.open();
  await press;
  assert.ok(document.getElementById('updateStatus') === null, 'the press took its chip down when it ended');
  button.remove();
});

test('on the launch path, an install that failed or needs a restart is said', async (t) => {
  clock(t);
  t.mock.method(console, 'warn', () => {});
  let seen = scenario({ update: '9.9.9', installThrows: new Error('signature mismatch (test)') });
  assert.equal((await ui.runLaunchCheck(ui.appUpdater())).status, 'failed', 'precondition');
  assert.deepEqual(seen.said.map((s) => [s.msg, s.opts.kind]), [[FAILED, 'error']], 'a failed install was said nowhere');
  assert.ok(document.getElementById('updateStatus') === null, 'the finished flight left its chip');

  seen = scenario({ update: '9.9.9', relaunchThrows: new Error('no relaunch (test)') });
  assert.equal((await ui.runLaunchCheck(ui.appUpdater())).status, 'installed-needs-restart', 'precondition');
  assert.deepEqual(seen.said.map((s) => s.msg), [REOPEN], 'an install waiting for a restart was said nowhere');
});

test('a launch check that a Settings press joined leaves the saying to the press, once', async (t) => {
  clock(t);
  t.mock.method(console, 'warn', () => {});
  const g = gateFor(t);
  const seen = scenario({ update: '9.9.9', installThrows: new Error('disk full (test)'), gate: g.gate });
  const button = pressButton();
  const launch = g.track(ui.runLaunchCheck(ui.appUpdater()));
  await tick();
  const press = g.track(ui.runUpdatePress(ui.appUpdater(), button));
  g.open();
  const [result] = await Promise.all([launch, press]);
  assert.equal(result.status, 'failed', 'precondition: the shared install failed');
  assert.equal(seen.installs, 1, 'precondition: one flight');
  assert.equal(seen.said.length, 1, `one failure was said ${seen.said.length} times`);
  button.remove();
});

test('routine launch answers say nothing and leave no chip: nothing new, no network, "Not now"', async (t) => {
  clock(t);
  t.mock.method(console, 'warn', () => {});
  for (const [name, opts, status] of [
    ['nothing new', {}, 'silent-current'],
    ['no network', { checkThrows: new Error('offline (test)') }, 'error'],
    ['Not now', { update: '9.9.9', ask: async () => false }, 'declined'],
  ]) {
    const seen = scenario(opts);
    assert.equal((await ui.runLaunchCheck(ui.appUpdater())).status, status, `precondition: ${name}`);
    assert.deepEqual(seen.said, [], `${name} was said on the launch path`);
    assert.ok(document.getElementById('updateStatus') === null, `${name} left a chip`);
  }
});

test('the question names both versions and offers the two answers', async (t) => {
  clock(t);
  const seen = scenario({ update: '9.9.9', ask: async () => false });
  await ui.runLaunchCheck(ui.appUpdater());
  assert.equal(seen.asked.length, 1, 'the update was not asked about');
  assert.match(seen.asked[0].msg, /^Cubus 9\.9\.9 is available\. You have \d+\.\d+\.\d+\./);
  assert.deepEqual({ ...seen.asked[0].opts }, {
    title: 'A newer Cubus', kind: 'info', okLabel: 'Install and restart', cancelLabel: 'Not now',
  });
});

test('no dialog to ask with is not a "no": nothing installs, and the update is said to be there', async (t) => {
  clock(t);
  t.mock.method(console, 'warn', () => {});
  const seen = scenario({ update: '9.9.9', ask: null });
  const result = await ui.runLaunchCheck(ui.appUpdater());
  assert.equal(result.status, 'unasked', 'a question nobody could ask was taken as the user declining');
  assert.equal(seen.installs, 0, 'an update installed that nobody agreed to');
  assert.equal(seen.said.length, 1, 'the update nobody could be asked about went unmentioned');
  assert.match(seen.said[0].msg, /9\.9\.9/);
});

test('an answer the native dialog cannot say is shown in the chip, and saying it never throws', async (t) => {
  clock(t);
  const warned = t.mock.method(console, 'warn', () => {});

  scenario({ message: null });
  await assert.doesNotReject(ui.reportUpdateOutcome({ status: 'failed' }), 'a missing dialog threw');
  assert.equal(document.getElementById('updateStatus')?.textContent, FAILED, 'a missing dialog dropped the answer');

  scenario({ message: async () => { throw new Error('dialog:allow-message denied (test)'); } });
  await assert.doesNotReject(ui.reportUpdateOutcome({ status: 'failed' }), 'a refusing dialog threw');
  const chip = document.getElementById('updateStatus');
  assert.equal(chip?.textContent, FAILED, 'a refusing dialog dropped the answer');
  assert.ok(warned.mock.callCount() >= 2, 'the dialog failures went unlogged');

  // The press hides its progress right after the answer; the notice is not progress.
  ui.hideUpdateProgress();
  assert.ok(chip.isConnected, 'hiding progress took the notice with it');
  t.mock.timers.tick(ui.NOTICE_MS);
  assert.equal(chip.isConnected, false, 'the notice never leaves');
});

test('a second answer replaces the first in the chip, and the first one does not take it away', async (t) => {
  clock(t);
  t.mock.method(console, 'warn', () => {});
  scenario({ message: null });
  await ui.reportUpdateOutcome({ status: 'failed' });
  t.mock.timers.tick(ui.NOTICE_MS / 2);
  await ui.reportUpdateOutcome({ status: 'installed-needs-restart' });
  const chip = document.getElementById('updateStatus');
  assert.equal(chip?.textContent, REOPEN, 'the second answer did not replace the first');

  // Where the first notice's NOTICE_MS falls due. It is superseded, so it has nothing to do.
  t.mock.timers.tick(ui.NOTICE_MS / 2 + 1);
  assert.ok(chip.isConnected, "the first answer's timer took the second one away");
  t.mock.timers.tick(ui.NOTICE_MS);
  assert.equal(chip.isConnected, false, 'the second answer never leaves');
});

test('a press whose answer the dialog refuses ends cleanly: tried once, button back', async (t) => {
  clock(t);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const seen = scenario({ message: async () => { throw new Error('dialog:allow-message denied (test)'); } });
  const button = pressButton();
  await assert.doesNotReject(ui.runUpdatePress(ui.appUpdater(), button), 'the press rejected');
  assert.equal(seen.said.length, 1, `the dialog was tried ${seen.said.length} times for one answer`);
  assert.equal(button.disabled, false, 'the button stayed disabled');
  assert.equal(button.textContent, 'Check now');
  button.remove();
});

test('the chip: drawn by the first report, a stall notice ticking between events, gone when hidden', async (t) => {
  clock(t);
  scenario();
  ui.showUpdateProgress({ phase: 'download', received: 3_000_000, total: 46_818_769, at: Date.now() });
  const chip = document.getElementById('updateStatus');
  assert.ok(chip, 'the first report drew no chip');
  assert.equal(chip.getAttribute('role'), 'status');
  assert.equal(chip.getAttribute('aria-live'), 'polite');
  assert.equal(chip.textContent, 'Downloading 3 of 47 MB…');
  t.mock.timers.tick(STALL_NOTICE_MS);
  assert.equal(chip.textContent, 'Downloading 3 of 47 MB… (no data for 15 s)', 'nothing ticked between events');
  ui.hideUpdateProgress();
  assert.ok(document.getElementById('updateStatus') === null, 'hiding left the chip');
  const last = chip.textContent;
  t.mock.timers.tick(5_000);
  assert.equal(chip.textContent, last, 'the ticker outlived the chip');
});

test('a press says Checking…, then Updating… once it downloads, and answers when it ends', async (t) => {
  clock(t);
  t.mock.method(console, 'warn', () => {});
  const g = gateFor(t);
  const seen = scenario({ update: '9.9.9', relaunchThrows: new Error('no relaunch (test)'), gate: g.gate });
  const button = pressButton();
  const press = g.track(ui.runUpdatePress(ui.appUpdater(), button));
  assert.equal(button.textContent, 'Checking…');
  assert.equal(button.disabled, true, 'the button accepts presses while a check is in flight');
  await tick();
  assert.equal(button.textContent, 'Updating…', 'the press became a download and the button did not say so');
  g.open();
  await press;
  assert.deepEqual(seen.said.map((s) => s.msg), [REOPEN]);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Check now');
  button.remove();
});
