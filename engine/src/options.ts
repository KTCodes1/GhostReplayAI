// Option enumeration + scoring for a player on the ball.
// Shared by the match generator (to choose what players do) and the ghost engine
// (to show what they could have done instead), so both see the same football.
// All positions are in the attacking team's frame (attacking towards x = 105).

import { PITCH_LENGTH, PITCH_WIDTH, add, clamp, clampToPitch, distToGoal, v } from './geometry';
import { carrySuccessProb, passFeatures, passProbFromFeatures, pressureAt } from './models/pass';
import { expectedValue, turnoverCost } from './models/value';
import { FINISHING_BASELINE, finishingAdjust, shotContext, xg, xgBase } from './models/xg';
import { xt } from './models/xt';
import type { GhostOption, Vec2 } from './types';

/** Ratings are optional: without them every player is treated as average. */
export type OptionPlayer = { id: string; pos: Vec2; isGK: boolean; finishing?: number; tackling?: number };

export type OptionContext = {
  carrier: OptionPlayer & { passing?: number; dribbling?: number; pace?: number };
  teammates: OptionPlayer[]; // excludes the carrier
  opponents: OptionPlayer[];
};

export type ScoredOption = Omit<GhostOption, 'deltaVsActual'> & {
  /** Model inputs, kept for the analyst breakdown. */
  features: Record<string, number>;
};

export const MAX_SHOT_DISTANCE = 32;
/** How much a better finisher raises the value of a pass that reaches them near goal. */
const RECEIVER_FINISHING_WEIGHT = 0.8;
const MIN_SHOT_BASE_XG = 0.02; // nobody shoots from the corner flag
const CARRY_LENGTH = 8;

/** Where a pass to this teammate should be aimed: forward runners get the ball played into their path. */
export function passTarget(carrier: Vec2, receiver: Vec2): Vec2 {
  const lead = receiver.x > carrier.x + 3 && receiver.x < PITCH_LENGTH - 6 ? 2 : 0;
  return clampToPitch(add(receiver, v(lead, 0)), 1);
}

/** Outfield opponents taken out of the game by moving the ball from a to b (line-breaking count). */
export function defendersBypassed(a: Vec2, b: Vec2, opponents: OptionPlayer[]): number {
  if (b.x <= a.x) return 0;
  return opponents.filter((o) => !o.isGK && o.pos.x > a.x && o.pos.x < b.x).length;
}

export function evaluatePass(ctx: OptionContext, targetPlayerId: string | undefined, end: Vec2): ScoredOption {
  const opp = ctx.opponents.map((o) => o.pos);
  const f = passFeatures(ctx.carrier.pos, end, opp);
  const pSuccess = passProbFromFeatures(f, ctx.carrier.passing ?? 0.5);
  // On a failed pass the ball is typically lost around 60% of the way to the target.
  const lossAt = { x: ctx.carrier.pos.x + (end.x - ctx.carrier.pos.x) * 0.6, y: ctx.carrier.pos.y + (end.y - ctx.carrier.pos.y) * 0.6 };
  // Near goal, the ball is worth more at the feet of a better finisher.
  const receiver = ctx.teammates.find((t) => t.id === targetPlayerId);
  const finishing = receiver?.finishing ?? FINISHING_BASELINE;
  const nearGoal = clamp((end.x - 75) / 20, 0, 1);
  const valueIfSuccess = xt(end) * (1 + RECEIVER_FINISHING_WEIGHT * (finishing - FINISHING_BASELINE) * nearGoal);
  const cost = turnoverCost(lossAt);
  return {
    action: 'pass',
    targetPlayerId,
    end,
    pSuccess,
    valueIfSuccess,
    turnoverCost: cost,
    expectedValue: expectedValue(pSuccess, valueIfSuccess, cost),
    features: { ...f, bypassed: defendersBypassed(ctx.carrier.pos, end, ctx.opponents), receiverFinishing: finishing },
  };
}

export function evaluateCarry(ctx: OptionContext, end: Vec2): ScoredOption {
  const opp = ctx.opponents.map((o) => o.pos);
  const pSuccess = carrySuccessProb(ctx.carrier.pos, end, opp, ctx.carrier.dribbling ?? 0.5, ctx.carrier.pace ?? 0.5, ctx.opponents.map((o) => o.tackling ?? 0.5));
  const valueIfSuccess = xt(end);
  const cost = turnoverCost(ctx.carrier.pos);
  return {
    action: 'carry',
    end,
    pSuccess,
    valueIfSuccess,
    turnoverCost: cost,
    expectedValue: expectedValue(pSuccess, valueIfSuccess, cost),
    features: { distance: Math.hypot(end.x - ctx.carrier.pos.x, end.y - ctx.carrier.pos.y), pressure: pressureAt(ctx.carrier.pos, opp) },
  };
}

/**
 * A shot is scored as pSuccess = chance this shooter scores (xG adjusted for finishing) and value 1
 * (a goal), so EV is on the same goal-probability scale as xT.
 */
export function evaluateShot(ctx: OptionContext): ScoredOption {
  const shooter = ctx.carrier.pos;
  const sc = shotContext(shooter, ctx.opponents);
  const chance = xg(shooter, sc);
  const pGoal = finishingAdjust(chance, ctx.carrier.finishing);
  const cost = turnoverCost(shooter);
  return {
    action: 'shot',
    end: v(PITCH_LENGTH, PITCH_WIDTH / 2),
    pSuccess: pGoal,
    valueIfSuccess: 1,
    turnoverCost: cost,
    expectedValue: expectedValue(pGoal, 1, cost),
    features: { distance: distToGoal(shooter), pressure: sc.pressure ?? 0, blockers: sc.blockers ?? 0, keeperInCone: sc.keeperInCone ? 1 : 0, xg: chance, finishing: ctx.carrier.finishing ?? FINISHING_BASELINE },
  };
}

export function carryTargets(from: Vec2): Vec2[] {
  const towardsCentre = Math.sign(PITCH_WIDTH / 2 - from.y) || 1;
  const raw = [
    v(from.x + CARRY_LENGTH, from.y),
    v(from.x + CARRY_LENGTH * 0.75, from.y + towardsCentre * CARRY_LENGTH * 0.6),
    v(from.x + CARRY_LENGTH * 0.75, from.y - towardsCentre * CARRY_LENGTH * 0.6),
  ];
  return raw
    .filter((p) => p.x < PITCH_LENGTH - 1 && p.y > 1 && p.y < PITCH_WIDTH - 1)
    .map((p) => ({ x: clamp(p.x, 1, PITCH_LENGTH - 1), y: p.y }));
}

/** Every sensible option for the player on the ball, best EV first. */
export function enumerateOptions(ctx: OptionContext): ScoredOption[] {
  const out: ScoredOption[] = [];
  for (const tm of ctx.teammates) {
    // Passing back to the keeper only makes sense from your own half.
    if (tm.isGK && ctx.carrier.pos.x > 45) continue;
    out.push(evaluatePass(ctx, tm.id, passTarget(ctx.carrier.pos, tm.pos)));
  }
  if (!ctx.carrier.isGK) {
    for (const end of carryTargets(ctx.carrier.pos)) out.push(evaluateCarry(ctx, end));
    const p = ctx.carrier.pos;
    if (distToGoal(p) <= MAX_SHOT_DISTANCE && p.x > 70 && xgBase(p) >= MIN_SHOT_BASE_XG) out.push(evaluateShot(ctx));
  }
  return out.sort((a, b) => b.expectedValue - a.expectedValue);
}
