// "What if" simulations: restart the match engine from a freeze frame, force a chosen
// option, and play the move out — many times for the odds, once to show on the pitch.

import { toAbsolute } from '../geometry';
import { Rng, hashSeed } from '../rng';
import { type BranchResult, type ForcedAction, createSimulation } from '../sim/generator';
import type { GhostOption, MatchEvent, MatchMeta, Vec2 } from '../types';

export type WhatIfOutcome = BranchResult['outcome'];

export type WhatIfSummary = {
  rollouts: number;
  /** Chance the forced first action comes off (from the model, not the rollouts). */
  pSuccess: number;
  /** Rates *given that it comes off*. */
  goalRate: number;
  shotRate: number; // includes goals
  turnoverRate: number;
  avgXg: number; // average xG generated per successful attempt
  /** Headline: expected goals from choosing this option at all = pSuccess × avgXg. */
  expectedGoals: number;
  outcomes: Record<WhatIfOutcome, number>;
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

/** Simulate `option` taken at `event` (whose freeze frame is the starting state). */
export function simulateWhatIf(meta: MatchMeta, event: MatchEvent, option: GhostOption, opts: WhatIfOptions = {}): WhatIfResult {
  const n = opts.rollouts ?? 50;
  const key = optionKey(option);
  // The whole freeze frame is in the actor's team frame.
  const positions = new Map<string, Vec2>(event.freezeFrame.map((s) => [s.playerId, toAbsolute(s.pos, event.team)]));
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
      },
    });
    runs.push(sim.playBranch(forced, { forceSuccess: option.action === 'shot' ? undefined : true, maxActions: opts.maxActions, maxMs: opts.maxMs }));
  }

  const outcomes: Record<WhatIfOutcome, number> = { goal: 0, shot: 0, turnover: 0, foul: 0, kept: 0 };
  let xgSum = 0;
  for (const r of runs) {
    outcomes[r.outcome] += 1;
    xgSum += r.xG;
  }
  const avgXg = xgSum / n;
  const pSuccess = option.pSuccess;
  const summary: WhatIfSummary = {
    rollouts: n,
    pSuccess,
    goalRate: outcomes.goal / n,
    shotRate: (outcomes.shot + outcomes.goal) / n,
    turnoverRate: outcomes.turnover / n,
    avgXg,
    expectedGoals: option.action === 'shot' ? avgXg : pSuccess * avgXg,
    outcomes,
  };

  // Representative rollout: if the move usually produces a shot, show the shot with median xG;
  // otherwise (and always for a shot itself) show the most common ending.
  let pick: BranchResult;
  const shots = runs.filter((r) => r.outcome === 'shot' || r.outcome === 'goal').sort((a, b) => a.xG - b.xG);
  if (option.action !== 'shot' && summary.shotRate >= 0.3 && shots.length) pick = shots[Math.floor(shots.length / 2)]!;
  else {
    const mode = (Object.keys(outcomes) as WhatIfOutcome[]).sort((a, b) => outcomes[b] - outcomes[a])[0]!;
    pick = runs.find((r) => r.outcome === mode)!;
  }

  return { key, option: forced, summary, replay: pick.events, replayOutcome: pick.outcome, replayXg: pick.xG };
}
