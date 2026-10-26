// The analyst's view of a decision. The match generator's players choose with the simple
// static models in options.ts; judging them is done more carefully, answering the classic
// criticisms of decision analysis:
//   - the world isn't frozen: passes are scored on where everyone will be when the ball arrives;
//   - god's-eye bias: every option is labelled visible / peripheral / behind the player;
//   - decision vs execution: the chance of coming off is adjusted for what this player can execute;
//   - one step only: a pass is also worth the best next action it sets up (two steps deep);
//   - no context: the game state scales risk (protecting a lead, chasing the game).
// All positions are in the acting team's frame (attacking towards x = 105).

import { PITCH_LENGTH, PITCH_WIDTH, clamp, dist, distToGoal, v } from '../geometry';
import { isOffside, leadTarget, offsideLine, passTravelSec, project } from '../models/dynamics';
import { calibratePass } from '../models/calibration';
import { type ExecutionFit, adjustP, footedness, passExecution } from '../models/execution';
import { type GameState, gameStateFor } from '../models/gamestate';
import { laneThreat, nearestDistance, passProbFromFeatures, pressureAt } from '../models/pass';
import { expectedValue, turnoverCost } from '../models/value';
import { type VisionCone, estimateVision, visibilityOf } from '../models/vision';
import { FINISHING_BASELINE, xgBase } from '../models/xg';
import { xt } from '../models/xt';
import { MAX_SHOT_DISTANCE, type OptionContext, type OptionPlayer, type ScoredOption, carryTargets, enumerateOptions, evaluateCarry, evaluateShot } from '../options';
import type { GhostOption, MatchEvent, PlayerAttributes, PlayerInfo, Side, Vec2 } from '../types';

export type RosterEntry = { info: PlayerInfo; team: Side; isGK: boolean; directness?: number };
export type Roster = Map<string, RosterEntry>;

export type FollowUp = NonNullable<GhostOption['followUp']>;

/** A scored option plus what the analyst layer knows (offside, runner, execution, follow-up come from GhostOption). */
export type JudgedOption = ScoredOption & {
  visibility: NonNullable<GhostOption['visibility']>;
  modelP: number;
};

export type JudgeContext = {
  ctx: OptionContext;
  vel: Map<string, Vec2>;
  cone: VisionCone;
  state: GameState;
  attrs: Pick<PlayerAttributes, 'passing' | 'decision' | 'dribbling' | 'pace' | 'finishing'>;
  offsideX: number;
};

const RECEIVER_FINISHING_WEIGHT = 0.8; // same as options.ts
const FOLLOW_DISCOUNT = 0.85;
const FOLLOW_SHARE = 0.5;
// Closing down for the look-ahead: the two nearest outfield defenders run at the new carrier.
const CLOSERS = 2;
const CLOSE_SPEED = 6; // m/s
const CLOSE_DOWN_TO = 1.5; // metres
const REACTION_EXTRA = 0.4; // seconds: the receiver's first touch gives them a moment more
/**
 * Defenders carry their momentum for about a reaction time, then respond to the ball rather than
 * keep drifting (their freeze-frame velocity is the move they just made, often retreating into shape).
 * Attackers already on a run keep it: that's what makes a pass into space.
 */
const DEFENDER_MOMENTUM_SEC = 0.35;
const momentum = (o: OptionPlayer, vel: Map<string, Vec2>, sec: number) => project(o.pos, vel.get(o.id), Math.min(sec, DEFENDER_MOMENTUM_SEC));
const CARRY_SPEED = 6; // m/s
const MIN_SHOT_BASE_XG = 0.02;

/** Rebuild the option context (attacking frame) from an event's freeze frame. */
export function contextFromEvent(e: MatchEvent, roster: Roster): OptionContext {
  const me = roster.get(e.playerId);
  const toOP = (s: MatchEvent['freezeFrame'][number]): OptionPlayer => {
    const r = roster.get(s.playerId);
    return { id: s.playerId, pos: s.pos, isGK: r?.isGK ?? false, finishing: r?.info.attrs.finishing, tackling: r?.info.attrs.tackling };
  };
  const a = me?.info.attrs;
  return {
    carrier: { id: e.playerId, pos: e.start, isGK: me?.isGK ?? false, passing: a?.passing, dribbling: a?.dribbling, pace: a?.pace, finishing: a?.finishing },
    teammates: e.freezeFrame.filter((s) => s.team === e.team && s.playerId !== e.playerId).map(toOP),
    opponents: e.freezeFrame.filter((s) => s.team !== e.team).map(toOP),
  };
}

export function judgeContext(e: MatchEvent, roster: Roster, prev?: MatchEvent): JudgeContext {
  const ctx = contextFromEvent(e, roster);
  const me = roster.get(e.playerId);
  const a = me?.info.attrs;
  const attrs = { passing: a?.passing ?? 0.6, decision: a?.decision ?? 0.6, dribbling: a?.dribbling ?? 0.5, pace: a?.pace ?? 0.5, finishing: a?.finishing ?? FINISHING_BASELINE };
  return {
    ctx,
    vel: new Map(e.freezeFrame.map((s) => [s.playerId, s.vel ?? { x: 0, y: 0 }])),
    cone: estimateVision(e, prev, attrs.decision),
    state: gameStateFor(e, me?.directness),
    attrs,
    offsideX: offsideLine(ctx.opponents.map((o) => o.pos), e.start.x),
  };
}

