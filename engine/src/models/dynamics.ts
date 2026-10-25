// The world isn't frozen: everyone keeps moving while the ball travels. These helpers project
// players forward along their velocity, time a pass, and check offside — so a pass is judged on
// where the receiver and defenders will be when the ball gets there, not where they stood.
// All positions are in the acting team's frame (attacking towards x = 105).

import { PITCH_LENGTH, add, clamp, clampToPitch, dist, scale } from '../geometry';
import type { Vec2 } from '../types';

/** Typical ball speed for a pass of this length (m/s) — the generator's mean. */
export const passSpeed = (length: number) => clamp(10 + length * 0.28, 7, 30);
export const passTravelSec = (from: Vec2, to: Vec2) => dist(from, to) / passSpeed(dist(from, to));

const MAX_PROJECT_M = 9; // nobody keeps a straight line for ever
const MAX_SPEED = 8.5;

/** Where a player moving at `vel` will be after `sec` seconds. */
export function project(pos: Vec2, vel: Vec2 | undefined, sec: number): Vec2 {
  if (!vel) return pos;
  const speed = Math.hypot(vel.x, vel.y);
  const capped = speed > MAX_SPEED ? scale(vel, MAX_SPEED / speed) : vel;
  let d = scale(capped, sec);
  const l = Math.hypot(d.x, d.y);
  if (l > MAX_PROJECT_M) d = scale(d, MAX_PROJECT_M / l);
  return clampToPitch(add(pos, d), 0.5);
}

/** Offside line: the second-last opponent (keeper included), never behind the ball or the halfway line. */
export function offsideLine(opponents: Vec2[], ballX: number): number {
  const xs = opponents.map((o) => o.x).sort((a, b) => b - a);
  return Math.max(xs[1] ?? PITCH_LENGTH / 2, ballX, PITCH_LENGTH / 2);
}

/** Clearly offside: a metre and a half past the line, so tight calls go to the attacker. */
export const isOffside = (receiver: Vec2, line: number) => receiver.x > line + 1.5;

/**
 * Where to play a pass to a teammate who is moving: into the space they'll run into.
 * A runner gets the ball ahead of them; a static player gets it to feet (plus a small lead going forward).
 */
export function leadTarget(carrier: Vec2, receiver: Vec2, vel: Vec2 | undefined): { end: Vec2; runner: boolean; sec: number } {
  // Two passes of fixed-point iteration: travel time depends on where we aim.
  let end = receiver;
  let sec = passTravelSec(carrier, end);
  for (let i = 0; i < 2; i++) {
    end = project(receiver, vel, sec);
    sec = passTravelSec(carrier, end);
  }
  const speed = vel ? Math.hypot(vel.x, vel.y) : 0;
  const runner = speed >= 3 && (vel?.x ?? 0) > 1;
  if (!runner && receiver.x > carrier.x + 3 && receiver.x < PITCH_LENGTH - 6) end = add(end, { x: 2, y: 0 });
  return { end: clampToPitch(end, 1), runner, sec };
}
