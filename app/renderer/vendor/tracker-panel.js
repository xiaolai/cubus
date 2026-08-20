// src/camera.ts
async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}
async function openCamera(video, deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
    audio: false
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await video.play();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return {
    stream,
    grab(width = 480) {
      if (!ctx || video.videoWidth === 0) return null;
      const scale = width / video.videoWidth;
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      return { data: img.data, width: w, height: h };
    },
    stop() {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    }
  };
}

// src/cube.ts
var FACES = ["U", "R", "F", "D", "L", "B"];
var BASE = {
  U: {
    cp: [3, 0, 1, 2, 4, 5, 6, 7],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  R: {
    cp: [4, 1, 2, 0, 7, 5, 6, 3],
    co: [2, 0, 0, 1, 1, 0, 0, 2],
    ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  F: {
    cp: [1, 5, 2, 3, 0, 4, 6, 7],
    co: [1, 2, 0, 0, 2, 1, 0, 0],
    ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11],
    eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]
  },
  D: {
    cp: [0, 1, 2, 3, 5, 6, 7, 4],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  L: {
    cp: [0, 2, 6, 3, 4, 1, 5, 7],
    co: [0, 1, 2, 0, 0, 2, 1, 0],
    ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  B: {
    cp: [0, 1, 3, 7, 4, 5, 2, 6],
    co: [0, 0, 1, 2, 0, 0, 2, 1],
    ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7],
    eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1]
  }
};
function multiply(a, b) {
  const cp = new Array(8);
  const co = new Array(8);
  for (let i = 0; i < 8; i++) {
    cp[i] = a.cp[b.cp[i]];
    co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
  }
  const ep = new Array(12);
  const eo = new Array(12);
  for (let i = 0; i < 12; i++) {
    ep[i] = a.ep[b.ep[i]];
    eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2;
  }
  return { cp, co, ep, eo };
}
var MOVE_NAMES = FACES.flatMap((f3) => [f3, `${f3}2`, `${f3}'`]);
var MOVES = (() => {
  const out = {};
  for (const f3 of FACES) {
    const base = BASE[f3];
    out[f3] = base;
    out[`${f3}2`] = multiply(base, base);
    out[`${f3}'`] = multiply(multiply(base, base), base);
  }
  return out;
})();
function applyMove(s, m) {
  return multiply(s, MOVES[m]);
}
function cloneState(s) {
  return { cp: [...s.cp], co: [...s.co], ep: [...s.ep], eo: [...s.eo] };
}
var SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
var CORNER_FACELET = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51]
];
var EDGE_FACELET = [
  [5, 10],
  [7, 19],
  [3, 37],
  [1, 46],
  [32, 16],
  [28, 25],
  [30, 43],
  [34, 52],
  [23, 12],
  [21, 41],
  [50, 39],
  [48, 14]
];
var CORNER_COLOR = CORNER_FACELET.map((t) => t.map((i) => SOLVED_FACELETS[i]));
var EDGE_COLOR = EDGE_FACELET.map((t) => t.map((i) => SOLVED_FACELETS[i]));
function faceIndices(f3) {
  const base = FACES.indexOf(f3) * 9;
  return Array.from({ length: 9 }, (_, i) => base + i);
}
function encodeFacelets(s) {
  const f3 = SOLVED_FACELETS.split("");
  for (let i = 0; i < 8; i++) {
    const dst = CORNER_FACELET[i];
    const src = CORNER_FACELET[s.cp[i]];
    const ori = s.co[i];
    for (let p4 = 0; p4 < 3; p4++) f3[dst[(p4 + ori) % 3]] = SOLVED_FACELETS[src[p4]];
  }
  for (let i = 0; i < 12; i++) {
    const dst = EDGE_FACELET[i];
    const src = EDGE_FACELET[s.ep[i]];
    const ori = s.eo[i];
    for (let p4 = 0; p4 < 2; p4++) f3[dst[(p4 + ori) % 2]] = SOLVED_FACELETS[src[p4]];
  }
  return f3.join("");
}
function decodeFacelets(f3) {
  if (f3.length !== 54) return null;
  const cp = new Array(8);
  const co = new Array(8);
  for (let i = 0; i < 8; i++) {
    const slot = CORNER_FACELET[i];
    let ori = 0;
    for (; ori < 3; ori++) {
      const c3 = f3[slot[ori]];
      if (c3 === "U" || c3 === "D") break;
    }
    if (ori === 3) return null;
    const c0 = f3[slot[ori]];
    const c1 = f3[slot[(ori + 1) % 3]];
    const c2 = f3[slot[(ori + 2) % 3]];
    let found = -1;
    for (let j = 0; j < 8; j++) {
      const cc = CORNER_COLOR[j];
      if (c0 === cc[0] && c1 === cc[1] && c2 === cc[2]) {
        found = j;
        break;
      }
    }
    if (found < 0) return null;
    cp[i] = found;
    co[i] = ori;
  }
  const ep = new Array(12);
  const eo = new Array(12);
  for (let i = 0; i < 12; i++) {
    const slot = EDGE_FACELET[i];
    const a = f3[slot[0]];
    const b = f3[slot[1]];
    let found = -1;
    let ori = 0;
    for (let j = 0; j < 12; j++) {
      const ec = EDGE_COLOR[j];
      if (a === ec[0] && b === ec[1]) {
        found = j;
        ori = 0;
        break;
      }
      if (a === ec[1] && b === ec[0]) {
        found = j;
        ori = 1;
        break;
      }
    }
    if (found < 0) return null;
    ep[i] = found;
    eo[i] = ori;
  }
  return { cp, co, ep, eo };
}
var IDENTITY_ORIENTATION = [...FACES];
function permFromCycle(cycle) {
  const img = [...FACES];
  for (let i = 0; i < cycle.length; i++) {
    const from = cycle[i];
    const to = cycle[(i + 1) % cycle.length];
    img[FACES.indexOf(from)] = to;
  }
  return img;
}
var ROT_X = permFromCycle(["U", "F", "D", "B"]);
var ROT_Y = permFromCycle(["F", "R", "B", "L"]);
function composeOrientation(a, b) {
  return FACES.map((_, i) => a[FACES.indexOf(b[i])]);
}
function orientationKey(o) {
  return o.join("");
}
var ORIENTATIONS = (() => {
  const seen = /* @__PURE__ */ new Map();
  const queue = [IDENTITY_ORIENTATION];
  seen.set(orientationKey(IDENTITY_ORIENTATION), IDENTITY_ORIENTATION);
  while (queue.length) {
    const cur = queue.shift();
    for (const g of [ROT_X, ROT_Y]) {
      const next = composeOrientation(g, cur);
      const k4 = orientationKey(next);
      if (!seen.has(k4)) {
        seen.set(k4, next);
        queue.push(next);
      }
    }
  }
  return [...seen.values()];
})();

// src/perception/motion.ts
function toLuma(frame, step = 8) {
  const gw = Math.floor((frame.width - 1) / step) + 1;
  const gh = Math.floor((frame.height - 1) / step) + 1;
  const data = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const i = (gy * step * frame.width + gx * step) * 4;
      data[gy * gw + gx] = 0.299 * frame.data[i] + 0.587 * frame.data[i + 1] + 0.114 * frame.data[i + 2];
    }
  return { data, gw, gh, step, w: frame.width, h: frame.height };
}
function lumaDiff(a, b, roi) {
  if (a.gw !== b.gw || a.gh !== b.gh || a.w !== b.w || a.h !== b.h || a.step !== b.step)
    return Number.POSITIVE_INFINITY;
  let sum = 0;
  let n = 0;
  for (let gy = 0; gy < a.gh; gy++)
    for (let gx = 0; gx < a.gw; gx++) {
      if (roi) {
        const px = gx * a.step;
        const py = gy * a.step;
        if (px < roi.x || px >= roi.x + roi.w || py < roi.y || py >= roi.y + roi.h) continue;
      }
      sum += Math.abs(a.data[gy * a.gw + gx] - b.data[gy * a.gw + gx]);
      n++;
    }
  if (n === 0) return roi ? lumaDiff(a, b) : Number.POSITIVE_INFINITY;
  return sum / n;
}
var StabilityGate = class {
  history = [];
  threshold;
  need;
  constructor(threshold = 6, need = 3) {
    if (!Number.isInteger(need) || need < 1)
      throw new Error(`StabilityGate: need must be a positive integer, got ${need}`);
    if (!Number.isFinite(threshold) || threshold < 0)
      throw new Error(`StabilityGate: threshold must be finite \u2265 0, got ${threshold}`);
    this.threshold = threshold;
    this.need = need;
  }
  /** Push a frame diff; returns true once `need` consecutive diffs are below threshold. */
  push(diff) {
    this.history.push(diff);
    if (this.history.length > this.need) this.history.shift();
    return this.history.length >= this.need && this.history.every((d) => d < this.threshold);
  }
  reset() {
    this.history = [];
  }
};

// src/likelihood.ts
var EPS = 1e-6;
var UNIFORM = 1 / 6;
function cellLogLik(predicted, soft) {
  const p4 = soft[predicted] * (1 - soft.unknown) + soft.unknown * UNIFORM;
  return Math.log(Math.max(p4, EPS));
}
function scoreFacelets(facelets, view) {
  let s = 0;
  for (const c2 of view.cells) s += cellLogLik(facelets[c2.index], c2.soft);
  return s;
}
function meanCellLogLik(facelets, view) {
  return view.cells.length === 0 ? Number.NEGATIVE_INFINITY : scoreFacelets(facelets, view) / view.cells.length;
}
function nullLogLik(view) {
  return view.cells.length * Math.log(UNIFORM);
}
function discrimCells(fa, fb, view) {
  let n = 0;
  for (const c2 of view.cells) if (fa[c2.index] !== fb[c2.index]) n++;
  return n;
}
function unknownSoft() {
  const e4 = EPS;
  return { U: e4, R: e4, F: e4, D: e4, L: e4, B: e4, unknown: 1 - 6 * e4 };
}
function normalizeSoft(s) {
  const keys = ["U", "R", "F", "D", "L", "B", "unknown"];
  let sum = 0;
  for (const k4 of keys) sum += Math.max(s[k4], EPS);
  const out = {};
  for (const k4 of keys) out[k4] = Math.max(s[k4], EPS) / sum;
  return out;
}

// src/types.ts
var DEFAULT_CONFIG = {
  beamWidth: 16,
  commitThreshold: 0.95,
  commitStableFrames: 3,
  recoveryMaxDepth: 4,
  noMovePrior: 0.5,
  absoluteFitFloor: 0.5,
  lostFitFloor: 0.35,
  maxEmptyFrames: 10
};

// src/belief.ts
var STAY = "stay";
function logSumExp(xs) {
  const m = Math.max(...xs);
  if (!Number.isFinite(m)) return m;
  let s = 0;
  for (const x of xs) s += Math.exp(x - m);
  return m + Math.log(s);
}
var Belief = class {
  committed;
  orientation;
  cfg;
  // accumulators since the last commit, keyed by candidate
  loglik = /* @__PURE__ */ new Map();
  nullLoglik = 0;
  frames = /* @__PURE__ */ new Map();
  viewpoints = /* @__PURE__ */ new Map();
  maxDiscrim = /* @__PURE__ */ new Map();
  seen = /* @__PURE__ */ new Set();
  status = "tracking";
  confidence = 1;
  constructor(state, orientation = IDENTITY_ORIENTATION, cfg = DEFAULT_CONFIG) {
    this.committed = cloneState(state);
    this.orientation = orientation;
    this.cfg = cfg;
  }
  currentState() {
    return cloneState(this.committed);
  }
  currentStatus() {
    return this.status;
  }
  currentConfidence() {
    return this.confidence;
  }
  reset(state, orientation = this.orientation) {
    this.committed = cloneState(state);
    this.orientation = orientation;
    this.clearAccumulators();
    this.status = "tracking";
    this.confidence = 1;
  }
  /**
   * Start a fresh evidence window while keeping the committed state — called after a
   * motion episode so a move is not penalised by pre-move still frames (stale
   * accumulation across a state change).
   */
  newEpisode() {
    this.clearAccumulators();
  }
  clearAccumulators() {
    this.loglik.clear();
    this.nullLoglik = 0;
    this.frames.clear();
    this.viewpoints.clear();
    this.maxDiscrim.clear();
    this.seen.clear();
  }
  candidates() {
    const list = [
      { key: STAY, move: null, state: this.committed, facelets: encodeFacelets(this.committed) }
    ];
    for (const m of MOVE_NAMES) {
      const state = applyMove(this.committed, m);
      list.push({ key: m, move: m, state, facelets: encodeFacelets(state) });
    }
    return list;
  }
  logPrior(key) {
    const p0 = this.cfg.noMovePrior;
    if (key === STAY) return Math.log(p0);
    return Math.log((1 - p0) * 0.95 / 18);
  }
  logPriorNull() {
    return Math.log((1 - this.cfg.noMovePrior) * 0.05);
  }
  /**
   * Fold one observation (a cube-coordinate view) into the belief.
   * @param obsHash a content hash of the observation — duplicates are idempotent.
   * @param viewpointKey identifies the viewing pose, for diversity accounting.
   */
  update(view, obsHash, viewpointKey) {
    if (this.seen.has(obsHash)) {
      return this.holdResult();
    }
    if (view.cells.length === 0) {
      this.status = "lost";
      return { kind: "lost" };
    }
    this.seen.add(obsHash);
    const cands = this.candidates();
    for (const c2 of cands) {
      const ll = scoreFacelets(c2.facelets, view);
      this.loglik.set(c2.key, (this.loglik.get(c2.key) ?? 0) + ll);
      this.frames.set(c2.key, (this.frames.get(c2.key) ?? 0) + 1);
    }
    this.nullLoglik += nullLogLik(view);
    const keys = cands.map((c2) => c2.key);
    const logits = keys.map((k4) => this.logPrior(k4) + (this.loglik.get(k4) ?? 0));
    const nullLogit = this.logPriorNull() + this.nullLoglik;
    const z = logSumExp([...logits, nullLogit]);
    const post = /* @__PURE__ */ new Map();
    keys.forEach((k4, i) => post.set(k4, Math.exp(logits[i] - z)));
    const nullPost = Math.exp(nullLogit - z);
    let leader = cands[0];
    let leaderPost = post.get(STAY) ?? 0;
    for (const c2 of cands) {
      const p4 = post.get(c2.key) ?? 0;
      if (p4 > leaderPost) {
        leaderPost = p4;
        leader = c2;
      }
    }
    this.confidence = Math.max(leaderPost, nullPost);
    const leaderFrameFit = meanCellLogLik(leader.facelets, view);
    if (leaderFrameFit < Math.log(this.cfg.lostFitFloor) || nullPost > leaderPost && nullPost > 0.5) {
      this.status = "lost";
      return { kind: "lost" };
    }
    if (leader.key === STAY || leader.move === null) {
      this.status = "tracking";
      return { kind: "hold", status: "tracking", confidence: leaderPost };
    }
    const runnerUp = this.bestOther(cands, post, leader.key);
    const discrim = discrimCells(leader.facelets, runnerUp.facelets, view);
    this.viewpoints.set(
      leader.key,
      (this.viewpoints.get(leader.key) ?? /* @__PURE__ */ new Set()).add(viewpointKey)
    );
    this.maxDiscrim.set(leader.key, Math.max(this.maxDiscrim.get(leader.key) ?? 0, discrim));
    const absFit = meanCellLogLik(leader.facelets, view);
    const frames = this.frames.get(leader.key) ?? 0;
    const viewpointCount = this.viewpoints.get(leader.key)?.size ?? 0;
    const discriminative = viewpointCount >= 2 || (this.maxDiscrim.get(leader.key) ?? 0) >= 2;
    const posteriorOk = leaderPost >= this.cfg.commitThreshold;
    const fitOk = absFit >= Math.log(this.cfg.absoluteFitFloor);
    const framesOk = frames >= this.cfg.commitStableFrames;
    if (posteriorOk && fitOk && framesOk && discriminative) {
      const move = leader.move;
      const state = cloneState(leader.state);
      this.committed = state;
      this.clearAccumulators();
      this.status = "tracking";
      this.confidence = leaderPost;
      return { kind: "move", move, confidence: leaderPost, state };
    }
    this.status = discriminative ? "partial" : "ambiguous";
    return { kind: "hold", status: this.status, confidence: leaderPost };
  }
  bestOther(cands, post, exclude) {
    let best = cands.find((c2) => c2.key !== exclude);
    let bestPost = post.get(best.key) ?? 0;
    for (const c2 of cands) {
      if (c2.key === exclude) continue;
      const p4 = post.get(c2.key) ?? 0;
      if (p4 > bestPost) {
        bestPost = p4;
        best = c2;
      }
    }
    return best;
  }
  holdResult() {
    if (this.status === "lost") return { kind: "lost" };
    return { kind: "hold", status: this.status, confidence: this.confidence };
  }
  /** The current joint hypotheses (top-weighted), for inspection / the public belief(). */
  hypotheses(limit = 8) {
    const cands = this.candidates();
    const logits = cands.map((c2) => this.logPrior(c2.key) + (this.loglik.get(c2.key) ?? 0));
    const z = logSumExp([...logits, this.logPriorNull() + this.nullLoglik]);
    const hyps = cands.map((c2, i) => ({
      state: cloneState(c2.state),
      orientation: this.orientation,
      pending: c2.move ? [c2.move] : [],
      weight: Math.exp(logits[i] - z)
    }));
    hyps.sort((a, b) => b.weight - a.weight);
    return hyps.slice(0, limit);
  }
};

