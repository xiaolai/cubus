// Turn a connection into a compatibility report.
//
// Upstream ships 12 real-hardware captures across 11 models, so a user report is no longer the
// precondition for supporting a brand (dev-docs/universal-cube-driver.md §7). It is still needed,
// for four reasons, and the second is the one that cannot be satisfied any other way:
//
//   1. Four implemented protocols have no capture anywhere — gan-gen1, gan-gen3, moyu-mhc,
//      moyu-v1. Gen3 is a GAN generation, which is what this audience most likely owns.
//   2. Every upstream capture was replayed through upstream's own Bluetooth mock. They verify
//      DECODERS. Nothing anyone has ever recorded exercises our polyfill, our btleplug bridge,
//      WKWebView, or Android permissions — only a real cube on a real device does.
//   3. A self-check refusal that reaches nobody is a quiet failure one level up from the one §6
//      guards against.
//   4. When the pinned rev moves, reports from real cubes are the only evidence they still work.
//
// **A report is machine-generated or it does not exist.** Free text from a beginner about whether
// a decode looked right is not evidence; the three checks in §6 are, and the raw traffic is.
//
// **Format: upstream's `smartcube-fixture` v1, not one of ours.** It records the whole GATT
// conversation plus the decoded events, which makes a capture self-checking on replay, and it
// already has a replay harness behind it — ours, in ble-polyfill.test.mjs, and theirs. A report
// for a model nobody has captured is therefore contributable upstream unchanged, which is the
// cheapest way to keep the dependency we depend on healthy.

/** The format this project reads and upstream's suite replays. Not ours to invent or to bump. */
export const FIXTURE_FORMAT = 'smartcube-fixture';
export const FIXTURE_VERSION = 1;

/**
 * Collect one session's traffic and events into a fixture.
 *
 * Pure and hardware-free: it is fed by the polyfill's capture tap and by whatever consumes the
 * protocol layer's events, and knows about neither.
 *
 * @param {object} [opts]
 * @param {() => number} [opts.now] injected clock, so a fixture is reproducible in tests.
 */
export function createCaptureRecorder({ now = () => Date.now() } = {}) {
  const started = now();
  const traffic = [];
  const events = [];
  let device = { name: '', id: '', mac: undefined };
  let protocol = { id: '', name: '' };
  let truncated = 0;

  // A cap, because a capture runs for as long as someone leaves the app open and a report nobody
  // can attach to an issue helps no one. 20k entries is minutes of a streaming cube and well
  // under a megabyte of hex; passing it is recorded rather than hidden, so a truncated report is
  // never mistaken for a complete one.
  //
  // Counted across BOTH lists, not per list. Applying it separately allowed 40,000 entries while
  // the documentation said 20,000 — a limit that is not the limit is worse than none, because it
  // is the number someone will reason about when a report turns out too large to attach.
  const MAX_ENTRIES = 20000;

  const at = () => Math.round(now() - started);

  function push(list, entry) {
    if (traffic.length + events.length >= MAX_ENTRIES) {
      truncated++;
      return;
    }
    list.push(entry);
  }

  return {
    describeDevice(info) {
      device = { name: info.name ?? '', id: info.id ?? '', ...(info.mac ? { mac: info.mac } : {}) };
    },
    describeProtocol(info) {
      protocol = { id: info.id ?? '', name: info.name ?? '' };
    },
    /** Every inbound notification, straight from the polyfill's tap, before decoding. */
    onPacket({ service, characteristic, bytes }) {
      push(traffic, { t: at(), op: 'notify', service, characteristic, data: toHex(bytes) });
    },
    onWrite({ service, characteristic, bytes }) {
      push(traffic, { t: at(), op: 'write', service, characteristic, data: toHex(bytes) });
    },
    onRead({ service, characteristic, bytes }) {
      push(traffic, { t: at(), op: 'read', service, characteristic, data: toHex(bytes) });
    },
    onServiceDiscovered(service) {
      push(traffic, { t: at(), op: 'discover-service', service });
    },
    onCharacteristicDiscovered(service, characteristic) {
      push(traffic, { t: at(), op: 'discover-char', service, characteristic });
    },
    /** A decoded event. What makes the capture self-checking: replay the traffic, compare these. */
    onEvent(event) {
      push(events, { t: at(), event });
    },
    /** A named point in the conversation, so a reader can find "the user turned R" in 4000 lines. */
    mark(note) {
      push(traffic, { t: at(), op: 'marker', service: 'marker', data: undefined, note });
    },

    get size() {
      return traffic.length + events.length;
    },
    get truncated() {
      return truncated;
    },

    /**
     * @param {object} [meta]
     * @param {string} [meta.scenario] what the user was asked to do.
     * @param {object} [meta.selfCheck] the §6 verdict, reason and counts — never a sentence.
     */
    build(meta = {}) {
      return {
        format: FIXTURE_FORMAT,
        version: FIXTURE_VERSION,
        capturedAt: new Date(started).toISOString(),
        device,
        protocol,
        services: [...new Set(traffic.map((e) => e.service).filter((s) => s && s !== 'marker'))],
        traffic,
        events,
        ...(meta.scenario ? { scenario: meta.scenario } : {}),
        ...(meta.selfCheck ? { selfCheck: meta.selfCheck } : {}),
        ...(truncated ? { truncatedEntries: truncated } : {}),
      };
    },
  };
}

