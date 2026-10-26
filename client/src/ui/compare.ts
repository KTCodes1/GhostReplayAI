// Running readouts for the what-if timeline: as the real continuation and the ghost run play,
// how much threat (xT) has each built, what chance (xG) has it made, and has it kept the ball?

import { type MatchEvent, type MatchMeta, type Side, shotContext, xg, xt } from '@ghost/engine';
import type { TimedEvent } from '../store';

export type Readout = { xT: number; xG: number; status: string; ended: boolean };

const SHOT_WORDS: Record<string, string> = { goal: 'Goal', saved: 'Shot saved', blocked: 'Shot blocked', off_target: 'Shot off target' };

export function readout(timed: TimedEvent[], pt: number, team: Side, meta: MatchMeta): Readout {
  const keeper = new Set([...meta.home.players, ...meta.away.players].filter((p) => p.position === 'GK').map((p) => p.id));
  let xT = 0;
  let xG = 0;
  let status = 'In possession';
  let ended = false;
  for (const { pt: at, e } of timed) {
    if (at > pt || ended) break;
    if (e.team !== team) {
      // The other side acting means we've lost it (an interception, a tackle, their pass...).
      if (e.type !== 'pressure' && e.type !== 'foul') {
        status = 'Lost the ball';
        ended = true;
      }
      continue;
    }
    if ((e.type === 'pass' || e.type === 'carry') && e.end) {
      if (e.outcome === 'success') xT += xt(e.end) - xt(e.start);
      else {
        status = 'Lost the ball';
        ended = true;
      }
    }
    if (e.type === 'shot') xG += xg(e.start, shotContext(e.start, opponents(e, keeper)));
    if (e.type === 'shot') {
      status = SHOT_WORDS[e.outcome ?? ''] ?? 'Shot';
      ended = true;
    }
  }
  return { xT, xG, status, ended };
}

function opponents(e: MatchEvent, keeper: Set<string>) {
  return e.freezeFrame.filter((s) => s.team !== e.team).map((s) => ({ pos: s.pos, isGK: keeper.has(s.playerId) }));
}

export type Ending = { label: string; goal: boolean };
const ENDINGS: Record<string, string> = { goal: 'Goal', saved: 'Saved', blocked: 'Blocked', off_target: 'Wide' };
// Events by the other side that mean they have the ball (pressure alone doesn't).
const WON = new Set(['pass', 'carry', 'shot', 'interception', 'possession_change']);

/** How a run of events ended, in one word for the pitch: the last shot's result, else whether the ball was kept. */
export function endingOf(events: MatchEvent[], team: Side): Ending {
  const shot = [...events].reverse().find((e) => e.type === 'shot' && e.team === team);
  if (shot?.outcome) return { label: ENDINGS[shot.outcome] ?? 'Shot', goal: shot.outcome === 'goal' };
  const lost = events.some((e) => e.team !== team && (WON.has(e.type) || (e.type === 'tackle' && e.outcome === 'success')));
  return { label: lost ? 'Ball lost' : 'Kept the ball', goal: false };
}
