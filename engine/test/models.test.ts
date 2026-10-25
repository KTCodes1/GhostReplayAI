import { describe, expect, it } from 'vitest';
import {
  XT_GRID,
  carrySuccessProb,
  expectedValue,
  opponentXt,
  passDifficulty,
  passSuccessProb,
  xg,
  xgBase,
  xt,
  xtCell,
} from '../src/index';

const P = (x: number, y: number) => ({ x, y });

describe('xG', () => {
  it('is calibrated: penalty spot ≈ 0.76, central edge of box ≈ 0.07–0.10', () => {
    expect(xgBase(P(94, 34))).toBeGreaterThan(0.74);
    expect(xgBase(P(94, 34))).toBeLessThan(0.79);
    expect(xgBase(P(87, 34))).toBeGreaterThan(0.07);
    expect(xgBase(P(87, 34))).toBeLessThanOrEqual(0.1);
  });

  it('falls with distance and with tighter angles', () => {
    expect(xgBase(P(99, 34))).toBeGreaterThan(xgBase(P(94, 34)));
    expect(xgBase(P(80, 34))).toBeLessThan(xgBase(P(87, 34)));
    expect(xgBase(P(60, 34))).toBeLessThan(xgBase(P(80, 34)));
    expect(xgBase(P(99, 10))).toBeLessThan(xgBase(P(99, 30)));
  });

  it('never exceeds 1 and stays positive everywhere', () => {
    for (let x = 50; x <= 104.5; x += 2.5)
      for (let y = 1; y <= 67; y += 3) {
        const p = xgBase(P(x, y));
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }
  });

  it('is reduced by pressure, blockers and a set keeper', () => {
    const base = xg(P(92, 34));
    expect(xg(P(92, 34), { pressure: 1 })).toBeLessThan(base);
    expect(xg(P(92, 34), { blockers: 2 })).toBeLessThan(xg(P(92, 34), { blockers: 1 }));
    expect(xg(P(97, 34), { keeperInCone: true })).toBeLessThan(xg(P(97, 34)));
  });
});

describe('xT', () => {
  it('uses the 12×8 grid and is symmetric across the pitch', () => {
    expect(XT_GRID).toHaveLength(8);
    expect(XT_GRID[0]).toHaveLength(12);
    expect(xt(P(90, 20))).toBeCloseTo(xt(P(90, 48)), 10);
  });

  it('rises towards the opposition goal through the centre', () => {
    let prev = 0;
    for (let x = 4; x <= 101; x += 8.75) {
      const v = xtCell(P(x, 34));
      expect(v).toBeGreaterThanOrEqual(prev - 0.002); // tiny dips exist in the published grid
      prev = v;
    }
    expect(xtCell(P(101, 34))).toBeCloseTo(0.2575, 3);
  });

  it('opponentXt mirrors the pitch: losing it in our box is expensive', () => {
    expect(opponentXt(P(4, 34))).toBeCloseTo(xt(P(101, 34)), 10);
    expect(opponentXt(P(4, 34))).toBeGreaterThan(opponentXt(P(90, 34)));
  });
});

describe('pass model', () => {
  const none: { x: number; y: number }[] = [];

  it('short open passes are near-certain, long ones are not', () => {
    expect(passSuccessProb(P(40, 34), P(50, 34), none)).toBeGreaterThan(0.93);
    expect(passSuccessProb(P(30, 34), P(80, 34), none)).toBeLessThan(0.5);
  });

  it('decreases with distance', () => {
    let prev = 1;
    for (let d = 5; d <= 60; d += 5) {
      const p = passSuccessProb(P(20, 34), P(20 + d, 34), none);
      expect(p).toBeLessThan(prev);
      prev = p;
    }
  });

  it('a defender in the lane, pressure on the passer, or a marked receiver all lower it', () => {
    const base = passSuccessProb(P(40, 34), P(60, 34), none);
    expect(passSuccessProb(P(40, 34), P(60, 34), [P(50, 34.5)])).toBeLessThan(base - 0.2);
    expect(passSuccessProb(P(40, 34), P(60, 34), [P(39, 33)])).toBeLessThan(base);
    expect(passSuccessProb(P(40, 34), P(60, 34), [P(61, 34)])).toBeLessThan(base);
  });

  it('difficulty is 1..10 from 1 - pSuccess', () => {
    expect(passDifficulty(0.97)).toBe(1);
    expect(passDifficulty(0.5)).toBe(5);
    expect(passDifficulty(0.01)).toBe(10);
    expect(passDifficulty(1)).toBe(1);
  });

  it('carrying into a crowd is harder than into space', () => {
    expect(carrySuccessProb(P(50, 34), P(58, 34), [P(56, 34)])).toBeLessThan(carrySuccessProb(P(50, 34), P(58, 34), []));
  });
});

describe('expected value', () => {
  it('follows EV = p·v − (1−p)·cost', () => {
    expect(expectedValue(0.8, 0.1, 0.05)).toBeCloseTo(0.8 * 0.1 - 0.2 * 0.05, 12);
    expect(expectedValue(1, 0.2, 1)).toBeCloseTo(0.2, 12);
  });
});

describe('player ratings', () => {
  it('a better finisher scores more of the same chance; an average one scores exactly xG', async () => {
    const { finishingAdjust, FINISHING_BASELINE } = await import('../src/index');
    expect(finishingAdjust(0.2, 0.9)).toBeGreaterThan(0.2);
    expect(finishingAdjust(0.2, 0.2)).toBeLessThan(0.2);
    expect(finishingAdjust(0.2, FINISHING_BASELINE)).toBeCloseTo(0.2, 10);
  });

  it('pace helps a dribble, good tacklers in the way hurt it', () => {
    const base = carrySuccessProb(P(50, 34), P(58, 34), [P(56, 34)], 0.5, 0.5, [0.5]);
    expect(carrySuccessProb(P(50, 34), P(58, 34), [P(56, 34)], 0.5, 0.9, [0.5])).toBeGreaterThan(base);
    expect(carrySuccessProb(P(50, 34), P(58, 34), [P(56, 34)], 0.5, 0.5, [0.95])).toBeLessThan(base);
  });

  it('a pass into the box is worth more to a better finisher', async () => {
    const { evaluatePass } = await import('../src/index');
    const ctx = (finishing: number) => ({
      carrier: { id: 'c', pos: P(80, 34), isGK: false },
      teammates: [{ id: 'st', pos: P(96, 34), isGK: false, finishing }],
      opponents: [{ id: 'gk', pos: P(103, 34), isGK: true }],
    });
    const good = evaluatePass(ctx(0.9), 'st', P(96, 34));
    const poor = evaluatePass(ctx(0.3), 'st', P(96, 34));
    expect(good.valueIfSuccess).toBeGreaterThan(poor.valueIfSuccess);
    expect(good.pSuccess).toBeCloseTo(poor.pSuccess, 10); // finishing changes the value, not the pass
  });
});
