// Pundit sketch: a pundit draws their own alternative on the pitch ("he should have played it
// here") and the engine scores it with the same models as every ghost, so arrows in the studio
// become testable. The drawn end point decides what the action is:
//   - on the goal mouth: a shot;
//   - next to a teammate: a pass to them;
//   - short: a carry to that spot;
//   - anywhere else: a pass into space for whichever teammate gets there first, checked against
//     the first defender who can reach it.
// Positions are in the acting team's frame.

import { PITCH_LENGTH, PITCH_WIDTH, clampToPitch, dist } from '../geometry';
import { passTravelSec, project } from '../models/dynamics';
import type { GhostOption, MatchEvent, Vec2 } from '../types';
import { type GhostAnalysis, toGhostOption } from './ghost';
import { type JudgedOption, type Roster, judgeCarry, judgeContext, judgePass, judgeShot } from './judge';

export type SketchVerdict = {
  option: GhostOption;
  /** What the drawing was read as, in words ("a pass into space for Moreau"). */
  readAs: string;
  /** Extra notes on how the race for the ball was judged. */
  notes: string[];
  /** Where it ranks among everything the engine considered (1 = best), including the actual choice. */
  rank: number;
  of: number;
};

const CARRY_MAX = 14; // metres
const NEAR_TEAMMATE = 3;
const RUN_SPEED = 7.5;
const ACCEL_START = 0.6; // seconds lost reacting/accelerating for a defender

export function judgeSketch(e: MatchEvent, roster: Roster, prev: MatchEvent | undefined, endRaw: Vec2, analysis: GhostAnalysis): SketchVerdict {
  const jc = judgeContext(e, roster, prev);
  const end = clampToPitch(endRaw, 0.5);
  const from = jc.ctx.carrier.pos;
  const name = (id?: string) => (id ? roster.get(id)?.info.shortName ?? 'a teammate' : 'a teammate');
  const notes: string[] = [];
  let judged: JudgedOption;
  let readAs: string;

  const mouth = end.x >= PITCH_LENGTH - 3 && Math.abs(end.y - PITCH_WIDTH / 2) <= 8;
  const mate = jc.ctx.teammates.filter((t) => dist(t.pos, end) <= NEAR_TEAMMATE).sort((a, b) => dist(a.pos, end) - dist(b.pos, end))[0];
  if (mouth) {
    judged = judgeShot(jc);
    readAs = 'a shot';
  } else if (mate) {
    judged = judgePass(jc, mate.id, end);
    readAs = `a pass to ${name(mate.id)}`;
  } else if (dist(from, end) <= CARRY_MAX) {
    judged = judgeCarry(jc, end);
    readAs = 'a run with the ball';
  } else {
    // A ball into space: who gets there first?
    const T = passTravelSec(from, end);
    const arrive = (pos: Vec2, vel?: Vec2) => dist(project(pos, vel, Math.min(T, 0.35)), end) / RUN_SPEED;
    const runner = [...jc.ctx.teammates].filter((t) => !t.isGK).sort((a, b) => arrive(a.pos, jc.vel.get(a.id)) - arrive(b.pos, jc.vel.get(b.id)))[0]!;
    const tR = arrive(runner.pos, jc.vel.get(runner.id));
    const tD = Math.min(...jc.ctx.opponents.map((o) => arrive(o.pos, jc.vel.get(o.id)) + ACCEL_START));
    judged = judgePass(jc, runner.id, end);
    readAs = `a pass into space for ${name(runner.id)}`;
    let factor = 1;
    if (tD < Math.max(T, tR)) {
      factor *= 0.35;
      notes.push(`a defender gets there first (${tD.toFixed(1)} s against ${Math.max(T, tR).toFixed(1)} s)`);
    } else if (tR > T + 1.2) {
      factor *= 0.7;
      notes.push(`the ball arrives ${(tR - T).toFixed(1)} s before ${name(runner.id)} can get to it`);
    } else notes.push(`${name(runner.id)} gets there in ${tR.toFixed(1)} s, ahead of the nearest defender`);
    if (factor < 1) judged = { ...judged, pSuccess: judged.pSuccess * factor, expectedValue: judged.pSuccess * factor * judged.valueIfSuccess - (1 - judged.pSuccess * factor) * judged.turnoverCost };
  }

  const option = toGhostOption(judged, analysis.actual.expectedValue);
  const pool = [analysis.actual, ...analysis.alternatives];
  const rank = 1 + pool.filter((o) => o.expectedValue > option.expectedValue).length;
  return { option, readAs, notes, rank, of: pool.length + 1 };
}
