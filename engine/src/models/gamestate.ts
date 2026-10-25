// No decision happens in a vacuum. Winning 1-0 in the 89th minute, keeping the ball is worth more
// than a risky through ball; 1-0 down in the 85th, the risk is worth taking. The game state scales
// how much losing the ball hurts (loss aversion) and how much a dangerous position is worth.

import type { MatchEvent, Side } from '../types';

export type GameStateCode = 'open' | 'protecting' | 'comfortable' | 'chasing' | 'desperate';

export type GameState = {
  code: GameStateCode;
  /** Plain words, e.g. "protecting a 1-0 lead, 87'". */
  label: string;
  minute: number;
  margin: number; // goals ahead (negative = behind) for the team on the ball
  /** Multiplies the cost of losing the ball. */
  lossAversion: number;
  /** Multiplies the value of reaching a dangerous position. */
  riskAppetite: number;
};

export const NEUTRAL_STATE: GameState = { code: 'open', label: 'open game', minute: 0, margin: 0, lossAversion: 1, riskAppetite: 1 };

/**
 * `directness` is the team's style (0..1): patient sides are a little more loss-averse anyway.
 * Before an event the score is unchanged for passes/carries; for a shot that scored, use the score before it.
 */
export function gameStateFor(e: MatchEvent, directness = 0.5): GameState {
  const team: Side = e.team;
  const opp: Side = team === 'home' ? 'away' : 'home';
  const scored = e.type === 'shot' && e.outcome === 'goal' ? 1 : 0;
  const margin = e.score[team] - scored - e.score[opp];
  const minute = Math.floor(e.clockMs / 60000) + 1;
  const style = 1 + (0.5 - directness) * 0.2;
  const score = `${Math.max(e.score[team] - scored, e.score[opp])}-${Math.min(e.score[team] - scored, e.score[opp])}`;
  const s = (code: GameStateCode, label: string, lossAversion: number, riskAppetite: number): GameState => ({ code, label: `${label}, ${minute}'`, minute, margin, lossAversion: lossAversion * style, riskAppetite });

  if (margin > 0 && minute >= 80) return s('protecting', `protecting a ${score} lead`, 1.8, 0.9);
  if (margin >= 2 && minute >= 65) return s('comfortable', `${score} up and in control`, 1.4, 0.95);
  if (margin <= -2 && minute >= 75) return s('desperate', `${score} down and running out of time`, 0.45, 1.4);
  if (margin < 0 && minute >= 75) return s('chasing', `chasing the game at ${score}`, 0.6, 1.25);
  return { ...NEUTRAL_STATE, label: `${margin === 0 ? `level at ${score}` : margin > 0 ? `${score} up` : `${score} down`}, ${minute}'`, minute, margin, lossAversion: style };
}