// src/orientation.ts
var NORMAL = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1]
};
var RIGHT = {
  U: [1, 0, 0],
  R: [0, 0, -1],
  F: [1, 0, 0],
  D: [1, 0, 0],
  L: [0, 0, 1],
  B: [-1, 0, 0]
};
var DOWN = {
  U: [0, 0, 1],
  R: [0, -1, 0],
  F: [0, -1, 0],
  D: [0, 0, -1],
  L: [0, -1, 0],
  B: [0, -1, 0]
};
var CENTERS = (() => {
  const out = [];
  for (const f3 of FACES) {
    const n = NORMAL[f3];
    const rt = RIGHT[f3];
    const dn = DOWN[f3];
    for (let r = 0; r < 3; r++)
      for (let c2 = 0; c2 < 3; c2++)
        out.push([
          n[0] * 1.5 + rt[0] * (c2 - 1) + dn[0] * (r - 1),
          n[1] * 1.5 + rt[1] * (c2 - 1) + dn[1] * (r - 1),
          n[2] * 1.5 + rt[2] * (c2 - 1) + dn[2] * (r - 1)
        ]);
  }
  return out;
})();
var RX = [1, 0, 0, 0, 0, -1, 0, 1, 0];
var RY = [0, 0, 1, 0, 1, 0, -1, 0, 0];
var IDENTITY_MAT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function matMul(a, b) {
  const out = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k4 = 0; k4 < 3; k4++) s += a[i * 3 + k4] * b[k4 * 3 + j];
      out[i * 3 + j] = s;
    }
  return out;
}
function matVec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
  ];
}
function transpose(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
var matKey = (m) => m.map((x) => Math.round(x)).join(",");
var ROTATION_MATS = (() => {
  const seen = /* @__PURE__ */ new Map([[matKey(IDENTITY_MAT), IDENTITY_MAT]]);
  const queue = [IDENTITY_MAT];
  while (queue.length) {
    const cur = queue.shift();
    for (const g of [RX, RY]) {
      const next = matMul(g, cur);
      const k4 = matKey(next);
      if (!seen.has(k4)) {
        seen.set(k4, next);
        queue.push(next);
      }
    }
  }
  return [...seen.values()];
})();
function nearestFacelet(p4) {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 54; i++) {
    const c2 = CENTERS[i];
    const d = (c2[0] - p4[0]) ** 2 + (c2[1] - p4[1]) ** 2 + (c2[2] - p4[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
var PERMS = ROTATION_MATS.map((m) => {
  const inv = transpose(m);
  return Array.from({ length: 54 }, (_, i) => nearestFacelet(matVec(inv, CENTERS[i])));
});
var ORIENTATION_COUNT = PERMS.length;
function faceMapOf(o) {
  const centerIdx = { U: 4, R: 13, F: 22, D: 31, L: 40, B: 49 };
  return FACES.map((slot) => {
    const cubeFacelet = PERMS[o][centerIdx[slot]];
    return FACES[Math.floor(cubeFacelet / 9)];
  });
}
function toCubeView(cells, o) {
  const perm = PERMS[o];
  const out = cells.map((c2) => ({ index: perm[c2.slot], soft: c2.soft }));
  return { cells: out };
}
function bestOrientationMatch(believedFacelets, cells, tol = 1e-6) {
  if (cells.length === 0) return { score: 0, orientations: [...Array(ORIENTATION_COUNT).keys()] };
  const scores = PERMS.map((perm) => {
    let s = 0;
    for (const c2 of cells) s += c2.soft[believedFacelets[perm[c2.slot]]];
    return s / cells.length;
  });
  const best = Math.max(...scores);
  const orientations = [];
  for (let o = 0; o < scores.length; o++) if (best - scores[o] <= tol) orientations.push(o);
  return { score: best, orientations };
}

// src/recovery.ts
function packKey(s) {
  let v = 0n;
  for (const x of s.cp) v = v * 8n + BigInt(x);
  for (const x of s.co) v = v * 3n + BigInt(x);
  for (const x of s.ep) v = v * 12n + BigInt(x);
  for (const x of s.eo) v = v * 2n + BigInt(x);
  return v.toString(36);
}
function ballWithinDepth(state, maxDepth) {
  const ball = /* @__PURE__ */ new Map();
  ball.set(packKey(state), { state, dist: 0 });
  let frontier = [state];
  for (let d = 1; d <= maxDepth; d++) {
    const next = [];
    for (const st of frontier) {
      for (const m of MOVE_NAMES) {
        const t = applyMove(st, m);
        const k4 = packKey(t);
        if (!ball.has(k4)) {
          ball.set(k4, { state: t, dist: d });
          next.push(t);
        }
      }
    }
    frontier = next;
  }
  return ball;
}
var DEFAULT_RECOVERY = { maxDepth: 4, fitFloor: 0.8, margin: 0.02 };
function recoverState(committed, cameraObs, opts = DEFAULT_RECOVERY) {
  const ball = ballWithinDepth(committed, opts.maxDepth);
  let best = Number.NEGATIVE_INFINITY;
  let second = Number.NEGATIVE_INFINITY;
  let bestState = null;
  let bestOrient = 0;
  const scored = [];
  for (const { state } of ball.values()) {
    const { score, orientations } = bestOrientationMatch(encodeFacelets(state), cameraObs);
    scored.push({ state, score });
    if (score > best) {
      second = best;
      best = score;
      bestState = state;
      bestOrient = orientations[0];
    } else if (score > second) {
      second = score;
    }
  }
  if (bestState === null || best < opts.fitFloor) return { kind: "reacquire" };
  if (best - second < opts.margin) {
    const candidates = scored.filter((s) => best - s.score < opts.margin).map((s) => s.state);
    return { kind: "ambiguous", candidates };
  }
  return {
    kind: "resync",
    state: cloneState(bestState),
    orientation: faceMapOf(bestOrient),
    confidence: best
  };
}

// src/tracker.ts
function argmaxFace(soft) {
  let best = "U";
  let bestV = Number.NEGATIVE_INFINITY;
  for (const f3 of ["U", "R", "F", "D", "L", "B"]) {
    if (soft[f3] > bestV) {
      bestV = soft[f3];
      best = f3;
    }
  }
  return best;
}
function hashCells(cells) {
  return cells.map((c2) => `${c2.slot}:${argmaxFace(c2.soft)}`).sort().join("|");
}
var CubeTracker = class {
  beliefState = null;
  cfg;
  recOpts;
  lastStatus = "lost";
  wasStable = false;
  // for detecting the motion→still transition (a new episode)
  ambiguousCandidates = [];
  // the real set when recovery is ambiguous (§12/#22)
  emptyStreak = 0;
  // consecutive no-detection frames — cube off-frame (§12/#7)
  constructor(cfg = DEFAULT_CONFIG, recOpts = DEFAULT_RECOVERY) {
    this.cfg = cfg;
    this.recOpts = recOpts;
  }
  /** Seed the tracker with an acquired start state (from acquisition). */
  seed(state) {
    this.beliefState = new Belief(state, IDENTITY_ORIENTATION, this.cfg);
    this.lastStatus = "tracking";
    this.emptyStreak = 0;
    this.wasStable = false;
    this.ambiguousCandidates = [];
  }
  state() {
    return this.beliefState ? this.beliefState.currentState() : null;
  }
  status() {
    return this.lastStatus;
  }
  belief() {
    return this.beliefState ? this.beliefState.hypotheses() : [];
  }
  /**
   * When ambiguous, the face whose reveal most splits the top hypotheses — the
   * MAX-INFORMATION face, not a fixed "show yellow" (§12/#22). Null if not ambiguous
   * or if no face separates the candidates.
   */
  disambiguationPrompt() {
    if (this.lastStatus !== "ambiguous") return null;
    const states = this.ambiguousCandidates.length >= 2 ? this.ambiguousCandidates : this.beliefState?.hypotheses(4).map((h) => h.state) ?? [];
    if (states.length < 2) return null;
    const facelets = states.map(encodeFacelets);
    let bestFace = null;
    let bestSpread = 1;
    for (const face of FACES) {
      const idxs = faceIndices(face);
      const patterns = new Set(facelets.map((f3) => idxs.map((i) => f3[i]).join("")));
      if (patterns.size > bestSpread) {
        bestSpread = patterns.size;
        bestFace = face;
      }
    }
    return bestFace;
  }
  reset() {
    this.beliefState = null;
    this.lastStatus = "lost";
    this.emptyStreak = 0;
    this.wasStable = false;
    this.ambiguousCandidates = [];
  }
  update(obs) {
    if (!this.beliefState) return { kind: "lost" };
    if (obs.cells.length === 0) {
      this.wasStable = false;
      if (++this.emptyStreak > this.cfg.maxEmptyFrames) {
        this.lastStatus = "lost";
        return { kind: "lost" };
      }
      return {
        kind: "hold",
        status: this.lastStatus,
        confidence: this.beliefState.currentConfidence()
      };
    }
    this.emptyStreak = 0;
    if (!obs.stable || !obs.alignedGeometry) {
      this.wasStable = false;
      return {
        kind: "hold",
        status: this.lastStatus,
        confidence: this.beliefState.currentConfidence()
      };
    }
    if (!this.wasStable) this.beliefState.newEpisode();
    this.wasStable = true;
    this.ambiguousCandidates = [];
    const committed = this.beliefState.currentState();
    const candidates = [committed, ...MOVE_NAMES.map((m) => applyMove(committed, m))];
    let bestO = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const c2 of candidates) {
      const { score, orientations } = bestOrientationMatch(encodeFacelets(c2), obs.cells);
      if (score > bestScore) {
        bestScore = score;
        bestO = orientations[0];
      }
    }
    if (bestScore < this.recOpts.fitFloor) return this.runRecovery(committed, obs.cells);
    const u = this.beliefState.update(
      toCubeView(obs.cells, bestO),
      hashCells(obs.cells),
      String(bestO)
    );
    if (u.kind === "lost") return this.runRecovery(committed, obs.cells);
    if (u.kind === "move") this.lastStatus = "tracking";
    else if (u.kind === "hold") this.lastStatus = u.status;
    return u;
  }
  runRecovery(committed, cells) {
    const rec = recoverState(committed, cells, this.recOpts);
    if (rec.kind === "resync") {
      this.beliefState.reset(rec.state);
      this.lastStatus = "tracking";
      return { kind: "resync", state: rec.state, confidence: rec.confidence };
    }
    if (rec.kind === "reacquire") {
      this.beliefState = null;
      this.lastStatus = "lost";
      return { kind: "lost" };
    }
    this.ambiguousCandidates = rec.candidates;
    this.lastStatus = "ambiguous";
    return { kind: "hold", status: "ambiguous", confidence: 0 };
  }
};

// src/live.ts
var LiveTracker = class {
  constructor(localizer, opts = {}) {
    this.localizer = localizer;
    this.tracker = new CubeTracker(opts.config, opts.recOpts);
    this.gate = new StabilityGate(opts.stabilityThreshold, opts.stabilityFrames);
  }
  tracker;
  gate;
  prevLuma = null;
  frameDebug = null;
  /** Seed with an acquired start state (from acquisition) — a fresh session. */
  seed(state) {
    this.tracker.seed(state);
    this.gate.reset();
    this.prevLuma = null;
  }
  /** Drive one camera frame through localize → ROI motion-gate → track. */
  pushFrame(frame, t) {
    const { cells, alignedGeometry, roi, centers } = this.localizer.detect(frame);
    const cur = toLuma(frame);
    const diff = this.prevLuma ? lumaDiff(this.prevLuma, cur, roi) : Number.POSITIVE_INFINITY;
    const stable = this.gate.push(diff);
    this.prevLuma = cur;
    const u = this.tracker.update({ cells, stable, alignedGeometry, t });
    this.frameDebug = {
      facesDetected: centers?.length ?? Math.floor(cells.length / 9),
      cellsSeen: cells.length,
      diff,
      stable,
      alignedGeometry,
      roi,
      centers: centers ?? [],
      status: this.tracker.status(),
      lastUpdate: u.kind
    };
    return u;
  }
  /** The last frame's inspection data (for a debug overlay / logs). */
  lastDebug() {
    return this.frameDebug;
  }
  state() {
    return this.tracker.state();
  }
  status() {
    return this.tracker.status();
  }
  disambiguationPrompt() {
    return this.tracker.disambiguationPrompt();
  }
  reset() {
    this.tracker.reset();
    this.gate.reset();
    this.prevLuma = null;
  }
};

// node_modules/culori/src/rgb/parseNumber.js
var parseNumber = (color, len) => {
  if (typeof color !== "number") return;
  if (len === 3) {
    return {
      mode: "rgb",
      r: (color >> 8 & 15 | color >> 4 & 240) / 255,
      g: (color >> 4 & 15 | color & 240) / 255,
      b: (color & 15 | color << 4 & 240) / 255
    };
  }
  if (len === 4) {
    return {
      mode: "rgb",
      r: (color >> 12 & 15 | color >> 8 & 240) / 255,
      g: (color >> 8 & 15 | color >> 4 & 240) / 255,
      b: (color >> 4 & 15 | color & 240) / 255,
      alpha: (color & 15 | color << 4 & 240) / 255
    };
  }
  if (len === 6) {
    return {
      mode: "rgb",
      r: (color >> 16 & 255) / 255,
      g: (color >> 8 & 255) / 255,
      b: (color & 255) / 255
    };
  }
  if (len === 8) {
    return {
      mode: "rgb",
      r: (color >> 24 & 255) / 255,
      g: (color >> 16 & 255) / 255,
      b: (color >> 8 & 255) / 255,
      alpha: (color & 255) / 255
    };
  }
};
var parseNumber_default = parseNumber;

// node_modules/culori/src/colors/named.js
var named = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  // Added in CSS Colors Level 4:
  // https://drafts.csswg.org/css-color/#changes-from-3
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
var named_default = named;

// node_modules/culori/src/rgb/parseNamed.js
var parseNamed = (color) => {
  return parseNumber_default(named_default[color.toLowerCase()], 6);
};
var parseNamed_default = parseNamed;

// node_modules/culori/src/rgb/parseHex.js
var hex = /^#?([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})$/i;
var parseHex = (color) => {
  let match;
  return (match = color.match(hex)) ? parseNumber_default(parseInt(match[1], 16), match[1].length) : void 0;
};
var parseHex_default = parseHex;

// node_modules/culori/src/util/regex.js
var num = "([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)";
var num_none = `(?:${num}|none)`;
var per = `${num}%`;
var per_none = `(?:${num}%|none)`;
var num_per = `(?:${num}%|${num})`;
var num_per_none = `(?:${num}%|${num}|none)`;
var hue = `(?:${num}(deg|grad|rad|turn)|${num})`;
var hue_none = `(?:${num}(deg|grad|rad|turn)|${num}|none)`;
var c = `\\s*,\\s*`;
var rx_num_per_none = new RegExp("^" + num_per_none + "$");

// node_modules/culori/src/rgb/parseRgbLegacy.js
var rgb_num_old = new RegExp(
  `^rgba?\\(\\s*${num}${c}${num}${c}${num}\\s*(?:,\\s*${num_per}\\s*)?\\)$`
);
var rgb_per_old = new RegExp(
  `^rgba?\\(\\s*${per}${c}${per}${c}${per}\\s*(?:,\\s*${num_per}\\s*)?\\)$`
);
var parseRgbLegacy = (color) => {
  let res = { mode: "rgb" };
  let match;
  if (match = color.match(rgb_num_old)) {
    if (match[1] !== void 0) {
      res.r = match[1] / 255;
    }
    if (match[2] !== void 0) {
      res.g = match[2] / 255;
    }
    if (match[3] !== void 0) {
      res.b = match[3] / 255;
    }
  } else if (match = color.match(rgb_per_old)) {
    if (match[1] !== void 0) {
      res.r = match[1] / 100;
    }
    if (match[2] !== void 0) {
      res.g = match[2] / 100;
    }
    if (match[3] !== void 0) {
      res.b = match[3] / 100;
    }
  } else {
    return void 0;
  }
  if (match[4] !== void 0) {
    res.alpha = Math.max(0, Math.min(1, match[4] / 100));
  } else if (match[5] !== void 0) {
    res.alpha = Math.max(0, Math.min(1, +match[5]));
  }
  return res;
};
var parseRgbLegacy_default = parseRgbLegacy;

// node_modules/culori/src/_prepare.js
var prepare = (color, mode) => color === void 0 ? void 0 : typeof color !== "object" ? parse_default(color) : color.mode !== void 0 ? color : mode ? { ...color, mode } : void 0;
var prepare_default = prepare;

// node_modules/culori/src/converter.js
var converter = (target_mode = "rgb") => (color) => (color = prepare_default(color, target_mode)) !== void 0 ? (
  // if the color's mode corresponds to our target mode
  color.mode === target_mode ? (
    // then just return the color
    color
  ) : (
    // otherwise check to see if we have a dedicated
    // converter for the target mode
    converters[color.mode][target_mode] ? (
      // and return its result...
      converters[color.mode][target_mode](color)
    ) : (
      // ...otherwise pass through RGB as an intermediary step.
      // if the target mode is RGB...
      target_mode === "rgb" ? (
        // just return the RGB
        converters[color.mode].rgb(color)
      ) : (
        // otherwise convert color.mode -> RGB -> target_mode
        converters.rgb[target_mode](converters[color.mode].rgb(color))
      )
    )
  )
) : void 0;
var converter_default = converter;

// node_modules/culori/src/modes.js
var converters = {};
var modes = {};
var parsers = [];
var colorProfiles = {};
var identity = (v) => v;
var useMode = (definition29) => {
  converters[definition29.mode] = {
    ...converters[definition29.mode],
    ...definition29.toMode
  };
  Object.keys(definition29.fromMode || {}).forEach((k4) => {
    if (!converters[k4]) {
      converters[k4] = {};
    }
    converters[k4][definition29.mode] = definition29.fromMode[k4];
  });
  if (!definition29.ranges) {
    definition29.ranges = {};
  }
  if (!definition29.difference) {
    definition29.difference = {};
  }
  definition29.channels.forEach((channel) => {
    if (definition29.ranges[channel] === void 0) {
      definition29.ranges[channel] = [0, 1];
    }
    if (!definition29.interpolate[channel]) {
      throw new Error(`Missing interpolator for: ${channel}`);
    }
    if (typeof definition29.interpolate[channel] === "function") {
      definition29.interpolate[channel] = {
        use: definition29.interpolate[channel]
      };
    }
    if (!definition29.interpolate[channel].fixup) {
      definition29.interpolate[channel].fixup = identity;
    }
  });
  modes[definition29.mode] = definition29;
  (definition29.parse || []).forEach((parser) => {
    useParser(parser, definition29.mode);
  });
  return converter_default(definition29.mode);
};
var getMode = (mode) => modes[mode];
var useParser = (parser, mode) => {
  if (typeof parser === "string") {
    if (!mode) {
      throw new Error(`'mode' required when 'parser' is a string`);
    }
    colorProfiles[parser] = mode;
  } else if (typeof parser === "function") {
    if (parsers.indexOf(parser) < 0) {
      parsers.push(parser);
    }
  }
};

// node_modules/culori/src/parse.js
var IdentStartCodePoint = /[^\x00-\x7F]|[a-zA-Z_]/;
var IdentCodePoint = /[^\x00-\x7F]|[-\w]/;
var Tok = {
  Function: "function",
  Ident: "ident",
  Number: "number",
  Percentage: "percentage",
  ParenClose: ")",
  None: "none",
  Hue: "hue",
  Alpha: "alpha"
};
var _i = 0;
function is_num(chars) {
  let ch = chars[_i];
  let ch1 = chars[_i + 1];
  if (ch === "-" || ch === "+") {
    return /\d/.test(ch1) || ch1 === "." && /\d/.test(chars[_i + 2]);
  }
  if (ch === ".") {
    return /\d/.test(ch1);
  }
  return /\d/.test(ch);
}
function is_ident(chars) {
  if (_i >= chars.length) {
    return false;
  }
  let ch = chars[_i];
  if (IdentStartCodePoint.test(ch)) {
    return true;
  }
  if (ch === "-") {
    if (chars.length - _i < 2) {
      return false;
    }
    let ch1 = chars[_i + 1];
    if (ch1 === "-" || IdentStartCodePoint.test(ch1)) {
      return true;
    }
    return false;
  }
  return false;
}
var huenits = {
  deg: 1,
  rad: 180 / Math.PI,
  grad: 9 / 10,
  turn: 360
};
function num2(chars) {
  let value = "";
  if (chars[_i] === "-" || chars[_i] === "+") {
    value += chars[_i++];
  }
  value += digits(chars);
  if (chars[_i] === "." && /\d/.test(chars[_i + 1])) {
    value += chars[_i++] + digits(chars);
  }
  if (chars[_i] === "e" || chars[_i] === "E") {
    if ((chars[_i + 1] === "-" || chars[_i + 1] === "+") && /\d/.test(chars[_i + 2])) {
      value += chars[_i++] + chars[_i++] + digits(chars);
    } else if (/\d/.test(chars[_i + 1])) {
      value += chars[_i++] + digits(chars);
    }
  }
  if (is_ident(chars)) {
    let id = ident(chars);
    if (id === "deg" || id === "rad" || id === "turn" || id === "grad") {
      return { type: Tok.Hue, value: value * huenits[id] };
    }
    return void 0;
  }
  if (chars[_i] === "%") {
    _i++;
    return { type: Tok.Percentage, value: +value };
  }
  return { type: Tok.Number, value: +value };
}
function digits(chars) {
  let v = "";
  while (/\d/.test(chars[_i])) {
    v += chars[_i++];
  }
  return v;
}
function ident(chars) {
  let v = "";
  while (_i < chars.length && IdentCodePoint.test(chars[_i])) {
    v += chars[_i++];
  }
  return v;
}
function identlike(chars) {
  let v = ident(chars);
  if (chars[_i] === "(") {
    _i++;
    return { type: Tok.Function, value: v };
  }
  if (v === "none") {
    return { type: Tok.None, value: void 0 };
  }
  return { type: Tok.Ident, value: v };
}
function tokenize(str = "") {
  let chars = str.trim();
  let tokens = [];
  let ch;
  _i = 0;
  while (_i < chars.length) {
    ch = chars[_i++];
    if (ch === "\n" || ch === "	" || ch === " ") {
      while (_i < chars.length && (chars[_i] === "\n" || chars[_i] === "	" || chars[_i] === " ")) {
        _i++;
      }
      continue;
    }
    if (ch === ",") {
      return void 0;
    }
    if (ch === ")") {
      tokens.push({ type: Tok.ParenClose });
      continue;
    }
    if (ch === "+") {
      _i--;
      if (is_num(chars)) {
        tokens.push(num2(chars));
        continue;
      }
      return void 0;
    }
    if (ch === "-") {
      _i--;
      if (is_num(chars)) {
        tokens.push(num2(chars));
        continue;
      }
      if (is_ident(chars)) {
        tokens.push({ type: Tok.Ident, value: ident(chars) });
        continue;
      }
      return void 0;
    }
    if (ch === ".") {
      _i--;
      if (is_num(chars)) {
        tokens.push(num2(chars));
        continue;
      }
      return void 0;
    }
    if (ch === "/") {
      while (_i < chars.length && (chars[_i] === "\n" || chars[_i] === "	" || chars[_i] === " ")) {
        _i++;
      }
      let alpha;
      if (is_num(chars)) {
        alpha = num2(chars);
        if (alpha.type !== Tok.Hue) {
          tokens.push({ type: Tok.Alpha, value: alpha });
          continue;
        }
      }
      if (is_ident(chars)) {
        if (ident(chars) === "none") {
          tokens.push({
            type: Tok.Alpha,
            value: { type: Tok.None, value: void 0 }
          });
          continue;
        }
      }
      return void 0;
    }
    if (/\d/.test(ch)) {
      _i--;
      tokens.push(num2(chars));
      continue;
    }
    if (IdentStartCodePoint.test(ch)) {
      _i--;
      tokens.push(identlike(chars));
      continue;
    }
    return void 0;
  }
  return tokens;
}
function parseColorSyntax(tokens) {
  tokens._i = 0;
  let token = tokens[tokens._i++];
  if (!token || token.type !== Tok.Function || token.value !== "color") {
    return void 0;
  }
  token = tokens[tokens._i++];
  if (token.type !== Tok.Ident) {
    return void 0;
  }
  const mode = colorProfiles[token.value];
  if (!mode) {
    return void 0;
  }
  const res = { mode };
  const coords = consumeCoords(tokens, false);
  if (!coords) {
    return void 0;
  }
  const channels = getMode(mode).channels;
  for (let ii = 0, c2, ch; ii < channels.length; ii++) {
    c2 = coords[ii];
    ch = channels[ii];
    if (c2.type !== Tok.None) {
      res[ch] = c2.type === Tok.Number ? c2.value : c2.value / 100;
      if (ch === "alpha") {
        res[ch] = Math.max(0, Math.min(1, res[ch]));
      }
    }
  }
  return res;
}
function consumeCoords(tokens, includeHue) {
  const coords = [];
  let token;
  while (tokens._i < tokens.length) {
    token = tokens[tokens._i++];
    if (token.type === Tok.None || token.type === Tok.Number || token.type === Tok.Alpha || token.type === Tok.Percentage || includeHue && token.type === Tok.Hue) {
      coords.push(token);
      continue;
    }
    if (token.type === Tok.ParenClose) {
      if (tokens._i < tokens.length) {
        return void 0;
      }
      continue;
    }
    return void 0;
  }
  if (coords.length < 3 || coords.length > 4) {
    return void 0;
  }
  if (coords.length === 4) {
    if (coords[3].type !== Tok.Alpha) {
      return void 0;
    }
    coords[3] = coords[3].value;
  }
  if (coords.length === 3) {
    coords.push({ type: Tok.None, value: void 0 });
  }
  return coords.every((c2) => c2.type !== Tok.Alpha) ? coords : void 0;
}
function parseModernSyntax(tokens, includeHue) {
  tokens._i = 0;
  let token = tokens[tokens._i++];
  if (!token || token.type !== Tok.Function) {
    return void 0;
  }
  let coords = consumeCoords(tokens, includeHue);
  if (!coords) {
    return void 0;
  }
  coords.unshift(token.value);
  return coords;
}
var parse = (color) => {
  if (typeof color !== "string") {
    return void 0;
  }
  const tokens = tokenize(color);
  const parsed = tokens ? parseModernSyntax(tokens, true) : void 0;
  let result = void 0;
  let i = 0;
  let len = parsers.length;
  while (i < len) {
    if ((result = parsers[i++](color, parsed)) !== void 0) {
      return result;
    }
  }
  return tokens ? parseColorSyntax(tokens) : void 0;
};
var parse_default = parse;

// node_modules/culori/src/rgb/parseRgb.js
function parseRgb(color, parsed) {
  if (!parsed || parsed[0] !== "rgb" && parsed[0] !== "rgba") {
    return void 0;
  }
  const res = { mode: "rgb" };
  const [, r, g, b, alpha] = parsed;
  if (r.type === Tok.Hue || g.type === Tok.Hue || b.type === Tok.Hue) {
    return void 0;
  }
  if (r.type !== Tok.None) {
    res.r = r.type === Tok.Number ? r.value / 255 : r.value / 100;
  }
  if (g.type !== Tok.None) {
    res.g = g.type === Tok.Number ? g.value / 255 : g.value / 100;
  }
  if (b.type !== Tok.None) {
    res.b = b.type === Tok.Number ? b.value / 255 : b.value / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseRgb_default = parseRgb;

// node_modules/culori/src/rgb/parseTransparent.js
var parseTransparent = (c2) => c2 === "transparent" ? { mode: "rgb", r: 0, g: 0, b: 0, alpha: 0 } : void 0;
var parseTransparent_default = parseTransparent;

// node_modules/culori/src/interpolate/lerp.js
var lerp = (a, b, t) => a + t * (b - a);

// node_modules/culori/src/interpolate/piecewise.js
var get_classes = (arr) => {
  let classes = [];
  for (let i = 0; i < arr.length - 1; i++) {
    let a = arr[i];
    let b = arr[i + 1];
    if (a === void 0 && b === void 0) {
      classes.push(void 0);
    } else if (a !== void 0 && b !== void 0) {
      classes.push([a, b]);
    } else {
      classes.push(a !== void 0 ? [a, a] : [b, b]);
    }
  }
  return classes;
};
var interpolatorPiecewise = (interpolator) => (arr) => {
  let classes = get_classes(arr);
  return (t) => {
    let cls = t * classes.length;
    let idx = t >= 1 ? classes.length - 1 : Math.max(Math.floor(cls), 0);
    let pair = classes[idx];
    return pair === void 0 ? void 0 : interpolator(pair[0], pair[1], cls - idx);
  };
};

// node_modules/culori/src/interpolate/linear.js
var interpolatorLinear = interpolatorPiecewise(lerp);

// node_modules/culori/src/fixup/alpha.js
var fixupAlpha = (arr) => {
  let some_defined = false;
  let res = arr.map((v) => {
    if (v !== void 0) {
      some_defined = true;
      return v;
    }
    return 1;
  });
  return some_defined ? res : arr;
};

// node_modules/culori/src/rgb/definition.js
var definition = {
  mode: "rgb",
  channels: ["r", "g", "b", "alpha"],
  parse: [
    parseRgb_default,
    parseHex_default,
    parseRgbLegacy_default,
    parseNamed_default,
    parseTransparent_default,
    "srgb"
  ],
  serialize: "srgb",
  interpolate: {
    r: interpolatorLinear,
    g: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  gamut: true,
  white: { r: 1, g: 1, b: 1 },
  black: { r: 0, g: 0, b: 0 }
};
var definition_default = definition;

// node_modules/culori/src/a98/convertA98ToXyz65.js
var linearize = (v = 0) => Math.pow(Math.abs(v), 563 / 256) * Math.sign(v);
var convertA98ToXyz65 = (a982) => {
  let r = linearize(a982.r);
  let g = linearize(a982.g);
  let b = linearize(a982.b);
  let res = {
    mode: "xyz65",
    x: 0.5766690429101305 * r + 0.1855582379065463 * g + 0.1882286462349947 * b,
    y: 0.297344975250536 * r + 0.6273635662554661 * g + 0.0752914584939979 * b,
    z: 0.0270313613864123 * r + 0.0706888525358272 * g + 0.9913375368376386 * b
  };
  if (a982.alpha !== void 0) {
    res.alpha = a982.alpha;
  }
  return res;
};
var convertA98ToXyz65_default = convertA98ToXyz65;

// node_modules/culori/src/a98/convertXyz65ToA98.js
var gamma = (v) => Math.pow(Math.abs(v), 256 / 563) * Math.sign(v);
var convertXyz65ToA98 = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "a98",
    r: gamma(
      x * 2.0415879038107465 - y * 0.5650069742788597 - 0.3447313507783297 * z
    ),
    g: gamma(
      x * -0.9692436362808798 + y * 1.8759675015077206 + 0.0415550574071756 * z
    ),
    b: gamma(
      x * 0.0134442806320312 - y * 0.1183623922310184 + 1.0151749943912058 * z
    )
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToA98_default = convertXyz65ToA98;

// node_modules/culori/src/lrgb/convertRgbToLrgb.js
var fn = (c2 = 0) => {
  const abs2 = Math.abs(c2);
  if (abs2 <= 0.04045) {
    return c2 / 12.92;
  }
  return (Math.sign(c2) || 1) * Math.pow((abs2 + 0.055) / 1.055, 2.4);
};
var convertRgbToLrgb = ({ r, g, b, alpha }) => {
  let res = {
    mode: "lrgb",
    r: fn(r),
    g: fn(g),
    b: fn(b)
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertRgbToLrgb_default = convertRgbToLrgb;

// node_modules/culori/src/xyz65/convertRgbToXyz65.js
var convertRgbToXyz65 = (rgb2) => {
  let { r, g, b, alpha } = convertRgbToLrgb_default(rgb2);
  let res = {
    mode: "xyz65",
    x: 0.4123907992659593 * r + 0.357584339383878 * g + 0.1804807884018343 * b,
    y: 0.2126390058715102 * r + 0.715168678767756 * g + 0.0721923153607337 * b,
    z: 0.0193308187155918 * r + 0.119194779794626 * g + 0.9505321522496607 * b
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertRgbToXyz65_default = convertRgbToXyz65;

// node_modules/culori/src/lrgb/convertLrgbToRgb.js
var fn2 = (c2 = 0) => {
  const abs2 = Math.abs(c2);
  if (abs2 > 31308e-7) {
    return (Math.sign(c2) || 1) * (1.055 * Math.pow(abs2, 1 / 2.4) - 0.055);
  }
  return c2 * 12.92;
};
var convertLrgbToRgb = ({ r, g, b, alpha }, mode = "rgb") => {
  let res = {
    mode,
    r: fn2(r),
    g: fn2(g),
    b: fn2(b)
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertLrgbToRgb_default = convertLrgbToRgb;

// node_modules/culori/src/xyz65/convertXyz65ToRgb.js
var convertXyz65ToRgb = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = convertLrgbToRgb_default({
    r: x * 3.2409699419045226 - y * 1.537383177570094 - 0.4986107602930034 * z,
    g: x * -0.9692436362808796 + y * 1.8759675015077204 + 0.0415550574071756 * z,
    b: x * 0.0556300796969936 - y * 0.2039769588889765 + 1.0569715142428784 * z
  });
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToRgb_default = convertXyz65ToRgb;

// node_modules/culori/src/a98/definition.js
var definition2 = {
  ...definition_default,
  mode: "a98",
  parse: ["a98-rgb"],
  serialize: "a98-rgb",
  fromMode: {
    rgb: (color) => convertXyz65ToA98_default(convertRgbToXyz65_default(color)),
    xyz65: convertXyz65ToA98_default
  },
  toMode: {
    rgb: (color) => convertXyz65ToRgb_default(convertA98ToXyz65_default(color)),
    xyz65: convertA98ToXyz65_default
  }
};
var definition_default2 = definition2;

// node_modules/culori/src/util/normalizeHue.js
var normalizeHue = (hue3) => (hue3 = hue3 % 360) < 0 ? hue3 + 360 : hue3;
var normalizeHue_default = normalizeHue;

// node_modules/culori/src/fixup/hue.js
var hue2 = (hues, fn5) => {
  return hues.map((hue3, idx, arr) => {
    if (hue3 === void 0) {
      return hue3;
    }
    let normalized = normalizeHue_default(hue3);
    if (idx === 0 || hues[idx - 1] === void 0) {
      return normalized;
    }
    return fn5(normalized - normalizeHue_default(arr[idx - 1]));
  }).reduce((acc, curr) => {
    if (!acc.length || curr === void 0 || acc[acc.length - 1] === void 0) {
      acc.push(curr);
      return acc;
    }
    acc.push(curr + acc[acc.length - 1]);
    return acc;
  }, []);
};
var fixupHueShorter = (arr) => hue2(arr, (d) => Math.abs(d) <= 180 ? d : d - 360 * Math.sign(d));

// node_modules/culori/src/cubehelix/constants.js
var M = [-0.14861, 1.78277, -0.29227, -0.90649, 1.97294, 0];
var degToRad = Math.PI / 180;
var radToDeg = 180 / Math.PI;

// node_modules/culori/src/cubehelix/convertRgbToCubehelix.js
var DE = M[3] * M[4];
var BE = M[1] * M[4];
var BCAD = M[1] * M[2] - M[0] * M[3];
var convertRgbToCubehelix = ({ r, g, b, alpha }) => {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let l = (BCAD * b + r * DE - g * BE) / (BCAD + DE - BE);
  let x = b - l;
  let y = (M[4] * (g - l) - M[2] * x) / M[3];
  let res = {
    mode: "cubehelix",
    l,
    s: l === 0 || l === 1 ? void 0 : Math.sqrt(x * x + y * y) / (M[4] * l * (1 - l))
  };
  if (res.s) res.h = Math.atan2(y, x) * radToDeg - 120;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertRgbToCubehelix_default = convertRgbToCubehelix;

// node_modules/culori/src/cubehelix/convertCubehelixToRgb.js
var convertCubehelixToRgb = ({ h, s, l, alpha }) => {
  let res = { mode: "rgb" };
  h = (h === void 0 ? 0 : h + 120) * degToRad;
  if (l === void 0) l = 0;
  let amp = s === void 0 ? 0 : s * l * (1 - l);
  let cosh = Math.cos(h);
  let sinh = Math.sin(h);
  res.r = l + amp * (M[0] * cosh + M[1] * sinh);
  res.g = l + amp * (M[2] * cosh + M[3] * sinh);
  res.b = l + amp * (M[4] * cosh + M[5] * sinh);
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertCubehelixToRgb_default = convertCubehelixToRgb;

// node_modules/culori/src/difference.js
var differenceHueSaturation = (std, smp) => {
  if (std.h === void 0 || smp.h === void 0 || !std.s || !smp.s) {
    return 0;
  }
  let std_h = normalizeHue_default(std.h);
  let smp_h = normalizeHue_default(smp.h);
  let dH = Math.sin((smp_h - std_h + 360) / 2 * Math.PI / 180);
  return 2 * Math.sqrt(std.s * smp.s) * dH;
};
var differenceHueNaive = (std, smp) => {
  if (std.h === void 0 || smp.h === void 0) {
    return 0;
  }
  let std_h = normalizeHue_default(std.h);
  let smp_h = normalizeHue_default(smp.h);
  if (Math.abs(smp_h - std_h) > 180) {
    return std_h - (smp_h - 360 * Math.sign(smp_h - std_h));
  }
  return smp_h - std_h;
};
var differenceHueChroma = (std, smp) => {
  if (std.h === void 0 || smp.h === void 0 || !std.c || !smp.c) {
    return 0;
  }
  let std_h = normalizeHue_default(std.h);
  let smp_h = normalizeHue_default(smp.h);
  let dH = Math.sin((smp_h - std_h + 360) / 2 * Math.PI / 180);
  return 2 * Math.sqrt(std.c * smp.c) * dH;
};
var differenceCiede2000 = (Kl = 1, Kc = 1, Kh = 1) => {
  let lab2 = converter_default("lab65");
  return (std, smp) => {
    let LabStd = lab2(std);
    let LabSmp = lab2(smp);
    let lStd = LabStd.l;
    let aStd = LabStd.a;
    let bStd = LabStd.b;
    let cStd = Math.sqrt(aStd * aStd + bStd * bStd);
    let lSmp = LabSmp.l;
    let aSmp = LabSmp.a;
    let bSmp = LabSmp.b;
    let cSmp = Math.sqrt(aSmp * aSmp + bSmp * bSmp);
    let cAvg = (cStd + cSmp) / 2;
    let G = 0.5 * (1 - Math.sqrt(
      Math.pow(cAvg, 7) / (Math.pow(cAvg, 7) + Math.pow(25, 7))
    ));
    let apStd = aStd * (1 + G);
    let apSmp = aSmp * (1 + G);
    let cpStd = Math.sqrt(apStd * apStd + bStd * bStd);
    let cpSmp = Math.sqrt(apSmp * apSmp + bSmp * bSmp);
    let hpStd = Math.abs(apStd) + Math.abs(bStd) === 0 ? 0 : Math.atan2(bStd, apStd);
    hpStd += (hpStd < 0) * 2 * Math.PI;
    let hpSmp = Math.abs(apSmp) + Math.abs(bSmp) === 0 ? 0 : Math.atan2(bSmp, apSmp);
    hpSmp += (hpSmp < 0) * 2 * Math.PI;
    let dL = lSmp - lStd;
    let dC = cpSmp - cpStd;
    let dhp = cpStd * cpSmp === 0 ? 0 : hpSmp - hpStd;
    dhp -= (dhp > Math.PI) * 2 * Math.PI;
    dhp += (dhp < -Math.PI) * 2 * Math.PI;
    let dH = 2 * Math.sqrt(cpStd * cpSmp) * Math.sin(dhp / 2);
    let Lp = (lStd + lSmp) / 2;
    let Cp = (cpStd + cpSmp) / 2;
    let hp;
    if (cpStd * cpSmp === 0) {
      hp = hpStd + hpSmp;
    } else {
      hp = (hpStd + hpSmp) / 2;
      hp -= (Math.abs(hpStd - hpSmp) > Math.PI) * Math.PI;
      hp += (hp < 0) * 2 * Math.PI;
    }
    let Lpm50 = Math.pow(Lp - 50, 2);
    let T = 1 - 0.17 * Math.cos(hp - Math.PI / 6) + 0.24 * Math.cos(2 * hp) + 0.32 * Math.cos(3 * hp + Math.PI / 30) - 0.2 * Math.cos(4 * hp - 63 * Math.PI / 180);
    let Sl = 1 + 0.015 * Lpm50 / Math.sqrt(20 + Lpm50);
    let Sc = 1 + 0.045 * Cp;
    let Sh = 1 + 0.015 * Cp * T;
    let deltaTheta = 30 * Math.PI / 180 * Math.exp(-1 * Math.pow((180 / Math.PI * hp - 275) / 25, 2));
    let Rc = 2 * Math.sqrt(Math.pow(Cp, 7) / (Math.pow(Cp, 7) + Math.pow(25, 7)));
    let Rt = -1 * Math.sin(2 * deltaTheta) * Rc;
    return Math.sqrt(
      Math.pow(dL / (Kl * Sl), 2) + Math.pow(dC / (Kc * Sc), 2) + Math.pow(dH / (Kh * Sh), 2) + Rt * dC / (Kc * Sc) * dH / (Kh * Sh)
    );
  };
};

// node_modules/culori/src/average.js
var averageAngle = (val) => {
  let sum = val.reduce(
    (sum2, val2) => {
      if (val2 !== void 0) {
        let rad = val2 * Math.PI / 180;
        sum2.sin += Math.sin(rad);
        sum2.cos += Math.cos(rad);
      }
      return sum2;
    },
    { sin: 0, cos: 0 }
  );
  let angle = Math.atan2(sum.sin, sum.cos) * 180 / Math.PI;
  return angle < 0 ? 360 + angle : angle;
};

// node_modules/culori/src/cubehelix/definition.js
var definition3 = {
  mode: "cubehelix",
  channels: ["h", "s", "l", "alpha"],
  parse: ["--cubehelix"],
  serialize: "--cubehelix",
  ranges: {
    h: [0, 360],
    s: [0, 4.614],
    l: [0, 1]
  },
  fromMode: {
    rgb: convertRgbToCubehelix_default
  },
  toMode: {
    rgb: convertCubehelixToRgb_default
  },
  interpolate: {
    h: {
      use: interpolatorLinear,
      fixup: fixupHueShorter
    },
    s: interpolatorLinear,
    l: interpolatorLinear,
    alpha: {
      use: interpolatorLinear,
      fixup: fixupAlpha
    }
  },
  difference: {
    h: differenceHueSaturation
  },
  average: {
    h: averageAngle
  }
};
var definition_default3 = definition3;

// node_modules/culori/src/lch/convertLabToLch.js
var convertLabToLch = ({ l, a, b, alpha }, mode = "lch") => {
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let c2 = Math.sqrt(a * a + b * b);
  let res = { mode, l, c: c2 };
  if (c2) res.h = normalizeHue_default(Math.atan2(b, a) * 180 / Math.PI);
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertLabToLch_default = convertLabToLch;

// node_modules/culori/src/lch/convertLchToLab.js
var convertLchToLab = ({ l, c: c2, h, alpha }, mode = "lab") => {
  if (h === void 0) h = 0;
  let res = {
    mode,
    l,
    a: c2 ? c2 * Math.cos(h / 180 * Math.PI) : 0,
    b: c2 ? c2 * Math.sin(h / 180 * Math.PI) : 0
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertLchToLab_default = convertLchToLab;

// node_modules/culori/src/xyz65/constants.js
var k = Math.pow(29, 3) / Math.pow(3, 3);
var e = Math.pow(6, 3) / Math.pow(29, 3);

// node_modules/culori/src/constants.js
var D50 = {
  X: 0.3457 / 0.3585,
  Y: 1,
  Z: (1 - 0.3457 - 0.3585) / 0.3585
};
var D65 = {
  X: 0.3127 / 0.329,
  Y: 1,
  Z: (1 - 0.3127 - 0.329) / 0.329
};
var k2 = Math.pow(29, 3) / Math.pow(3, 3);
var e2 = Math.pow(6, 3) / Math.pow(29, 3);

// node_modules/culori/src/lab65/convertLab65ToXyz65.js
var fn3 = (v) => Math.pow(v, 3) > e ? Math.pow(v, 3) : (116 * v - 16) / k;
var convertLab65ToXyz65 = ({ l, a, b, alpha }) => {
  if (l === void 0) l = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let fy = (l + 16) / 116;
  let fx = a / 500 + fy;
  let fz = fy - b / 200;
  let res = {
    mode: "xyz65",
    x: fn3(fx) * D65.X,
    y: fn3(fy) * D65.Y,
    z: fn3(fz) * D65.Z
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLab65ToXyz65_default = convertLab65ToXyz65;

// node_modules/culori/src/lab65/convertLab65ToRgb.js
var convertLab65ToRgb = (lab2) => convertXyz65ToRgb_default(convertLab65ToXyz65_default(lab2));
var convertLab65ToRgb_default = convertLab65ToRgb;

// node_modules/culori/src/lab65/convertXyz65ToLab65.js
var f = (value) => value > e ? Math.cbrt(value) : (k * value + 16) / 116;
var convertXyz65ToLab65 = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let f0 = f(x / D65.X);
  let f1 = f(y / D65.Y);
  let f22 = f(z / D65.Z);
  let res = {
    mode: "lab65",
    l: 116 * f1 - 16,
    a: 500 * (f0 - f1),
    b: 200 * (f1 - f22)
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToLab65_default = convertXyz65ToLab65;

// node_modules/culori/src/lab65/convertRgbToLab65.js
var convertRgbToLab65 = (rgb2) => {
  let res = convertXyz65ToLab65_default(convertRgbToXyz65_default(rgb2));
  if (rgb2.r === rgb2.b && rgb2.b === rgb2.g) {
    res.a = res.b = 0;
  }
  return res;
};
var convertRgbToLab65_default = convertRgbToLab65;

// node_modules/culori/src/dlch/constants.js
var kE = 1;
var kCH = 1;
var \u03B8 = 26 / 180 * Math.PI;
var cos\u03B8 = Math.cos(\u03B8);
var sin\u03B8 = Math.sin(\u03B8);
var factor = 100 / Math.log(139 / 100);

// node_modules/culori/src/dlch/convertDlchToLab65.js
var convertDlchToLab65 = ({ l, c: c2, h, alpha }) => {
  if (l === void 0) l = 0;
  if (c2 === void 0) c2 = 0;
  if (h === void 0) h = 0;
  let res = {
    mode: "lab65",
    l: (Math.exp(l * kE / factor) - 1) / 39e-4
  };
  let G = (Math.exp(0.0435 * c2 * kCH * kE) - 1) / 0.075;
  let e4 = G * Math.cos(h / 180 * Math.PI - \u03B8);
  let f3 = G * Math.sin(h / 180 * Math.PI - \u03B8);
  res.a = e4 * cos\u03B8 - f3 / 0.83 * sin\u03B8;
  res.b = e4 * sin\u03B8 + f3 / 0.83 * cos\u03B8;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertDlchToLab65_default = convertDlchToLab65;

// node_modules/culori/src/dlch/convertLab65ToDlch.js
var convertLab65ToDlch = ({ l, a, b, alpha }) => {
  if (l === void 0) l = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let e4 = a * cos\u03B8 + b * sin\u03B8;
  let f3 = 0.83 * (b * cos\u03B8 - a * sin\u03B8);
  let G = Math.sqrt(e4 * e4 + f3 * f3);
  let res = {
    mode: "dlch",
    l: factor / kE * Math.log(1 + 39e-4 * l),
    c: Math.log(1 + 0.075 * G) / (0.0435 * kCH * kE)
  };
  if (res.c) {
    res.h = normalizeHue_default((Math.atan2(f3, e4) + \u03B8) / Math.PI * 180);
  }
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertLab65ToDlch_default = convertLab65ToDlch;

// node_modules/culori/src/dlab/definition.js
var convertDlabToLab65 = (c2) => convertDlchToLab65_default(convertLabToLch_default(c2, "dlch"));
var convertLab65ToDlab = (c2) => convertLchToLab_default(convertLab65ToDlch_default(c2), "dlab");
var definition4 = {
  mode: "dlab",
  parse: ["--din99o-lab"],
  serialize: "--din99o-lab",
  toMode: {
    lab65: convertDlabToLab65,
    rgb: (c2) => convertLab65ToRgb_default(convertDlabToLab65(c2))
  },
  fromMode: {
    lab65: convertLab65ToDlab,
    rgb: (c2) => convertLab65ToDlab(convertRgbToLab65_default(c2))
  },
  channels: ["l", "a", "b", "alpha"],
  ranges: {
    l: [0, 100],
    a: [-40.09, 45.501],
    b: [-40.469, 44.344]
  },
  interpolate: {
    l: interpolatorLinear,
    a: interpolatorLinear,
    b: interpolatorLinear,
    alpha: {
      use: interpolatorLinear,
      fixup: fixupAlpha
    }
  }
};
var definition_default4 = definition4;

// node_modules/culori/src/dlch/definition.js
var definition5 = {
  mode: "dlch",
  parse: ["--din99o-lch"],
  serialize: "--din99o-lch",
  toMode: {
    lab65: convertDlchToLab65_default,
    dlab: (c2) => convertLchToLab_default(c2, "dlab"),
    rgb: (c2) => convertLab65ToRgb_default(convertDlchToLab65_default(c2))
  },
  fromMode: {
    lab65: convertLab65ToDlch_default,
    dlab: (c2) => convertLabToLch_default(c2, "dlch"),
    rgb: (c2) => convertLab65ToDlch_default(convertRgbToLab65_default(c2))
  },
  channels: ["l", "c", "h", "alpha"],
  ranges: {
    l: [0, 100],
    c: [0, 51.484],
    h: [0, 360]
  },
  interpolate: {
    l: interpolatorLinear,
    c: interpolatorLinear,
    h: {
      use: interpolatorLinear,
      fixup: fixupHueShorter
    },
    alpha: {
      use: interpolatorLinear,
      fixup: fixupAlpha
    }
  },
  difference: {
    h: differenceHueChroma
  },
  average: {
    h: averageAngle
  }
};
var definition_default5 = definition5;

// node_modules/culori/src/hsi/convertHsiToRgb.js
function convertHsiToRgb({ h, s, i, alpha }) {
  h = normalizeHue_default(h !== void 0 ? h : 0);
  if (s === void 0) s = 0;
  if (i === void 0) i = 0;
  let f3 = Math.abs(h / 60 % 2 - 1);
  let res;
  switch (Math.floor(h / 60)) {
    case 0:
      res = {
        r: i * (1 + s * (3 / (2 - f3) - 1)),
        g: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1)),
        b: i * (1 - s)
      };
      break;
    case 1:
      res = {
        r: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1)),
        g: i * (1 + s * (3 / (2 - f3) - 1)),
        b: i * (1 - s)
      };
      break;
    case 2:
      res = {
        r: i * (1 - s),
        g: i * (1 + s * (3 / (2 - f3) - 1)),
        b: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1))
      };
      break;
    case 3:
      res = {
        r: i * (1 - s),
        g: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1)),
        b: i * (1 + s * (3 / (2 - f3) - 1))
      };
      break;
    case 4:
      res = {
        r: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1)),
        g: i * (1 - s),
        b: i * (1 + s * (3 / (2 - f3) - 1))
      };
      break;
    case 5:
      res = {
        r: i * (1 + s * (3 / (2 - f3) - 1)),
        g: i * (1 - s),
        b: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1))
      };
      break;
    default:
      res = { r: i * (1 - s), g: i * (1 - s), b: i * (1 - s) };
  }
  res.mode = "rgb";
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsi/convertRgbToHsi.js
function convertRgbToHsi({ r, g, b, alpha }) {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let M3 = Math.max(r, g, b), m = Math.min(r, g, b);
  let res = {
    mode: "hsi",
    s: r + g + b === 0 ? 0 : 1 - 3 * m / (r + g + b),
    i: (r + g + b) / 3
  };
  if (M3 - m !== 0)
    res.h = (M3 === r ? (g - b) / (M3 - m) + (g < b) * 6 : M3 === g ? (b - r) / (M3 - m) + 2 : (r - g) / (M3 - m) + 4) * 60;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsi/definition.js
var definition6 = {
  mode: "hsi",
  toMode: {
    rgb: convertHsiToRgb
  },
  parse: ["--hsi"],
  serialize: "--hsi",
  fromMode: {
    rgb: convertRgbToHsi
  },
  channels: ["h", "s", "i", "alpha"],
  ranges: {
    h: [0, 360]
  },
  gamut: "rgb",
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    s: interpolatorLinear,
    i: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueSaturation
  },
  average: {
    h: averageAngle
  }
};
var definition_default6 = definition6;

// node_modules/culori/src/hsl/convertHslToRgb.js
function convertHslToRgb({ h, s, l, alpha }) {
  h = normalizeHue_default(h !== void 0 ? h : 0);
  if (s === void 0) s = 0;
  if (l === void 0) l = 0;
  let m1 = l + s * (l < 0.5 ? l : 1 - l);
  let m2 = m1 - (m1 - l) * 2 * Math.abs(h / 60 % 2 - 1);
  let res;
  switch (Math.floor(h / 60)) {
    case 0:
      res = { r: m1, g: m2, b: 2 * l - m1 };
      break;
    case 1:
      res = { r: m2, g: m1, b: 2 * l - m1 };
      break;
    case 2:
      res = { r: 2 * l - m1, g: m1, b: m2 };
      break;
    case 3:
      res = { r: 2 * l - m1, g: m2, b: m1 };
      break;
    case 4:
      res = { r: m2, g: 2 * l - m1, b: m1 };
      break;
    case 5:
      res = { r: m1, g: 2 * l - m1, b: m2 };
      break;
    default:
      res = { r: 2 * l - m1, g: 2 * l - m1, b: 2 * l - m1 };
  }
  res.mode = "rgb";
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsl/convertRgbToHsl.js
function convertRgbToHsl({ r, g, b, alpha }) {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let M3 = Math.max(r, g, b), m = Math.min(r, g, b);
  let res = {
    mode: "hsl",
    s: M3 === m ? 0 : (M3 - m) / (1 - Math.abs(M3 + m - 1)),
    l: 0.5 * (M3 + m)
  };
  if (M3 - m !== 0)
    res.h = (M3 === r ? (g - b) / (M3 - m) + (g < b) * 6 : M3 === g ? (b - r) / (M3 - m) + 2 : (r - g) / (M3 - m) + 4) * 60;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/util/hue.js
var hueToDeg = (val, unit) => {
  switch (unit) {
    case "deg":
      return +val;
    case "rad":
      return val / Math.PI * 180;
    case "grad":
      return val / 10 * 9;
    case "turn":
      return val * 360;
  }
};
var hue_default = hueToDeg;

// node_modules/culori/src/hsl/parseHslLegacy.js
var hsl_old = new RegExp(
  `^hsla?\\(\\s*${hue}${c}${per}${c}${per}\\s*(?:,\\s*${num_per}\\s*)?\\)$`
);
var parseHslLegacy = (color) => {
  let match = color.match(hsl_old);
  if (!match) return;
  let res = { mode: "hsl" };
  if (match[3] !== void 0) {
    res.h = +match[3];
  } else if (match[1] !== void 0 && match[2] !== void 0) {
    res.h = hue_default(match[1], match[2]);
  }
  if (match[4] !== void 0) {
    res.s = Math.min(Math.max(0, match[4] / 100), 1);
  }
  if (match[5] !== void 0) {
    res.l = Math.min(Math.max(0, match[5] / 100), 1);
  }
  if (match[6] !== void 0) {
    res.alpha = Math.max(0, Math.min(1, match[6] / 100));
  } else if (match[7] !== void 0) {
    res.alpha = Math.max(0, Math.min(1, +match[7]));
  }
  return res;
};
var parseHslLegacy_default = parseHslLegacy;

// node_modules/culori/src/hsl/parseHsl.js
function parseHsl(color, parsed) {
  if (!parsed || parsed[0] !== "hsl" && parsed[0] !== "hsla") {
    return void 0;
  }
  const res = { mode: "hsl" };
  const [, h, s, l, alpha] = parsed;
  if (h.type !== Tok.None) {
    if (h.type === Tok.Percentage) {
      return void 0;
    }
    res.h = h.value;
  }
  if (s.type !== Tok.None) {
    if (s.type === Tok.Hue) {
      return void 0;
    }
    res.s = s.value / 100;
  }
  if (l.type !== Tok.None) {
    if (l.type === Tok.Hue) {
      return void 0;
    }
    res.l = l.value / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseHsl_default = parseHsl;

// node_modules/culori/src/hsl/definition.js
var definition7 = {
  mode: "hsl",
  toMode: {
    rgb: convertHslToRgb
  },
  fromMode: {
    rgb: convertRgbToHsl
  },
  channels: ["h", "s", "l", "alpha"],
  ranges: {
    h: [0, 360]
  },
  gamut: "rgb",
  parse: [parseHsl_default, parseHslLegacy_default],
  serialize: (c2) => `hsl(${c2.h !== void 0 ? c2.h : "none"} ${c2.s !== void 0 ? c2.s * 100 + "%" : "none"} ${c2.l !== void 0 ? c2.l * 100 + "%" : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    s: interpolatorLinear,
    l: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueSaturation
  },
  average: {
    h: averageAngle
  }
};
var definition_default7 = definition7;

// node_modules/culori/src/hsv/convertHsvToRgb.js
function convertHsvToRgb({ h, s, v, alpha }) {
  h = normalizeHue_default(h !== void 0 ? h : 0);
  if (s === void 0) s = 0;
  if (v === void 0) v = 0;
  let f3 = Math.abs(h / 60 % 2 - 1);
  let res;
  switch (Math.floor(h / 60)) {
    case 0:
      res = { r: v, g: v * (1 - s * f3), b: v * (1 - s) };
      break;
    case 1:
      res = { r: v * (1 - s * f3), g: v, b: v * (1 - s) };
      break;
    case 2:
      res = { r: v * (1 - s), g: v, b: v * (1 - s * f3) };
      break;
    case 3:
      res = { r: v * (1 - s), g: v * (1 - s * f3), b: v };
      break;
    case 4:
      res = { r: v * (1 - s * f3), g: v * (1 - s), b: v };
      break;
    case 5:
      res = { r: v, g: v * (1 - s), b: v * (1 - s * f3) };
      break;
    default:
      res = { r: v * (1 - s), g: v * (1 - s), b: v * (1 - s) };
  }
  res.mode = "rgb";
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsv/convertRgbToHsv.js
function convertRgbToHsv({ r, g, b, alpha }) {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let M3 = Math.max(r, g, b), m = Math.min(r, g, b);
  let res = {
    mode: "hsv",
    s: M3 === 0 ? 0 : 1 - m / M3,
    v: M3
  };
  if (M3 - m !== 0)
    res.h = (M3 === r ? (g - b) / (M3 - m) + (g < b) * 6 : M3 === g ? (b - r) / (M3 - m) + 2 : (r - g) / (M3 - m) + 4) * 60;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsv/definition.js
var definition8 = {
  mode: "hsv",
  toMode: {
    rgb: convertHsvToRgb
  },
  parse: ["--hsv"],
  serialize: "--hsv",
  fromMode: {
    rgb: convertRgbToHsv
  },
  channels: ["h", "s", "v", "alpha"],
  ranges: {
    h: [0, 360]
  },
  gamut: "rgb",
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    s: interpolatorLinear,
    v: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueSaturation
  },
  average: {
    h: averageAngle
  }
};
var definition_default8 = definition8;

// node_modules/culori/src/hwb/convertHwbToRgb.js
function convertHwbToRgb({ h, w, b, alpha }) {
  if (w === void 0) w = 0;
  if (b === void 0) b = 0;
  if (w + b > 1) {
    let s = w + b;
    w /= s;
    b /= s;
  }
  return convertHsvToRgb({
    h,
    s: b === 1 ? 1 : 1 - w / (1 - b),
    v: 1 - b,
    alpha
  });
}

// node_modules/culori/src/hwb/convertRgbToHwb.js
function convertRgbToHwb(rgba) {
  let hsv2 = convertRgbToHsv(rgba);
  if (hsv2 === void 0) return void 0;
  let s = hsv2.s !== void 0 ? hsv2.s : 0;
  let v = hsv2.v !== void 0 ? hsv2.v : 0;
  let res = {
    mode: "hwb",
    w: (1 - s) * v,
    b: 1 - v
  };
  if (hsv2.h !== void 0) res.h = hsv2.h;
  if (hsv2.alpha !== void 0) res.alpha = hsv2.alpha;
  return res;
}

// node_modules/culori/src/hwb/parseHwb.js
function ParseHwb(color, parsed) {
  if (!parsed || parsed[0] !== "hwb") {
    return void 0;
  }
  const res = { mode: "hwb" };
  const [, h, w, b, alpha] = parsed;
  if (h.type !== Tok.None) {
    if (h.type === Tok.Percentage) {
      return void 0;
    }
    res.h = h.value;
  }
  if (w.type !== Tok.None) {
    if (w.type === Tok.Hue) {
      return void 0;
    }
    res.w = w.value / 100;
  }
  if (b.type !== Tok.None) {
    if (b.type === Tok.Hue) {
      return void 0;
    }
    res.b = b.value / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseHwb_default = ParseHwb;

// node_modules/culori/src/hwb/definition.js
var definition9 = {
  mode: "hwb",
  toMode: {
    rgb: convertHwbToRgb
  },
  fromMode: {
    rgb: convertRgbToHwb
  },
  channels: ["h", "w", "b", "alpha"],
  ranges: {
    h: [0, 360]
  },
  gamut: "rgb",
  parse: [parseHwb_default],
  serialize: (c2) => `hwb(${c2.h !== void 0 ? c2.h : "none"} ${c2.w !== void 0 ? c2.w * 100 + "%" : "none"} ${c2.b !== void 0 ? c2.b * 100 + "%" : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    w: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueNaive
  },
  average: {
    h: averageAngle
  }
};
var definition_default9 = definition9;

// node_modules/culori/src/hdr/constants.js
var YW = 203;

// node_modules/culori/src/hdr/transfer.js
var M1 = 0.1593017578125;
var M2 = 78.84375;
var C1 = 0.8359375;
var C2 = 18.8515625;
var C3 = 18.6875;
function transferPqDecode(v) {
  if (v < 0) return 0;
  const c2 = Math.pow(v, 1 / M2);
  return 1e4 * Math.pow(Math.max(0, c2 - C1) / (C2 - C3 * c2), 1 / M1);
}
function transferPqEncode(v) {
  if (v < 0) return 0;
  const c2 = Math.pow(v / 1e4, M1);
  return Math.pow((C1 + C2 * c2) / (1 + C3 * c2), M2);
}

// node_modules/culori/src/itp/convertItpToXyz65.js
var toRel = (c2) => Math.max(c2 / YW, 0);
var convertItpToXyz65 = ({ i, t, p: p4, alpha }) => {
  if (i === void 0) i = 0;
  if (t === void 0) t = 0;
  if (p4 === void 0) p4 = 0;
  const l = transferPqDecode(
    i + 0.008609037037932761 * t + 0.11102962500302593 * p4
  );
  const m = transferPqDecode(
    i - 0.00860903703793275 * t - 0.11102962500302599 * p4
  );
  const s = transferPqDecode(
    i + 0.5600313357106791 * t - 0.32062717498731885 * p4
  );
  const res = {
    mode: "xyz65",
    x: toRel(
      2.070152218389422 * l - 1.3263473389671556 * m + 0.2066510476294051 * s
    ),
    y: toRel(
      0.3647385209748074 * l + 0.680566024947227 * m - 0.0453045459220346 * s
    ),
    z: toRel(
      -0.049747207535812 * l - 0.0492609666966138 * m + 1.1880659249923042 * s
    )
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertItpToXyz65_default = convertItpToXyz65;

// node_modules/culori/src/itp/convertXyz65ToItp.js
var toAbs = (c2 = 0) => Math.max(c2 * YW, 0);
var convertXyz65ToItp = ({ x, y, z, alpha }) => {
  const absX = toAbs(x);
  const absY = toAbs(y);
  const absZ = toAbs(z);
  const l = transferPqEncode(
    0.3592832590121217 * absX + 0.6976051147779502 * absY - 0.0358915932320289 * absZ
  );
  const m = transferPqEncode(
    -0.1920808463704995 * absX + 1.1004767970374323 * absY + 0.0753748658519118 * absZ
  );
  const s = transferPqEncode(
    0.0070797844607477 * absX + 0.0748396662186366 * absY + 0.8433265453898765 * absZ
  );
  const i = 0.5 * l + 0.5 * m;
  const t = 1.61376953125 * l - 3.323486328125 * m + 1.709716796875 * s;
  const p4 = 4.378173828125 * l - 4.24560546875 * m - 0.132568359375 * s;
  const res = { mode: "itp", i, t, p: p4 };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToItp_default = convertXyz65ToItp;

// node_modules/culori/src/itp/definition.js
var definition10 = {
  mode: "itp",
  channels: ["i", "t", "p", "alpha"],
  parse: ["--ictcp"],
  serialize: "--ictcp",
  toMode: {
    xyz65: convertItpToXyz65_default,
    rgb: (color) => convertXyz65ToRgb_default(convertItpToXyz65_default(color))
  },
  fromMode: {
    xyz65: convertXyz65ToItp_default,
    rgb: (color) => convertXyz65ToItp_default(convertRgbToXyz65_default(color))
  },
  ranges: {
    i: [0, 0.581],
    t: [-0.369, 0.272],
    p: [-0.164, 0.331]
  },
  interpolate: {
    i: interpolatorLinear,
    t: interpolatorLinear,
    p: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default10 = definition10;

// node_modules/culori/src/jab/convertXyz65ToJab.js
var p = 134.03437499999998;
var d0 = 16295499532821565e-27;
var jabPqEncode = (v) => {
  if (v < 0) return 0;
  let vn3 = Math.pow(v / 1e4, M1);
  return Math.pow((C1 + C2 * vn3) / (1 + C3 * vn3), p);
};
var abs = (v = 0) => Math.max(v * 203, 0);
var convertXyz65ToJab = ({ x, y, z, alpha }) => {
  x = abs(x);
  y = abs(y);
  z = abs(z);
  let xp = 1.15 * x - 0.15 * z;
  let yp = 0.66 * y + 0.34 * x;
  let l = jabPqEncode(0.41478972 * xp + 0.579999 * yp + 0.014648 * z);
  let m = jabPqEncode(-0.20151 * xp + 1.120649 * yp + 0.0531008 * z);
  let s = jabPqEncode(-0.0166008 * xp + 0.2648 * yp + 0.6684799 * z);
  let i = (l + m) / 2;
  let res = {
    mode: "jab",
    j: 0.44 * i / (1 - 0.56 * i) - d0,
    a: 3.524 * l - 4.066708 * m + 0.542708 * s,
    b: 0.199076 * l + 1.096799 * m - 1.295875 * s
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToJab_default = convertXyz65ToJab;

// node_modules/culori/src/jab/convertJabToXyz65.js
var p2 = 134.03437499999998;
var d02 = 16295499532821565e-27;
var jabPqDecode = (v) => {
  if (v < 0) return 0;
  let vp = Math.pow(v, 1 / p2);
  return 1e4 * Math.pow((C1 - vp) / (C3 * vp - C2), 1 / M1);
};
var rel = (v) => v / 203;
var convertJabToXyz65 = ({ j, a, b, alpha }) => {
  if (j === void 0) j = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let i = (j + d02) / (0.44 + 0.56 * (j + d02));
  let l = jabPqDecode(i + 0.13860504 * a + 0.058047316 * b);
  let m = jabPqDecode(i - 0.13860504 * a - 0.058047316 * b);
  let s = jabPqDecode(i - 0.096019242 * a - 0.8118919 * b);
  let res = {
    mode: "xyz65",
    x: rel(
      1.661373024652174 * l - 0.914523081304348 * m + 0.23136208173913045 * s
    ),
    y: rel(
      -0.3250758611844533 * l + 1.571847026732543 * m - 0.21825383453227928 * s
    ),
    z: rel(-0.090982811 * l - 0.31272829 * m + 1.5227666 * s)
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertJabToXyz65_default = convertJabToXyz65;

// node_modules/culori/src/jab/convertRgbToJab.js
var convertRgbToJab = (rgb2) => {
  let res = convertXyz65ToJab_default(convertRgbToXyz65_default(rgb2));
  if (rgb2.r === rgb2.b && rgb2.b === rgb2.g) {
    res.a = res.b = 0;
  }
  return res;
};
var convertRgbToJab_default = convertRgbToJab;

// node_modules/culori/src/jab/convertJabToRgb.js
var convertJabToRgb = (color) => convertXyz65ToRgb_default(convertJabToXyz65_default(color));
var convertJabToRgb_default = convertJabToRgb;

// node_modules/culori/src/jab/definition.js
var definition11 = {
  mode: "jab",
  channels: ["j", "a", "b", "alpha"],
  parse: ["--jzazbz"],
  serialize: "--jzazbz",
  fromMode: {
    rgb: convertRgbToJab_default,
    xyz65: convertXyz65ToJab_default
  },
  toMode: {
    rgb: convertJabToRgb_default,
    xyz65: convertJabToXyz65_default
  },
  ranges: {
    j: [0, 0.222],
    a: [-0.109, 0.129],
    b: [-0.185, 0.134]
  },
  interpolate: {
    j: interpolatorLinear,
    a: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default11 = definition11;

// node_modules/culori/src/jch/convertJabToJch.js
var convertJabToJch = ({ j, a, b, alpha }) => {
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let c2 = Math.sqrt(a * a + b * b);
  let res = {
    mode: "jch",
    j,
    c: c2
  };
  if (c2) {
    res.h = normalizeHue_default(Math.atan2(b, a) * 180 / Math.PI);
  }
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertJabToJch_default = convertJabToJch;

// node_modules/culori/src/jch/convertJchToJab.js
var convertJchToJab = ({ j, c: c2, h, alpha }) => {
  if (h === void 0) h = 0;
  let res = {
    mode: "jab",
    j,
    a: c2 ? c2 * Math.cos(h / 180 * Math.PI) : 0,
    b: c2 ? c2 * Math.sin(h / 180 * Math.PI) : 0
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertJchToJab_default = convertJchToJab;

// node_modules/culori/src/jch/definition.js
var definition12 = {
  mode: "jch",
  parse: ["--jzczhz"],
  serialize: "--jzczhz",
  toMode: {
    jab: convertJchToJab_default,
    rgb: (c2) => convertJabToRgb_default(convertJchToJab_default(c2))
  },
  fromMode: {
    rgb: (c2) => convertJabToJch_default(convertRgbToJab_default(c2)),
    jab: convertJabToJch_default
  },
  channels: ["j", "c", "h", "alpha"],
  ranges: {
    j: [0, 0.221],
    c: [0, 0.19],
    h: [0, 360]
  },
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    c: interpolatorLinear,
    j: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueChroma
  },
  average: {
    h: averageAngle
  }
};
var definition_default12 = definition12;

// node_modules/culori/src/xyz50/constants.js
var k3 = Math.pow(29, 3) / Math.pow(3, 3);
var e3 = Math.pow(6, 3) / Math.pow(29, 3);

// node_modules/culori/src/lab/convertLabToXyz50.js
var fn4 = (v) => Math.pow(v, 3) > e3 ? Math.pow(v, 3) : (116 * v - 16) / k3;
var convertLabToXyz50 = ({ l, a, b, alpha }) => {
  if (l === void 0) l = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let fy = (l + 16) / 116;
  let fx = a / 500 + fy;
  let fz = fy - b / 200;
  let res = {
    mode: "xyz50",
    x: fn4(fx) * D50.X,
    y: fn4(fy) * D50.Y,
    z: fn4(fz) * D50.Z
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLabToXyz50_default = convertLabToXyz50;

// node_modules/culori/src/xyz50/convertXyz50ToRgb.js
var convertXyz50ToRgb = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = convertLrgbToRgb_default({
    r: x * 3.1341359569958707 - y * 1.6173863321612538 - 0.4906619460083532 * z,
    g: x * -0.978795502912089 + y * 1.916254567259524 + 0.03344273116131949 * z,
    b: x * 0.07195537988411677 - y * 0.2289768264158322 + 1.405386058324125 * z
  });
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToRgb_default = convertXyz50ToRgb;

// node_modules/culori/src/lab/convertLabToRgb.js
var convertLabToRgb = (lab2) => convertXyz50ToRgb_default(convertLabToXyz50_default(lab2));
var convertLabToRgb_default = convertLabToRgb;

// node_modules/culori/src/xyz50/convertRgbToXyz50.js
var convertRgbToXyz50 = (rgb2) => {
  let { r, g, b, alpha } = convertRgbToLrgb_default(rgb2);
  let res = {
    mode: "xyz50",
    x: 0.436065742824811 * r + 0.3851514688337912 * g + 0.14307845442264197 * b,
    y: 0.22249319175623702 * r + 0.7168870538238823 * g + 0.06061979053616537 * b,
    z: 0.013923904500943465 * r + 0.09708128566574634 * g + 0.7140993584005155 * b
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertRgbToXyz50_default = convertRgbToXyz50;

// node_modules/culori/src/lab/convertXyz50ToLab.js
var f2 = (value) => value > e3 ? Math.cbrt(value) : (k3 * value + 16) / 116;
var convertXyz50ToLab = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let f0 = f2(x / D50.X);
  let f1 = f2(y / D50.Y);
  let f22 = f2(z / D50.Z);
  let res = {
    mode: "lab",
    l: 116 * f1 - 16,
    a: 500 * (f0 - f1),
    b: 200 * (f1 - f22)
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToLab_default = convertXyz50ToLab;

// node_modules/culori/src/lab/convertRgbToLab.js
var convertRgbToLab = (rgb2) => {
  let res = convertXyz50ToLab_default(convertRgbToXyz50_default(rgb2));
  if (rgb2.r === rgb2.b && rgb2.b === rgb2.g) {
    res.a = res.b = 0;
  }
  return res;
};
var convertRgbToLab_default = convertRgbToLab;

// node_modules/culori/src/lab/parseLab.js
function parseLab(color, parsed) {
  if (!parsed || parsed[0] !== "lab") {
    return void 0;
  }
  const res = { mode: "lab" };
  const [, l, a, b, alpha] = parsed;
  if (l.type === Tok.Hue || a.type === Tok.Hue || b.type === Tok.Hue) {
    return void 0;
  }
  if (l.type !== Tok.None) {
    res.l = Math.min(Math.max(0, l.value), 100);
  }
  if (a.type !== Tok.None) {
    res.a = a.type === Tok.Number ? a.value : a.value * 125 / 100;
  }
  if (b.type !== Tok.None) {
    res.b = b.type === Tok.Number ? b.value : b.value * 125 / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseLab_default = parseLab;

// node_modules/culori/src/lab/definition.js
var definition13 = {
  mode: "lab",
  toMode: {
    xyz50: convertLabToXyz50_default,
    rgb: convertLabToRgb_default
  },
  fromMode: {
    xyz50: convertXyz50ToLab_default,
    rgb: convertRgbToLab_default
  },
  channels: ["l", "a", "b", "alpha"],
  ranges: {
    l: [0, 100],
    a: [-125, 125],
    b: [-125, 125]
  },
  parse: [parseLab_default],
  serialize: (c2) => `lab(${c2.l !== void 0 ? c2.l : "none"} ${c2.a !== void 0 ? c2.a : "none"} ${c2.b !== void 0 ? c2.b : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  interpolate: {
    l: interpolatorLinear,
    a: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default13 = definition13;

// node_modules/culori/src/lab65/definition.js
var definition14 = {
  ...definition_default13,
  mode: "lab65",
  parse: ["--lab-d65"],
  serialize: "--lab-d65",
  toMode: {
    xyz65: convertLab65ToXyz65_default,
    rgb: convertLab65ToRgb_default
  },
  fromMode: {
    xyz65: convertXyz65ToLab65_default,
    rgb: convertRgbToLab65_default
  },
  ranges: {
    l: [0, 100],
    a: [-125, 125],
    b: [-125, 125]
  }
};
var definition_default14 = definition14;

// node_modules/culori/src/lch/parseLch.js
function parseLch(color, parsed) {
  if (!parsed || parsed[0] !== "lch") {
    return void 0;
  }
  const res = { mode: "lch" };
  const [, l, c2, h, alpha] = parsed;
  if (l.type !== Tok.None) {
    if (l.type === Tok.Hue) {
      return void 0;
    }
    res.l = Math.min(Math.max(0, l.value), 100);
  }
  if (c2.type !== Tok.None) {
    res.c = Math.max(
      0,
      c2.type === Tok.Number ? c2.value : c2.value * 150 / 100
    );
  }
  if (h.type !== Tok.None) {
    if (h.type === Tok.Percentage) {
      return void 0;
    }
    res.h = h.value;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseLch_default = parseLch;

// node_modules/culori/src/lch/definition.js
var definition15 = {
  mode: "lch",
  toMode: {
    lab: convertLchToLab_default,
    rgb: (c2) => convertLabToRgb_default(convertLchToLab_default(c2))
  },
  fromMode: {
    rgb: (c2) => convertLabToLch_default(convertRgbToLab_default(c2)),
    lab: convertLabToLch_default
  },
  channels: ["l", "c", "h", "alpha"],
  ranges: {
    l: [0, 100],
    c: [0, 150],
    h: [0, 360]
  },
  parse: [parseLch_default],
  serialize: (c2) => `lch(${c2.l !== void 0 ? c2.l : "none"} ${c2.c !== void 0 ? c2.c : "none"} ${c2.h !== void 0 ? c2.h : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    c: interpolatorLinear,
    l: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueChroma
  },
  average: {
    h: averageAngle
  }
};
var definition_default15 = definition15;

// node_modules/culori/src/lch65/definition.js
var definition16 = {
  ...definition_default15,
  mode: "lch65",
  parse: ["--lch-d65"],
  serialize: "--lch-d65",
  toMode: {
    lab65: (c2) => convertLchToLab_default(c2, "lab65"),
    rgb: (c2) => convertLab65ToRgb_default(convertLchToLab_default(c2, "lab65"))
  },
  fromMode: {
    rgb: (c2) => convertLabToLch_default(convertRgbToLab65_default(c2), "lch65"),
    lab65: (c2) => convertLabToLch_default(c2, "lch65")
  },
  ranges: {
    l: [0, 100],
    c: [0, 150],
    h: [0, 360]
  }
};
var definition_default16 = definition16;

// node_modules/culori/src/lchuv/convertLuvToLchuv.js
var convertLuvToLchuv = ({ l, u, v, alpha }) => {
  if (u === void 0) u = 0;
  if (v === void 0) v = 0;
  let c2 = Math.sqrt(u * u + v * v);
  let res = {
    mode: "lchuv",
    l,
    c: c2
  };
  if (c2) {
    res.h = normalizeHue_default(Math.atan2(v, u) * 180 / Math.PI);
  }
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLuvToLchuv_default = convertLuvToLchuv;

// node_modules/culori/src/lchuv/convertLchuvToLuv.js
var convertLchuvToLuv = ({ l, c: c2, h, alpha }) => {
  if (h === void 0) h = 0;
  let res = {
    mode: "luv",
    l,
    u: c2 ? c2 * Math.cos(h / 180 * Math.PI) : 0,
    v: c2 ? c2 * Math.sin(h / 180 * Math.PI) : 0
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLchuvToLuv_default = convertLchuvToLuv;

// node_modules/culori/src/luv/convertXyz50ToLuv.js
var u_fn = (x, y, z) => 4 * x / (x + 15 * y + 3 * z);
var v_fn = (x, y, z) => 9 * y / (x + 15 * y + 3 * z);
var un = u_fn(D50.X, D50.Y, D50.Z);
var vn = v_fn(D50.X, D50.Y, D50.Z);
var l_fn = (value) => value <= e3 ? k3 * value : 116 * Math.cbrt(value) - 16;
var convertXyz50ToLuv = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let l = l_fn(y / D50.Y);
  let u = u_fn(x, y, z);
  let v = v_fn(x, y, z);
  if (!isFinite(u) || !isFinite(v)) {
    l = u = v = 0;
  } else {
    u = 13 * l * (u - un);
    v = 13 * l * (v - vn);
  }
  let res = {
    mode: "luv",
    l,
    u,
    v
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToLuv_default = convertXyz50ToLuv;

// node_modules/culori/src/luv/convertLuvToXyz50.js
var u_fn2 = (x, y, z) => 4 * x / (x + 15 * y + 3 * z);
var v_fn2 = (x, y, z) => 9 * y / (x + 15 * y + 3 * z);
var un2 = u_fn2(D50.X, D50.Y, D50.Z);
var vn2 = v_fn2(D50.X, D50.Y, D50.Z);
var convertLuvToXyz50 = ({ l, u, v, alpha }) => {
  if (l === void 0) l = 0;
  if (l === 0) {
    return { mode: "xyz50", x: 0, y: 0, z: 0 };
  }
  if (u === void 0) u = 0;
  if (v === void 0) v = 0;
  let up = u / (13 * l) + un2;
  let vp = v / (13 * l) + vn2;
  let y = D50.Y * (l <= 8 ? l / k3 : Math.pow((l + 16) / 116, 3));
  let x = y * (9 * up) / (4 * vp);
  let z = y * (12 - 3 * up - 20 * vp) / (4 * vp);
  let res = { mode: "xyz50", x, y, z };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLuvToXyz50_default = convertLuvToXyz50;

// node_modules/culori/src/lchuv/definition.js
var convertRgbToLchuv = (rgb2) => convertLuvToLchuv_default(convertXyz50ToLuv_default(convertRgbToXyz50_default(rgb2)));
var convertLchuvToRgb = (lchuv2) => convertXyz50ToRgb_default(convertLuvToXyz50_default(convertLchuvToLuv_default(lchuv2)));
var definition17 = {
  mode: "lchuv",
  toMode: {
    luv: convertLchuvToLuv_default,
    rgb: convertLchuvToRgb
  },
  fromMode: {
    rgb: convertRgbToLchuv,
    luv: convertLuvToLchuv_default
  },
  channels: ["l", "c", "h", "alpha"],
  parse: ["--lchuv"],
  serialize: "--lchuv",
  ranges: {
    l: [0, 100],
    c: [0, 176.956],
    h: [0, 360]
  },
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    c: interpolatorLinear,
    l: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueChroma
  },
  average: {
    h: averageAngle
  }
};
var definition_default17 = definition17;

// node_modules/culori/src/lrgb/definition.js
var definition18 = {
  ...definition_default,
  mode: "lrgb",
  toMode: {
    rgb: convertLrgbToRgb_default
  },
  fromMode: {
    rgb: convertRgbToLrgb_default
  },
  parse: ["srgb-linear"],
  serialize: "srgb-linear"
};
var definition_default18 = definition18;

// node_modules/culori/src/luv/definition.js
var definition19 = {
  mode: "luv",
  toMode: {
    xyz50: convertLuvToXyz50_default,
    rgb: (luv2) => convertXyz50ToRgb_default(convertLuvToXyz50_default(luv2))
  },
  fromMode: {
    xyz50: convertXyz50ToLuv_default,
    rgb: (rgb2) => convertXyz50ToLuv_default(convertRgbToXyz50_default(rgb2))
  },
  channels: ["l", "u", "v", "alpha"],
  parse: ["--luv"],
  serialize: "--luv",
  ranges: {
    l: [0, 100],
    u: [-84.936, 175.042],
    v: [-125.882, 87.243]
  },
  interpolate: {
    l: interpolatorLinear,
    u: interpolatorLinear,
    v: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default19 = definition19;

// node_modules/culori/src/oklab/convertLrgbToOklab.js
var convertLrgbToOklab = ({ r, g, b, alpha }) => {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let L = Math.cbrt(
    0.412221469470763 * r + 0.5363325372617348 * g + 0.0514459932675022 * b
  );
  let M3 = Math.cbrt(
    0.2119034958178252 * r + 0.6806995506452344 * g + 0.1073969535369406 * b
  );
  let S = Math.cbrt(
    0.0883024591900564 * r + 0.2817188391361215 * g + 0.6299787016738222 * b
  );
  let res = {
    mode: "oklab",
    l: 0.210454268309314 * L + 0.7936177747023054 * M3 - 0.0040720430116193 * S,
    a: 1.9779985324311684 * L - 2.42859224204858 * M3 + 0.450593709617411 * S,
    b: 0.0259040424655478 * L + 0.7827717124575296 * M3 - 0.8086757549230774 * S
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLrgbToOklab_default = convertLrgbToOklab;

// node_modules/culori/src/oklab/convertRgbToOklab.js
var convertRgbToOklab = (rgb2) => {
  let res = convertLrgbToOklab_default(convertRgbToLrgb_default(rgb2));
  if (rgb2.r === rgb2.b && rgb2.b === rgb2.g) {
    res.a = res.b = 0;
  }
  return res;
};
var convertRgbToOklab_default = convertRgbToOklab;

// node_modules/culori/src/oklab/convertOklabToLrgb.js
var convertOklabToLrgb = ({ l, a, b, alpha }) => {
  if (l === void 0) l = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let L = Math.pow(l + 0.3963377773761749 * a + 0.2158037573099136 * b, 3);
  let M3 = Math.pow(l - 0.1055613458156586 * a - 0.0638541728258133 * b, 3);
  let S = Math.pow(l - 0.0894841775298119 * a - 1.2914855480194092 * b, 3);
  let res = {
    mode: "lrgb",
    r: 4.076741636075957 * L - 3.3077115392580616 * M3 + 0.2309699031821044 * S,
    g: -1.2684379732850317 * L + 2.6097573492876887 * M3 - 0.3413193760026573 * S,
    b: -0.0041960761386756 * L - 0.7034186179359362 * M3 + 1.7076146940746117 * S
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertOklabToLrgb_default = convertOklabToLrgb;

// node_modules/culori/src/oklab/convertOklabToRgb.js
var convertOklabToRgb = (c2) => convertLrgbToRgb_default(convertOklabToLrgb_default(c2));
var convertOklabToRgb_default = convertOklabToRgb;

// node_modules/culori/src/okhsl/helpers.js
function toe(x) {
  const k_1 = 0.206;
  const k_2 = 0.03;
  const k_3 = (1 + k_1) / (1 + k_2);
  return 0.5 * (k_3 * x - k_1 + Math.sqrt((k_3 * x - k_1) * (k_3 * x - k_1) + 4 * k_2 * k_3 * x));
}
function toe_inv(x) {
  const k_1 = 0.206;
  const k_2 = 0.03;
  const k_3 = (1 + k_1) / (1 + k_2);
  return (x * x + k_1 * x) / (k_3 * (x + k_2));
}
function compute_max_saturation(a, b) {
  let k0, k1, k22, k32, k4, wl, wm, ws;
  if (-1.88170328 * a - 0.80936493 * b > 1) {
    k0 = 1.19086277;
    k1 = 1.76576728;
    k22 = 0.59662641;
    k32 = 0.75515197;
    k4 = 0.56771245;
    wl = 4.0767416621;
    wm = -3.3077115913;
    ws = 0.2309699292;
  } else if (1.81444104 * a - 1.19445276 * b > 1) {
    k0 = 0.73956515;
    k1 = -0.45954404;
    k22 = 0.08285427;
    k32 = 0.1254107;
    k4 = 0.14503204;
    wl = -1.2684380046;
    wm = 2.6097574011;
    ws = -0.3413193965;
  } else {
    k0 = 1.35733652;
    k1 = -915799e-8;
    k22 = -1.1513021;
    k32 = -0.50559606;
    k4 = 692167e-8;
    wl = -0.0041960863;
    wm = -0.7034186147;
    ws = 1.707614701;
  }
  let S = k0 + k1 * a + k22 * b + k32 * a * a + k4 * a * b;
  let k_l = 0.3963377774 * a + 0.2158037573 * b;
  let k_m = -0.1055613458 * a - 0.0638541728 * b;
  let k_s = -0.0894841775 * a - 1.291485548 * b;
  {
    let l_ = 1 + S * k_l;
    let m_ = 1 + S * k_m;
    let s_ = 1 + S * k_s;
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;
    let l_dS = 3 * k_l * l_ * l_;
    let m_dS = 3 * k_m * m_ * m_;
    let s_dS = 3 * k_s * s_ * s_;
    let l_dS2 = 6 * k_l * k_l * l_;
    let m_dS2 = 6 * k_m * k_m * m_;
    let s_dS2 = 6 * k_s * k_s * s_;
    let f3 = wl * l + wm * m + ws * s;
    let f1 = wl * l_dS + wm * m_dS + ws * s_dS;
    let f22 = wl * l_dS2 + wm * m_dS2 + ws * s_dS2;
    S = S - f3 * f1 / (f1 * f1 - 0.5 * f3 * f22);
  }
  return S;
}
function find_cusp(a, b) {
  let S_cusp = compute_max_saturation(a, b);
  let rgb2 = convertOklabToLrgb_default({ l: 1, a: S_cusp * a, b: S_cusp * b });
  let L_cusp = Math.cbrt(1 / Math.max(rgb2.r, rgb2.g, rgb2.b));
  let C_cusp = L_cusp * S_cusp;
  return [L_cusp, C_cusp];
}
function find_gamut_intersection(a, b, L1, C12, L0, cusp = null) {
  if (!cusp) {
    cusp = find_cusp(a, b);
  }
  let t;
  if ((L1 - L0) * cusp[1] - (cusp[0] - L0) * C12 <= 0) {
    t = cusp[1] * L0 / (C12 * cusp[0] + cusp[1] * (L0 - L1));
  } else {
    t = cusp[1] * (L0 - 1) / (C12 * (cusp[0] - 1) + cusp[1] * (L0 - L1));
    {
      let dL = L1 - L0;
      let dC = C12;
      let k_l = 0.3963377774 * a + 0.2158037573 * b;
      let k_m = -0.1055613458 * a - 0.0638541728 * b;
      let k_s = -0.0894841775 * a - 1.291485548 * b;
      let l_dt = dL + dC * k_l;
      let m_dt = dL + dC * k_m;
      let s_dt = dL + dC * k_s;
      {
        let L = L0 * (1 - t) + t * L1;
        let C = t * C12;
        let l_ = L + C * k_l;
        let m_ = L + C * k_m;
        let s_ = L + C * k_s;
        let l = l_ * l_ * l_;
        let m = m_ * m_ * m_;
        let s = s_ * s_ * s_;
        let ldt = 3 * l_dt * l_ * l_;
        let mdt = 3 * m_dt * m_ * m_;
        let sdt = 3 * s_dt * s_ * s_;
        let ldt2 = 6 * l_dt * l_dt * l_;
        let mdt2 = 6 * m_dt * m_dt * m_;
        let sdt2 = 6 * s_dt * s_dt * s_;
        let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s - 1;
        let r1 = 4.0767416621 * ldt - 3.3077115913 * mdt + 0.2309699292 * sdt;
        let r2 = 4.0767416621 * ldt2 - 3.3077115913 * mdt2 + 0.2309699292 * sdt2;
        let u_r = r1 / (r1 * r1 - 0.5 * r * r2);
        let t_r = -r * u_r;
        let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s - 1;
        let g1 = -1.2684380046 * ldt + 2.6097574011 * mdt - 0.3413193965 * sdt;
        let g2 = -1.2684380046 * ldt2 + 2.6097574011 * mdt2 - 0.3413193965 * sdt2;
        let u_g = g1 / (g1 * g1 - 0.5 * g * g2);
        let t_g = -g * u_g;
        let b2 = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s - 1;
        let b1 = -0.0041960863 * ldt - 0.7034186147 * mdt + 1.707614701 * sdt;
        let b22 = -0.0041960863 * ldt2 - 0.7034186147 * mdt2 + 1.707614701 * sdt2;
        let u_b = b1 / (b1 * b1 - 0.5 * b2 * b22);
        let t_b = -b2 * u_b;
        t_r = u_r >= 0 ? t_r : 1e6;
        t_g = u_g >= 0 ? t_g : 1e6;
        t_b = u_b >= 0 ? t_b : 1e6;
        t += Math.min(t_r, Math.min(t_g, t_b));
      }
    }
  }
  return t;
}
function get_ST_max(a_, b_, cusp = null) {
  if (!cusp) {
    cusp = find_cusp(a_, b_);
  }
  let L = cusp[0];
  let C = cusp[1];
  return [C / L, C / (1 - L)];
}
function get_Cs(L, a_, b_) {
  let cusp = find_cusp(a_, b_);
  let C_max = find_gamut_intersection(a_, b_, L, 1, L, cusp);
  let ST_max = get_ST_max(a_, b_, cusp);
  let S_mid = 0.11516993 + 1 / (7.4477897 + 4.1590124 * b_ + a_ * (-2.19557347 + 1.75198401 * b_ + a_ * (-2.13704948 - 10.02301043 * b_ + a_ * (-4.24894561 + 5.38770819 * b_ + 4.69891013 * a_))));
  let T_mid = 0.11239642 + 1 / (1.6132032 - 0.68124379 * b_ + a_ * (0.40370612 + 0.90148123 * b_ + a_ * (-0.27087943 + 0.6122399 * b_ + a_ * (299215e-8 - 0.45399568 * b_ - 0.14661872 * a_))));
  let k4 = C_max / Math.min(L * ST_max[0], (1 - L) * ST_max[1]);
  let C_a = L * S_mid;
  let C_b = (1 - L) * T_mid;
  let C_mid = 0.9 * k4 * Math.sqrt(
    Math.sqrt(
      1 / (1 / (C_a * C_a * C_a * C_a) + 1 / (C_b * C_b * C_b * C_b))
    )
  );
  C_a = L * 0.4;
  C_b = (1 - L) * 0.8;
  let C_0 = Math.sqrt(1 / (1 / (C_a * C_a) + 1 / (C_b * C_b)));
  return [C_0, C_mid, C_max];
}

// node_modules/culori/src/okhsl/convertOklabToOkhsl.js
function convertOklabToOkhsl(lab2) {
  const l = lab2.l !== void 0 ? lab2.l : 0;
  const a = lab2.a !== void 0 ? lab2.a : 0;
  const b = lab2.b !== void 0 ? lab2.b : 0;
  const ret = { mode: "okhsl", l: toe(l) };
  if (lab2.alpha !== void 0) {
    ret.alpha = lab2.alpha;
  }
  let c2 = Math.sqrt(a * a + b * b);
  if (!c2) {
    ret.s = 0;
    return ret;
  }
  let [C_0, C_mid, C_max] = get_Cs(l, a / c2, b / c2);
  let s;
  if (c2 < C_mid) {
    let k_0 = 0;
    let k_1 = 0.8 * C_0;
    let k_2 = 1 - k_1 / C_mid;
    let t = (c2 - k_0) / (k_1 + k_2 * (c2 - k_0));
    s = t * 0.8;
  } else {
    let k_0 = C_mid;
    let k_1 = 0.2 * C_mid * C_mid * 1.25 * 1.25 / C_0;
    let k_2 = 1 - k_1 / (C_max - C_mid);
    let t = (c2 - k_0) / (k_1 + k_2 * (c2 - k_0));
    s = 0.8 + 0.2 * t;
  }
  if (s) {
    ret.s = s;
    ret.h = normalizeHue_default(Math.atan2(b, a) * 180 / Math.PI);
  }
  return ret;
}

// node_modules/culori/src/okhsl/convertOkhslToOklab.js
function convertOkhslToOklab(hsl2) {
  let h = hsl2.h !== void 0 ? hsl2.h : 0;
  let s = hsl2.s !== void 0 ? hsl2.s : 0;
  let l = hsl2.l !== void 0 ? hsl2.l : 0;
  const ret = { mode: "oklab", l: toe_inv(l) };
  if (hsl2.alpha !== void 0) {
    ret.alpha = hsl2.alpha;
  }
  if (!s || l === 1) {
    ret.a = ret.b = 0;
    return ret;
  }
  let a_ = Math.cos(h / 180 * Math.PI);
  let b_ = Math.sin(h / 180 * Math.PI);
  let [C_0, C_mid, C_max] = get_Cs(ret.l, a_, b_);
  let t, k_0, k_1, k_2;
  if (s < 0.8) {
    t = 1.25 * s;
    k_0 = 0;
    k_1 = 0.8 * C_0;
    k_2 = 1 - k_1 / C_mid;
  } else {
    t = 5 * (s - 0.8);
    k_0 = C_mid;
    k_1 = 0.2 * C_mid * C_mid * 1.25 * 1.25 / C_0;
    k_2 = 1 - k_1 / (C_max - C_mid);
  }
  let C = k_0 + t * k_1 / (1 - k_2 * t);
  ret.a = C * a_;
  ret.b = C * b_;
  return ret;
}

// node_modules/culori/src/okhsl/modeOkhsl.js
var modeOkhsl = {
  ...definition_default7,
  mode: "okhsl",
  channels: ["h", "s", "l", "alpha"],
  parse: ["--okhsl"],
  serialize: "--okhsl",
  fromMode: {
    oklab: convertOklabToOkhsl,
    rgb: (c2) => convertOklabToOkhsl(convertRgbToOklab_default(c2))
  },
  toMode: {
    oklab: convertOkhslToOklab,
    rgb: (c2) => convertOklabToRgb_default(convertOkhslToOklab(c2))
  }
};
var modeOkhsl_default = modeOkhsl;

// node_modules/culori/src/okhsv/convertOklabToOkhsv.js
function convertOklabToOkhsv(lab2) {
  let l = lab2.l !== void 0 ? lab2.l : 0;
  let a = lab2.a !== void 0 ? lab2.a : 0;
  let b = lab2.b !== void 0 ? lab2.b : 0;
  let c2 = Math.sqrt(a * a + b * b);
  let a_ = c2 ? a / c2 : 1;
  let b_ = c2 ? b / c2 : 1;
  let [S_max, T] = get_ST_max(a_, b_);
  let S_0 = 0.5;
  let k4 = 1 - S_0 / S_max;
  let t = T / (c2 + l * T);
  let L_v = t * l;
  let C_v = t * c2;
  let L_vt = toe_inv(L_v);
  let C_vt = C_v * L_vt / L_v;
  let rgb_scale = convertOklabToLrgb_default({ l: L_vt, a: a_ * C_vt, b: b_ * C_vt });
  let scale_L = Math.cbrt(
    1 / Math.max(rgb_scale.r, rgb_scale.g, rgb_scale.b, 0)
  );
  l = l / scale_L;
  c2 = c2 / scale_L * toe(l) / l;
  l = toe(l);
  const ret = {
    mode: "okhsv",
    s: c2 ? (S_0 + T) * C_v / (T * S_0 + T * k4 * C_v) : 0,
    v: l ? l / L_v : 0
  };
  if (ret.s) {
    ret.h = normalizeHue_default(Math.atan2(b, a) * 180 / Math.PI);
  }
  if (lab2.alpha !== void 0) {
    ret.alpha = lab2.alpha;
  }
  return ret;
}

// node_modules/culori/src/okhsv/convertOkhsvToOklab.js
function convertOkhsvToOklab(hsv2) {
  const ret = { mode: "oklab" };
  if (hsv2.alpha !== void 0) {
    ret.alpha = hsv2.alpha;
  }
  const h = hsv2.h !== void 0 ? hsv2.h : 0;
  const s = hsv2.s !== void 0 ? hsv2.s : 0;
  const v = hsv2.v !== void 0 ? hsv2.v : 0;
  const a_ = Math.cos(h / 180 * Math.PI);
  const b_ = Math.sin(h / 180 * Math.PI);
  const [S_max, T] = get_ST_max(a_, b_);
  const S_0 = 0.5;
  const k4 = 1 - S_0 / S_max;
  const L_v = 1 - s * S_0 / (S_0 + T - T * k4 * s);
  const C_v = s * T * S_0 / (S_0 + T - T * k4 * s);
  const L_vt = toe_inv(L_v);
  const C_vt = C_v * L_vt / L_v;
  const rgb_scale = convertOklabToLrgb_default({
    l: L_vt,
    a: a_ * C_vt,
    b: b_ * C_vt
  });
  const scale_L = Math.cbrt(
    1 / Math.max(rgb_scale.r, rgb_scale.g, rgb_scale.b, 0)
  );
  const L_new = toe_inv(v * L_v);
  const C = C_v * L_new / L_v;
  ret.l = L_new * scale_L;
  ret.a = C * a_ * scale_L;
  ret.b = C * b_ * scale_L;
  return ret;
}

// node_modules/culori/src/okhsv/modeOkhsv.js
var modeOkhsv = {
  ...definition_default8,
  mode: "okhsv",
  channels: ["h", "s", "v", "alpha"],
  parse: ["--okhsv"],
  serialize: "--okhsv",
  fromMode: {
    oklab: convertOklabToOkhsv,
    rgb: (c2) => convertOklabToOkhsv(convertRgbToOklab_default(c2))
  },
  toMode: {
    oklab: convertOkhsvToOklab,
    rgb: (c2) => convertOklabToRgb_default(convertOkhsvToOklab(c2))
  }
};
var modeOkhsv_default = modeOkhsv;

// node_modules/culori/src/oklab/parseOklab.js
function parseOklab(color, parsed) {
  if (!parsed || parsed[0] !== "oklab") {
    return void 0;
  }
  const res = { mode: "oklab" };
  const [, l, a, b, alpha] = parsed;
  if (l.type === Tok.Hue || a.type === Tok.Hue || b.type === Tok.Hue) {
    return void 0;
  }
  if (l.type !== Tok.None) {
    res.l = Math.min(
      Math.max(0, l.type === Tok.Number ? l.value : l.value / 100),
      1
    );
  }
  if (a.type !== Tok.None) {
    res.a = a.type === Tok.Number ? a.value : a.value * 0.4 / 100;
  }
  if (b.type !== Tok.None) {
    res.b = b.type === Tok.Number ? b.value : b.value * 0.4 / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseOklab_default = parseOklab;

// node_modules/culori/src/oklab/definition.js
var definition20 = {
  ...definition_default13,
  mode: "oklab",
  toMode: {
    lrgb: convertOklabToLrgb_default,
    rgb: convertOklabToRgb_default
  },
  fromMode: {
    lrgb: convertLrgbToOklab_default,
    rgb: convertRgbToOklab_default
  },
  ranges: {
    l: [0, 1],
    a: [-0.4, 0.4],
    b: [-0.4, 0.4]
  },
  parse: [parseOklab_default],
  serialize: (c2) => `oklab(${c2.l !== void 0 ? c2.l : "none"} ${c2.a !== void 0 ? c2.a : "none"} ${c2.b !== void 0 ? c2.b : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`
};
var definition_default20 = definition20;

// node_modules/culori/src/oklch/parseOklch.js
function parseOklch(color, parsed) {
  if (!parsed || parsed[0] !== "oklch") {
    return void 0;
  }
  const res = { mode: "oklch" };
  const [, l, c2, h, alpha] = parsed;
  if (l.type !== Tok.None) {
    if (l.type === Tok.Hue) {
      return void 0;
    }
    res.l = Math.min(
      Math.max(0, l.type === Tok.Number ? l.value : l.value / 100),
      1
    );
  }
  if (c2.type !== Tok.None) {
    res.c = Math.max(
      0,
      c2.type === Tok.Number ? c2.value : c2.value * 0.4 / 100
    );
  }
  if (h.type !== Tok.None) {
    if (h.type === Tok.Percentage) {
      return void 0;
    }
    res.h = h.value;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseOklch_default = parseOklch;

// node_modules/culori/src/oklch/definition.js
var definition21 = {
  ...definition_default15,
  mode: "oklch",
  toMode: {
    oklab: (c2) => convertLchToLab_default(c2, "oklab"),
    rgb: (c2) => convertOklabToRgb_default(convertLchToLab_default(c2, "oklab"))
  },
  fromMode: {
    rgb: (c2) => convertLabToLch_default(convertRgbToOklab_default(c2), "oklch"),
    oklab: (c2) => convertLabToLch_default(c2, "oklch")
  },
  parse: [parseOklch_default],
  serialize: (c2) => `oklch(${c2.l !== void 0 ? c2.l : "none"} ${c2.c !== void 0 ? c2.c : "none"} ${c2.h !== void 0 ? c2.h : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  ranges: {
    l: [0, 1],
    c: [0, 0.4],
    h: [0, 360]
  }
};
var definition_default21 = definition21;

// node_modules/culori/src/p3/convertP3ToXyz65.js
var convertP3ToXyz65 = (rgb2) => {
  let { r, g, b, alpha } = convertRgbToLrgb_default(rgb2);
  let res = {
    mode: "xyz65",
    x: 0.486570948648216 * r + 0.265667693169093 * g + 0.1982172852343625 * b,
    y: 0.2289745640697487 * r + 0.6917385218365062 * g + 0.079286914093745 * b,
    z: 0 * r + 0.0451133818589026 * g + 1.043944368900976 * b
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertP3ToXyz65_default = convertP3ToXyz65;

// node_modules/culori/src/p3/convertXyz65ToP3.js
var convertXyz65ToP3 = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = convertLrgbToRgb_default(
    {
      r: x * 2.4934969119414263 - y * 0.9313836179191242 - 0.402710784450717 * z,
      g: x * -0.8294889695615749 + y * 1.7626640603183465 + 0.0236246858419436 * z,
      b: x * 0.0358458302437845 - y * 0.0761723892680418 + 0.9568845240076871 * z
    },
    "p3"
  );
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToP3_default = convertXyz65ToP3;

// node_modules/culori/src/p3/definition.js
var definition22 = {
  ...definition_default,
  mode: "p3",
  parse: ["display-p3"],
  serialize: "display-p3",
  fromMode: {
    rgb: (color) => convertXyz65ToP3_default(convertRgbToXyz65_default(color)),
    xyz65: convertXyz65ToP3_default
  },
  toMode: {
    rgb: (color) => convertXyz65ToRgb_default(convertP3ToXyz65_default(color)),
    xyz65: convertP3ToXyz65_default
  }
};
var definition_default22 = definition22;

// node_modules/culori/src/prophoto/convertXyz50ToProphoto.js
var gamma2 = (v) => {
  let abs2 = Math.abs(v);
  if (abs2 >= 1 / 512) {
    return Math.sign(v) * Math.pow(abs2, 1 / 1.8);
  }
  return 16 * v;
};
var convertXyz50ToProphoto = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "prophoto",
    r: gamma2(
      x * 1.3457868816471585 - y * 0.2555720873797946 - 0.0511018649755453 * z
    ),
    g: gamma2(
      x * -0.5446307051249019 + y * 1.5082477428451466 + 0.0205274474364214 * z
    ),
    b: gamma2(x * 0 + y * 0 + 1.2119675456389452 * z)
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToProphoto_default = convertXyz50ToProphoto;

// node_modules/culori/src/prophoto/convertProphotoToXyz50.js
var linearize2 = (v = 0) => {
  let abs2 = Math.abs(v);
  if (abs2 >= 16 / 512) {
    return Math.sign(v) * Math.pow(abs2, 1.8);
  }
  return v / 16;
};
var convertProphotoToXyz50 = (prophoto2) => {
  let r = linearize2(prophoto2.r);
  let g = linearize2(prophoto2.g);
  let b = linearize2(prophoto2.b);
  let res = {
    mode: "xyz50",
    x: 0.7977666449006423 * r + 0.1351812974005331 * g + 0.0313477341283922 * b,
    y: 0.2880748288194013 * r + 0.7118352342418731 * g + 899369387256e-16 * b,
    z: 0 * r + 0 * g + 0.8251046025104602 * b
  };
  if (prophoto2.alpha !== void 0) {
    res.alpha = prophoto2.alpha;
  }
  return res;
};
var convertProphotoToXyz50_default = convertProphotoToXyz50;

// node_modules/culori/src/prophoto/definition.js
var definition23 = {
  ...definition_default,
  mode: "prophoto",
  parse: ["prophoto-rgb"],
  serialize: "prophoto-rgb",
  fromMode: {
    xyz50: convertXyz50ToProphoto_default,
    rgb: (color) => convertXyz50ToProphoto_default(convertRgbToXyz50_default(color))
  },
  toMode: {
    xyz50: convertProphotoToXyz50_default,
    rgb: (color) => convertXyz50ToRgb_default(convertProphotoToXyz50_default(color))
  }
};
var definition_default23 = definition23;

// node_modules/culori/src/rec2020/convertXyz65ToRec2020.js
var \u03B1 = 1.09929682680944;
var \u03B2 = 0.018053968510807;
var gamma3 = (v) => {
  const abs2 = Math.abs(v);
  if (abs2 > \u03B2) {
    return (Math.sign(v) || 1) * (\u03B1 * Math.pow(abs2, 0.45) - (\u03B1 - 1));
  }
  return 4.5 * v;
};
var convertXyz65ToRec2020 = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "rec2020",
    r: gamma3(
      x * 1.7166511879712683 - y * 0.3556707837763925 - 0.2533662813736599 * z
    ),
    g: gamma3(
      x * -0.6666843518324893 + y * 1.6164812366349395 + 0.0157685458139111 * z
    ),
    b: gamma3(
      x * 0.0176398574453108 - y * 0.0427706132578085 + 0.9421031212354739 * z
    )
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToRec2020_default = convertXyz65ToRec2020;

// node_modules/culori/src/rec2020/convertRec2020ToXyz65.js
var \u03B12 = 1.09929682680944;
var \u03B22 = 0.018053968510807;
var linearize3 = (v = 0) => {
  let abs2 = Math.abs(v);
  if (abs2 < \u03B22 * 4.5) {
    return v / 4.5;
  }
  return (Math.sign(v) || 1) * Math.pow((abs2 + \u03B12 - 1) / \u03B12, 1 / 0.45);
};
var convertRec2020ToXyz65 = (rec20202) => {
  let r = linearize3(rec20202.r);
  let g = linearize3(rec20202.g);
  let b = linearize3(rec20202.b);
  let res = {
    mode: "xyz65",
    x: 0.6369580483012911 * r + 0.1446169035862083 * g + 0.1688809751641721 * b,
    y: 0.262700212011267 * r + 0.6779980715188708 * g + 0.059301716469862 * b,
    z: 0 * r + 0.0280726930490874 * g + 1.0609850577107909 * b
  };
  if (rec20202.alpha !== void 0) {
    res.alpha = rec20202.alpha;
  }
  return res;
};
var convertRec2020ToXyz65_default = convertRec2020ToXyz65;

// node_modules/culori/src/rec2020/definition.js
var definition24 = {
  ...definition_default,
  mode: "rec2020",
  fromMode: {
    xyz65: convertXyz65ToRec2020_default,
    rgb: (color) => convertXyz65ToRec2020_default(convertRgbToXyz65_default(color))
  },
  toMode: {
    xyz65: convertRec2020ToXyz65_default,
    rgb: (color) => convertXyz65ToRgb_default(convertRec2020ToXyz65_default(color))
  },
  parse: ["rec2020"],
  serialize: "rec2020"
};
var definition_default24 = definition24;

// node_modules/culori/src/xyb/constants.js
var bias = 0.0037930732552754493;
var bias_cbrt = Math.cbrt(bias);

// node_modules/culori/src/xyb/convertRgbToXyb.js
var transfer = (v) => Math.cbrt(v) - bias_cbrt;
var convertRgbToXyb = (color) => {
  const { r, g, b, alpha } = convertRgbToLrgb_default(color);
  const l = transfer(0.3 * r + 0.622 * g + 0.078 * b + bias);
  const m = transfer(0.23 * r + 0.692 * g + 0.078 * b + bias);
  const s = transfer(
    0.2434226892454782 * r + 0.2047674442449682 * g + 0.5518098665095535 * b + bias
  );
  const res = {
    mode: "xyb",
    x: (l - m) / 2,
    y: (l + m) / 2,
    /* Apply default chroma from luma (subtract Y from B) */
    b: s - (l + m) / 2
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertRgbToXyb_default = convertRgbToXyb;

// node_modules/culori/src/xyb/convertXybToRgb.js
var transfer2 = (v) => Math.pow(v + bias_cbrt, 3);
var convertXybToRgb = ({ x, y, b, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (b === void 0) b = 0;
  const l = transfer2(x + y) - bias;
  const m = transfer2(y - x) - bias;
  const s = transfer2(b + y) - bias;
  const res = convertLrgbToRgb_default({
    r: 11.031566904639861 * l - 9.866943908131562 * m - 0.16462299650829934 * s,
    g: -3.2541473810744237 * l + 4.418770377582723 * m - 0.16462299650829934 * s,
    b: -3.6588512867136815 * l + 2.7129230459360922 * m + 1.9459282407775895 * s
  });
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertXybToRgb_default = convertXybToRgb;

// node_modules/culori/src/xyb/definition.js
var definition25 = {
  mode: "xyb",
  channels: ["x", "y", "b", "alpha"],
  parse: ["--xyb"],
  serialize: "--xyb",
  toMode: {
    rgb: convertXybToRgb_default
  },
  fromMode: {
    rgb: convertRgbToXyb_default
  },
  ranges: {
    x: [-0.0154, 0.0281],
    y: [0, 0.8453],
    b: [-0.2778, 0.388]
  },
  interpolate: {
    x: interpolatorLinear,
    y: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default25 = definition25;

// node_modules/culori/src/xyz50/definition.js
var definition26 = {
  mode: "xyz50",
  parse: ["xyz-d50"],
  serialize: "xyz-d50",
  toMode: {
    rgb: convertXyz50ToRgb_default,
    lab: convertXyz50ToLab_default
  },
  fromMode: {
    rgb: convertRgbToXyz50_default,
    lab: convertLabToXyz50_default
  },
  channels: ["x", "y", "z", "alpha"],
  ranges: {
    x: [0, 0.964],
    y: [0, 0.999],
    z: [0, 0.825]
  },
  interpolate: {
    x: interpolatorLinear,
    y: interpolatorLinear,
    z: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default26 = definition26;

// node_modules/culori/src/xyz65/convertXyz65ToXyz50.js
var convertXyz65ToXyz50 = (xyz652) => {
  let { x, y, z, alpha } = xyz652;
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "xyz50",
    x: 1.0479298208405488 * x + 0.0229467933410191 * y - 0.0501922295431356 * z,
    y: 0.0296278156881593 * x + 0.990434484573249 * y - 0.0170738250293851 * z,
    z: -0.0092430581525912 * x + 0.0150551448965779 * y + 0.7518742899580008 * z
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToXyz50_default = convertXyz65ToXyz50;

// node_modules/culori/src/xyz65/convertXyz50ToXyz65.js
var convertXyz50ToXyz65 = (xyz502) => {
  let { x, y, z, alpha } = xyz502;
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "xyz65",
    x: 0.9554734527042182 * x - 0.0230985368742614 * y + 0.0632593086610217 * z,
    y: -0.0283697069632081 * x + 1.0099954580058226 * y + 0.021041398966943 * z,
    z: 0.0123140016883199 * x - 0.0205076964334779 * y + 1.3303659366080753 * z
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToXyz65_default = convertXyz50ToXyz65;

// node_modules/culori/src/xyz65/definition.js
var definition27 = {
  mode: "xyz65",
  toMode: {
    rgb: convertXyz65ToRgb_default,
    xyz50: convertXyz65ToXyz50_default
  },
  fromMode: {
    rgb: convertRgbToXyz65_default,
    xyz50: convertXyz50ToXyz65_default
  },
  ranges: {
    x: [0, 0.95],
    y: [0, 1],
    z: [0, 1.088]
  },
  channels: ["x", "y", "z", "alpha"],
  parse: ["xyz", "xyz-d65"],
  serialize: "xyz-d65",
  interpolate: {
    x: interpolatorLinear,
    y: interpolatorLinear,
    z: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default27 = definition27;

// node_modules/culori/src/yiq/convertRgbToYiq.js
var convertRgbToYiq = ({ r, g, b, alpha }) => {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  const res = {
    mode: "yiq",
    y: 0.29889531 * r + 0.58662247 * g + 0.11448223 * b,
    i: 0.59597799 * r - 0.2741761 * g - 0.32180189 * b,
    q: 0.21147017 * r - 0.52261711 * g + 0.31114694 * b
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertRgbToYiq_default = convertRgbToYiq;

// node_modules/culori/src/yiq/convertYiqToRgb.js
var convertYiqToRgb = ({ y, i, q, alpha }) => {
  if (y === void 0) y = 0;
  if (i === void 0) i = 0;
  if (q === void 0) q = 0;
  const res = {
    mode: "rgb",
    r: y + 0.95608445 * i + 0.6208885 * q,
    g: y - 0.27137664 * i - 0.6486059 * q,
    b: y - 1.10561724 * i + 1.70250126 * q
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertYiqToRgb_default = convertYiqToRgb;

// node_modules/culori/src/yiq/definition.js
var definition28 = {
  mode: "yiq",
  toMode: {
    rgb: convertYiqToRgb_default
  },
  fromMode: {
    rgb: convertRgbToYiq_default
  },
  channels: ["y", "i", "q", "alpha"],
  parse: ["--yiq"],
  serialize: "--yiq",
  ranges: {
    i: [-0.595, 0.595],
    q: [-0.522, 0.522]
  },
  interpolate: {
    y: interpolatorLinear,
    i: interpolatorLinear,
    q: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default28 = definition28;

// node_modules/culori/src/index.js
var a98 = useMode(definition_default2);
var cubehelix = useMode(definition_default3);
var dlab = useMode(definition_default4);
var dlch = useMode(definition_default5);
var hsi = useMode(definition_default6);
var hsl = useMode(definition_default7);
var hsv = useMode(definition_default8);
var hwb = useMode(definition_default9);
var itp = useMode(definition_default10);
var jab = useMode(definition_default11);
var jch = useMode(definition_default12);
var lab = useMode(definition_default13);
var lab65 = useMode(definition_default14);
var lch = useMode(definition_default15);
var lch65 = useMode(definition_default16);
var lchuv = useMode(definition_default17);
var lrgb = useMode(definition_default18);
var luv = useMode(definition_default19);
var okhsl = useMode(modeOkhsl_default);
var okhsv = useMode(modeOkhsv_default);
var oklab = useMode(definition_default20);
var oklch = useMode(definition_default21);
var p3 = useMode(definition_default22);
var prophoto = useMode(definition_default23);
var rec2020 = useMode(definition_default24);
var rgb = useMode(definition_default);
var xyb = useMode(definition_default25);
var xyz50 = useMode(definition_default26);
var xyz65 = useMode(definition_default27);
var yiq = useMode(definition_default28);

// src/perception/color.ts
var toLab = converter_default("lab65");
var ciede = differenceCiede2000();
function culoriRgb([r, g, b]) {
  return { mode: "rgb", r: r / 255, g: g / 255, b: b / 255 };
}
function ciede2000(a, b) {
  return ciede(toLab(culoriRgb(a)), toLab(culoriRgb(b)));
}
var DEFAULT_CLASSIFY = { temp: 6, farMid: 26, farScale: 5 };
function classifySoft(sample, centers, opts = DEFAULT_CLASSIFY) {
  const faces = ["U", "R", "F", "D", "L", "B"];
  const dist2 = faces.map((f3) => ciede2000(sample, centers[f3]));
  const minD = Math.min(...dist2);
  const unknownMass = 1 / (1 + Math.exp(-(minD - opts.farMid) / opts.farScale));
  const weights = dist2.map((d) => Math.exp(-d / opts.temp));
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const soft = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0, unknown: unknownMass };
  faces.forEach((f3, i) => {
    soft[f3] = weights[i] / wSum * (1 - unknownMass);
  });
  return normalizeSoft(soft);
}
var CANONICAL_CENTERS = {
  U: [245, 245, 245],
  R: [200, 30, 30],
  F: [0, 150, 70],
  D: [255, 215, 0],
  L: [255, 120, 0],
  B: [0, 80, 200]
};

// src/perception/palette.ts
function clone(c2) {
  return { U: [...c2.U], R: [...c2.R], F: [...c2.F], D: [...c2.D], L: [...c2.L], B: [...c2.B] };
}
function staticPalette(centers = CANONICAL_CENTERS) {
  const c2 = clone(centers);
  return { get: () => c2 };
}
function nearestLabel(rgb2, centers) {
  let best = "U";
  let bestD = Number.POSITIVE_INFINITY;
  for (const f3 of FACES) {
    const d = ciede2000(rgb2, centers[f3]);
    if (d < bestD) {
      bestD = d;
      best = f3;
    }
  }
  return best;
}
function rollingPalette(alpha = 0.1) {
  const p4 = clone(CANONICAL_CENTERS);
  return {
    get: () => p4,
    observe(rgb2) {
      const f3 = nearestLabel(rgb2, p4);
      const cur = p4[f3];
      p4[f3] = [
        cur[0] + alpha * (rgb2[0] - cur[0]),
        cur[1] + alpha * (rgb2[1] - cur[1]),
        cur[2] + alpha * (rgb2[2] - cur[2])
      ];
    }
  };
}

// src/perception/localize.ts
function computeHomography(quad) {
  const [p0, p1, p22, p32] = quad;
  const dx1 = p1.x - p22.x;
  const dx2 = p32.x - p22.x;
  const dx3 = p0.x - p1.x + p22.x - p32.x;
  const dy1 = p1.y - p22.y;
  const dy2 = p32.y - p22.y;
  const dy3 = p0.y - p1.y + p22.y - p32.y;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return {
      a: p1.x - p0.x,
      b: p32.x - p0.x,
      c: p0.x,
      d: p1.y - p0.y,
      e: p32.y - p0.y,
      f: p0.y,
      g: 0,
      h: 0
    };
  }
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-9) {
    return {
      a: p1.x - p0.x,
      b: p32.x - p0.x,
      c: p0.x,
      d: p1.y - p0.y,
      e: p32.y - p0.y,
      f: p0.y,
      g: 0,
      h: 0
    };
  }
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return {
    a: p1.x - p0.x + g * p1.x,
    b: p32.x - p0.x + h * p32.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p32.y - p0.y + h * p32.y,
    f: p0.y,
    g,
    h
  };
}
function project(m, u, v) {
  const w = m.g * u + m.h * v + 1;
  return { x: (m.a * u + m.b * v + m.c) / w, y: (m.d * u + m.e * v + m.f) / w };
}
var RING_RADIUS = 0.08;
var RING_N = 8;
function sampleQuad(frame, quad) {
  const m = computeHomography(quad);
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const out = [];
  for (let r = 0; r < 3; r++)
    for (let c2 = 0; c2 < 3; c2++) {
      const uc = (c2 + 0.5) / 3;
      const vc = (r + 0.5) / 3;
      const rs = [];
      const gs = [];
      const bs = [];
      for (let k4 = 0; k4 < RING_N; k4++) {
        const ang = k4 / RING_N * 2 * Math.PI;
        const p4 = project(m, uc + RING_RADIUS * Math.cos(ang), vc + RING_RADIUS * Math.sin(ang));
        const px = Math.round(p4.x);
        const py = Math.round(p4.y);
        if (px < 0 || px >= frame.width || py < 0 || py >= frame.height) continue;
        const i = (py * frame.width + px) * 4;
        rs.push(frame.data[i]);
        gs.push(frame.data[i + 1]);
        bs.push(frame.data[i + 2]);
      }
      out.push(rs.length < RING_N / 2 ? null : [med(rs), med(gs), med(bs)]);
    }
  return out;
}
function classifyCells(cells, centers = CANONICAL_CENTERS) {
  return cells.map((rgb2) => rgb2 === null ? unknownSoft() : classifySoft(rgb2, centers));
}
function createLocalizer(detector = nullDetector(), palette = staticPalette()) {
  return {
    detect(frame) {
      const { faces, alignedGeometry } = detector.detect(frame);
      const centers = palette.get();
      const cells = [];
      const detectedCenters = [];
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const face of faces) {
        const sampled = sampleQuad(frame, face.quad);
        if (sampled.every((s) => s === null)) continue;
        const centerRgb = sampled[4];
        if (centerRgb) {
          palette.observe?.(centerRgb);
          detectedCenters.push({ slot: face.slot, rgb: centerRgb });
        }
        const soft = classifyCells(sampled, centers);
        const idx = faceIndices(face.slot);
        soft.forEach((s, k4) => cells.push({ slot: idx[k4], soft: s }));
        for (const p4 of face.quad) {
          minX = Math.min(minX, p4.x);
          minY = Math.min(minY, p4.y);
          maxX = Math.max(maxX, p4.x);
          maxY = Math.max(maxY, p4.y);
        }
      }
      if (cells.length === 0) return { cells, alignedGeometry, centers: detectedCenters };
      const x = Math.max(0, minX);
      const y = Math.max(0, minY);
      const roi = {
        x,
        y,
        w: Math.max(0, Math.min(frame.width, maxX) - x),
        h: Math.max(0, Math.min(frame.height, maxY) - y)
      };
      return { cells, alignedGeometry, roi, centers: detectedCenters };
    }
  };
}
function nullDetector() {
  return { detect: (_frame) => ({ faces: [], alignedGeometry: false }) };
}

// src/perception/geometry.ts
function orderCorners(pts) {
  if (pts.length !== 4) throw new Error(`orderCorners: expected 4 points, got ${pts.length}`);
  let tl = pts[0];
  let br = pts[0];
  let tr = pts[0];
  let bl = pts[0];
  for (const p4 of pts) {
    if (p4.x + p4.y < tl.x + tl.y) tl = p4;
    if (p4.x + p4.y > br.x + br.y) br = p4;
    if (p4.x - p4.y > tr.x - tr.y) tr = p4;
    if (p4.x - p4.y < bl.x - bl.y) bl = p4;
  }
  return [tl, tr, br, bl];
}
function centroid(pts) {
  let x = 0;
  let y = 0;
  for (const p4 of pts) {
    x += p4.x;
    y += p4.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}
function assignSlots(centroids) {
  const n = centroids.length;
  if (n === 0) return [];
  if (n === 1) return ["F"];
  const out = new Array(n);
  let top = 0;
  for (let i = 1; i < n; i++) if (centroids[i].y < centroids[top].y) top = i;
  out[top] = "U";
  const rest = [];
  for (let i = 0; i < n; i++) if (i !== top) rest.push(i);
  if (n === 2) {
    out[rest[0]] = "F";
    return out;
  }
  const [a, b] = rest;
  if (centroids[a].x > centroids[b].x) {
    out[a] = "R";
    out[b] = "F";
  } else {
    out[a] = "F";
    out[b] = "R";
  }
  return out;
}

// src/perception/opencv-detector.ts
var DEFAULT_OPENCV = {
  minFaceAreaFrac: 0.01,
  cannyLow: 50,
  cannyHigh: 150,
  approxEps: 0.04,
  squarenessMin: 0.6
};
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function squareness(q) {
  const sides = [dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0])];
  const min = Math.min(...sides);
  const max = Math.max(...sides);
  return max === 0 ? 0 : min / max;
}
function opencvDetector(cv, opts = DEFAULT_OPENCV) {
  return {
    detect(frame) {
      const src = cv.matFromImageData({
        data: frame.data,
        width: frame.width,
        height: frame.height
      });
      const gray = new cv.Mat();
      const edges = new cv.Mat();
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      const minArea = opts.minFaceAreaFrac * frame.width * frame.height;
      const candidates = [];
      try {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        cv.Canny(gray, edges, opts.cannyLow, opts.cannyHigh);
        cv.dilate(edges, edges, cv.Mat.ones(3, 3, cv.CV_8U));
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < contours.size(); i++) {
          const c2 = contours.get(i);
          const peri = cv.arcLength(c2, true);
          const approx = new cv.Mat();
          cv.approxPolyDP(c2, approx, opts.approxEps * peri, true);
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const area = cv.contourArea(approx);
            if (area >= minArea) {
              const corners = [];
              for (let k4 = 0; k4 < 4; k4++)
                corners.push({ x: approx.data32S[k4 * 2], y: approx.data32S[k4 * 2 + 1] });
              candidates.push({ corners, area, sq: squareness(corners) });
            }
          }
          approx.delete();
          c2.delete();
        }
      } finally {
        src.delete();
        gray.delete();
        edges.delete();
        contours.delete();
        hierarchy.delete();
      }
      candidates.sort((a, b) => b.area - a.area);
      const kept = [];
      for (const cand of candidates) {
        const cc = centroid(cand.corners);
        const near = kept.some((k4) => dist(centroid(k4.corners), cc) < 0.5 * Math.sqrt(cand.area));
        if (!near) kept.push(cand);
        if (kept.length === 3) break;
      }
      const slots = assignSlots(kept.map((k4) => centroid(k4.corners)));
      const faces = kept.map((k4, i) => ({
        slot: slots[i],
        quad: orderCorners(k4.corners)
      }));
      const alignedGeometry = faces.length > 0 && kept.every((k4) => k4.sq >= opts.squarenessMin);
      return { faces, alignedGeometry };
    }
  };
}

// view/tracker-panel.ts
var FACES2 = ["U", "R", "F", "D", "L", "B"];
var css = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
var TrackerPanel = class extends HTMLElement {
  stage = document.createElement("div");
  video = document.createElement("video");
  guide = document.createElement("div");
  hint = document.createElement("div");
  picker = document.createElement("select");
  statusEl = document.createElement("div");
  scanBtn = document.createElement("button");
  retryBtn = document.createElement("button");
  debugToggle = document.createElement("button");
  debugWrap = document.createElement("div");
  paletteEl = document.createElement("div");
  debugEl = document.createElement("pre");
  cam = null;
  live = null;
  cameraOn = false;
  seedFacelets = null;
  palette = rollingPalette();
  deviceId;
  debugOn = false;
  lastLog = 0;
  loopGen = 0;
  _cv = null;
  // The injected OpenCV.js module (set by the app once its WASM runtime is ready).
  set cv(m) {
    this._cv = m;
    this.tryStartTracking();
    this.render();
  }
  get cv() {
    return this._cv;
  }
  connectedCallback() {
    this.style.display = "block";
    this.stage.style.cssText = "position:relative;width:100%;border-radius:10px;overflow:hidden;background:#000;aspect-ratio:4/3";
    this.video.setAttribute("playsinline", "true");
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
    this.guide.style.cssText = "position:absolute;inset:0;margin:auto;width:58%;aspect-ratio:1;border:3px dashed rgba(255,255,255,.75);border-radius:14px;pointer-events:none";
    this.hint.textContent = "Hold your cube in the box \u2014 show 3 sides (top, right, front)";
    this.hint.style.cssText = "position:absolute;left:0;right:0;bottom:8px;text-align:center;font-size:12px;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none";
    this.stage.append(this.video, this.guide, this.hint);
    this.picker.style.cssText = "margin-top:8px;width:100%;padding:6px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px";
    this.picker.onchange = () => void this.changeCamera(this.picker.value);
    this.picker.style.display = "none";
    this.statusEl.style.cssText = "margin-top:10px;font-size:14px;font-weight:600;color:#e6edf3;min-height:20px";
    this.scanBtn.textContent = "Scan your cube first";
    this.scanBtn.style.cssText = "margin-top:8px;padding:8px 16px;border:0;border-radius:8px;background:#58a6ff;color:#06122b;font-weight:600;cursor:pointer";
    this.scanBtn.onclick = () => this.dispatchEvent(new CustomEvent("request-scan"));
    this.scanBtn.hidden = true;
    this.retryBtn.textContent = "Start camera";
    this.retryBtn.style.cssText = "margin-top:8px;padding:8px 16px;border:1px solid #30363d;border-radius:8px;background:#21262d;color:#e6edf3;cursor:pointer";
    this.retryBtn.onclick = () => void this.startCamera();
    this.retryBtn.hidden = true;
    this.debugToggle.textContent = "Show debug";
    this.debugToggle.style.cssText = "margin-top:12px;padding:0;border:0;background:none;color:#6e7681;font-size:11px;text-decoration:underline;cursor:pointer";
    this.debugToggle.onclick = () => {
      this.debugOn = !this.debugOn;
      this.debugToggle.textContent = this.debugOn ? "Hide debug" : "Show debug";
      this.debugWrap.hidden = !this.debugOn;
    };
    this.paletteEl.style.cssText = "display:flex;gap:4px;margin-top:8px;align-items:center";
    this.debugEl.style.cssText = "margin-top:6px;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#8b949e;white-space:pre-wrap;word-break:break-all";
    this.debugWrap.append(this.paletteEl, this.debugEl);
    this.debugWrap.hidden = true;
    this.append(
      this.stage,
      this.picker,
      this.statusEl,
      this.scanBtn,
      this.retryBtn,
      this.debugToggle,
      this.debugWrap
    );
    this.render();
    void this.refreshCameras();
  }
  /** Provide the start state (from a scan or the smart cube); tracking begins once cv is ready too. */
  provideSeed(facelets) {
    this.seedFacelets = facelets || null;
    this.tryStartTracking();
    this.render();
  }
  async refreshCameras() {
    let cams = [];
    try {
      cams = await listCameras();
    } catch {
    }
    this.picker.textContent = "";
    for (const c2 of cams) {
      const o = document.createElement("option");
      o.value = c2.deviceId;
      o.textContent = c2.label;
      if (c2.deviceId === this.deviceId) o.selected = true;
      this.picker.append(o);
    }
    this.picker.style.display = cams.length > 1 && this.cameraOn ? "block" : "none";
  }
  async changeCamera(deviceId) {
    if ((deviceId || void 0) === this.deviceId) return;
    this.deviceId = deviceId || void 0;
    if (this.cameraOn) this.teardownCamera();
    await this.startCamera();
  }
  /** Stop the current stream and kill its frame loop, without clearing the tracker. */
  teardownCamera() {
    this.loopGen++;
    this.cameraOn = false;
    this.cam?.stop();
    this.cam = null;
  }
  /** Open the camera and show the live feed — independent of the seed / OpenCV. */
  async startCamera() {
    if (this.cameraOn && this.cam) return;
    this.statusEl.textContent = "Opening camera\u2026";
    const gen = ++this.loopGen;
    let cam;
    try {
      cam = await openCamera(this.video, this.deviceId);
    } catch (e4) {
      this.statusEl.textContent = `Camera error: ${e4.message || e4}`;
      this.retryBtn.hidden = false;
      return;
    }
    if (gen !== this.loopGen) {
      cam.stop();
      return;
    }
    this.cam = cam;
    this.cameraOn = true;
    void this.refreshCameras();
    this.tryStartTracking();
    this.render();
    this.tick(gen);
  }
  tryStartTracking() {
    if (this.live || !this.cameraOn) return;
    if (this._cv?.Mat && this.seedFacelets) {
      const state = decodeFacelets(this.seedFacelets);
      if (state) {
        this.live = new LiveTracker(createLocalizer(opencvDetector(this._cv), this.palette));
        this.live.seed(state);
      }
    }
  }
  /** Show/hide the contextual controls and set the plain-language status line. */
  render() {
    const cvReady = !!this._cv?.Mat;
    const seeded = !!this.seedFacelets;
    this.retryBtn.hidden = this.cameraOn;
    this.scanBtn.hidden = !(this.cameraOn && cvReady && !seeded);
    this.guide.style.display = this.cameraOn ? "block" : "none";
    this.hint.style.display = this.cameraOn && this.live ? "block" : "none";
    let text;
    let tone = "#e6edf3";
    if (!this.cameraOn) text = "Camera off";
    else if (!cvReady) text = "Warming up the detector\u2026";
    else if (!seeded) text = "To track your cube, its starting colors must be known.";
    else {
      const d = this.live?.lastDebug();
      if (!d) text = "Point your cube at the box\u2026";
      else if (d.status === "tracking") {
        text = "Tracking your cube \u2713";
        tone = "#3fb950";
      } else if (d.facesDetected === 0)
        text = "Searching \u2014 hold the cube in the box, showing 3 sides";
      else if (d.status === "lost") {
        text = "Lost the cube \u2014 show it to the camera again";
        tone = "#d29922";
      } else text = "Cube found \u2014 hold steady";
    }
    this.statusEl.textContent = text;
    this.statusEl.style.color = tone;
  }
  tick = (gen) => {
    if (gen !== this.loopGen || !this.cameraOn || !this.cam) return;
    const frame = this.cam.grab();
    if (frame) {
      if (this.live) {
        const u = this.live.pushFrame(frame, performance.now());
        if (u.kind === "move" || u.kind === "resync") {
          const st = this.live.state();
          if (st) {
            this.dispatchEvent(
              new CustomEvent("state-update", { detail: { facelets: encodeFacelets(st) } })
            );
          }
        }
        this.render();
        if (this.debugOn) this.renderDebug(this.live.lastDebug());
      } else {
        this.tryStartTracking();
        this.render();
      }
    }
    const next = () => this.tick(gen);
    const v = this.video;
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  };
  renderDebug(d) {
    const p4 = this.palette.get();
    this.paletteEl.textContent = "palette:";
    for (const f3 of FACES2) {
      const sw = document.createElement("span");
      const [r, g, b] = p4[f3];
      sw.title = `${f3} ${css(r, g, b)}`;
      sw.style.cssText = `width:16px;height:16px;border-radius:3px;border:1px solid rgba(0,0,0,.4);background:${css(r, g, b)}`;
      this.paletteEl.append(sw);
    }
    if (!d) return;
    const centers = d.centers.map((c2) => `${c2.slot}=${css(c2.rgb[0], c2.rgb[1], c2.rgb[2])}`).join(" ");
    const line = `status=${d.status} last=${d.lastUpdate} faces=${d.facesDetected} cells=${d.cellsSeen} diff=${Number.isFinite(d.diff) ? d.diff.toFixed(1) : "\u221E"} stable=${d.stable} aligned=${d.alignedGeometry}
centers: ${centers || "(none \u2014 detector found no cube)"}`;
    this.debugEl.textContent = line;
    const now = performance.now();
    if (now - this.lastLog > 500) {
      this.lastLog = now;
      console.log("[tracker]", line.replace("\n", " | "));
    }
  }
  stop() {
    this.teardownCamera();
    this.live = null;
    this.render();
  }
};
if (!customElements.get("tracker-panel")) customElements.define("tracker-panel", TrackerPanel);
export {
  TrackerPanel
};
