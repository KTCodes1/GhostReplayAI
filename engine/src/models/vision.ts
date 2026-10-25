// What could the player actually see? Freeze frames are a god's-eye view; the player on the ball
// sees a cone in front of them. We estimate which way they were facing and label every option as
// visible (central vision), peripheral, or behind them, so they are only blamed for what they could see.
// All positions are in the acting team's frame (attacking towards x = 105).

import { clamp, norm, sub } from '../geometry';
import type { MatchEvent, Vec2 } from '../types';

export type Visibility = 'visible' | 'peripheral' | 'behind';

export type VisionCone = {
  facing: Vec2; // unit vector
  /** Half-angles in degrees: within `centralDeg` is clear sight, within `peripheralDeg` the edge of vision. */
  centralDeg: number;
  peripheralDeg: number;
  /** How the facing was worked out, for the explanation. */
  basis: 'running' | 'receiving' | 'default';
};

const RUNNING_SPEED = 2.5; // m/s: above this, a player faces the way they're moving
const CENTRAL_DEG = 70;
const PERIPHERAL_DEG = 125;
/** Good decision-makers scan before the ball arrives, which widens what they "see". */
const SCAN_BONUS_DEG = 20;
/** Time on the ball lets anyone check their shoulder: no pressure opens the cone by this much. */
const TIME_BONUS_DEG = 35;

const rotateTowards = (from: Vec2, to: Vec2, t: number): Vec2 => {
  const a0 = Math.atan2(from.y, from.x);
  let d = Math.atan2(to.y, to.x) - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const a = a0 + d * t;
  return { x: Math.cos(a), y: Math.sin(a) };
};

/**
 * Which way was the player facing at the moment of the event?
 * - running: they face the way they're moving;
 * - receiving: they face back towards the passer, then open their body towards goal
 *   (better decision-makers open up more);
 * - after their own carry: the way they carried it;
 * - otherwise: towards the opponent's goal, nudged by any movement.
 * How wide they can see depends on time on the ball: under pressure the cone narrows,
 * with time they can check their shoulder.
 */
export function estimateVision(e: MatchEvent, prev: MatchEvent | undefined, decision = 0.6): VisionCone {
  const me = e.freezeFrame.find((s) => s.playerId === e.playerId);
  const vel = me?.vel ?? { x: 0, y: 0 };
  const speed = Math.hypot(vel.x, vel.y);
  const goal = { x: 1, y: 0 };
  const scan = clamp((decision - 0.5) / 0.4, 0, 1) * SCAN_BONUS_DEG;
  const nearest = Math.min(...e.freezeFrame.filter((s) => s.team !== e.team).map((s) => Math.hypot(s.pos.x - e.start.x, s.pos.y - e.start.y)));
  const time = clamp((nearest - 1) / 5, 0, 1); // 0 = defender on top of them, 1 = 6 m+ of room
  const cone = (facing: Vec2, basis: VisionCone['basis']): VisionCone => ({
    facing: norm(facing),
    centralDeg: CENTRAL_DEG + scan * 0.5 + time * TIME_BONUS_DEG * 0.5,
    peripheralDeg: Math.min(175, PERIPHERAL_DEG + scan + time * TIME_BONUS_DEG),
    basis,
  });

  if (speed >= RUNNING_SPEED) return cone(rotateTowards(norm(vel), goal, 0.15), 'running');
  const received = prev && prev.type === 'pass' && prev.outcome === 'success' && prev.team === e.team && prev.targetPlayerId === e.playerId;
  if (received) {
    const towardsPasser = norm(sub(prev.start, e.start));
    if (Math.hypot(towardsPasser.x, towardsPasser.y) > 0) return cone(rotateTowards(towardsPasser, goal, 0.3 + 0.45 * decision), 'receiving');
  }
  const carried = prev && prev.type === 'carry' && prev.outcome === 'success' && prev.playerId === e.playerId && prev.end;
  if (carried) return cone(sub(prev.end!, prev.start), 'running');
  return cone(speed > 0.5 ? rotateTowards(goal, norm(vel), 0.3) : goal, 'default');
}

/** Angle in degrees between the facing direction and the line from `from` to `to`. */
export function angleOff(cone: VisionCone, from: Vec2, to: Vec2): number {
  const d = norm(sub(to, from));
  const dot = clamp(d.x * cone.facing.x + d.y * cone.facing.y, -1, 1);
  return (Math.acos(dot) * 180) / Math.PI;
}

export function visibilityOf(cone: VisionCone, from: Vec2, to: Vec2): Visibility {
  const a = angleOff(cone, from, to);
  return a <= cone.centralDeg ? 'visible' : a <= cone.peripheralDeg ? 'peripheral' : 'behind';
}
