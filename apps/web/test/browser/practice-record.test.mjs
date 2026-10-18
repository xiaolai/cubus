// The practice record over IndexedDB itself (lib/drill/record.js, lib/drill/record-store.js), in both engines:
// WebKit, the macOS, iOS and Linux webviews' engine, and Chromium, WebView2's and Android's. The node suite
// (test/drill-record.test.mjs) runs the record over a store in memory with IndexedDB's contract; this one holds
// IndexedDB to that contract and the store to every failure it says it reports:
//
//   * two pages saving at the same instant: every rep kept, none refused, and each page told of the other's saves
//   * the old localStorage record, version 1 and version 2, imported by two pages opened at once: each rep once,
//     and the key removed; one neither version reads, left as it is and said
//   * the database out of reach: a newer version's database (`unavailable`), an upgrade waiting on a connection
//     that will not let go (`blocked`), this connection asked to let go by an upgrade or a deletion (`closed`) —
//     each said, each failing the operations it stops, and each cleared by the next operation that reaches it
//   * a write that does not commit, by INJECTION in both engines: a put refused at once (a QuotaExceededError, as a
//     quota already known to be spent refuses one), a write request that fails after it was made (which aborts the
//     transaction with the request's error — the path a quota found spent at commit takes), and a transaction
//     aborted outright. A REAL spent quota could not be made: Chromium's `Storage.overrideQuotaForOrigin` says the
//     override is active (`getUsageAndQuota`: quota 1) while the page's own estimate stays ~10 GB and a 5 MB write
//     commits — in a fresh context and in a persistent profile alike (2026-10-18) — and WebKit has no override
//   * the browser closing the connection itself, as clearing site data does (Chromium, through the protocol)
//
// Each test has its own browser context, so its own origin storage. Fails loudly without the browsers:
// `pnpm exec playwright install webkit chromium` (CI does this).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';

const ENGINES = ['webkit', 'chromium'];
const fixtures = {};

before(async () => {
  for (const engine of ENGINES) fixtures[engine] = await startBrowserFixture({ engine });
});
after(async () => {
  await Promise.all(Object.values(fixtures).map((fx) => fx.close()));
});

/** A context with `n` pages of the origin, each with the record's modules on `window.M` and a helper, `window.R`,
 *  that opens a record whose `onChange` calls are counted in `window.heard`. */
async function pages(engine, n = 1) {
  const fx = fixtures[engine];
  const context = await fx.browser.newContext();
  const list = [];
  for (let i = 0; i < n; i++) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    // Any document of the origin will do: the modules are imported into it.
    await page.goto(`${fx.base}/lib/drill/record.js`);
    await page.evaluate(async () => {
      const [record, store] = await Promise.all([import('/lib/drill/record.js'), import('/lib/drill/record-store.js')]);
      window.M = { ...record, ...store };
      window.heard = 0;
      window.R = (o = {}) => record.openPracticeRecord({
        store: store.indexedDbStore(indexedDB, o.db ?? {}),
        now: () => Date.now(),
        legacy: localStorage,
        broadcast: BroadcastChannel,
        onChange: () => { window.heard += 1; },
      });
    });
    list.push({ page, errors });
  }
  return { context, pages: list };
}

/** How long a deletion or an upgrade another page asks for may wait on the record's connection before it is a
 *  connection that never lets go. A liveness bound, not a speed claim. */
const GOES_THROUGH_MS = 20_000;

/** A rep as `repFromDone` makes them. */
const REP = { clean: true, lostTurn: false, ms: 900, refused: null, turns: 6, pauses: 0, htm: 7 };

/** Wait in Node for a page's condition, asked last (test/fixtures/app-waits.mjs's rule), bounded by LIVENESS_MS. */
async function until(page, fn, arg, what) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > LIVENESS_MS) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
}

