// "You're the player" votes: what fans (and anyone who coaches or plays) picked at each frozen
// moment, before the reveal. Saved to server/data/votes.json so the crowd builds up across
// sessions, and used to validate the model: how often do people agree with its pick?

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VoteTally } from '@ghost/engine';

type MomentVotes = { tally: VoteTally; modelKey: string; actualKey: string; kind: 'miss' | 'genius' };
type Store = Record<string, MomentVotes>; // `${matchId}|${eventId}`

const FILE = fileURLToPath(new URL('../data/votes.json', import.meta.url));

function load(): Store {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Store;
  } catch {
    return {};
  }
}

const store: Store = load();
let saveTimer: NodeJS.Timeout | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(store, null, 1));
    } catch (err) {
      console.warn(`[votes] could not save: ${(err as Error).message}`);
    }
  }, 500);
}

const keyOf = (matchId: string, eventId: string) => `${matchId}|${eventId}`;

/** Record a vote. `modelKey` is the engine's pick: the better option for a miss, the choice made for a genius moment. */
export function vote(matchId: string, eventId: string, key: string, role: 'fan' | 'coach', model: { modelKey: string; actualKey: string; kind: 'miss' | 'genius' }): { tally: VoteTally; total: number } {
  const k = keyOf(matchId, eventId);
  const m = (store[k] ??= { tally: {}, ...model });
  const t = (m.tally[key] ??= { fans: 0, coaches: 0 });
  if (role === 'coach') t.coaches += 1;
  else t.fans += 1;
  save();
  return tallyFor(matchId, eventId);
}

export function tallyFor(matchId: string, eventId: string): { tally: VoteTally; total: number } {
  const m = store[keyOf(matchId, eventId)];
  const tally = m?.tally ?? {};
  return { tally, total: Object.values(tally).reduce((s, x) => s + x.fans + x.coaches, 0) };
}

export type VoteValidation = { moments: number; votes: number; agreeFans: number | null; agreeCoaches: number | null; coachVotes: number };

/**
 * Agreement between the model and people: for each moment, does the most popular pick match the
 * model's pick? Reported separately for fans and for people who coach or play.
 */
export function validation(): VoteValidation {
  let moments = 0;
  let votes = 0;
  let coachVotes = 0;
  const agree = { fans: { n: 0, yes: 0 }, coaches: { n: 0, yes: 0 } };
  for (const m of Object.values(store)) {
    const entries = Object.entries(m.tally);
    const fans = entries.reduce((s, [, x]) => s + x.fans, 0);
    const coaches = entries.reduce((s, [, x]) => s + x.coaches, 0);
    if (!fans && !coaches) continue;
    moments += 1;
    votes += fans + coaches;
    coachVotes += coaches;
    for (const role of ['fans', 'coaches'] as const) {
      const total = role === 'fans' ? fans : coaches;
      if (!total) continue;
      const top = entries.sort((a, b) => b[1][role] - a[1][role])[0]![0];
      agree[role].n += 1;
      if (top === m.modelKey) agree[role].yes += 1;
    }
  }
  const rate = (r: { n: number; yes: number }) => (r.n ? +(r.yes / r.n).toFixed(3) : null);
  return { moments, votes, agreeFans: rate(agree.fans), agreeCoaches: rate(agree.coaches), coachVotes };
}
