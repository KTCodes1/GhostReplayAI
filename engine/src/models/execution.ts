// Decision vs execution: the best option on paper might be a 40 m ball on the weaker foot under
// pressure. This adjusts an option's chance of coming off for what *this* player can execute in
// *this* moment, and says why in plain words.

import { clamp, dist, sigmoid } from '../geometry';
import { hashSeed } from '../rng';
import type { PlayerAttributes, Vec2 } from '../types';
import type { VisionCone } from './vision';

export type Footedness = { foot: 'right' | 'left'; weakFoot: number /* 0..1 */ };

/** Synthetic but stable per player: ~78% right-footed; weak-foot quality loosely tracks passing. */
export function footedness(playerId: string, passing = 0.6): Footedness {
  const h = hashSeed(`foot:${playerId}`);
  const foot = h % 100 < 78 ? 'right' : 'left';
  const weakFoot = clamp(0.2 + ((h >>> 8) % 1000) / 1000 * 0.5 + (passing - 0.6) * 0.5, 0.15, 0.9);
  return { foot, weakFoot };
}

export type ExecutionFit = {
  /** Logit-scale adjustment to the option's chance of coming off (≤ 0). */
  logitAdj: number;
  /** 0..1: how well the demand matches the player (1 = routine for them). */
  fit: number;
  notes: string[];
};

const LONG_FROM = 30; // metres: shorter passes are already covered by the base pass model

/**
 * The demands of a pass on this player, beyond what the base pass model already prices in
 * (distance, pressure and passing quality are in there): real range for a weaker passer and the
 * weaker foot. Turning to play a ball behind them is noted, not priced: in the simulated world
 * those passes come off as often as any other, and an execution model must stay calibrated.
 */
export function passExecution(
  from: Vec2,
  to: Vec2,
  attrs: Pick<PlayerAttributes, 'passing' | 'decision'>,
  feet: Footedness,
  pressure: number,
  cone?: VisionCone,
): ExecutionFit {
  const notes: string[] = [];
  let adj = 0;
  const d = dist(from, to);
  if (d > LONG_FROM) {
    const range = -((d - LONG_FROM) / 20) * (1 - attrs.passing) * 1.2;
    if (range < -0.15) notes.push(`a ${Math.round(d)} m ball is at the edge of their range (passing ${Math.round(attrs.passing * 100)})`);
    adj += range;
  }
  if (cone && d > 16) {
    // Which side of their body is the pass going? Positive cross = to their left.
    const dx = (to.x - from.x) / d;
    const dy = (to.y - from.y) / d;
    const cross = cone.facing.x * dy - cone.facing.y * dx;
    const dot = cone.facing.x * dx + cone.facing.y * dy;
    const sharp = Math.abs(Math.atan2(cross, dot)) > (40 * Math.PI) / 180;
    const weakSide = (feet.foot === 'right' && cross > 0) || (feet.foot === 'left' && cross < 0);
    if (sharp && weakSide) {
      const w = -(1 - feet.weakFoot) * 0.9;
      adj += w;
      if (w < -0.3) notes.push(`it needs the weaker ${feet.foot === 'right' ? 'left' : 'right'} foot`);
    }
  }
  if (pressure > 0.6 && attrs.decision < 0.55) notes.push('under heavy pressure');
  if (cone) {
    const toT = { x: to.x - from.x, y: to.y - from.y };
    const l = Math.hypot(toT.x, toT.y) || 1;
    const ang = (Math.acos(clamp((toT.x * cone.facing.x + toT.y * cone.facing.y) / l, -1, 1)) * 180) / Math.PI;
    if (ang > cone.peripheralDeg) notes.push('it means turning or playing it blind');
  }
  return { logitAdj: adj, fit: clamp(sigmoid(adj + 2.5) / sigmoid(2.5), 0, 1), notes };
}

/** Apply an execution adjustment to a probability. */
export function adjustP(p: number, logitAdj: number): number {
  const q = clamp(p, 1e-4, 1 - 1e-4);
  return sigmoid(Math.log(q / (1 - q)) + logitAdj);
}