/** Apply the game state to an option: the danger it reaches and the cost of losing the ball. */
function withState(o: ScoredOption, state: GameState): ScoredOption {
  const value = o.action === 'shot' ? o.valueIfSuccess : o.valueIfSuccess * state.riskAppetite;
  const cost = o.turnoverCost * state.lossAversion;
  return { ...o, valueIfSuccess: value, turnoverCost: cost, expectedValue: expectedValue(o.pSuccess, value, cost), features: { ...o.features, rawValue: o.valueIfSuccess, rawCost: o.turnoverCost } };
}

/**
 * Best next action from where the ball ends up (one step deeper), on the static models.
 * Defenders don't stand still for it: the nearest ones close the new ball carrier down.
 */
function followUpFrom(jc: JudgeContext, newCarrier: OptionPlayer & { passing?: number; dribbling?: number; pace?: number }, at: Vec2, sec: number): FollowUp | undefined {
  const { ctx, vel } = jc;
  const mates = [...ctx.teammates.filter((t) => t.id !== newCarrier.id), ...(newCarrier.id === ctx.carrier.id ? [] : [{ ...ctx.carrier }])]
    .map((t) => ({ ...t, pos: t.id === ctx.carrier.id ? t.pos : project(t.pos, vel.get(t.id), sec) }));
  const byDistance = [...ctx.opponents].sort((a, b) => dist(a.pos, at) - dist(b.pos, at));
  const closers = new Set(byDistance.filter((o) => !o.isGK).slice(0, CLOSERS).map((o) => o.id));
  const opps = ctx.opponents.map((o) => {
    if (!closers.has(o.id)) return { ...o, pos: momentum(o, vel, sec) };
    const d = dist(o.pos, at);
    const step = Math.min(Math.max(0, d - CLOSE_DOWN_TO), (sec + REACTION_EXTRA) * CLOSE_SPEED);
    return { ...o, pos: { x: o.pos.x + ((at.x - o.pos.x) / (d || 1)) * step, y: o.pos.y + ((at.y - o.pos.y) / (d || 1)) * step } };
  });
  const next = enumerateOptions({ carrier: { ...newCarrier, pos: at }, teammates: mates, opponents: opps })
    // Don't count simply giving it straight back.
    .filter((o) => !(o.action === 'pass' && o.targetPlayerId === ctx.carrier.id));
  const best = next[0];
  if (!best) return undefined;
  return { action: best.action, ...(best.targetPlayerId ? { targetPlayerId: best.targetPlayerId } : {}), end: best.end, ev: best.expectedValue };
}

/**
 * Two-step value: where the ball ends up (xT, which already averages typical next actions), plus a
 * share of the extra the best next action is worth. Only a share, because nobody always finds the
 * best next ball and the defence keeps adjusting.
 */
function twoStep(value: number, f: FollowUp | undefined): { value: number; followUp?: FollowUp } {
  const extra = f ? FOLLOW_DISCOUNT * f.ev - value : 0;
  if (!f || extra <= 0.002) return { value };
  return { value: value + FOLLOW_SHARE * extra, followUp: f };
}

/**
 * Room for the receiver where the ball arrives. For a ball to feet that's the distance to the nearest
 * defender; for a ball played into space (3 m+ ahead of the receiver) it's also a race: a defender
 * who can get to the spot about as soon as the receiver is contesting it, however much room there is
 * at the spot itself.
 */
function receiverSpace(to: Vec2, receiver: Vec2 | undefined, defenders: Vec2[]): number {
  const atSpot = clamp(nearestDistance(to, defenders) / 5, 0, 1);
  const run = receiver ? dist(receiver, to) : 0;
  if (run < INTO_SPACE_M) return atSpot;
  const headStart = Math.min(...defenders.map((d) => dist(d, to) - run));
  return Math.min(atSpot, clamp((headStart + 2) / 5, 0, 1));
}
const INTO_SPACE_M = 3;

