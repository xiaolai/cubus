// The seam between the protocol layer and the app.
//
// Driven by a fake connection rather than the real library: this file is about what the SESSION
// guarantees — that the self-check sees every event before any screen does, that a serial is
// passed through rather than invented, and that nothing reaches a listener after the cube is gone.
// The library's own behaviour is covered by ble-polyfill.test.mjs against twelve real captures.

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { makeTauriBridge } from '../lib/ble-bridge.js';
import { createBluetooth } from '../lib/ble-polyfill.js';
import { VERDICT, connectCube, requestEvent } from '../lib/cube-session.js';
import { IDENTITY, deriveOffset } from '../lib/cube-trust.js';

let Cube;
before(async () => {
  Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
});

const after_ = (alg) => Cube.fromString(IDENTITY).move(alg).asString();

/** A stand-in for SmartCubeConnection: an event bus plus the three methods the session calls. */
function fakeConnection({
  capabilities = { facelets: true, battery: true },
  battery = null,
  answerFacelets = null,
  // Records what the transport looked like when the disconnect was attempted, so the ORDER of
  // teardown can be asserted rather than assumed.
  bridgeState = null,
  disconnectFails = false,
  sendThrowsSync = false,
} = {}) {
  const subs = new Set();
  const sent = [];
  let disconnected = false;
  return {
    sent,
    emit(ev) {
      for (const s of [...subs]) s.next?.(ev);
    },
    fail(e) {
      for (const s of [...subs]) s.error?.(e);
    },
    get disconnected() {
      return disconnected;
    },
    /** Live subscriptions on the event stream. A leak shows up here and nowhere else. */
    get subscribers() {
      return subs.size;
    },
    conn: {
      deviceName: 'GAN16ui_C8D3',
      deviceMAC: '54:6C:50:89:C8:D3',
      protocol: { id: 'gan-gen4', name: 'GAN Gen4' },
      capabilities,
      events$: {
        subscribe(s) {
          subs.add(s);
          return { unsubscribe: () => subs.delete(s) };
        },
      },
      getSnapshot: () => ({ battery: battery === null ? null : { value: battery } }),
      // Not `async` when it is meant to throw synchronously: an async function's throw is a
      // rejection, which is a different code path from the one being tested.
      sendCommand: sendThrowsSync
        ? (c) => {
            sent.push(c.type);
            throw new Error('the transport is gone');
          }
        : async (c) => {
            sent.push(c.type);
            // Answer a state request the way a cube does, so the request path is exercised rather
            // than silently falling through to a timeout.
            if (c.type === 'REQUEST_FACELETS' && answerFacelets !== null) {
              queueMicrotask(() => {
                for (const sub of [...subs]) sub.next?.({ type: 'FACELETS', facelets: answerFacelets });
              });
            }
          },
      disconnect: async () => {
        disconnected = true;
        bridgeState?.order.push(bridgeState.uninstalled ? 'disconnect-through-dead-bridge' : 'disconnect');
        if (disconnectFails) throw new Error('the radio would not let go');
      },
    },
  };
}

/** A bridge stub. `kind` decides which branch of installBleBridge the session took. */
function fakeBridge(kind = 'native') {
  const state = { uninstalled: false, packets: [], released: 0, order: [] };
  return {
    state,
    install: ({ onRawPacket, onTraffic }) => {
      state.tap = onRawPacket;
      state.traffic = onTraffic;
      return {
        kind,
        // The polyfill's extension: resolves once no native release is still in flight. Present
        // on the native path only, which is why the session reaches it optionally.
        bluetooth: {
          async whenReleased() {
            state.released++;
            state.order.push('released');
          },
        },
        uninstall: () => {
          state.uninstalled = true;
          state.order.push('uninstall');
        },
        bridge: null,
      };
    },
  };
}

/** A clock the test drives, so the anchor precondition's stale branch can be reached at all. */
function clock(start = 1_800_000_000_000) {
  const c = { t: start };
  c.now = () => c.t;
  c.advance = (ms) => { c.t += ms; };
  return c;
}

async function open(opts = {}) {
  const b = fakeBridge(opts.kind);
  const f = fakeConnection({ bridgeState: b.state, ...(opts.connection ?? {}) });
  const c = opts.clock ?? clock();
  const session = await connectCube({
    Cube,
    connect: async () => f.conn,
    installBridge: b.install,
    now: c.now,
    ...opts.session,
  });
  return { session, f, b, clock: c };
}

