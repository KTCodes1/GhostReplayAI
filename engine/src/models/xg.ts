import { POST_HIGH, POST_LOW, dist, distToGoal, goalAngle, inTriangle, sigmoid } from '../geometry';
import { pressureAt } from './pass';
import type { Vec2 } from '../types';

// Logistic xG on distance + opening angle (fit offline, see README / tests):
//   base(d, a) = PMAX * sigmoid(B0 + B1*d + B2*a + B3*d²),  d clamped at D_KNEE
// Calibrated so an unpressured penalty-spot shot ≈ 0.76 and a central shot at the
// edge of the box (18 m) ≈ 0.09. Beyond D_KNEE the value decays exponentially.
const B0 = 0.2748;
const B1 = -0.4697;
const B2 = 8.2655;
const B3 = 0.0082;
const PMAX = 0.95;
const D_KNEE = 28.5; // vertex of the quadratic
const LONG_DECAY = 0.08;

// Context modifiers (on the logit scale).
const PRESSURE_COEF = -1.8; // full pressure on the shooter
const BLOCKER_COEF = -0.8; // per outfield defender inside the shot triangle
const MAX_BLOCKERS = 2;
const HEADER_COEF = -1.0;
const KEEPER_SET_COEF = -0.7; // keeper inside the shot triangle (fades out beyond ~10 m)
const KEEPER_CLOSE_COEF = -0.8; // keeper rushing out to within ~5 m

export type ShotContext = {
  pressure?: number; // 0..1
  blockers?: number; // defenders in the shot cone (GK excluded)
  header?: boolean;
  keeperInCone?: boolean;
  keeperDistance?: number; // metres from shooter
};

export function xgBase(p: Vec2): number {
  const d = distToGoal(p);
  const a = goalAngle(p);
  const dc = Math.min(d, D_KNEE);
  const pr = PMAX * sigmoid(B0 + B1 * dc + B2 * a + B3 * dc * dc);
  return d > D_KNEE ? pr * Math.exp(-(d - D_KNEE) * LONG_DECAY) : pr;
}

export function xg(p: Vec2, ctx: ShotContext = {}): number {
  const base = xgBase(p);
  const z =
    Math.log(base / (1 - base)) +
    PRESSURE_COEF * (ctx.pressure ?? 0) +
    BLOCKER_COEF * Math.min(ctx.blockers ?? 0, MAX_BLOCKERS) +
    (ctx.header ? HEADER_COEF : 0) +
    (ctx.keeperInCone ? KEEPER_SET_COEF * Math.min(1, Math.max(0, (18 - distToGoal(p)) / 8)) : 0) +
    (ctx.keeperDistance !== undefined ? KEEPER_CLOSE_COEF * Math.max(0, Math.min(1, (6 - ctx.keeperDistance) / 4)) : 0);
  return sigmoid(z);
}

/** Outfield defenders standing inside the triangle shooter -> posts. */
export function countBlockers(shooter: Vec2, defenders: Vec2[]): number {
  return defenders.filter((d) => d.x > shooter.x && inTriangle(d, shooter, POST_LOW, POST_HIGH)).length;
}

/** Full in-game context for a shot from `shooter` given every opponent (keeper flagged). */
export function shotContext(shooter: Vec2, opponents: { pos: Vec2; isGK: boolean }[]): ShotContext {
  const keeper = opponents.find((o) => o.isGK);
  const outfield = opponents.filter((o) => !o.isGK).map((o) => o.pos);
  return {
    pressure: pressureAt(shooter, opponents.map((o) => o.pos)),
    blockers: countBlockers(shooter, outfield),
    keeperInCone: keeper ? inTriangle(keeper.pos, shooter, POST_LOW, POST_HIGH) : false,
    keeperDistance: keeper ? dist(keeper.pos, shooter) : undefined,
  };
}

export const PENALTY_XG = 0.76;

// Finishing: xG is the quality of the chance (player-agnostic, as in real analytics);
// the chance *this* player scores it shifts with their finishing rating (logit scale).
const FINISHING_COEF = 1.6;
export const FINISHING_BASELINE = 0.74; // the average shot-taker's rating: across all shots, goals ≈ xG

/** Goal probability for a given chance (xG) taken by a player with this finishing rating. */
export function finishingAdjust(chanceXg: number, finishing = FINISHING_BASELINE): number {
  const p = Math.min(0.99, Math.max(0.001, chanceXg));
  return sigmoid(Math.log(p / (1 - p)) + FINISHING_COEF * (finishing - FINISHING_BASELINE));
}