/** Lowercase, even-length hex — the only form a replayer can decode.
 *
 *  A string used to be passed through untouched, which accepted uppercase, odd-length and outright
 *  non-hex input while the docstring promised canonical hex. A capture containing any of those
 *  replays to nothing, and the divergence gets blamed on the decoder rather than on the recorder. */
function toHex(bytes) {
  if (typeof bytes === 'string') {
    const t = bytes.toLowerCase();
    if (!/^([0-9a-f]{2})*$/.test(t)) {
      throw new Error(`cube-report: expected hex, got ${JSON.stringify(bytes.slice(0, 24))}`);
    }
    return t;
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Everything in a report that is not raw traffic, in one place a person can read before posting.
 *
 * Shown, not summarised. The privacy line is the reason this function exists: a GAN or MoYu
 * capture contains the cube's BLE MAC, because key derivation needs it. It is a toy's identifier
 * that the cube itself broadcasts in the clear — not a phone, not a computer — but a user posting
 * to a public tracker is entitled to know it is in the file before they attach it, and to be told
 * once rather than to find out later.
 */
export function describeReport(fixture) {
  const notifies = fixture.traffic.filter((e) => e.op === 'notify').length;
  const kinds = {};
  for (const e of fixture.events) kinds[e.event.type] = (kinds[e.event.type] ?? 0) + 1;
  return {
    device: fixture.device.name || '(unnamed)',
    protocol: fixture.protocol.id || '(unrecognised)',
    packets: notifies,
    events: fixture.events.length,
    eventKinds: kinds,
    selfCheck: fixture.selfCheck ?? null,
    // `device.id` is a Bluetooth address on Windows, Android and most Linux stacks — only macOS
    // substitutes a per-host UUID. Reporting "no MAC in this file" while the id field holds one
    // would be exactly the reassurance a privacy note must not give.
    containsMac: Boolean(fixture.device.mac) || looksLikeMac(fixture.device.id),
    truncated: fixture.truncatedEntries ?? 0,
  };
}

/** Does this identifier look like a BLE address rather than an opaque handle? */
function looksLikeMac(id) {
  return typeof id === 'string' && /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(id.trim());
}

/** A stable filename, matching upstream's so a report can be dropped into their captures/ too. */
export function reportFilename(fixture) {
  const safe = (s) => (s || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const stamp = fixture.capturedAt.replace(/[:.]/g, '-').replace(/Z$/, '');
  return `fixture_${safe(fixture.device.name)}_${safe(fixture.protocol.id)}_${stamp}.json`;
}
