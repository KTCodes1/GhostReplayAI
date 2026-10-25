import type { Vec2 } from '../types';
import { opponentXt } from './xt';

/** EV = pSuccess × value_if_success − (1 − pSuccess) × turnover_cost */
export function expectedValue(pSuccess: number, valueIfSuccess: number, turnoverCost: number): number {
  return pSuccess * valueIfSuccess - (1 - pSuccess) * turnoverCost;
}

/** Turnover cost = opponent's xT where we lose it (p in our attacking frame). */
export const turnoverCost = (lossAt: Vec2): number => opponentXt(lossAt);
