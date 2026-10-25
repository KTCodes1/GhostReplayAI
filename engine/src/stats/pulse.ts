// Match Pulse: how the game feels right now. Rolling metrics over the last five minutes for each
// side — pressure, territory, threat and predictability — and the "spells" they add up to
// ("sustained pressure, but passing is becoming predictable"). Fed event by event, live.

import type { MatchEvent, Side } from '../types';
import type { EventMetrics } from './interpret';

export type PulseTeam = {
  /** Pressing actions per minute. */
  pressure: number;
  /** Share of the side's on-ball actions in the opponent's half (0..1). */
  territory: number;
  /** Threat created: xT gained + xG. */
  threat: number;
  /** Share of the side's judged decisions that were the safe, obvious choice (0..1); null if too few. */
  predictability: number | null;
};

export type PulseSpellCode = 'pressure_predictable' | 'sustained_pressure' | 'control_no_threat' | 'end_to_end' | 'pressing_high';

export type PulseSpell = { code: PulseSpellCode; team?: Side; label: string; facts: string[] };

export type MatchPulse = {
  clockMs: number;
  windowMin: number;
  home: PulseTeam;
  away: PulseTeam;
  /** Turnovers per minute, both sides together (chaos). */
  turnoversPerMin: number;
  spell?: PulseSpell;
};

type Sample = { t: number; clockMs: number; team: Side; type: MatchEvent['type']; inOppHalf: boolean; threat: number; obvious?: boolean };

const WINDOW_MS = 5 * 60_000;
const ON_BALL = new Set(['pass', 'carry', 'shot']);
const TURNOVER = new Set(['interception', 'tackle', 'possession_change']);
const MIN_DECISIONS = 8;
/** In this engine about 30-50% of decisions are the safe, obvious one; 55%+ is noticeably predictable. */
const PREDICTABLE = 0.55;
/** Turnovers per minute (both sides) that make a spell end to end; the engine averages about 7. */
const CHAOS_TURNOVERS = 10;

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const r2 = (x: number) => Math.round(x * 100) / 100;

export class PulseTracker {
  private samples: Sample[] = [];
  private lastClock = 0;

  /** Feed every event in order, with its metrics and (if it was judged) whether it was the obvious choice. */
  push(e: MatchEvent, m: EventMetrics | undefined, obvious?: boolean) {
    this.lastClock = e.clockMs;
    const threat = (m?.xG ?? 0) + Math.max(0, m?.xTAdded ?? 0);
    this.samples.push({ t: e.t, clockMs: e.clockMs, team: e.team, type: e.type, inOppHalf: e.start.x > 52.5, threat, ...(obvious !== undefined ? { obvious } : {}) });
    const cut = e.t - WINDOW_MS;
    while (this.samples.length && this.samples[0]!.t < cut) this.samples.shift();
  }

  snapshot(): MatchPulse {
    const s = this.samples;
    const span = s.length ? Math.max(1, (s.at(-1)!.t - s[0]!.t) / 60_000) : 1;
    const team = (side: Side): PulseTeam => {
      const mine = s.filter((x) => x.team === side);
      const onBall = mine.filter((x) => ON_BALL.has(x.type));
      const judged = mine.filter((x) => x.obvious !== undefined);
      return {
        pressure: r2(mine.filter((x) => x.type === 'pressure').length / span),
        territory: r2(onBall.length ? onBall.filter((x) => x.inOppHalf).length / onBall.length : 0.5),
        threat: r2(mine.reduce((a, x) => a + x.threat, 0)),
        predictability: judged.length >= MIN_DECISIONS ? r2(judged.filter((x) => x.obvious).length / judged.length) : null,
      };
    };
    const pulse: MatchPulse = {
      clockMs: this.lastClock,
      windowMin: 5,
      home: team('home'),
      away: team('away'),
      turnoversPerMin: r2(s.filter((x) => TURNOVER.has(x.type)).length / span),
    };
    const spell = spellOf(pulse);
    return spell ? { ...pulse, spell } : pulse;
  }
}

/** The most notable spell right now, with the facts behind it (for an evidence-checked AI line). */
export function spellOf(p: MatchPulse): PulseSpell | undefined {
  const pctS = (x: number) => `${Math.round(x * 100)}%`;
  for (const side of ['home', 'away'] as Side[]) {
    const t = p[side];
    const o = p[other(side)];
    const threatShare = t.threat + o.threat > 0 ? t.threat / (t.threat + o.threat) : 0.5;
    const facts = [
      `${side} on-ball actions in the opponent's half over the last 5 minutes: ${pctS(t.territory)}.`,
      `${side} share of the threat created over the last 5 minutes: ${pctS(threatShare)} (${t.threat.toFixed(2)} vs ${o.threat.toFixed(2)}).`,
      `${side} pressing actions per minute: ${t.pressure.toFixed(1)}; ${other(side)}: ${o.pressure.toFixed(1)}.`,
      ...(t.predictability !== null ? [`${side} decisions that were the safe, obvious choice: ${pctS(t.predictability)}.`] : []),
    ];
    if (t.territory >= 0.62 && threatShare >= 0.6 && t.predictability !== null && t.predictability >= PREDICTABLE)
      return { code: 'pressure_predictable', team: side, label: 'Sustained pressure, but passing is becoming predictable', facts };
    if (t.territory >= 0.62 && threatShare >= 0.65 && t.threat >= 0.15) return { code: 'sustained_pressure', team: side, label: 'Sustained pressure', facts };
    if (t.territory >= 0.6 && threatShare <= 0.35) return { code: 'control_no_threat', team: side, label: 'Control without penetration', facts };
    if (t.pressure >= 1.5 && t.pressure >= o.pressure * 1.8 && o.territory <= 0.4) return { code: 'pressing_high', team: side, label: 'Pressing high and pinning them back', facts };
  }
  if (p.turnoversPerMin >= CHAOS_TURNOVERS) return { code: 'end_to_end', label: 'End to end: the ball keeps changing hands', facts: [`Turnovers per minute over the last 5 minutes: ${p.turnoversPerMin.toFixed(1)}.`] };
  return undefined;
}
