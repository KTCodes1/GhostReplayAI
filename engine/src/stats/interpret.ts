// Interpret layer: per-event metrics and a live, incremental stats accumulator.

import { passDifficulty, passFeatures, passProbFromFeatures, pressureAt } from '../models/pass';
import { PENALTY_XG, shotContext, xg } from '../models/xg';
import { xt } from '../models/xt';
import type { MatchEvent, MatchMeta, Side } from '../types';

export type EventMetrics = {
  eventId: string;
  xG?: number;
  xTStart?: number;
  xTEnd?: number;
  xTAdded?: number; // only credited when the action succeeds
  passDistance?: number;
  pSuccess?: number;
  difficulty?: number; // 1..10
  ballSpeedKmh?: number;
  pressureOnActor?: number; // 0..1
};

export function makeGKLookup(meta: MatchMeta): (id: string) => boolean {
  const gks = new Set([...meta.home.players, ...meta.away.players].filter((p) => p.position === 'GK').map((p) => p.id));
  return (id) => gks.has(id);
}

export function interpretEvent(e: MatchEvent, isGK: (id: string) => boolean, passing = 0.5): EventMetrics {
  const m: EventMetrics = { eventId: e.id };
  const oppSide: Side = e.team === 'home' ? 'away' : 'home';
  const opponents = e.freezeFrame.filter((s) => s.team === oppSide).map((s) => s.pos);
  if (e.ballSpeed) m.ballSpeedKmh = Math.round(e.ballSpeed * 3.6);

  if (e.type === 'pass' || e.type === 'carry' || e.type === 'shot') m.pressureOnActor = pressureAt(e.start, opponents);

  if ((e.type === 'pass' || e.type === 'carry') && e.end) {
    m.xTStart = xt(e.start);
    m.xTEnd = xt(e.end);
    m.xTAdded = e.outcome === 'success' ? m.xTEnd - m.xTStart : 0;
  }
  if (e.type === 'pass' && e.end) {
    const f = passFeatures(e.start, e.end, opponents);
    m.passDistance = f.distance;
    m.pSuccess = passProbFromFeatures(f, passing);
    m.difficulty = passDifficulty(m.pSuccess);
  }
  if (e.type === 'shot') {
    if (e.context === 'penalty') m.xG = PENALTY_XG;
    else {
      const opp = e.freezeFrame.filter((s) => s.team === oppSide).map((s) => ({ pos: s.pos, isGK: isGK(s.playerId) }));
      m.xG = xg(e.start, shotContext(e.start, opp));
    }
  }
  return m;
}

export type TeamStats = {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  xG: number;
  passes: number;
  passesCompleted: number;
  passAccuracy: number; // 0..1
  avgPassDistance: number;
  avgPassDifficulty: number;
  xTAdded: number;
  possessionMs: number;
  possessionPct: number; // 0..100
  pressures: number;
  tackles: number;
  interceptions: number;
  fouls: number;
};

export type PlayerStats = {
  playerId: string;
  team: Side;
  passes: number;
  passesCompleted: number;
  xTAdded: number;
  shots: number;
  goals: number;
  xG: number;
  touches: number;
};

export type MomentumPoint = { t: number; home: number; away: number }; // rolling xT+xG per team

export type StatsSnapshot = {
  t: number;
  score: { home: number; away: number };
  teams: Record<Side, TeamStats>;
  players: PlayerStats[];
  momentum: MomentumPoint[];
  pressureTrend: { t: number; home: number; away: number }[]; // pressures per 5-min window
};

const emptyTeam = (): TeamStats => ({
  goals: 0, shots: 0, shotsOnTarget: 0, xG: 0, passes: 0, passesCompleted: 0, passAccuracy: 0,
  avgPassDistance: 0, avgPassDifficulty: 0, xTAdded: 0, possessionMs: 0, possessionPct: 50,
  pressures: 0, tackles: 0, interceptions: 0, fouls: 0,
});

const ON_BALL: ReadonlySet<string> = new Set(['pass', 'carry', 'shot', 'kickoff', 'possession_change']);
const WINDOW_MS = 5 * 60 * 1000;

/** Feed events in order; read `snapshot()` at any moment. */
export class LiveStats {
  private teams: Record<Side, TeamStats> = { home: emptyTeam(), away: emptyTeam() };
  private sumPassDist: Record<Side, number> = { home: 0, away: 0 };
  private sumPassDiff: Record<Side, number> = { home: 0, away: 0 };
  private players = new Map<string, PlayerStats>();
  private lastOnBall?: { t: number; team: Side };
  private threatEvents: { t: number; team: Side; value: number }[] = [];
  private pressureEvents: { t: number; team: Side }[] = [];
  private score = { home: 0, away: 0 };
  private t = 0;
  private isGK: (id: string) => boolean;
  private passingOf: (id: string) => number;

