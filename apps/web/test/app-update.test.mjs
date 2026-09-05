// The self-updater's decisions, without Tauri, a network or a clock.
//
// Everything worth getting wrong here is a decision about WHEN to act and WHETHER to interrupt:
// the signature check that makes an update safe belongs to tauri-plugin-updater and is not this
// module's to make. So the tests drive the branches that are ours — the throttle, the clock going
// backwards, the single-flight gate, and the rule that nothing downloads before the user says yes.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  CHECK_INTERVAL_MS,
  CHECK_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  LAST_CHECK_KEY,
  SELF_UPDATE_PLATFORMS,
  STALL_NOTICE_MS,
  dueForCheck,
  makeUpdater,
  progressLabel,
  readLastCheck,
  selfUpdateSupported,
} from '../lib/app-update.js';

/** A localStorage that is just a Map, plus a switch for the quota failure real ones have. */
function fakeStorage(initial = {}, { throwOnSet = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (throwOnSet) throw new Error('quota exceeded (test)');
      map.set(k, String(v));
    },
    map,
  };
}

describe('selfUpdateSupported', () => {
  // macOS is here alongside its Homebrew cask, and that is deliberate rather than an oversight.
  // Both follow the same GitHub releases and the tap updates on `release: published`, so they move
  // together: `brew upgrade` reinstalls the version the app already has instead of replacing a
  // newer one. The downgrade this was once written to avoid needs the cask to LAG the app, which
  // is a property of a tap that updates late — not of having two updaters.
  test('every desktop self-updates, macOS included', () => {
    assert.equal(selfUpdateSupported('macos'), true);
    assert.equal(selfUpdateSupported('windows'), true);
    assert.equal(selfUpdateSupported('linux'), true);
    assert.deepEqual([...SELF_UPDATE_PLATFORMS].sort(), ['linux', 'macos', 'windows']);
  });

  // Unknown must fall to the side that promises less, the same rule `isDesktopHost` follows.
  test('a phone, the browser harness, and an unknown host do not self-update', () => {
    for (const p of ['ios', 'android', null, undefined, '', 'freebsd']) {
      assert.equal(selfUpdateSupported(p), false, String(p));
    }
  });
});

describe('dueForCheck', () => {
  test('a machine that has never checked is due', () => {
    assert.equal(dueForCheck(1_000_000, 0), true);
    assert.equal(dueForCheck(1_000_000, Number.NaN), true);
  });

  test('inside the interval it is not due, at the interval it is', () => {
    const now = 10 * CHECK_INTERVAL_MS;
    assert.equal(dueForCheck(now, now - CHECK_INTERVAL_MS + 1), false);
    assert.equal(dueForCheck(now, now - CHECK_INTERVAL_MS), true);
  });

  // The failure this exists to prevent: a laptop waking in another timezone, or a user correcting
  // the date, writes a lastCheck in the future. Treating that as "not yet" would lock the app out
  // of updating until real time caught up — potentially never.
  test('a timestamp from the future is due, not a lockout', () => {
    const now = 1_000_000;
    assert.equal(dueForCheck(now, now + 5 * CHECK_INTERVAL_MS), true);
  });
});

describe('readLastCheck', () => {
  test('reads a number, and treats anything else as never', () => {
    assert.equal(readLastCheck(fakeStorage({ [LAST_CHECK_KEY]: '1234' })), 1234);
    assert.equal(readLastCheck(fakeStorage({ [LAST_CHECK_KEY]: 'yesterday' })), 0);
    assert.equal(readLastCheck(fakeStorage()), 0);
    assert.equal(readLastCheck(undefined), 0);
  });
});

/** A Tauri stub whose updater returns whatever the test wants, and records what it was asked. */
function fakeApi({ update, checkThrows, installThrows, relaunchThrows, events = [] } = {}) {
  const calls = { check: 0, install: 0, relaunch: 0, checkArgs: undefined, installArgs: undefined };
  return {
    calls,
    api: {
      updater: {
        check: async (opts) => {
          calls.check++;
          calls.checkArgs = opts;
          if (checkThrows) throw checkThrows;
          return update ?? null;
        },
      },
      process: {
        relaunch: async () => {
          calls.relaunch++;
          if (relaunchThrows) throw relaunchThrows;
        },
      },
    },
    available(version = '0.3.0') {
      return {
        available: true,
        version,
        // The plugin's shape: a channel callback, then options. The scripted events are what the
        // Rust side sends — Started with the size, a Progress per chunk, Finished — delivered
        // before the call settles, exactly as the real channel does.
        downloadAndInstall: async (onEvent, opts) => {
          calls.install++;
          calls.installArgs = opts;
          for (const ev of events) onEvent?.(ev);
          if (installThrows) throw installThrows;
        },
      };
    },
  };
}

