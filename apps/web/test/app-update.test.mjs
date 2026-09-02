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
  LAST_CHECK_KEY,
  SELF_UPDATE_PLATFORMS,
  dueForCheck,
  makeUpdater,
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
  // macOS is the interesting entry, and it is ABSENT on purpose. It ships through a Homebrew cask,
  // which is its updater; an app that also updated itself there would be reinstalled over by the
  // next `brew upgrade` — a downgrade performed by the command meant to keep you current, and
  // reported by nothing. The cask correspondingly does NOT declare `auto_updates true`.
  test('macOS does not self-update — Homebrew owns it', () => {
    assert.equal(selfUpdateSupported('macos'), false);
    assert.ok(!SELF_UPDATE_PLATFORMS.includes('macos'));
  });

  test('windows and linux do, because nothing else tracks their installs', () => {
    assert.equal(selfUpdateSupported('windows'), true);
    assert.equal(selfUpdateSupported('linux'), true);
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

/** A Tauri stub whose updater returns whatever the test wants. */
function fakeApi({ update, checkThrows, installThrows, relaunchThrows } = {}) {
  const calls = { check: 0, install: 0, relaunch: 0 };
  return {
    calls,
    api: {
      updater: {
        check: async () => {
          calls.check++;
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
        downloadAndInstall: async () => {
          calls.install++;
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

  test('the endpoint is HTTPS', () => {
    const endpoints = conf?.plugins?.updater?.endpoints ?? [];
    assert.ok(endpoints.length > 0, 'no update endpoint is configured');
    for (const e of endpoints) assert.match(e, /^https:\/\//, e);
  });
});