  constructor(meta: MatchMeta) {
    this.isGK = makeGKLookup(meta);
    const all = [...meta.home.players, ...meta.away.players];
    const passing = new Map(all.map((p) => [p.id, p.attrs.passing]));
    this.passingOf = (id) => passing.get(id) ?? 0.5;
  }

  private player(id: string, team: Side): PlayerStats {
    let p = this.players.get(id);
    if (!p) {
      p = { playerId: id, team, passes: 0, passesCompleted: 0, xTAdded: 0, shots: 0, goals: 0, xG: 0, touches: 0 };
      this.players.set(id, p);
    }
    return p;
  }

  push(e: MatchEvent): EventMetrics {
    const m = interpretEvent(e, this.isGK, this.passingOf(e.playerId));
    const team = this.teams[e.team];
    this.t = e.t;
    this.score = { ...e.score };

    // Possession time: time between on-ball events goes to whoever had the ball.
    if (this.lastOnBall && e.type !== 'half_time') {
      this.teams[this.lastOnBall.team].possessionMs += e.t - this.lastOnBall.t;
    }
    if (ON_BALL.has(e.type)) this.lastOnBall = { t: e.t, team: e.team };
    if (e.type === 'half_time' || e.type === 'full_time') this.lastOnBall = undefined;

    const p = e.type === 'half_time' || e.type === 'full_time' ? undefined : this.player(e.playerId, e.team);
    if (p && ON_BALL.has(e.type)) p.touches += 1;

    switch (e.type) {
      case 'pass':
        team.passes += 1;
        p!.passes += 1;
        this.sumPassDist[e.team] += m.passDistance ?? 0;
        this.sumPassDiff[e.team] += m.difficulty ?? 0;
        if (e.outcome === 'success') {
          team.passesCompleted += 1;
          p!.passesCompleted += 1;
        }
        break;
      case 'shot':
        team.shots += 1;
        p!.shots += 1;
        team.xG += m.xG ?? 0;
        p!.xG += m.xG ?? 0;
        if (e.outcome === 'goal' || e.outcome === 'saved') team.shotsOnTarget += 1;
        if (e.outcome === 'goal') {
          team.goals += 1;
          p!.goals += 1;
        }
        this.threatEvents.push({ t: e.t, team: e.team, value: m.xG ?? 0 });
        break;
      case 'pressure':
        team.pressures += 1;
        this.pressureEvents.push({ t: e.t, team: e.team });
        break;
      case 'tackle':
        team.tackles += 1;
        break;
      case 'interception':
        team.interceptions += 1;
        break;
      case 'foul':
        team.fouls += 1;
        break;
    }
    if (m.xTAdded) {
      team.xTAdded += m.xTAdded;
      p!.xTAdded += m.xTAdded;
      if (m.xTAdded > 0) this.threatEvents.push({ t: e.t, team: e.team, value: m.xTAdded });
    }
    return m;
  }

  snapshot(): StatsSnapshot {
    const teams = { home: { ...this.teams.home }, away: { ...this.teams.away } };
    const totalPoss = teams.home.possessionMs + teams.away.possessionMs || 1;
    for (const s of ['home', 'away'] as Side[]) {
      const ts = teams[s];
      ts.passAccuracy = ts.passes ? ts.passesCompleted / ts.passes : 0;
      ts.avgPassDistance = ts.passes ? this.sumPassDist[s] / ts.passes : 0;
      ts.avgPassDifficulty = ts.passes ? this.sumPassDiff[s] / ts.passes : 0;
      ts.possessionPct = (100 * ts.possessionMs) / totalPoss;
    }
    return {
      t: this.t,
      score: { ...this.score },
      teams,
      players: [...this.players.values()].map((p) => ({ ...p })),
      momentum: this.windowed(this.threatEvents, (e) => e.value),
      pressureTrend: this.windowed(this.pressureEvents, () => 1),
    };
  }

  private windowed<T extends { t: number; team: Side }>(list: T[], val: (e: T) => number) {
    const out: { t: number; home: number; away: number }[] = [];
    for (let w = 0; w * WINDOW_MS <= this.t; w++) {
      const lo = w * WINDOW_MS;
      const hi = lo + WINDOW_MS;
      const pt = { t: hi, home: 0, away: 0 };
      for (const e of list) if (e.t >= lo && e.t < hi) pt[e.team] += val(e);
      out.push(pt);
    }
    return out;
  }
}