describe('makeUpdater', () => {
  test('with no update available it installs nothing and says so only when asked', async () => {
    const f = fakeApi({ update: { available: false, version: '0.2.2' } });
    const storage = fakeStorage();
    const u = makeUpdater({ api: f.api, storage, now: () => 5_000, confirm: async () => true });

    assert.equal((await u.checkNow()).status, 'current');
    assert.equal((await u.check()).status, 'silent-current');
    assert.equal(f.calls.install, 0);
  });

  // The whole point of the chosen behaviour: nothing is downloaded until the user agrees.
  test('a declined update downloads nothing', async () => {
    const f = fakeApi();
    const update = f.available();
    const f2 = fakeApi({ update });
    const u = makeUpdater({
      api: f2.api,
      storage: fakeStorage(),
      now: () => 1,
      confirm: async () => false,
    });
    const r = await u.checkNow();
    assert.equal(r.status, 'declined');
    assert.equal(r.version, '0.3.0');
    assert.equal(f.calls.install, 0, 'downloadAndInstall must not run without consent');
  });

  test('an accepted update installs and relaunches', async () => {
    const f = fakeApi();
    const f2 = fakeApi({ update: f.available('0.3.0') });
    const u = makeUpdater({
      api: f2.api,
      storage: fakeStorage(),
      now: () => 1,
      confirm: async () => true,
    });
    assert.equal((await u.checkNow()).status, 'installed');
    assert.equal(f.calls.install, 1);
    assert.equal(f2.calls.relaunch, 1);
  });

  // An install that landed but could not relaunch must not report success: the user would see
  // nothing change and conclude it failed, when in fact a restart is all that is missing.
  test('installed but unable to relaunch is its own outcome, not success', async () => {
    const f = fakeApi();
    const f2 = fakeApi({ update: f.available(), relaunchThrows: new Error('nope') });
    const u = makeUpdater({
      api: f2.api,
      storage: fakeStorage(),
      now: () => 1,
      confirm: async () => true,
    });
    assert.equal((await u.checkNow()).status, 'installed-needs-restart');
  });

  test('a check that throws is an error, not a crash', async () => {
    const f = fakeApi({ checkThrows: new Error('offline') });
    const u = makeUpdater({
      api: f.api,
      storage: fakeStorage(),
      now: () => 1,
      confirm: async () => true,
    });
    assert.equal((await u.checkNow()).status, 'error');
  });

  // A build with no updater API — every non-desktop one — must be inert rather than throwing on
  // launch. The caller already declines to draw the affordance there; this is the belt.
  test('a build without the updater API is inert', async () => {
    const u = makeUpdater({ api: {}, storage: fakeStorage(), now: () => 1, confirm: async () => true });
    assert.equal((await u.checkNow()).status, 'unavailable');
  });

  // Two prompts for one update is worse than either alone: dismissing one leaves the other on
  // screen looking like a bug.
  test('a launch check and a Settings press share one flight', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    let checks = 0;
    const api = {
      updater: {
        check: async () => {
          checks++;
          await gate;
          return { available: false, version: '0.2.2' };
        },
      },
    };
    const u = makeUpdater({ api, storage: fakeStorage(), now: () => 1, confirm: async () => true });
    const a = u.checkNow();
    const b = u.checkNow();
    release();
    await Promise.all([a, b]);
    assert.equal(checks, 1, 'the second press must join the first flight, not start another');

    // And the gate reopens once it settles, or Settings would only ever work once.
    await u.checkNow();
    assert.equal(checks, 2);
  });

  test('checkOnLaunch respects the throttle; checkNow ignores it', async () => {
    const now = 10 * CHECK_INTERVAL_MS;
    const storage = fakeStorage({ [LAST_CHECK_KEY]: String(now - 1000) });
    const f = fakeApi({ update: { available: false } });
    const u = makeUpdater({ api: f.api, storage, now: () => now, confirm: async () => true });

    assert.equal((await u.checkOnLaunch()).status, 'not-due');
    assert.equal(f.calls.check, 0, 'a throttled launch must not touch the network');

    assert.equal((await u.checkNow()).status, 'current');
    assert.equal(f.calls.check, 1, 'a Settings press always checks');
  });

  test('the last-check stamp is written even when the check failed', async () => {
    const storage = fakeStorage();
    const f = fakeApi({ checkThrows: new Error('offline') });
    const u = makeUpdater({ api: f.api, storage, now: () => 4242, confirm: async () => true });
    await u.checkNow();
    assert.equal(storage.map.get(LAST_CHECK_KEY), '4242',
      'an offline machine must not retry on every single launch');
  });

  // localStorage throws when it is full or blocked, and that must never be what takes the app down
  // on launch — the update check is the least important thing happening at that moment.
  test('a storage that refuses to write does not break the check', async () => {
    const storage = fakeStorage({}, { throwOnSet: true });
    const f = fakeApi({ update: { available: false } });
    const u = makeUpdater({ api: f.api, storage, now: () => 1, confirm: async () => true });
    assert.equal((await u.checkNow()).status, 'current');
  });

  // The plugin's default for both requests is NO timeout, so a stalled connection was waited on
  // forever (measured 2026-09-06: five minutes at 1454 bytes through a proxy tunnel). Bounded now,
  // and the bounds are the module's constants so the wording that quotes them cannot drift.
  test('the check and the download are bounded, not open-ended', async () => {
    const f = fakeApi();
    const f2 = fakeApi({ update: f.available() });
    const u = makeUpdater({ api: f2.api, storage: fakeStorage(), now: () => 1, confirm: async () => true });
    await u.checkNow();
    assert.deepEqual(f2.calls.checkArgs, { timeout: CHECK_TIMEOUT_MS });
    assert.deepEqual(f.calls.installArgs, { timeout: DOWNLOAD_TIMEOUT_MS });
    assert.ok(CHECK_TIMEOUT_MS >= 5_000 && CHECK_TIMEOUT_MS <= 60_000, 'a manifest is kilobytes');
    assert.ok(DOWNLOAD_TIMEOUT_MS >= 5 * 60_000, 'a 47 MB archive on a slow link must still finish');
  });

  test('a download that gives up is reported as failed, with the reason, and nothing relaunches', async () => {
    const f = fakeApi({ installThrows: new Error('request timed out') });
    const f2 = fakeApi({ update: f.available() });
    const u = makeUpdater({ api: f2.api, storage: fakeStorage(), now: () => 1, confirm: async () => true });
    const r = await u.checkNow();
    assert.equal(r.status, 'failed');
    assert.match(String(r.error), /timed out/);
    assert.equal(f2.calls.relaunch, 0);
  });

  test('progress is folded per event, stamped with the time, and reaches every listener in order', async () => {
    const events = [
      { event: 'Started', data: { contentLength: 46_818_769 } },
      { event: 'Progress', data: { chunkLength: 1_000_000 } },
      { event: 'Progress', data: { chunkLength: 2_000_000 } },
      { event: 'Finished' },
    ];
    const f = fakeApi({ events });
    const f2 = fakeApi({ update: f.available() });
    let clock = 100;
    let release;
    const gate = new Promise((r) => { release = r; });
    const u = makeUpdater({
      api: f2.api,
      storage: fakeStorage(),
      now: () => clock++,
      // Held until the second caller has joined, so the join is proven to see the download.
      confirm: async () => { await gate; return true; },
    });
    const launchSaw = [];
    const pressSaw = [];
    const launch = u.checkOnLaunch({ onProgress: (p) => launchSaw.push(p) });
    const press = u.checkNow({ onProgress: (p) => pressSaw.push(p) });
    release();
    assert.equal((await launch).status, 'installed');
    assert.equal((await press).status, 'installed');
    const shape = (p) => [p.phase, p.received, p.total];
    assert.deepEqual(launchSaw.map(shape), [
      ['download', 0, null],
      ['download', 0, 46_818_769],
      ['download', 1_000_000, 46_818_769],
      ['download', 3_000_000, 46_818_769],
      ['install', 3_000_000, 46_818_769],
      ['restart', undefined, undefined],
    ]);
    assert.deepEqual(pressSaw.map(shape), launchSaw.map(shape), 'the press that joined the flight sees the same download');
    assert.ok(launchSaw.every((p) => Number.isFinite(p.at)), 'every report carries when it was made — the stall notice is measured from it');
    assert.ok(launchSaw.every((p, i) => i === 0 || p.at > launchSaw[i - 1].at), 'later reports carry later times');
  });

  test('a progress listener that throws costs a warning, never the install', async () => {
    const f = fakeApi({ events: [{ event: 'Finished' }] });
    const f2 = fakeApi({ update: f.available() });
    const warned = [];
    const u = makeUpdater({
      api: f2.api, storage: fakeStorage(), now: () => 1, confirm: async () => true,
      warn: (m) => warned.push(m),
    });
    const r = await u.checkNow({ onProgress: () => { throw new Error('the UI is gone'); } });
    assert.equal(r.status, 'installed');
    assert.equal(f2.calls.relaunch, 1);
    assert.ok(warned.some((m) => /progress listener/.test(m)));
  });

  // The launch check runs three seconds after boot; a press inside that window joins it. It used
  // to inherit the launch check's silent status and then say "finished without a clear answer"
  // for a check that had succeeded.
  test('a Settings press that joins the launch flight still gets its answer announced', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const api = { updater: { check: async () => { await gate; return { available: false, version: '0.3.3' }; } } };
    const u = makeUpdater({ api, storage: fakeStorage(), now: () => 1, confirm: async () => true });
    const launch = u.checkOnLaunch();
    const press = u.checkNow();
    release();
    assert.equal((await launch).status, 'silent-current', 'the launch path stays quiet');
    assert.equal((await press).status, 'current', 'the press must not inherit that silence');
  });
});