for (const engine of ENGINES) {
  test(`${engine}: two pages saving at the same instant keep every rep, refuse none, and each hears the other's`, async () => {
    const { context, pages: [a, b] } = await pages(engine, 2);
    try {
      for (const { page } of [a, b]) await page.evaluate(() => { window.rec = R(); return rec.ready; });
      // Each page saves eight reps, every one started in the same millisecond as the other page's, on one
      // algorithm and on two.
      const at = Date.now() + 500;
      const fire = (page, id) => page.evaluate(async ({ at, id, rep }) => {
        while (Date.now() < at) { /* the instant */ }
        const outs = await Promise.all(Array.from({ length: 8 }, () => rec.add(id, rep)));
        return outs.map((o) => o.error?.code ?? 'saved');
      }, { at, id, rep: REP });
      const [outA, outB] = await Promise.all([fire(a.page, 'shared'), fire(b.page, 'only-b')]);
      assert.deepEqual([...outA, ...outB], Array(16).fill('saved'));
      for (const { page } of [a, b]) {
        const counts = await page.evaluate(async () => Object.fromEntries([...(await rec.read())].map(([id, reps]) => [id, reps.length])));
        assert.deepEqual(counts, { shared: 8, 'only-b': 8 });
      }
      await until(a.page, () => window.heard > 0, null, 'page A to hear page B\'s saves');
      await until(b.page, () => window.heard > 0, null, 'page B to hear page A\'s saves');
      assert.deepEqual([a.errors, b.errors], [[], []]);
    } finally {
      await context.close();
    }
  });

  for (const version of [1, 2]) {
    test(`${engine}: a version-${version} record in localStorage, imported by two pages opened at once, is in the database once and its key is gone`, async () => {
      const { context, pages: [a, b] } = await pages(engine, 2);
      try {
        const V1_REP = { t: 5, c: true, l: false, ms: 900, r: null, n: 6, p: 0, h: 7 };
        const text = JSON.stringify(version === 1
          ? { v: 1, algs: { x: [{ ...V1_REP, t: 1000 }, { ...V1_REP, t: 3000, ms: 800 }, { ...V1_REP, t: 3000, ms: 700 }], y: [{ ...V1_REP, t: 2000, ms: 600 }] } }
          : { v: 2, gen: '1'.repeat(16), algs: { x: [{ ...V1_REP, i: 'b'.repeat(24), t: 1000 }, { ...V1_REP, i: 'c'.repeat(24), t: 3000, ms: 800 }, { ...V1_REP, i: 'd'.repeat(24), t: 3000, ms: 700 }], y: [{ ...V1_REP, i: 'e'.repeat(24), t: 2000, ms: 600 }] } });
        await a.page.evaluate((t) => localStorage.setItem('cubusDrillRecord', t), text);
        // Both opened before either import has run.
        await Promise.all([a, b].map(({ page }) => page.evaluate(() => { window.rec = R(); })));
        await Promise.all([a, b].map(({ page }) => page.evaluate(() => rec.ready)));
        for (const { page } of [a, b]) {
          const seen = await page.evaluate(async () => ({
            ms: Object.fromEntries([...(await rec.read())].map(([id, reps]) => [id, reps.map((r) => r.ms)])),
            ids: [...(await rec.read()).values()].flat().map((r) => r.repId),
            legacy: rec.status().legacy?.code ?? null,
            key: localStorage.getItem('cubusDrillRecord'),
          }));
          assert.deepEqual(seen.ms, { x: [900, 800, 700], y: [600] }, 'a rep was put in twice, lost or moved');
          assert.equal(new Set(seen.ids).size, 4);
          assert.deepEqual([seen.legacy, seen.key], [null, null]);
        }
      } finally {
        await context.close();
      }
    });
  }

  test(`${engine}: an old record neither version reads is left as it is and said, and practice is saved`, async () => {
    const { context, pages: [a] } = await pages(engine);
    try {
      const out = await a.page.evaluate(async () => {
        localStorage.setItem('cubusDrillRecord', '{not json');
        window.rec = R();
        await rec.ready;
        const legacy = rec.status().legacy?.code;
        const saved = (await rec.add('x', { clean: true, lostTurn: false, ms: 900, refused: null, turns: 6, pauses: 0, htm: 7 })).saved;
        return { legacy, heard: window.heard, saved, key: localStorage.getItem('cubusDrillRecord'), reps: (await rec.reps('x')).length };
      });
      assert.deepEqual(out, { legacy: 'not-json', heard: 1, saved: true, key: '{not json', reps: 1 });
    } finally {
      await context.close();
    }
  });

  test(`${engine}: a database a newer version upgraded is unavailable — said, and every operation fails with it`, async () => {
    const { context, pages: [a] } = await pages(engine);
    try {
      const out = await a.page.evaluate(async () => {
        await new Promise((ok, no) => {
          const r = indexedDB.open(M.RECORD_DB, 2);
          r.onupgradeneeded = () => r.result.createObjectStore(M.RECORD_STORE);
          r.onsuccess = () => { r.result.close(); ok(); };
          r.onerror = () => no(r.error);
        });
        window.rec = R();
        const read = await rec.read().then(() => 'read', (e) => e.code);
        const add = await rec.add('x', { clean: true, lostTurn: false, ms: 900, refused: null, turns: 6, pauses: 0, htm: 7 });
        return { read, add: add.error?.code, cause: add.error?.cause?.name, status: rec.status().error?.code, heard: window.heard };
      });
      assert.deepEqual(out, { read: 'unavailable', add: 'unavailable', cause: 'VersionError', status: 'unavailable', heard: 1 });
    } finally {
      await context.close();
    }
  });

  test(`${engine}: an upgrade waiting on a connection that will not let go is blocked — said, and cleared when it goes through`, async () => {
    const { context, pages: [a] } = await pages(engine);
    try {
      const out = await a.page.evaluate(async () => {
        // A connection at version 1 with no versionchange handler: it never lets go by itself.
        window.holder = await new Promise((ok, no) => {
          const r = indexedDB.open('blocked-test', 1);
          r.onupgradeneeded = () => r.result.createObjectStore(M.RECORD_STORE);
          r.onsuccess = () => ok(r.result);
          r.onerror = () => no(r.error);
        });
        window.rec = R({ db: { name: 'blocked-test', version: 2 } });
        const read = await rec.read().then(() => 'read', (e) => e.code);
        return { read, status: rec.status().error?.code, heard: window.heard };
      });
      assert.deepEqual(out, { read: 'blocked', status: 'blocked', heard: 1 });
      await a.page.evaluate(() => holder.close());
      await until(a.page, () => rec.status().error === null, null, 'the blocked open to go through');
      const after = await a.page.evaluate(async () => ({
        saved: (await rec.add('x', { clean: true, lostTurn: false, ms: 900, refused: null, turns: 6, pauses: 0, htm: 7 })).saved,
        heard: window.heard,
      }));
      assert.deepEqual(after, { saved: true, heard: 2 });
    } finally {
      await context.close();
    }
  });

  test(`${engine}: a connection an upgrade or a deletion asks to let go lets go — said as closed, and the next operation opens again`, async () => {
    const { context, pages: [a, b] } = await pages(engine, 2);
    try {
      await a.page.evaluate(async () => {
        window.rec = R();
        await rec.add('x', { clean: true, lostTurn: false, ms: 900, refused: null, turns: 6, pauses: 0, htm: 7 });
      });
      // Another page deletes the database: it goes through, and the record says why it let go. `blocked` alone is not
      // a failure — WebKit can fire it while a connection that has let go is still closing — but a deletion that never
      // goes through is one: a connection that did not let go.
      const deleted = await b.page.evaluate((ms) => new Promise((ok) => {
        const r = indexedDB.deleteDatabase(M.RECORD_DB);
        r.onsuccess = () => ok('deleted');
        r.onerror = () => ok(`failed: ${r.error?.name}`);
        setTimeout(() => ok('never went through'), ms);
      }), GOES_THROUGH_MS);
      assert.equal(deleted, 'deleted');
      assert.deepEqual(await a.page.evaluate(() => [rec.status().error?.code, window.heard]), ['closed', 1]);
      // The next read opens a new, empty database, and the state is cleared.
      assert.deepEqual(await a.page.evaluate(async () => [(await rec.read()).size, rec.status().error, window.heard]), [0, null, 2]);
      // An upgrade by a newer version: let go at once, then refused the newer database.
      const upgraded = await b.page.evaluate((ms) => new Promise((ok) => {
        const r = indexedDB.open(M.RECORD_DB, 2);
        r.onsuccess = () => { r.result.close(); ok('upgraded'); };
        r.onerror = () => ok(`failed: ${r.error?.name}`);
        setTimeout(() => ok('never went through'), ms);
      }), GOES_THROUGH_MS);
      assert.equal(upgraded, 'upgraded');
      assert.deepEqual(await a.page.evaluate(() => [rec.status().error?.code, window.heard]), ['closed', 3]);
      assert.deepEqual(await a.page.evaluate(async () => [await rec.read().then(() => 'read', (e) => e.code), rec.status().error?.code]), ['unavailable', 'unavailable']);
    } finally {
      await context.close();
    }
  });

  test(`${engine}: a write that does not commit is saved:false with its cause, and the record keeps what it had`, async () => {
    const { context, pages: [a] } = await pages(engine);
    try {
      const out = await a.page.evaluate(async (rep) => {
        window.rec = R();
        await rec.add('x', rep);
        const put = IDBObjectStore.prototype.put;
        // A put refused at once, as a quota already known to be spent is.
        IDBObjectStore.prototype.put = function refuse() { throw new DOMException('quota exceeded (test)', 'QuotaExceededError'); };
        const refused = await rec.add('x', rep);
        // A write request that fails after it was made: `add` where a value is already stored under the key, which
        // aborts the transaction with the request's error.
        IDBObjectStore.prototype.put = function addInstead(...args) { return this.add(...args); };
        const failed = await rec.add('x', rep);
        // A transaction aborted outright after its put.
        IDBObjectStore.prototype.put = function abortAfter(...args) { const request = put.apply(this, args); this.transaction.abort(); return request; };
        const aborted = await rec.add('x', rep);
        IDBObjectStore.prototype.put = put;
        return {
          refused: [refused.saved, refused.error?.code, refused.error?.cause?.name],
          failed: [failed.saved, failed.error?.code, failed.error?.cause?.name],
          aborted: [aborted.saved, aborted.error?.code],
          reps: (await rec.reps('x')).length,
          saved: (await rec.add('x', rep)).saved,
        };
      }, REP);
      assert.deepEqual(out, {
        refused: [false, 'write-failed', 'QuotaExceededError'],
        failed: [false, 'write-failed', 'ConstraintError'],
        aborted: [false, 'write-failed'],
        reps: 1,
        saved: true,
      });
    } finally {
      await context.close();
    }
  });
}

test('chromium: the browser closing the connection itself, as clearing site data does, is said as closed, and the next read opens again', async () => {
  const { context, pages: [a] } = await pages('chromium');
  try {
    const cdp = await context.newCDPSession(a.page);
    await a.page.evaluate(async (rep) => { window.rec = R(); await rec.add('x', rep); }, REP);
    // Clearing the origin's IndexedDB is what "clear site data" does: the browser closes the connection.
    await cdp.send('Storage.clearDataForOrigin', { origin: fixtures.chromium.base, storageTypes: 'indexeddb' });
    await until(a.page, () => rec.status().error?.code === 'closed', null, 'the forced close to be said');
    assert.equal(await a.page.evaluate(() => window.heard), 1);
    assert.deepEqual(await a.page.evaluate(async () => [(await rec.read()).size, rec.status().error, window.heard]), [0, null, 2]);
  } finally {
    await context.close();
  }
});
