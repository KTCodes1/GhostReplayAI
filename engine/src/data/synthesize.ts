// Synthetic squad generator — only used by scripts/make-profiles.ts to (re)write profiles.ts.
// Everything here is invented: names, ratings and season stats. A real deployment would
// replace profiles.ts with a league's actual player data in the same shape.

import { Rng, hashSeed } from '../rng';
import { CLUBS, FORMATIONS } from '../sim/teams';
import type { PlayerAttributes, PlayerProfile, Position, SeasonStats } from '../types';

export const SEASONS = { current: '2026/27', previous: '2025/26' } as const;

const FIRST = ['Jamie', 'Kofi', 'Luca', 'Mateo', 'Theo', 'Ruben', 'Yusuf', 'Callum', 'Niko', 'Andre', 'Sami', 'Oskar', 'Rafael', 'Tomas', 'Kai', 'Elias', 'Malik', 'Joel', 'Ivan', 'Dario', 'Felix', 'Hugo', 'Leon', 'Marco', 'Noah', 'Owen', 'Pablo', 'Rhys', 'Sven', 'Tariq', 'Ugo', 'Victor', 'Wes', 'Xavi', 'Yann', 'Zeki', 'Ade', 'Bruno', 'Cian', 'Dami'];
// Invented surnames, chosen not to match well-known footballers (same length and order as the
// original list, so every squad keeps its draws and ratings).
const LAST = ['Ezeoha', 'Lindqvist', 'Moreau', 'Hartley', 'Castellano', 'Takenouchi', 'Brennan', 'Achterberg', 'Valadares', 'Brzezina', 'Ansomah', 'Delacroix', 'Ferrandes', 'Halloran', 'Ibrisevic', 'Jovancic', 'Kessler', 'Lombardi', 'Mbekwa', 'Novotar', 'Oyelaran', 'Petrunin', 'Quinlan', 'Rasmark', 'Santoro', 'Thorne', 'Uesaka', 'Vasquez', 'Whitlock', 'Yildiran', 'Zielonka', 'Asafo', 'Bergstrom', 'Coelheiro', 'Dunmore', 'Eriksrud', 'Foulani', 'Gallowen', 'Haddad', 'Iweka'];

type Group = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'W' | 'AM' | 'ST';
const groupOf = (p: Position): Group =>
  p === 'GK' ? 'GK' : p === 'CB' ? 'CB' : p === 'LB' || p === 'RB' ? 'FB' : p === 'DM' ? 'DM' : p === 'CM' ? 'CM' : p === 'AM' ? 'AM' : p === 'ST' ? 'ST' : 'W';

/** Per-90 output rates by role, driven by the ratings. */
function rates(g: Group, a: PlayerAttributes) {
  const sq = (x: number) => x * x;
  const goals = { GK: 0, CB: 0.01 + 0.05 * a.finishing, FB: 0.01 + 0.05 * a.finishing, DM: 0.02 + 0.06 * sq(a.finishing), CM: 0.03 + 0.14 * sq(a.finishing), W: 0.1 + 0.38 * sq(a.finishing), AM: 0.1 + 0.32 * sq(a.finishing), ST: 0.22 + 0.6 * sq(a.finishing) }[g];
  const assists = { GK: 0.003, CB: 0.01 + 0.02 * a.passing, FB: 0.04 + 0.12 * sq(a.passing), DM: 0.03 + 0.08 * sq(a.passing), CM: 0.05 + 0.2 * sq(a.passing), W: 0.08 + 0.26 * sq(a.passing), AM: 0.1 + 0.3 * sq(a.passing), ST: 0.06 + 0.16 * sq(a.passing) }[g];
  const tackles = { GK: 0, CB: 1.1 + 1.8 * a.tackling, FB: 1.2 + 1.8 * a.tackling, DM: 1.5 + 2.2 * a.tackling, CM: 1.0 + 1.6 * a.tackling, W: 0.4 + 0.9 * a.tackling, AM: 0.4 + 0.8 * a.tackling, ST: 0.2 + 0.6 * a.tackling }[g];
  const interceptions = { GK: 0.1, CB: 1.0 + 1.5 * a.tackling, FB: 0.8 + 1.0 * a.tackling, DM: 1.0 + 1.3 * a.tackling, CM: 0.5 + 0.8 * a.tackling, W: 0.2 + 0.3 * a.tackling, AM: 0.2 + 0.3 * a.tackling, ST: 0.1 + 0.2 * a.tackling }[g];
  const passAccuracy = Math.min(0.93, Math.max(0.6, 0.6 + 0.32 * a.passing + (g === 'CB' ? 0.04 : g === 'ST' ? -0.05 : 0)));
  return { goals, assists, tackles, interceptions, passAccuracy };
}