/** A pass, judged on the moving picture. `end` given = the actual pass; otherwise lead the receiver. */
export function judgePass(jc: JudgeContext, targetPlayerId: string | undefined, end?: Vec2, played = false): JudgedOption {
  const { ctx, vel, cone, attrs } = jc;
  const from = ctx.carrier.pos;
  const receiver = ctx.teammates.find((t) => t.id === targetPlayerId);
  const lead = end ? { end, runner: false, sec: passTravelSec(from, end) } : leadTarget(from, receiver!.pos, vel.get(receiver!.id));
  const to = lead.end;
  const T = lead.sec;
  const now = ctx.opponents.map((o) => o.pos);
  const mid = ctx.opponents.map((o) => momentum(o, vel, T * 0.5));
  const arrive = ctx.opponents.map((o) => momentum(o, vel, T));
  const f = { distance: dist(from, to), laneThreat: laneThreat(from, to, mid), pressure: pressureAt(from, now), receiverSpace: receiverSpace(to, receiver?.pos, arrive) };
  const modelP = passProbFromFeatures(f, attrs.passing);
  const execution: ExecutionFit = passExecution(from, to, attrs, footedness(ctx.carrier.id, attrs.passing), f.pressure, cone);
  // The pass actually played wasn't flagged, so only alternatives can be offside.
  const offside = !played && !!receiver && isOffside(receiver.pos, jc.offsideX) && receiver.pos.x > from.x;
  // Calibrated on training matches (see models/calibration.ts), then adjusted for execution.
  const pSuccess = offside ? 0.02 : adjustP(calibratePass(modelP), execution.logitAdj);

  const finishing = receiver?.finishing ?? FINISHING_BASELINE;
  const nearGoal = clamp((to.x - 75) / 20, 0, 1);
  const oneStep = xt(to) * (1 + RECEIVER_FINISHING_WEIGHT * (finishing - FINISHING_BASELINE) * nearGoal);
  const lossAt = { x: from.x + (to.x - from.x) * 0.6, y: from.y + (to.y - from.y) * 0.6 };
  const cost = turnoverCost(lossAt);
  const follow = receiver && !offside ? followUpFrom(jc, receiver, to, T) : undefined;
  const two = twoStep(oneStep, follow);
  const bypassed = ctx.opponents.filter((o) => !o.isGK && o.pos.x > from.x && o.pos.x < to.x).length;

  const base: ScoredOption = {
    action: 'pass',
    targetPlayerId,
    end: to,
    pSuccess,
    valueIfSuccess: two.value,
    turnoverCost: cost,
    expectedValue: expectedValue(pSuccess, two.value, cost),
    features: { ...f, bypassed, receiverFinishing: finishing, xtTarget: oneStep, travelSec: T, modelP },
  };
  return {
    ...withState(base, jc.state),
    visibility: visibilityOf(cone, from, receiver?.pos ?? to),
    modelP,
    execution: { fit: execution.fit, notes: execution.notes },
    ...(offside ? { offside } : {}),
    ...(lead.runner ? { runner: true } : {}),
    ...(two.followUp ? { followUp: two.followUp } : {}),
  };
}

export function judgeCarry(jc: JudgeContext, end: Vec2): JudgedOption {
  const { ctx, vel, cone } = jc;
  const sec = dist(ctx.carrier.pos, end) / CARRY_SPEED;
  const moved: OptionContext = { ...ctx, opponents: ctx.opponents.map((o) => ({ ...o, pos: momentum(o, vel, sec * 0.5) })) };
  const o = evaluateCarry(moved, end);
  // Pressure is felt now, not half a second later.
  const follow = followUpFrom(jc, ctx.carrier, end, sec);
  const two = twoStep(o.valueIfSuccess, follow);
  const base: ScoredOption = { ...o, valueIfSuccess: two.value, expectedValue: expectedValue(o.pSuccess, two.value, o.turnoverCost), features: { ...o.features, xtTarget: o.valueIfSuccess } };
  return {
    ...withState(base, jc.state),
    visibility: visibilityOf(cone, ctx.carrier.pos, end),
    modelP: o.pSuccess,
    ...(two.followUp ? { followUp: two.followUp } : {}),
  };
}

export function judgeShot(jc: JudgeContext): JudgedOption {
  const o = evaluateShot(jc.ctx);
  return { ...withState(o, jc.state), visibility: visibilityOf(jc.cone, jc.ctx.carrier.pos, v(PITCH_LENGTH, PITCH_WIDTH / 2)), modelP: o.pSuccess };
}

/** Every sensible option, judged, best expected value first. */
export function judgeOptions(jc: JudgeContext): JudgedOption[] {
  const { ctx } = jc;
  const out: JudgedOption[] = [];
  for (const tm of ctx.teammates) {
    if (tm.isGK && ctx.carrier.pos.x > 45) continue;
    out.push(judgePass(jc, tm.id));
  }
  if (!ctx.carrier.isGK) {
    for (const end of carryTargets(ctx.carrier.pos)) out.push(judgeCarry(jc, end));
    const p = ctx.carrier.pos;
    if (distToGoal(p) <= MAX_SHOT_DISTANCE && p.x > 70 && xgBase(p) >= MIN_SHOT_BASE_XG) out.push(judgeShot(jc));
  }
  return out.sort((a, b) => b.expectedValue - a.expectedValue);
}

/** Judge the action the player actually took (pass end / carry end as played). */
export function judgeActual(jc: JudgeContext, e: MatchEvent): JudgedOption {
  if (e.type === 'pass') return judgePass(jc, e.targetPlayerId, e.end!, true);
  if (e.type === 'carry') return judgeCarry(jc, e.end!);
  return judgeShot(jc);
}
