// "What if" simulations: restart the match engine from a freeze frame, make the player take a
// chosen option, and play the move out — many times for the odds, once to show on the pitch.
// Passes are resolved with reactive defenders (they move while the ball travels), nothing is forced
// to come off, and a lost ball is followed into the opponent's counter-attack.

import { toAbsolute, toTeamFrame } from '../geometry';
import { Rng, hashSeed } from '../rng';
import { type BranchResult, type ForcedAction, createSimulation } from '../sim/generator';
import type { GhostOption, MatchEvent, MatchMeta, Vec2 } from '../types';

export type WhatIfOutcome = BranchResult['outcome'];

/** Branching outcomes of one option, for the "ghost tree". Positions are in the actor's team frame. */
export type GhostTree = {
  /** The first action comes off (pass arrives / carry gets through / shot scores). */
  arrive: number;
  /** Given it comes off: */
  thenShot: number; // includes goals
  thenGoal: number;
  thenKept: number;
  thenLost: number;
  /** Given it doesn't: the opponent counter-attacks into a shot. */
  counterShot: number;
  /** Average spot the follow-up shot came from / the ball was lost. */
  shotFrom?: Vec2;
  lossAt?: Vec2;
};

export type WhatIfSummary = {
  rollouts: number;
  /** Simulated chance the first action comes off (shots: the model's chance this player scores). */
  pSuccess: number;
  /** The model's chance, before simulation. */
  modelP: number;
  /** Rates *given that it comes off*. */
  goalRate: number;
  shotRate: number; // includes goals
  turnoverRate: number;
  avgXg: number; // average xG generated per successful attempt
  /** Headline: expected goals from choosing this option at all = pSuccess × avgXg. */
  expectedGoals: number;
  /** Spread of per-run xG, for the confidence check. */
  sdXg: number;
  /** Expected goals the opponent creates on the counter after winning the ball. */
  xgAgainst: number;
  outcomes: Record<WhatIfOutcome, number>;
  tree: GhostTree;
};

export type WhatIfResult = {
  key: string;
  option: ForcedAction;
  summary: WhatIfSummary;
  /** One representative rollout to animate: events after the decision, in order. */
  replay: MatchEvent[];
  replayOutcome: WhatIfOutcome;
  replayXg: number;
};

export const optionKey = (o: Pick<GhostOption, 'action' | 'targetPlayerId' | 'end'>) =>
  `${o.action}:${o.targetPlayerId ?? ''}:${o.end.x.toFixed(1)},${o.end.y.toFixed(1)}`;

export type WhatIfOptions = { rollouts?: number; maxActions?: number; maxMs?: number };

const avgPos = (ps: Vec2[]): Vec2 | undefined =>
  ps.length ? { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length } : undefined;

