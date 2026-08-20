// The belief core (the heart). A recursive discrete Bayes filter over the
// transition graph: from the last committed state the candidates are {stay} ∪ {18
// moves}, each legal by construction. Evidence accumulates across DISTINCT
// observations (idempotent on duplicates — §12/#5); a null/outlier hypothesis
// guards against off-model views (§12/#4); and a move is committed only on
// absolute fit + high posterior + viewpoint-diverse / multi-cell discrimination
// (§12/#4, #12), biased hard toward false-negatives.
//
// Orientation is carried but not branched here — that is orientation.ts (T2). This
// module is the state belief given a cube-coordinate view.

import {
  type CubeState,
  IDENTITY_ORIENTATION,
  MOVE_NAMES,
  type Move,
  type Orientation,
  applyMove,
  cloneState,
  encodeFacelets,
} from './cube.js';
import {
  type CubeView,
  discrimCells,
  meanCellLogLik,
  nullLogLik,
  scoreFacelets,
} from './likelihood.js';
import {
  DEFAULT_CONFIG,
  type Hypothesis,
  type TrackStatus,
  type TrackUpdate,
  type TrackerConfig,
} from './types.js';

const STAY = 'stay';
type CandKey = typeof STAY | Move;
const NULL_KEY = 'null';

function logSumExp(xs: number[]): number {
  const m = Math.max(...xs);
  if (!Number.isFinite(m)) return m;
  let s = 0;
  for (const x of xs) s += Math.exp(x - m);
  return m + Math.log(s);
}

interface Candidate {
  key: CandKey;
  move: Move | null;
  state: CubeState;
  facelets: string;
}

export class Belief {
  private committed: CubeState;
  private orientation: Orientation;
  private readonly cfg: TrackerConfig;

  // accumulators since the last commit, keyed by candidate
  private loglik = new Map<CandKey, number>();
  private nullLoglik = 0;
  private frames = new Map<CandKey, number>();
  private viewpoints = new Map<CandKey, Set<string>>();
  private maxDiscrim = new Map<CandKey, number>();
  private seen = new Set<string>();
  private status: TrackStatus = 'tracking';
  private confidence = 1;

  constructor(
    state: CubeState,
    orientation: Orientation = IDENTITY_ORIENTATION,
    cfg: TrackerConfig = DEFAULT_CONFIG,
  ) {
    this.committed = cloneState(state);
    this.orientation = orientation;
    this.cfg = cfg;
  }

  currentState(): CubeState {
    return cloneState(this.committed);
  }

  currentStatus(): TrackStatus {
    return this.status;
  }

  currentConfidence(): number {
    return this.confidence;
  }

  reset(state: CubeState, orientation: Orientation = this.orientation): void {
    this.committed = cloneState(state);
    this.orientation = orientation;
    this.clearAccumulators();
    this.status = 'tracking';
    this.confidence = 1;
  }

  /**
   * Start a fresh evidence window while keeping the committed state — called after a
   * motion episode so a move is not penalised by pre-move still frames (stale
   * accumulation across a state change).
   */
  newEpisode(): void {
    this.clearAccumulators();
  }

  private clearAccumulators(): void {
    this.loglik.clear();
    this.nullLoglik = 0;
    this.frames.clear();
    this.viewpoints.clear();
    this.maxDiscrim.clear();
    this.seen.clear();
  }

  private candidates(): Candidate[] {
    const list: Candidate[] = [
      { key: STAY, move: null, state: this.committed, facelets: encodeFacelets(this.committed) },
    ];
    for (const m of MOVE_NAMES) {
      const state = applyMove(this.committed, m);
      list.push({ key: m, move: m, state, facelets: encodeFacelets(state) });
    }
    return list;
  }

  private logPrior(key: CandKey): number {
    const p0 = this.cfg.noMovePrior;
    if (key === STAY) return Math.log(p0);
    // remaining mass split over 18 moves + the null hypothesis
    return Math.log(((1 - p0) * 0.95) / 18);
  }

  private logPriorNull(): number {
    return Math.log((1 - this.cfg.noMovePrior) * 0.05);
  }

