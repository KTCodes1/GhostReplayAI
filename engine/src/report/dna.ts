// Decision DNA: a player's decision-making style, built from every decision the ghost engine judged.
// A new kind of player stat: not what they did, but how they choose — risk, ambition, vision,
// composure under pressure, late-game decisions, unpredictability and overall quality.
// Every trait is a percentile against the other outfield players in the same matches, so 80 means
// "more than 80% of the players around them".

import type { GhostAnalysis } from '../ghost/ghost';
import { analyzeEvent, buildRoster, isPlausible } from '../ghost/ghost';
import type { GeneratedMatch } from '../types';

export type DnaTraitKey = 'quality' | 'risk' | 'progression' | 'vision' | 'composure' | 'late' | 'unpredictable';

export type DnaTrait = {
  key: DnaTraitKey;
  label: string;
  /** 0..100 percentile among peers (50 = typical). */
  value: number;
  /** The number behind it, in words. */
  detail: string;
};

export type DecisionDNA = {
  playerId: string;
  name: string;
  matches: number;
  decisions: number;
  /** How many players they're compared with. */
  peers: number;
  /** One-line style, e.g. "Progressive risk-taker". */
  style: string;
  traits: DnaTrait[];
};

const MIN_DECISIONS = 20;
const MIN_SPLIT = 8;
const LABELS: Record<DnaTraitKey, string> = {
  quality: 'Decision quality',
  risk: 'Risk appetite',
  progression: 'Progression',
  vision: 'Vision',
  composure: 'Under pressure',
  late: 'Late in games',
  unpredictable: 'Unpredictability',
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const typicalUtility = (o: GhostAnalysis['actual']) => o.pSuccess * (o.valueIfSuccess + 0.035) - (1 - o.pSuccess) * o.turnoverCost * 2.5;
const rate = (xs: GhostAnalysis[]) => (xs.length ? xs.filter((a) => a.choseBest).length / xs.length : 0);

type Raw = { value: number | null; detail: string };

/** The raw numbers behind each trait (null = too few decisions of that kind). */
function rawTraits(mine: GhostAnalysis[]): Record<DnaTraitKey, Raw> {
  const n = mine.length;
  const quality = rate(mine);
  const avgP = mine.reduce((s, a) => s + a.actual.pSuccess, 0) / n;
  const moves = mine.filter((a) => a.actual.action !== 'shot');
  const progressive = moves.filter((a) => (a.actual.features?.bypassed ?? 0) >= 2 || a.actual.end.x - a.event.start.x >= 10).length / Math.max(1, moves.length);
  const found = mine.filter((a) => a.choseBest && a.actual.visibility !== 'visible').length / n;
  const pressured = mine.filter((a) => (a.actual.features?.pressure ?? 0) >= 0.4);
  const late = mine.filter((a) => a.event.clockMs >= 75 * 60_000);
  const early = mine.filter((a) => a.event.clockMs < 75 * 60_000);
  const offScript =
    mine.filter((a) => {
      const pool = [a.actual, ...a.alternatives.filter(isPlausible)];
      return pool.reduce((m, o) => (typicalUtility(o) > typicalUtility(m) ? o : m), pool[0]!) !== a.actual;
    }).length / n;
  return {
    quality: { value: quality, detail: `picked the best option ${pct(quality)} of the time` },
    // Riskier = lower chance their choice comes off.
    risk: { value: -avgP, detail: `their chosen action comes off ${pct(avgP)} of the time` },
    progression: { value: progressive, detail: `${pct(progressive)} of their passes and carries go forward past defenders` },
    vision: { value: found, detail: `${pct(found)} of their decisions were the best option and on the edge of their vision or behind them` },
    composure:
      pressured.length >= MIN_SPLIT
        ? { value: rate(pressured) - quality, detail: `best option ${pct(rate(pressured))} of the time under pressure, ${pct(quality)} overall` }
        : { value: null, detail: 'too few pressured decisions to judge' },
    late:
      late.length >= MIN_SPLIT && early.length >= MIN_SPLIT
        ? { value: rate(late) - rate(early), detail: `best option ${pct(rate(late))} after 75', ${pct(rate(early))} before` }
        : { value: null, detail: 'too few late decisions to judge' },
    unpredictable: { value: offScript, detail: `${pct(offScript)} of the time they don't make the safe, obvious choice` },
  };
}

/** Percentile of `x` among `xs` (ties count half). */
const percentile = (x: number, xs: number[]) => Math.round((100 * (xs.filter((y) => y < x).length + 0.5 * xs.filter((y) => y === x).length)) / Math.max(1, xs.length));

/**
 * DNA for one player from `analyses` (theirs), compared with `peers` (analyses of everyone in the
 * same matches; defaults to `analyses`). Needs 20+ decisions.
 */
export function decisionDNA(playerId: string, name: string, analyses: readonly GhostAnalysis[], matches = 1, peers: readonly GhostAnalysis[] = analyses): DecisionDNA | null {
  const mine = analyses.filter((a) => a.event.playerId === playerId);
  if (mine.length < MIN_DECISIONS) return null;
  const byPlayer = new Map<string, GhostAnalysis[]>();
  for (const a of peers) byPlayer.set(a.event.playerId, [...(byPlayer.get(a.event.playerId) ?? []), a]);
  const peerRaws = [...byPlayer.entries()].filter(([id, xs]) => id !== playerId && xs.length >= MIN_DECISIONS).map(([, xs]) => rawTraits(xs));
  const own = rawTraits(mine);
  const traits = (Object.keys(LABELS) as DnaTraitKey[]).map((key): DnaTrait => {
    const r = own[key];
    const others = peerRaws.map((p) => p[key].value).filter((v): v is number => v !== null);
    const value = r.value === null || others.length < 5 ? 50 : percentile(r.value, others);
    return { key, label: LABELS[key], value, detail: r.detail };
  });
  return { playerId, name, matches, decisions: mine.length, peers: peerRaws.length, style: styleOf(traits), traits };
}

function styleOf(traits: DnaTrait[]): string {
  const t = Object.fromEntries(traits.map((x) => [x.key, x.value])) as Record<DnaTraitKey, number>;
  if (t.vision >= 75 && t.quality >= 60) return 'Visionary playmaker';
  if (t.risk >= 70 && t.progression >= 65) return 'Progressive risk-taker';
  if (t.unpredictable >= 75 && t.quality >= 50) return 'Unpredictable creator';
  if (t.unpredictable >= 75) return 'Off-script gambler';
  if (t.composure >= 75) return 'Cool under pressure';
  if (t.risk <= 30 && t.progression <= 35) return 'Safe recycler';
  if (t.quality >= 75) return 'Reliable decision-maker';
  if (t.progression >= 75) return 'Line-breaker';
  return 'Balanced decision-maker';
}

/**
 * Decision DNA across several matches (e.g. a player's last five). Peers are everyone in the first
 * match (fully analysed); in the others only the player's own events are analysed, to stay quick.
 */
export function decisionDNAAcross(playerId: string, matches: readonly GeneratedMatch[]): DecisionDNA | null {
  const mine: GhostAnalysis[] = [];
  const peers: GhostAnalysis[] = [];
  let name = playerId;
  let played = 0;
  matches.forEach((m, k) => {
    const roster = buildRoster(m.meta);
    const me = roster.get(playerId);
    if (me) {
      name = me.info.name;
      played += 1;
    }
    m.events.forEach((e, i) => {
      if (k > 0 && e.playerId !== playerId) return;
      const a = analyzeEvent(e, roster, m.events[i - 1]);
      if (!a) return;
      if (e.playerId === playerId) mine.push(a);
      if (k === 0) peers.push(a);
    });
  });
  return decisionDNA(playerId, name, mine, played, peers);
}