describe('opening a session', () => {
  test('refuses honestly where no transport exists at all', async () => {
    // Safari and Firefox: no Web Bluetooth, no Tauri. A beginner deserves "not available here",
    // not a connect that hangs and reads as a broken cube.
    const b = fakeBridge('none');
    await assert.rejects(
      () => connectCube({ Cube, connect: async () => { throw new Error('should not be reached'); }, installBridge: b.install }),
      /cannot reach one/,
    );
    assert.equal(b.state.uninstalled, true, 'and it does not leave a transport installed');
  });

  test('releases the transport when the protocol layer fails to connect', async () => {
    const b = fakeBridge();
    await assert.rejects(
      () => connectCube({ Cube, connect: async () => { throw new Error('no cube found'); }, installBridge: b.install }),
      /no cube found/,
    );
    assert.equal(b.state.uninstalled, true);
  });

  test('carries the cube identity the app needs', async () => {
    const { session } = await open();
    assert.equal(session.name, 'GAN16ui_C8D3');
    assert.equal(session.mac, '54:6C:50:89:C8:D3');
    assert.equal(session.protocol.id, 'gan-gen4');
    assert.equal(session.alive, true);
  });

  test('a cube that reports no state is declared reduced, not left to be guessed at', async () => {
    const { session } = await open({ connection: { capabilities: { facelets: false } } });
    assert.equal(session.verdict, VERDICT.REDUCED);
    assert.equal(session.maySourceOffset(), false);
  });
});

describe('the event stream', () => {
  test('the self-check sees an event before any listener does', async () => {
    // Load-bearing ordering. A screen that saw a report the checker had not vetted could act on a
    // decode this session is about to refuse.
    const { session, f } = await open();
    const order = [];
    session.onFacelets(() => order.push(`listener:${session.verdict}`));
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    assert.deepEqual(order, [`listener:${VERDICT.UNKNOWN}`, `listener:${VERDICT.STREAM}`]);
  });

  test('adapts a move into the shape the app already speaks', async () => {
    const { session, f } = await open();
    const seen = [];
    session.onMove((m) => seen.push(m));
    f.emit({ type: 'MOVE', move: "R'", face: 0, direction: 1, localTimestamp: 111, cubeTimestamp: 222, serial: 7 });
    assert.deepEqual(seen, [
      { notation: "R'", face: 0, direction: 1, timestamp: 111, cubeTimestamp: 222, serial: 7 },
    ]);
  });

  test('passes a serial through and never invents one', async () => {
    // The whole point. A locally counted number would look exactly like the cube's and mean
    // strictly less — it can only order what we received, never reveal what we did not.
    const { session, f } = await open();
    const seen = [];
    session.onMove((m) => seen.push(m.serial));
    assert.equal(session.numbersMoves(), false, 'nothing seen yet, so nothing is claimed');

    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    assert.deepEqual(seen, [undefined], 'absent stays absent');
    assert.equal(session.numbersMoves(), false);

    f.emit({ type: 'MOVE', move: 'U', face: 1, direction: 0, serial: 42 });
    assert.deepEqual(seen, [undefined, 42]);
    assert.equal(session.numbersMoves(), true, 'and it says so once the cube supplies one');
  });

  test('a verdict change is announced once, not per event', async () => {
    const { session, f } = await open();
    const verdicts = [];
    session.onVerdict((v) => verdicts.push(v));
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    f.emit({ type: 'MOVE', move: 'U', face: 1, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R U') });
    assert.deepEqual(verdicts, [VERDICT.STREAM], 'the same verdict twice is not news');
  });

  test('a refusal reaches the app', async () => {
    const { session, f } = await open();
    const verdicts = [];
    session.onVerdict((v) => verdicts.push(v));
    f.emit({ type: 'FACELETS', facelets: 'U'.repeat(54) });
    assert.deepEqual(verdicts, [VERDICT.REFUSED]);
    assert.equal(session.mayFollow(), false);
  });
});

describe('the verdict is a gate, not a note', () => {
  test('mayFollow closes only on a refusal, so an unverified cube still drives the walk', async () => {
    // The failure this prevents is invisible from the outside: an ungated cube behaves exactly
    // like a gated one right up until the moment it is wrong.
    const { session, f } = await open();
    assert.equal(session.mayFollow(), true, 'unverified is not known-wrong');
    f.emit({ type: 'FACELETS', facelets: 'U'.repeat(54) }); // illegal -> refused
    assert.equal(session.verdict, VERDICT.REFUSED);
    assert.equal(session.mayFollow(), false, 'a proved contradiction must stop driving anything');
  });

  test('the report says whether this cube numbers its moves', async () => {
    // A fact about the protocol a reader needs: it decides whether a dropped turn is detectable
    // from the move stream at all, or only by reconciling against a state report.
    const { session, f } = await open();
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    assert.equal(session.report().selfCheck.numbersMoves, false);
    f.emit({ type: 'MOVE', move: 'U', face: 1, direction: 0, serial: 12 });
    assert.equal(session.report().selfCheck.numbersMoves, true);
  });
});

describe('the timer’s question: does this cube number its turns', () => {
  // `numbersMoves()` decides whether solve-timer.js may report a span at all: both of its "moves
  // were dropped" refusals compare serials, and on a cube that numbers nothing both go inert.

  test('a snapshot serial answers it, because that is when the timer asks', async () => {
    // The timer ARMS on a snapshot — the cube reaching the scramble — and asks there, before the
    // first turn of the solve. Reading move events only, the answer at that instant was "no" for
    // every GAN cube on earth, so wiring the timer to it would have declined to time the one
    // family that CAN be timed. Moves and snapshots share the counter; either proves it exists.
    const { session, f } = await open();
    assert.equal(session.numbersMoves(), false, 'nothing seen yet, so nothing is claimed');
    f.emit({ type: 'FACELETS', facelets: IDENTITY, serial: 3 });
    assert.equal(session.numbersMoves(), true);
    assert.equal(session.report().selfCheck.numbersMoves, true, 'and the report agrees');
  });

  test('a cube that numbers nothing is never claimed to — moyu32, moyu-mhc, qiyi', async () => {
    // Measured against the protocol layer at the pinned rev: only the GAN drivers set `serial`,
    // on either channel. These three report a usable cube clock and no counter at all, which is
    // exactly the combination that would time unverifiably.
    const { session, f } = await open();
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0, cubeTimestamp: 1200 });
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    f.emit({ type: 'MOVE', move: 'U', face: 1, direction: 0, cubeTimestamp: 2400 });
    assert.equal(session.numbersMoves(), false, 'a clock is not a counter');
    assert.equal(session.report().selfCheck.numbersMoves, false);
  });

  test('a serial that is not a number is not a serial', async () => {
    const { session, f } = await open();
    f.emit({ type: 'FACELETS', facelets: IDENTITY, serial: Number.NaN });
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0, serial: '7' });
    assert.equal(session.numbersMoves(), false);
  });
});