describe('progressLabel', () => {
  test('says how much of how many, and names a stall only once the silence is long enough', () => {
    const p = { phase: 'download', received: 3_000_000, total: 46_818_769, at: 1_000 };
    assert.equal(progressLabel(p, 1_000), 'Downloading 3 of 47 MB…');
    assert.equal(progressLabel(p, 1_000 + STALL_NOTICE_MS - 1), 'Downloading 3 of 47 MB…');
    assert.equal(progressLabel(p, 1_000 + STALL_NOTICE_MS), 'Downloading 3 of 47 MB… (no data for 15 s)');
    assert.equal(progressLabel(p, 1_000 + 5 * 60_000), 'Downloading 3 of 47 MB… (no data for 300 s)');
    // No Content-Length from the server: count what has arrived, and a first packet rounds to 0.
    assert.equal(progressLabel({ phase: 'download', received: 1454, total: null, at: 0 }, 0), 'Downloading… 0 MB');
    // The install and the restart have no bytes to count and no stall to notice.
    assert.equal(progressLabel({ phase: 'install', at: 0 }, 99_999_999), 'Installing…');
    assert.equal(progressLabel({ phase: 'restart', at: 0 }, 0), 'Restarting…');
    assert.equal(progressLabel(null, 0), '');
  });

  test("goes through the caller's t(), parameters and all", () => {
    const t = (s, ...a) => `[${s}|${a.join(',')}]`;
    assert.equal(progressLabel({ phase: 'download', received: 2e6, total: 4e6, at: 0 }, 0, t), '[Downloading %1 of %2 MB…|2,4]');
    assert.equal(progressLabel({ phase: 'install', at: 0 }, 0, t), '[Installing…|]');
  });
});