function season(label: string, apps: number, g: Group, a: PlayerAttributes, rng: Rng): SeasonStats {
  const r = rates(g, a);
  const nineties = apps * rng.range(0.75, 0.95);
  const count = (perNinety: number) => Math.max(0, Math.round(perNinety * nineties * rng.range(0.8, 1.2)));
  return {
    season: label,
    apps,
    goals: count(r.goals),
    assists: count(r.assists),
    tackles: count(r.tackles),
    interceptions: count(r.interceptions),
    passAccuracy: +Math.min(0.95, r.passAccuracy + rng.normal(0, 0.015)).toFixed(3),
  };
}

export function synthesizeSquad(clubId: string): PlayerProfile[] {
  const club = CLUBS.find((c) => c.id === clubId);
  if (!club) throw new Error(`Unknown club ${clubId}`);
  // Same seed + draw order as the original squads, so existing names and core ratings are kept.
  const rng = new Rng(hashSeed(`squad:${clubId}`));
  const used = new Set<string>();
  return FORMATIONS[club.formation].map((slot) => {
    let first: string;
    let last: string;
    do {
      first = rng.pick(FIRST);
      last = rng.pick(LAST);
    } while (used.has(last));
    used.add(last);

    const r = (lo: number, hi: number) => +rng.range(lo, hi).toFixed(2);
    const pos = slot.position;
    const attacker = ['ST', 'RW', 'LW', 'AM'].includes(pos);
    const mid = ['DM', 'CM', 'RM', 'LM'].includes(pos);
    const passing = pos === 'GK' ? r(0.35, 0.6) : mid ? r(0.6, 0.92) : attacker ? r(0.5, 0.82) : r(0.45, 0.75);
    const finishing = attacker ? r(0.6, 0.92) : mid ? r(0.35, 0.7) : r(0.1, 0.4);
    const dribbling = attacker ? r(0.6, 0.92) : mid ? r(0.45, 0.8) : r(0.3, 0.6);
    const decision = r(0.45, 0.92);
    const shotBias = attacker ? r(-0.1, 0.9) : mid ? r(-0.4, 0.5) : r(-0.8, 0);

    // New ratings and stats come from their own seed so they don't disturb the draws above.
    const extra = new Rng(hashSeed(`profile:${clubId}:${slot.number}`));
    const e = (lo: number, hi: number) => +extra.range(lo, hi).toFixed(2);
    const g = groupOf(pos);
    const tackling = { GK: e(0.1, 0.3), CB: e(0.62, 0.92), FB: e(0.55, 0.85), DM: e(0.62, 0.93), CM: e(0.4, 0.75), W: e(0.2, 0.5), AM: e(0.2, 0.5), ST: e(0.15, 0.45) }[g];
    const pace = { GK: e(0.2, 0.4), CB: e(0.4, 0.75), FB: e(0.6, 0.9), DM: e(0.4, 0.72), CM: e(0.45, 0.8), W: e(0.68, 0.96), AM: e(0.55, 0.85), ST: e(0.55, 0.92) }[g];
    const attrs: PlayerAttributes = { passing, finishing, dribbling, tackling, pace, decision, shotBias };

    return {
      name: `${first} ${last}`,
      shortName: last,
      number: slot.number,
      position: pos,
      role: slot.role,
      attrs,
      seasons: {
        current: season(SEASONS.current, extra.int(5, 9), g, attrs, extra),
        previous: season(SEASONS.previous, extra.int(22, 38), g, attrs, extra),
      },
    };
  });
}
