// The seam between the protocol layer and the app.
//
// Driven by a fake connection rather than the real library: this file is about what the SESSION
// guarantees — that the self-check sees every event before any screen does, that a serial is
// passed through rather than invented, and that nothing reaches a listener after the cube is gone.
// The library's own behaviour is covered by ble-polyfill.test.mjs against twelve real captures.

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { VERDICT, connectCube } from '../lib/cube-session.js';
import { IDENTITY } from '../lib/cube-trust.js';

let Cube;
before(async () => {
  Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
});

const after_ = (alg) => Cube.fromString(IDENTITY).move(alg).asString();

/** A stand-in for SmartCubeConnection: an event bus plus the three methods the session calls. */
function fakeConnection({ capabilities = { facelets: true, battery: true }, battery = null, answerFacelets = null } = {}) {
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
      sendCommand: async (c) => {
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
      },
    },
  };
}

/** A bridge stub. `kind` decides which branch of installBleBridge the session took. */
function fakeBridge(kind = 'native') {
  const state = { uninstalled: false, packets: [] };
  return {
    state,
    install: ({ onRawPacket, onTraffic }) => {
      state.tap = onRawPacket;
      state.traffic = onTraffic;
      return { kind, uninstall: () => { state.uninstalled = true; }, bridge: null };
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
  const f = fakeConnection(opts.connection ?? {});
  const b = fakeBridge(opts.kind);
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
});

describe('ending a session', () => {
  test('a disconnect event tears the session down and releases the transport', async () => {
    const { session, f, b } = await open();
    let told = 0;
    session.onDisconnect(() => told++);
    f.emit({ type: 'DISCONNECT' });
    assert.equal(told, 1);
    assert.equal(session.alive, false);
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

  test('a state request resolves with the report that answers it', async () => {
    const { session, f } = await open();
    const p = session.requestState({ timeoutMs: 500 });
    await new Promise((r) => setTimeout(r, 0));
    f.emit({ type: 'FACELETS', facelets: IDENTITY, serial: 5 });
    const ev = await p;
    assert.equal(ev.facelets, IDENTITY);
    assert.deepEqual(f.sent, ['REQUEST_FACELETS']);
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
    // Settings tests /refusing to anchor/ to decide whether to offer the override. Reworded, the
    // override silently stops appearing and an honest user with a drifted cube is dead-ended.
    const { session, f } = await open();
    f.emit({ type: 'FACELETS', facelets: after_('R') });
    const err = await session.anchorSolved().then(() => null, (e) => e);
    assert.match(String(err.message), /refusing to anchor/i);
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