// ---- the wiring the client cannot check for itself -------------------------------------------
//
// The pubkey is only ever decoded inside `verify_signature`, at DOWNLOAD time — not at plugin
// init and not during `check()`. So a placeholder key produces an app that starts fine, reports
// updates correctly, and then fails at the single moment that matters, on a user's machine. There
// is no earlier signal, which is exactly why there is a test.
describe('the updater is actually wired to a key', () => {
  const conf = JSON.parse(
    readFileSync(new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
  );

  test('tauri.conf.json carries a real minisign public key', () => {
    const pubkey = conf?.plugins?.updater?.pubkey;
    assert.ok(pubkey, 'plugins.updater.pubkey is missing — the updater cannot verify anything');
    assert.notEqual(
      pubkey,
      'REPLACE_WITH_MINISIGN_PUBLIC_KEY',
      'the updater still holds its placeholder key. Generate one with `tauri signer generate`, ' +
        'commit the PUBLIC half here, and set TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) as repo ' +
        'secrets. Until then every download fails signature verification on the user\'s machine.',
    );
    // minisign public keys are base64 of a block that starts with a comment line.
    const decoded = Buffer.from(pubkey, 'base64').toString('utf8');
    assert.match(decoded, /untrusted comment:/,
      'the pubkey does not decode to a minisign public key block');
  });

  test('updater artifacts are actually produced, or there is nothing to sign', () => {
    assert.equal(conf?.bundle?.createUpdaterArtifacts, true);
  });

  test('the app hands progress to both paths and draws it in a live region', () => {
    const appJs = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
    assert.match(appJs, /checkNow\(\{\s*onProgress/, 'the Settings press reports no progress');
    assert.match(appJs, /checkOnLaunch\(\{\s*onProgress/, 'a launch-path install would be invisible');
    assert.match(appJs, /setAttribute\('aria-live', 'polite'\)/, 'the chip is not announced');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /\.update-status\s*\{[^}]*position:\s*fixed/, 'the chip is not fixed, so a launch-path install on another screen would not see it');
  });

  test('the endpoint is HTTPS', () => {
    const endpoints = conf?.plugins?.updater?.endpoints ?? [];
    assert.ok(endpoints.length > 0, 'no update endpoint is configured');
    for (const e of endpoints) assert.match(e, /^https:\/\//, e);
  });
});
