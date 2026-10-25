import type { Side, Vec2 } from './types';

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
export const GOAL_WIDTH = 7.32;
export const GOAL_CENTER: Vec2 = { x: PITCH_LENGTH, y: PITCH_WIDTH / 2 };
export const POST_LOW: Vec2 = { x: PITCH_LENGTH, y: PITCH_WIDTH / 2 - GOAL_WIDTH / 2 };
export const POST_HIGH: Vec2 = { x: PITCH_LENGTH, y: PITCH_WIDTH / 2 + GOAL_WIDTH / 2 };

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function clampToPitch(p: Vec2, margin = 0.5): Vec2 {
  return { x: clamp(p.x, margin, PITCH_LENGTH - margin), y: clamp(p.y, margin, PITCH_WIDTH - margin) };
}

/** Rotate a point 180° about the centre spot (switches attacking direction). */
export const flip = (p: Vec2): Vec2 => ({ x: PITCH_LENGTH - p.x, y: PITCH_WIDTH - p.y });

/** Absolute frame = home attacks left -> right. */
export const toTeamFrame = (p: Vec2, team: Side): Vec2 => (team === 'home' ? { ...p } : flip(p));
export const toAbsolute = (p: Vec2, team: Side): Vec2 => (team === 'home' ? { ...p } : flip(p));
export const flipVel = (vel: Vec2): Vec2 => ({ x: -vel.x, y: -vel.y });

/** Distance from p to segment ab, and the projection parameter u in [0,1]. */
export function pointToSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; u: number } {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  if (l2 < 1e-9) return { d: dist(p, a), u: 0 };
  const uRaw = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2;
  const u = clamp(uRaw, 0, 1);
  return { d: dist(p, { x: a.x + ab.x * u, y: a.y + ab.y * u }), u: uRaw };
}

/** Opening angle (radians) of the goal mouth as seen from p (attacking towards x = 105). */
export function goalAngle(p: Vec2): number {
  const a1 = Math.atan2(POST_LOW.y - p.y, PITCH_LENGTH - p.x);
  const a2 = Math.atan2(POST_HIGH.y - p.y, PITCH_LENGTH - p.x);
  return Math.abs(a2 - a1);
}

export const distToGoal = (p: Vec2): number => dist(p, GOAL_CENTER);

/** True if q lies inside triangle abc. */
export function inTriangle(q: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const s = (p1: Vec2, p2: Vec2, p3: Vec2) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = s(q, a, b);
  const d2 = s(q, b, c);
  const d3 = s(q, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** In the penalty area of the goal at x = 105. */
export const inBox = (p: Vec2): boolean => p.x >= PITCH_LENGTH - 16.5 && Math.abs(p.y - PITCH_WIDTH / 2) <= 20.16;