describe('a lost turn reaches the app', () => {
  test('a reconciliation failure is announced, not merely recorded', async () => {
    // The defect this exists for: the session announced only VERDICT changes, and a resync leaves
    // the verdict where it is. Everything downstream of it — trust lapsing, follow standing down,
    // the timer refusing the span — was therefore dead in production while the test seam kept it
    // green. Nothing about that is visible from the outside until a turn actually goes missing.
    const { session, f } = await open();
    const told = [];
    session.onVerdict((v, reason) => told.push(reason));

    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    assert.deepEqual(told, ['reconciled'], 'the stream verified');

    // Now a turn reaches the cube but not us: the reported state moves further than the moves
    // we saw can account for.
    f.emit({ type: 'MOVE', move: 'U', face: 1, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R U F') });
    assert.deepEqual(told, ['reconciled', 'resynced'], 'and the loss must be announced');
  });

  test('the verdict stays put through it, which is exactly why the reason must carry', async () => {
    const { session, f } = await open();
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    const before = session.verdict;
    f.emit({ type: 'MOVE', move: 'U', face: 1, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R U F') });
    assert.equal(session.verdict, before, 'one loss is weather, not a verdict');
    assert.equal(session.reason, 'resynced');
    assert.equal(session.evidence.resyncs, 1);
  });

  test('a loss on a TRUSTED cube is announced too — on its own channel', async () => {
    // The hole this closes. A camera-confirmed cube stays trusted through a lost packet by design,
    // and the reason used to be suppressed there as well, so a trusted cube losing a turn produced
    // no event of any kind: the guide went on describing a cube that was no longer in that state,
    // and nothing on any screen could have said so.
    const { session, f } = await open();
    const verdicts = [];
    const losses = [];
    session.onVerdict((v, reason) => verdicts.push(reason));
    session.onMovesLost((e) => losses.push(e));

    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    session.cameraScan(after_('R'), after_('R'));
    assert.equal(session.verdict, VERDICT.TRUSTED);
    assert.deepEqual(losses, [], 'nothing lost yet');

    f.emit({ type: 'MOVE', move: 'U', face: 1, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R U F') });

    assert.equal(session.verdict, VERDICT.TRUSTED, 'the verdict is designed not to move here');
    assert.deepEqual(losses, [{ lost: 1, total: 1, verdict: VERDICT.TRUSTED }]);
    assert.equal(session.losses, 1);
    assert.ok(verdicts.includes('resynced'), 'and the reason carries it as well');
  });

  test('the loss channel is silent while nothing is lost', async () => {
    const { session, f } = await open();
    const losses = [];
    session.onMovesLost((e) => losses.push(e));
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    let alg = '';
    for (const m of ['R', 'U', "F'"]) {
      alg = alg ? `${alg} ${m}` : m;
      f.emit({ type: 'MOVE', move: m, face: 0, direction: 0 });
      f.emit({ type: 'FACELETS', facelets: after_(alg) });
    }
    assert.deepEqual(losses, [], 'an intact stream announces nothing');
  });
});

describe('ending a session', () => {
  test('a disconnect event tears the session down and releases the transport', async () => {
    const { session, f, b } = await open();
    let told = 0;
    session.onDisconnect(() => told++);
    f.emit({ type: 'DISCONNECT' });
    assert.equal(told, 1);
    assert.equal(session.alive, false);
    // After the goodbye the session says for itself, which the transport outlives on purpose.
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(b.state.uninstalled, true, 'the transport must not outlive the cube');
  });

  test('nothing reaches a listener after the cube is gone', async () => {
    // A late packet from a cube you have let go must not land as the current cube's anything.
    const { session, f } = await open();
    const moves = [];
    session.onMove((m) => moves.push(m));
    await session.disconnect();
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    assert.deepEqual(moves, []);
  });

  test('a stream error ends the session rather than leaving it half-alive', async () => {
    const { session, f, b } = await open();
    let told = 0;
    session.onDisconnect(() => told++);
    f.fail(new Error('transport died'));
    assert.equal(told, 1);
    assert.equal(session.alive, false);
    // After the goodbye the session says for itself, which the transport outlives on purpose.
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(b.state.uninstalled, true);
  });

  test('disconnecting twice is harmless and tells the app once', async () => {
    const { session, f } = await open();
    let told = 0;
    session.onDisconnect(() => told++);
    f.emit({ type: 'DISCONNECT' });
    await session.disconnect();
    assert.equal(told, 1);
  });

  test('the goodbye travels over a LIVE transport, and the transport goes last', async () => {
    // The defect: `disconnect()` released the bridge first, and a disposed bridge refuses every
    // command — so `ble_disconnect` was never issued at all. The protocol layer swallows the throw
    // (`gatt.disconnect()` is fire-and-forget against the real API), so the goodbye looked clean
    // while Rust went on holding the peripheral for the life of the process. Every symptom of that
    // lands on the NEXT connect, which is why it survived.
    const { session, b } = await open();
    await session.disconnect();
    assert.deepEqual(b.state.order, ['disconnect', 'released', 'uninstall']);
  });

  test('it waits for the radio to have let go, not merely for the library to say goodbye', async () => {
    // The protocol layer calls `gatt.disconnect()` without awaiting it, so its own promise
    // resolves while the native side still holds the peripheral. A connect on the next line races
    // a release that has not happened.
    const { session, b } = await open();
    await session.disconnect();
    assert.equal(b.state.released, 1);
  });

  test('a disconnect that fails is reported, never swallowed', async () => {
    // It used to be an empty catch — the worst available answer, because the app tears its own
    // state down either way, so a peripheral the native side never released looked exactly like a
    // clean goodbye until the next connect failed for reasons nothing could explain.
    const { session, b } = await open({ connection: { disconnectFails: true } });
    const err = await session.disconnect();
    assert.match(String(err), /would not let go/);
    assert.equal(session.disconnectError, err, 'and it stays readable, so a screen can say it');
    assert.equal(session.alive, false, 'the session still ends');
    assert.equal(b.state.uninstalled, true, 'and the transport is still released');
  });

  test('a clean disconnect reports no error', async () => {
    const { session } = await open();
    assert.equal(await session.disconnect(), null);
    assert.equal(session.disconnectError, null);
  });

  /**
   * The native transport exactly as installBleBridge builds it — the real Tauri bridge under the
   * real polyfill — over a native side the test plays, which decides what `ble_disconnect` does.
   * The bridge is the real one because its timing is the point: a command waits for the listeners
   * before it is issued, and one released meanwhile is refused. `log` is what reached the native
   * side, in order; `drop()` is the native side reporting the link gone.
   */
  function nativeRadio(release) {
    const log = [];
    let dropped = () => {};
    const invoke = async (name, args) => {
      if (name === 'ble_request_device') return { id: 'd', name: 'GAN16ui_C8D3' };
      if (name !== 'ble_disconnect') return undefined;
      log.push(`disconnect ${args.id}`);
      return release();
    };
    const listen = async (event, cb) => {
      if (event === 'ble-disconnect') dropped = cb;
      return () => {};
    };
    const install = () => {
      log.push('install');
      const bridge = makeTauriBridge({ core: { invoke }, event: { listen } });
      return {
        kind: 'native',
        bluetooth: createBluetooth(bridge),
        bridge,
        uninstall: () => {
          log.push('uninstall');
          return bridge.dispose();
        },
      };
    };
    return { log, install, drop: () => dropped({ payload: { device: 'd' } }) };
  }

  /** A protocol layer that leaves one of three ways: its own teardown and then `gatt.disconnect()`,
   *  fired and never awaited; a teardown that throws before the radio is reached; or a goodbye that
   *  never touches the radio at all. */
  const protocolOver = (leave) => async ({ bluetooth }) => {
    const device = await bluetooth.requestDevice({});
    await device.gatt.connect();
    const ways = {
      'through the radio': async () => {
        if (device.gatt.connected) device.gatt.disconnect();
      },
      'by throwing first': async () => {
        throw new Error('the protocol layer failed on its way out (test)');
      },
      'without the radio': async () => {},
    };
    return { ...fakeConnection().conn, disconnect: ways[leave] };
  };

  test('what the radio still holds after the goodbye is answered — through the real polyfill', async (t) => {
    // The polyfill only warns about a release the native side refused, and the protocol layer
    // never reads `gatt.disconnect()`, so this answered null for a cube still held and every caller
    // above it took that for a clean goodbye. Only a fake that threw from its own disconnect ever
    // reached the error path.
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
    for (const [leave, said] of [['through the radio', /busy \(test\)/], ['without the radio', /still holds the cube/]]) {
      const radio = nativeRadio(async () => {
        throw 'the cube did not release cleanly: busy (test)';
      });
      const session = await connectCube({ Cube, connect: protocolOver(leave), installBridge: radio.install });
      const err = await session.disconnect();
      assert.match(String(err), said, `a goodbye that left the cube held (${leave}) read as a clean one`);
      assert.equal(radio.log.at(-1), 'uninstall', 'and the transport was not released last');
    }
  });

  test('asked again after a goodbye the radio did not complete, it asks the radio again, and stops once it lets go', async (t) => {
    // A released bridge refuses every command, and the goodbye had already released this one — so
    // a second disconnect() could not reach the radio at all, and the retry every caller was told
    // to make was theatre. It goes by id, over a bridge built for it.
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
    for (const [leave, refusals] of [['by throwing first', 1], ['through the radio', 2]]) {
      let asked = 0;
      const radio = nativeRadio(async () => {
        asked += 1;
        if (asked <= refusals) throw 'the cube did not release cleanly: busy (test)';
      });
      const session = await connectCube({ Cube, connect: protocolOver(leave), installBridge: radio.install });
      assert.ok(await session.disconnect(), `precondition: the goodbye (${leave}) left the cube held`);
      radio.log.length = 0;
      const again = await session.disconnect();
      assert.deepEqual(radio.log, ['install', 'disconnect d', 'uninstall'],
        `asking again (${leave}) did not reach the radio over a live bridge, for the peripheral held`);
      assert.ok(again instanceof Error && /busy \(test\)/.test(again.message), 'a refused retry was not answered as why');
      radio.log.length = 0;
      assert.equal(await session.disconnect(), null, 'the radio let go and the session still answered a refusal');
      assert.deepEqual(radio.log, ['install', 'disconnect d', 'uninstall'], 'the ask that let go did not reach the radio the same way');
      radio.log.length = 0;
      assert.equal(await session.disconnect(), null, 'a session whose cube had let go answered a refusal');
      assert.deepEqual(radio.log, [], 'a cube that had let go was asked again');
    }
  });

  test('a handshake that fails once the link is up lets the radio go before the transport, or hands back what it could not', async (t) => {
    // connectSmartCube fires `gatt.disconnect()` on its way out of a failed handshake and never
    // waits for it, and the transport was released on the next line: the release met a bridge
    // that refused it, and the radio went on holding a cube nothing could ask about again.
    t.mock.method(console, 'warn', () => {});
    let refuse = false;
    const radio = nativeRadio(async () => {
      if (refuse) throw 'the cube did not release cleanly: busy (test)';
    });
    // `fired`: the protocol layer's way out, `gatt.disconnect()` fired. Otherwise it never asks.
    const handshake = (fired) => async ({ bluetooth }) => {
      const device = await bluetooth.requestDevice({});
      await device.gatt.connect();
      if (fired) device.gatt.disconnect();
      throw new Error('Timed out waiting for cube data (test)');
    };
    const fails = (fired) => connectCube({ Cube, connect: handshake(fired), installBridge: radio.install })
      .then(() => assert.fail('the handshake did not fail'), (e) => e);

    const clean = await fails(true);
    assert.deepEqual(radio.log, ['install', 'disconnect d', 'uninstall'],
      'the release a failed handshake fired did not reach the radio before the transport went');
    assert.ok(/Timed out waiting for cube data \(test\)/.test(clean.message) && clean.unreleased === undefined,
      'a handshake the radio let go of was not thrown as itself');

    for (const fired of [true, false]) {
      const how = fired ? 'its release refused' : 'never asked to let go';
      refuse = fired;
      radio.log.length = 0;
      const err = await fails(fired);
      assert.match(err.message, /Timed out waiting for cube data \(test\)/, `the handshake error was not the one thrown (${how})`);
      assert.equal(typeof err.unreleased?.disconnect, 'function',
        `a cube the radio kept (${how}) was thrown away with nothing that could ask again`);
      refuse = true;
      radio.log.length = 0;
      const again = await err.unreleased.disconnect();
      assert.ok(again instanceof Error && /busy \(test\)/.test(again.message), `a refused ask (${how}) was not answered as why`);
      assert.deepEqual(radio.log, ['install', 'disconnect d', 'uninstall'], `asking again (${how}) did not reach the radio over a live bridge`);
      refuse = false;
      assert.equal(await err.unreleased.disconnect(), null, `the radio let go (${how}) and the handle still answered a refusal`);
      radio.log.length = 0;
      assert.equal(await err.unreleased.disconnect(), null);
      assert.deepEqual(radio.log, [], `a cube that had let go (${how}) was asked again`);
    }
  });

  test('a cube that goes away on its own is let go before the transport goes, and not from inside its own teardown', async (t) => {
    // The protocol layer can end a connection itself without touching the radio, and the transport
    // was released on the spot — so a link still up stayed held by the native side, with nothing
    // left that could ask it again.
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
    for (const [how, refusals, reached, answered] of [
      ['a link still up, released when asked', 0, ['install', 'disconnect d', 'uninstall'], null],
      ['a link still up, refused twice', 2,
        ['install', 'disconnect d', 'uninstall', 'install', 'disconnect d', 'uninstall'], /busy \(test\)/],
      ['a link already dropped', 0, ['install', 'uninstall'], null],
    ]) {
      let asked = 0;
      const radio = nativeRadio(async () => {
        asked += 1;
        if (asked <= refusals) throw 'the cube did not release cleanly: busy (test)';
      });
      const f = fakeConnection();
      let emitting = false;
      let reentered = false;
      const connect = async ({ bluetooth }) => {
        const device = await bluetooth.requestDevice({});
        await device.gatt.connect();
        const disconnect = async () => {
          reentered ||= emitting;
          if (device.gatt.connected) device.gatt.disconnect();
        };
        return { ...f.conn, disconnect };
      };
      const session = await connectCube({ Cube, connect, installBridge: radio.install });
      if (how === 'a link already dropped') radio.drop();
      emitting = true;
      f.emit({ type: 'DISCONNECT' });
      emitting = false;
      assert.equal(session.alive, false, `precondition: the session ended (${how})`);
      // Asked straight away, so an ask that did not wait for the goodbye would find nothing held.
      const answer = await session.disconnect();
      assert.equal(reentered, false, `the goodbye (${how}) was said from inside the protocol layer's own DISCONNECT`);
      assert.deepEqual(radio.log, reached, `a cube that went away on its own (${how}) was not let go before the transport went`);
      if (answered) assert.match(String(answer), answered, `asked again (${how}), it did not wait for its own goodbye`);
      else assert.equal(answer, null, `nothing was held (${how}), and asking again answered a refusal`);
    }
  });

  test('asked again after a goodbye that failed with nothing left held, it answers that nothing is', async (t) => {
    // The failure was the protocol layer's and the radio holds nothing, so answering that failure
    // again on every later ask kept the session unreleased for good, and refused every pairing
    // after it over a release no radio was withholding.
    t.mock.method(console, 'error', () => {});
    const { session } = await open({ connection: { disconnectFails: true } });
    assert.match(String(await session.disconnect()), /would not let go/, 'precondition: the goodbye failed');
    assert.equal(await session.disconnect(), null, 'a failed goodbye with nothing held was answered again as a refusal');
    assert.equal(session.disconnectError, null, 'and still read as why the last disconnect did not complete');
  });
});

describe('asking the cube things', () => {
  test('uses a battery level the cube already volunteered', async () => {
    // Saves a round trip and a five-second wait on a cube that answered during connect.
    const { session, f } = await open({ connection: { battery: 73 } });
    assert.equal(await session.requestBattery(), 73);
    assert.deepEqual(f.sent, [], 'and asks for nothing');
  });

  test('returns null rather than a fictional battery level', async () => {
    // "Never invent data": a cube that will not answer is still usable, and the UI says unknown.
    const { session } = await open();
    assert.equal(await session.requestBattery({ timeoutMs: 20 }), null);
  });

  test('a state request that goes unanswered rejects loudly', async () => {
    // The opposite policy from battery, and deliberately: an unknown battery is cosmetic, an
    // unknown cube state is the thing every screen is about. Silence there must surface.
    const { session } = await open();
    await assert.rejects(() => session.requestState({ timeoutMs: 20 }), /did not answer with FACELETS/);
  });

  test('a send that throws on the spot releases the listener on the spot', async () => {
    // A SYNCHRONOUS throw from sendCommand — a closed transport, a characteristic the polyfill
    // refuses — escaped the promise executor and rejected the request directly, leaving the
    // subscription and the timer alive until the full timeout elapsed. The caller saw the right
    // error at the right moment while a listener went on receiving events for a request that had
    // already failed; with a five-second default and a retrying caller, those accumulate.
    const { session, f } = await open({ connection: { sendThrowsSync: true } });
    const before = f.subscribers;
    await assert.rejects(() => session.requestState({ timeoutMs: 60_000 }), /the transport is gone/);
    assert.equal(f.subscribers, before, 'the request left nothing subscribed behind it');
  });

  test('a battery request whose send throws on the spot answers null without waiting', async () => {
    // Same mechanism, through the path that swallows the rejection: it must still not hold the
    // subscription for the full timeout.
    const { session, f } = await open({ connection: { sendThrowsSync: true } });
    const before = f.subscribers;
    assert.equal(await session.requestBattery({ timeoutMs: 60_000 }), null);
    assert.equal(f.subscribers, before);
  });

  test('a state request resolves with the report that answers it', async () => {
    const { session, f } = await open();
    const p = session.requestState({ timeoutMs: 500 });
    await new Promise((r) => setTimeout(r, 0));
    f.emit({ type: 'FACELETS', facelets: IDENTITY, serial: 5 });
    const ev = await p;
    assert.equal(ev.facelets, IDENTITY);
    assert.deepEqual(f.sent, ['REQUEST_FACELETS']);
  });

  // An Observable may deliver INSIDE `subscribe` (rxjs does, for a replayed value). The request
  // then settles before the command is sent — and used to go on and send it anyway, asking the
  // transport to fetch what it had just delivered (audit-fix, 2026-09-21, row 87). One stream, the
  // three ways it can settle synchronously, and in none of them may `send` run.
  const settlesOnSubscribe = (how) => ({
    subscribe(s) {
      if (how === 'next') s.next?.({ type: 'FACELETS', facelets: IDENTITY });
      if (how === 'error') s.error?.(new Error('the stream failed as it opened'));
      if (how === 'complete') s.complete?.();
      return { unsubscribe() {} };
    },
  });

  test('a stream that answers as it is subscribed to settles the request, and the command is never sent', async () => {
    let sends = 0;
    const ev = await requestEvent(settlesOnSubscribe('next'), 'FACELETS', () => { sends += 1; }, 1000);
    assert.equal(ev.facelets, IDENTITY);
    assert.equal(sends, 0, 'the answer was in hand, and the command was sent anyway');
  });

  test('a stream that errors or ends as it is subscribed to rejects the request, and the command is never sent', async () => {
    for (const [how, said] of [['error', /failed as it opened/], ['complete', /ended before FACELETS/]]) {
      let sends = 0;
      await assert.rejects(() => requestEvent(settlesOnSubscribe(how), 'FACELETS', () => { sends += 1; }, 1000), said);
      assert.equal(sends, 0, `the stream ${how}d on subscribe, and the command was sent anyway`);
    }
  });

  test('through the session: a report delivered on subscribe answers requestState with nothing sent', async () => {
    const { session, f } = await open();
    // The fake's stream, made to replay the last report to a new subscriber — as rxjs does.
    const subscribe = f.conn.events$.subscribe;
    f.conn.events$.subscribe = (s) => { s.next?.({ type: 'FACELETS', facelets: IDENTITY }); return subscribe(s); };
    assert.equal((await session.requestState({ timeoutMs: 500 })).facelets, IDENTITY);
    assert.deepEqual(f.sent, [], 'the transport was asked for a report that had already arrived');
    assert.equal(f.subscribers, 1, 'and the request left nothing subscribed behind it (the session\'s own is the one)');
  });

  // The timeout path tore the subscription down BEFORE rejecting, unguarded: a teardown that threw
  // left the timer's callback throwing and the request pending for ever, with the caller's own
  // timeout already spent (audit-fix, 2026-09-21, row 86).
  test('a subscription whose teardown throws still lets the request time out, rather than hang', async () => {
    const stream = { subscribe: () => ({ unsubscribe() { throw new Error('teardown failed (test)'); } }) };
    await assert.rejects(() => requestEvent(stream, 'FACELETS', () => {}, 20), /did not answer with FACELETS within 20ms/);
  });
});

describe('a correction reaches the checker as a retraction', () => {
  // The session is the one door to the checker, and `{ retracts }` had been forwarded through it
  // by hand-written fakes in every test that exercised the rule — so deleting the forwarding here
  // left them all green while a corrected reading became a contradictory second scan (audit-fix,
  // 2026-09-21, row 17). Driven through connectCube.
  test('a correction of the standing look withdraws it, counts a retraction and no second scan', async () => {
    const { session, f } = await open();
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    assert.equal(session.cameraScan(after_('R U2'), after_('R')), deriveOffset(after_('R U2'), after_('R'), Cube));
    assert.equal(session.verdict, VERDICT.TRUSTED, 'precondition: the misread look was taken');
    // The same look, one sticker fixed by hand.
    const offset = session.cameraScan(after_('R U'), after_('R'), { retracts: true });
    assert.equal(session.verdict, VERDICT.TRUSTED, 'the correction was judged a contradictory second scan');
    assert.equal(offset, deriveOffset(after_('R U'), after_('R'), Cube), 'the corrected offset is the one in force');
    assert.equal(session.offset, offset);
    assert.deepEqual([session.evidence.cameraScans, session.evidence.retractions], [1, 1],
      'one scan withdrawn, one put in its place');
  });
});

describe('anchoring the cube', () => {
  test('refuses on a cube that does not report itself solved', async () => {
    // Anchoring a scrambled cube permanently sets its reference to a scramble, and nothing
    // afterwards looks wrong — every later report is confidently, invisibly off.
    const { session, f } = await open();
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    await assert.rejects(() => session.anchorSolved(), /refusing to anchor/);
    assert.deepEqual(f.sent, [], 'and it sends no reset');
  });

  test('asks the cube again when its last report is too old to rely on', async () => {
    // A second is long enough to turn a face. A cached "solved" from before that turn would
    // anchor a scrambled cube.
    const { session, f, clock: c } = await open({ connection: { answerFacelets: after_('R') } });
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    c.advance(2000);
    await assert.rejects(() => session.anchorSolved(), /refusing to anchor/);
    assert.ok(f.sent.includes('REQUEST_FACELETS'), 'it went and asked rather than trusting the cache');
    assert.ok(!f.sent.includes('REQUEST_RESET'), 'and did not anchor on the stale value');
  });

  test('refuses when the cube will not say where it is', async () => {
    // Falling back to a stale value here would hide the real problem behind a wrong reference.
    const { session, f, clock: c } = await open();
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    c.advance(2000);
    await assert.rejects(() => session.anchorSolved({ timeoutMs: 20 }), /did not say where it is/);
  });

  test('the refusal wording is the one Settings matches on', async () => {
    // Settings tests /does not report itself solved/ to decide whether to offer the override —
    // /refusing to anchor/ also matched a cube that said nothing (2026-09-13). Reworded, the
    // override silently stops appearing and an honest user with a drifted cube is dead-ended.
    const { session, f } = await open();
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    const err = await session.anchorSolved().then(() => null, (e) => e);
    assert.match(String(err.message), /does not report itself solved/i);
  });

  test('anchors a cube that does report itself solved, and confirms the reset landed', async () => {
    const { session, f } = await open({ connection: { answerFacelets: IDENTITY } });
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    await session.anchorSolved();
    assert.deepEqual(f.sent, ['REQUEST_RESET', 'REQUEST_FACELETS'], 'it asks again afterwards');
  });

  test('refuses to call an unconfirmed reset a success', async () => {
    // sendCommand resolves when the write leaves the host, not when the cube acts on it. Marking
    // the cube trusted on that basis is confidently wrong in the one place the user was asked to
    // trust — so a reset the cube does not confirm is reported as unset.
    const { session, f } = await open({ connection: { answerFacelets: after_('R') } });
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    await assert.rejects(() => session.anchorSolved(), /still does not report itself solved/);
  });

  test('says so when the cube goes quiet after the reset', async () => {
    const { session, f } = await open();
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    await assert.rejects(() => session.anchorSolved({ timeoutMs: 20 }), /did not confirm/);
  });

  test('the override anchors a scrambled cube, because only the user can see the desk', async () => {
    const { session, f } = await open({ connection: { answerFacelets: IDENTITY } });
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    await session.anchorSolved({ force: true });
    assert.deepEqual(f.sent, ['REQUEST_RESET', 'REQUEST_FACELETS']);
  });

  test('a cube that cannot be reset says so rather than pretending', async () => {
    const { session } = await open({ connection: { capabilities: { facelets: true, reset: false } } });
    await assert.rejects(() => session.anchorSolved({ force: true }), /cannot be told/);
  });
});

describe('the compatibility report', () => {
  test('records the whole conversation, not just the inbound half', async () => {
    // Notifications alone do not make a replayable capture. A protocol whose handshake is a WRITE
    // replays as a conversation the cube was never having, and the divergence gets blamed on the
    // decoder — which is why upstream's fixture format records all six operation kinds.
    const { session, b } = await open();
    b.state.traffic({ op: 'discover-service', service: 'svc' });
    b.state.traffic({ op: 'discover-char', service: 'svc', characteristic: 'chr' });
    b.state.traffic({ op: 'write', service: 'svc', characteristic: 'chr', bytes: Uint8Array.of(0xdd, 0x04) });
    b.state.traffic({ op: 'read', service: 'svc', characteristic: 'chr', bytes: Uint8Array.of(0x01) });

    const ops = session.report().traffic.map((e) => e.op);
    for (const op of ['discover-service', 'discover-char', 'write', 'read']) {
      assert.ok(ops.includes(op), `the capture is missing ${op} entries`);
    }
    const write = session.report().traffic.find((e) => e.op === 'write');
    assert.equal(write.data, 'dd04', 'and the bytes survive as hex');
  });

  test('carries the self-check verdict and the traffic together', async () => {
    const { session, f, b } = await open();
    b.state.tap({ service: 's', characteristic: 'c', bytes: Uint8Array.of(1, 2) });
    f.emit({ type: 'FACELETS', facelets: IDENTITY });
    f.emit({ type: 'MOVE', move: 'R', face: 0, direction: 0 });
    f.emit({ type: 'FACELETS', facelets: after_('R') });

    const r = session.report({ scenario: 'turn R once' });
    assert.equal(r.selfCheck.verdict, VERDICT.STREAM);
    assert.equal(r.scenario, 'turn R once');
    assert.equal(r.device.name, 'GAN16ui_C8D3');
    assert.equal(r.protocol.id, 'gan-gen4');
    assert.equal(r.traffic.filter((e) => e.op === 'notify').length, 1, 'the raw packet was tapped');
    assert.equal(r.events.length, 3, 'and the decoded events were recorded beside it');
  });
});