/** Simulate `option` taken at `event` (whose freeze frame is the starting state). */
export function simulateWhatIf(meta: MatchMeta, event: MatchEvent, option: Pick<GhostOption, 'action' | 'targetPlayerId' | 'end' | 'pSuccess'>, opts: WhatIfOptions = {}): WhatIfResult {
  const n = opts.rollouts ?? 50;
  const key = optionKey(option);
  // The whole freeze frame is in the actor's team frame.
  const positions = new Map<string, Vec2>(event.freezeFrame.map((s) => [s.playerId, toAbsolute(s.pos, event.team)]));
  const velocities = new Map<string, Vec2>(event.freezeFrame.map((s) => [s.playerId, event.team === 'home' ? s.vel ?? { x: 0, y: 0 } : { x: -(s.vel?.x ?? 0), y: -(s.vel?.y ?? 0) }]));
  const forced: ForcedAction = { action: option.action, ...(option.targetPlayerId ? { targetPlayerId: option.targetPlayerId } : {}), end: option.end };
  const periodStartT = event.period === 1 ? 0 : event.t - (event.clockMs - meta.halfLengthMs);

  const runs: BranchResult[] = [];
  for (let i = 0; i < n; i++) {
    const sim = createSimulation({
      rng: new Rng(hashSeed(`${event.id}|${key}|${i}`)),
      meta,
      idPrefix: `${event.id}~${i}`,
      initial: {
        t: event.t,
        period: event.period,
        periodStartT,
        score: { ...event.score },
        possession: event.team,
        carrierId: event.playerId,
        ball: toAbsolute(event.start, event.team),
        positions,
        velocities,
      },
    });
    runs.push(sim.playBranch(forced, { reactive: option.action === 'pass', maxActions: opts.maxActions, maxMs: opts.maxMs, counter: true }));
  }

  const outcomes: Record<WhatIfOutcome, number> = { goal: 0, shot: 0, turnover: 0, foul: 0, kept: 0 };
  for (const r of runs) outcomes[r.outcome] += 1;
  const isShot = option.action === 'shot';
  const ok = isShot ? runs : runs.filter((r) => r.firstSuccess);
  const xgs = runs.map((r) => r.xG);
  const mean = xgs.reduce((s, x) => s + x, 0) / n;
  const sdXg = Math.sqrt(xgs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  const count = (rs: BranchResult[], f: (r: BranchResult) => boolean) => rs.filter(f).length;
  const per = (k: number, of: number) => (of ? k / of : 0);
  const avgXg = per(ok.reduce((s, r) => s + r.xG, 0), ok.length);
  const pSuccess = isShot ? option.pSuccess : ok.length / n;
  const failed = isShot ? [] : runs.filter((r) => !r.firstSuccess);
  const lost = runs.filter((r) => r.counter);
  const toTF = (p?: Vec2) => (p ? toTeamFrame(p, event.team) : undefined);
  const shotFrom = toTF(avgPos(ok.flatMap((r) => (r.shotFrom ? [r.shotFrom] : []))));
  const lossAt = toTF(avgPos(failed.flatMap((r) => (r.lossAt ? [r.lossAt] : []))));

  const tree: GhostTree = {
    arrive: isShot ? per(count(runs, (r) => r.outcome === 'goal'), n) : pSuccess,
    thenShot: per(count(ok, (r) => r.outcome === 'shot' || r.outcome === 'goal'), ok.length),
    thenGoal: per(count(ok, (r) => r.outcome === 'goal'), ok.length),
    thenKept: per(count(ok, (r) => r.outcome === 'kept' || r.outcome === 'foul'), ok.length),
    thenLost: per(count(ok, (r) => r.outcome === 'turnover'), ok.length),
    counterShot: per(count(failed, (r) => !!r.counter?.shot), failed.length),
    ...(shotFrom ? { shotFrom } : {}),
    ...(lossAt ? { lossAt } : {}),
  };

  const summary: WhatIfSummary = {
    rollouts: n,
    pSuccess,
    modelP: option.pSuccess,
    goalRate: per(count(ok, (r) => r.outcome === 'goal'), ok.length),
    shotRate: per(count(ok, (r) => r.outcome === 'shot' || r.outcome === 'goal'), ok.length),
    turnoverRate: per(count(runs, (r) => r.outcome === 'turnover'), n),
    avgXg,
    expectedGoals: mean,
    sdXg,
    xgAgainst: lost.reduce((s, r) => s + (r.counter?.xG ?? 0) * (r.counter?.shot ? 1 : 0), 0) / n,
    outcomes,
    tree,
  };

  // Representative rollout: if the move usually produces a shot, show the shot with median xG;
  // otherwise (and always for a shot itself) show the most common ending.
  let pick: BranchResult;
  const shots = runs.filter((r) => r.outcome === 'shot' || r.outcome === 'goal').sort((a, b) => a.xG - b.xG);
  if (!isShot && pSuccess > 0 && shots.length / n >= 0.3 * pSuccess && shots.length) pick = shots[Math.floor(shots.length / 2)]!;
  else {
    const mode = (Object.keys(outcomes) as WhatIfOutcome[]).sort((a, b) => outcomes[b] - outcomes[a])[0]!;
    pick = runs.find((r) => r.outcome === mode)!;
  }

  return { key, option: forced, summary, replay: pick.events, replayOutcome: pick.outcome, replayXg: pick.xG };
}
