// Calibration of the judged pass probability (Platt scaling: p' = sigmoid(a · logit(p) + b)).
// Fitted on TRAINING matches only (seeds 1-12) by `npm run fit-calibration -w @ghost/engine`, then
// checked on held-out matches by `npm run validate`. Without it, the judge is too pessimistic about
// risky passes players actually chose to play.

import { clamp, sigmoid } from '../geometry';

/** Mutable so the fitting script can switch it off (a = 1, b = 0) while it measures. */
export const PASS_CALIBRATION = { a: 0.689, b: 0.604 };

export function calibratePass(p: number): number {
  const q = clamp(p, 1e-4, 1 - 1e-4);
  return sigmoid(PASS_CALIBRATION.a * Math.log(q / (1 - q)) + PASS_CALIBRATION.b);
}