  /**
   * Fold one observation (a cube-coordinate view) into the belief.
   * @param obsHash a content hash of the observation — duplicates are idempotent.
   * @param viewpointKey identifies the viewing pose, for diversity accounting.
   */
  update(view: CubeView, obsHash: string, viewpointKey: string): TrackUpdate {
    if (this.seen.has(obsHash)) {
      // Duplicate frame: no new evidence, no graph advance (§12/#5).
      return this.holdResult();
    }
    if (view.cells.length === 0) {
      this.status = 'lost';
      return { kind: 'lost' };
    }
    this.seen.add(obsHash);

    const cands = this.candidates();
    for (const c of cands) {
      const ll = scoreFacelets(c.facelets, view);
      this.loglik.set(c.key, (this.loglik.get(c.key) ?? 0) + ll);
      this.frames.set(c.key, (this.frames.get(c.key) ?? 0) + 1);
    }
    this.nullLoglik += nullLogLik(view);

    // posterior via softmax over {candidates, null}
    const keys = cands.map((c) => c.key);
    const logits = keys.map((k) => this.logPrior(k) + (this.loglik.get(k) ?? 0));
    const nullLogit = this.logPriorNull() + this.nullLoglik;
    const z = logSumExp([...logits, nullLogit]);
    const post = new Map<CandKey, number>();
    keys.forEach((k, i) => post.set(k, Math.exp(logits[i]! - z)));
    const nullPost = Math.exp(nullLogit - z);

    // leader among the real candidates
    let leader = cands[0]!;
    let leaderPost = post.get(STAY) ?? 0;
    for (const c of cands) {
      const p = post.get(c.key) ?? 0;
      if (p > leaderPost) {
        leaderPost = p;
        leader = c;
      }
    }
    this.confidence = Math.max(leaderPost, nullPost);

    // Off-model observation -> lost / recovery (§12/#4). Two independent signals:
    // (a) even the best-fitting candidate explains this frame poorly (the tell-tale
    // of a multi-move gap — the new state still partially matches the old one, so
    // the leader may be 'stay', but its ABSOLUTE fit is bad); (b) the null/outlier
    // hypothesis outright wins the posterior.
    const leaderFrameFit = meanCellLogLik(leader.facelets, view);
    if (
      leaderFrameFit < Math.log(this.cfg.lostFitFloor) ||
      (nullPost > leaderPost && nullPost > 0.5)
    ) {
      this.status = 'lost';
      return { kind: 'lost' };
    }

    if (leader.key === STAY || leader.move === null) {
      this.status = 'tracking';
      return { kind: 'hold', status: 'tracking', confidence: leaderPost };
    }

    // leader is a move — evaluate the commit guards
    const runnerUp = this.bestOther(cands, post, leader.key);
    const discrim = discrimCells(leader.facelets, runnerUp.facelets, view);
    this.viewpoints.set(
      leader.key,
      (this.viewpoints.get(leader.key) ?? new Set()).add(viewpointKey),
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
      this.status = 'tracking';
      this.confidence = leaderPost;
      return { kind: 'move', move, confidence: leaderPost, state };
    }

    // a move is suspected but not committable — say why via status
    this.status = discriminative ? 'partial' : 'ambiguous';
    return { kind: 'hold', status: this.status, confidence: leaderPost };
  }

  private bestOther(cands: Candidate[], post: Map<CandKey, number>, exclude: CandKey): Candidate {
    let best = cands.find((c) => c.key !== exclude)!;
    let bestPost = post.get(best.key) ?? 0;
    for (const c of cands) {
      if (c.key === exclude) continue;
      const p = post.get(c.key) ?? 0;
      if (p > bestPost) {
        bestPost = p;
        best = c;
      }
    }
    return best;
  }

  private holdResult(): TrackUpdate {
    if (this.status === 'lost') return { kind: 'lost' };
    return { kind: 'hold', status: this.status, confidence: this.confidence };
  }

  /** The current joint hypotheses (top-weighted), for inspection / the public belief(). */
  hypotheses(limit = 8): Hypothesis[] {
    const cands = this.candidates();
    const logits = cands.map((c) => this.logPrior(c.key) + (this.loglik.get(c.key) ?? 0));
    const z = logSumExp([...logits, this.logPriorNull() + this.nullLoglik]);
    const hyps: Hypothesis[] = cands.map((c, i) => ({
      state: cloneState(c.state),
      orientation: this.orientation,
      pending: c.move ? [c.move] : [],
      weight: Math.exp(logits[i]! - z),
    }));
    hyps.sort((a, b) => b.weight - a.weight);
    return hyps.slice(0, limit);
  }
}

export { NULL_KEY, STAY };
