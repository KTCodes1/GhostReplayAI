import { clamp, dist, pointToSegment, sigmoid } from '../geometry';
import type { Vec2 } from '../types';

// Pass success: logistic on distance, defenders near the passing lane (corridor check),
// pressure on the passer and space around the receiver.
const P_INTERCEPT = 3.6;
const P_DIST = -0.055; // per metre
const P_DIST2 = -0.0006; // per metre², long balls get disproportionately harder
const P_LANE = -2.0; // per unit of lane threat
const P_PRESSURE = -0.9;
const P_TIGHT = -1.6; // receiver fully marked
const LOFTED_FROM = 30; // passes longer than this are lofted and clear most lane defenders
const LOFTED_LANE_FACTOR = 0.4;

export const PRESSURE_RADIUS = 5; // metres: no pressure beyond this
const RECEIVER_SPACE_RADIUS = 5;

/** 0..1 pressure from the nearest opponent (1 = touching distance). */
export function pressureAt(p: Vec2, opponents: Vec2[]): number {
  const d = nearestDistance(p, opponents);
  return clamp((PRESSURE_RADIUS - d) / (PRESSURE_RADIUS - 1), 0, 1);
}

export function nearestDistance(p: Vec2, others: Vec2[]): number {
  let best = Infinity;
  for (const o of others) best = Math.min(best, dist(p, o));
  return best;
}

/** Sum of interception threat from defenders near the ball path (excludes the endpoints). */
export function laneThreat(start: Vec2, end: Vec2, opponents: Vec2[]): number {
  const length = dist(start, end);
  let threat = 0;
  for (const o of opponents) {
    const { d, u } = pointToSegment(o, start, end);
    if (u <= 0.05 || u >= 0.92) continue;
    // Defenders further along the lane have more time to step across.
    const reach = 1.2 + 0.05 * length * u;
    threat += Math.exp(-((d / reach) ** 2));
  }
  return length > LOFTED_FROM ? threat * LOFTED_LANE_FACTOR : threat;
}

export type PassFeatures = {
  distance: number;
  laneThreat: number;
  pressure: number;
  receiverSpace: number; // 0 (marked) .. 1 (free)
};

export function passFeatures(start: Vec2, end: Vec2, opponents: Vec2[]): PassFeatures {
  return {
    distance: dist(start, end),
    laneThreat: laneThreat(start, end, opponents),
    pressure: pressureAt(start, opponents),
    receiverSpace: clamp(nearestDistance(end, opponents) / RECEIVER_SPACE_RADIUS, 0, 1),
  };
}

export function passProbFromFeatures(f: PassFeatures, passerSkill = 0.5): number {
  const z =
    P_INTERCEPT +
    P_DIST * f.distance +
    P_DIST2 * f.distance * f.distance +
    P_LANE * f.laneThreat +
    P_PRESSURE * f.pressure +
    P_TIGHT * (1 - f.receiverSpace) +
    (passerSkill - 0.5) * 1.2;
  return sigmoid(z);
}

export function passSuccessProb(start: Vec2, end: Vec2, opponents: Vec2[], passerSkill = 0.5): number {
  return passProbFromFeatures(passFeatures(start, end, opponents), passerSkill);
}

/** 1 (trivial) .. 10 (near impossible), from 1 - pSuccess. */
export function passDifficulty(pSuccess: number): number {
  return clamp(Math.ceil((1 - pSuccess) * 10), 1, 10);
}

// Carry success: pressure on the carrier and defenders along the carry path. Better tacklers
// in the way make it harder; a quicker, trickier carrier makes it easier.
export function carrySuccessProb(start: Vec2, end: Vec2, opponents: Vec2[], dribbling = 0.5, pace = 0.5, tackling?: number[]): number {
  let ahead = 0;
  opponents.forEach((o, i) => {
    const { d, u } = pointToSegment(o, start, end);
    if (u < 0 || u > 1.3) return;
    ahead += Math.exp(-((d / 3) ** 2)) * (0.6 + 0.8 * (tackling?.[i] ?? 0.5));
  });
  // Dribbling into the box means beating a crowd.
  const boxPenalty = end.x > 88.5 && Math.abs(end.y - 34) < 20 ? 0.8 + (end.x - 88.5) * 0.12 : 0;
  const z = 3.3 - 1.4 * pressureAt(start, opponents) - 1.6 * ahead - boxPenalty - 0.04 * dist(start, end) + (dribbling - 0.5) * 1.5 + (pace - 0.5) * 0.8;
  return sigmoid(z);
}
