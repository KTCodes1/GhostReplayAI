// Usage: npm run fit-calibration -w @ghost/engine
// Fits the pass-probability calibration (Platt scaling) on TRAINING matches (seeds 1-12) and prints
// the constants for src/models/calibration.ts. Held-out matches (seeds 101+) are never used here.

import { PASS_CALIBRATION, analyzeEvent, buildRoster, generateMatch } from '../src/index';

PASS_CALIBRATION.a = 1;
PASS_CALIBRATION.b = 0; // measure the uncalibrated model

const xs: number[] = [];
const ys: number[] = [];
for (let seed = 1; seed <= 12; seed++) {
  const m = generateMatch({ seed });
  const roster = buildRoster(m.meta);
  m.events.forEach((e, i) => {
    if (e.type !== 'pass') return;
    const a = analyzeEvent(e, roster, m.events[i - 1]);
    if (!a) return;
    const p = Math.min(1 - 1e-4, Math.max(1e-4, a.actual.pSuccess));
    xs.push(Math.log(p / (1 - p)));
    ys.push(e.outcome === 'success' ? 1 : 0);
  });
}

// Logistic regression y ~ sigmoid(a·x + b) by Newton's method.
let a = 1;
let b = 0;
for (let it = 0; it < 50; it++) {
  let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
  for (let i = 0; i < xs.length; i++) {
    const p = 1 / (1 + Math.exp(-(a * xs[i]! + b)));
    const r = ys[i]! - p;
    const w = p * (1 - p);
    ga += r * xs[i]!;
    gb += r;
    haa += w * xs[i]! * xs[i]!;
    hab += w * xs[i]!;
    hbb += w;
  }
  const det = haa * hbb - hab * hab;
  const da = (hbb * ga - hab * gb) / det;
  const db = (haa * gb - hab * ga) / det;
  a += da;
  b += db;
  if (Math.abs(da) + Math.abs(db) < 1e-9) break;
}
console.log(`${xs.length} training passes (seeds 1-12). Fitted: a = ${a.toFixed(3)}, b = ${b.toFixed(3)}`);
console.log(`Put these in engine/src/models/calibration.ts: export const PASS_CALIBRATION = { a: ${a.toFixed(3)}, b: ${b.toFixed(3)} };`);
