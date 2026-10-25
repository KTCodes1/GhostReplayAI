// Post-match (or so-far) report: match summary, momentum, the decisions that shaped it, and a
// card per player with stats, a match rating and the decision score only this engine can give.

import type { DecisionDetector } from '../ghost/ghost';
import { confirmWithSimulation, toDecisionMoment } from '../ghost/ghost';
import { toAbsolute } from '../geometry';
import { LiveStats, type StatsSnapshot, type TeamStats, makeGKLookup } from '../stats/interpret';
import type { DecisionMoment, GeneratedMatch, MatchEvent, Side, Vec2 } from '../types';

export type PlayerMatchStats = {
  touches: number;
  passes: number;
  passesCompleted: number;
  passAccuracy: number; // 0..1
  keyPasses: number; // passes straight into a teammate's shot
  assists: number;
  shots: number;
  shotsOnTarget: number;
  goals: number;
  xG: number;
  xTAdded: number;
  carries: number;
  carriesWon: number; // dribbles that came off
  tackles: number;
  interceptions: number;
  pressures: number;
  fouls: number;
  saves: number;
  goalsConceded: number; // keepers
  distanceKm: number;
};

export type ReportMoment = { eventId: string; clockMs: number; text: string };

export type PlayerReport = {
  playerId: string;
  team: Side;
  name: string;
  shortName: string;
  role: string;
  rating: number; // 3.0..10.0
  /** Share of this player's judged decisions where they picked the best option. */
  decisions: { best: number; total: number; rate: number } | null;
  evLost: number;
  stats: PlayerMatchStats;
  bestMoment?: ReportMoment;
  missedChance?: DecisionMoment;
  /** Template one-liner; the server may replace it with AI text. */
  summary: string;
};

export type MomentumBin = { label: string; period: 1 | 2; home: number; away: number };

export type MatchReport = {
  matchId: string;
  status: 'live' | 'final';
  clockMs: number;
  score: { home: number; away: number };
  teams: Record<Side, TeamStats>;
  momentum: MomentumBin[];
  goals: { eventId: string; clockMs: number; team: Side; playerId: string; bin: number; penalty: boolean }[];
  topMoments: DecisionMoment[];
  playerOfTheMatch?: string;
  highlights: Record<Side, string[]>; // top two per team (POTM excluded)
  players: PlayerReport[]; // everyone, best rating first
};

const BIN_MS = 5 * 60_000;
const BINS_PER_HALF = 9;

/** Momentum bin for an event: 0..8 first half (stoppage folds into 40-45'), 9..17 second. */
function binOf(e: MatchEvent, halfLengthMs: number): number {
  if (e.period === 1) return Math.min(Math.floor(e.clockMs / BIN_MS), BINS_PER_HALF - 1);
  return BINS_PER_HALF + Math.min(Math.floor((e.clockMs - halfLengthMs) / BIN_MS), BINS_PER_HALF - 1);
}

const emptyStats = (): PlayerMatchStats => ({
  touches: 0, passes: 0, passesCompleted: 0, passAccuracy: 0, keyPasses: 0, assists: 0, shots: 0, shotsOnTarget: 0,
  goals: 0, xG: 0, xTAdded: 0, carries: 0, carriesWon: 0, tackles: 0, interceptions: 0, pressures: 0, fouls: 0,
  saves: 0, goalsConceded: 0, distanceKm: 0,
});

const LAYOUT = new Set(['pass', 'carry', 'shot', 'kickoff']);
const ON_BALL = new Set(['pass', 'carry', 'shot', 'kickoff', 'possession_change']);
const minute = (ms: number) => `${Math.floor(ms / 60000) + 1}'`;

/**
 * Build the report from every event up to and including `uptoSeq` (default: the whole match).
 * `detector` must have been fed the same events (it holds the decision analysis).
 */
export function buildMatchReport(match: GeneratedMatch, detector: DecisionDetector, uptoSeq = match.events.length - 1, alsoSpotlight: string[] = []): MatchReport {
  const { meta } = match;
  const events = match.events.slice(0, uptoSeq + 1);
  const last = events.at(-1)!;
  const isGK = makeGKLookup(meta);
  const info = new Map([...meta.home.players, ...meta.away.players].map((p) => [p.id, p]));
  const sideOf = new Map<string, Side>();
  for (const s of ['home', 'away'] as Side[]) for (const p of meta[s].players) sideOf.set(p.id, s);
  const keeper = (s: Side) => meta[s].players.find((p) => p.position === 'GK')!.id;
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

  const stats = new Map<string, PlayerMatchStats>([...info.keys()].map((id) => [id, emptyStats()]));
  const live = new LiveStats(meta);
  const momentum: MomentumBin[] = Array.from({ length: BINS_PER_HALF * 2 }, (_, i) => {
    const half = i < BINS_PER_HALF ? 1 : 2;
    const start = (i % BINS_PER_HALF) * 5 + (half === 2 ? 45 : 0);
    return { label: i % BINS_PER_HALF === BINS_PER_HALF - 1 ? `${start}'+` : `${start}'`, period: half as 1 | 2, home: 0, away: 0 };
  });
  const goals: MatchReport['goals'] = [];
  const bestAction = new Map<string, { value: number; moment: ReportMoment }>();
  let lastPass: { passer: string; receiver: string; team: Side; eventId: string } | undefined;
  let prevFrame: Map<string, Vec2> | undefined;
  let snap: StatsSnapshot | undefined;

  const offer = (id: string, value: number, moment: ReportMoment) => {
    const cur = bestAction.get(id);
    if (!cur || value > cur.value) bestAction.set(id, { value, moment });
  };

  for (const e of events) {
    const m = live.push(e);
    const s = stats.get(e.playerId);
    if (s && ON_BALL.has(e.type)) s.touches += 1;

    // Distance covered, from consecutive full-pitch snapshots (kick-off resets don't count).
    if (LAYOUT.has(e.type)) {
      const frame = new Map(e.freezeFrame.map((f) => [f.playerId, toAbsolute(f.pos, e.team)]));
      if (prevFrame && e.type !== 'kickoff')
        for (const [id, p] of frame) {
          const q = prevFrame.get(id);
          if (q) stats.get(id)!.distanceKm += Math.hypot(p.x - q.x, p.y - q.y) / 1000;
        }
      prevFrame = frame;
    }

    if (e.type === 'possession_change' || e.type === 'kickoff') lastPass = undefined;
    const bin = binOf(e, meta.halfLengthMs);
    const threat = (m.xG ?? 0) + Math.max(0, m.xTAdded ?? 0);
    if (threat > 0 && (e.type === 'pass' || e.type === 'carry' || e.type === 'shot')) momentum[bin]![e.team] += threat;

    switch (e.type) {
      case 'pass':
        s!.passes += 1;
        if (e.outcome === 'success') {
          s!.passesCompleted += 1;
          lastPass = e.targetPlayerId ? { passer: e.playerId, receiver: e.targetPlayerId, team: e.team, eventId: e.id } : undefined;
          if ((m.xTAdded ?? 0) > 0.02)
            offer(e.playerId, m.xTAdded! * 3, { eventId: e.id, clockMs: e.clockMs, text: `Best ball: a pass to ${info.get(e.targetPlayerId!)?.shortName ?? 'a teammate'} in the ${minute(e.clockMs)} (+${m.xTAdded!.toFixed(2)} xT)` });
        } else lastPass = undefined;
        break;
      case 'carry':
        s!.carries += 1;
        if (e.outcome === 'success') {
          s!.carriesWon += 1;
          if ((m.xTAdded ?? 0) > 0.02) offer(e.playerId, m.xTAdded! * 3, { eventId: e.id, clockMs: e.clockMs, text: `Best run: drove forward in the ${minute(e.clockMs)} (+${m.xTAdded!.toFixed(2)} xT)` });
        }
        break;
      case 'shot': {
        s!.shots += 1;
        s!.xG += m.xG ?? 0;
        const onTarget = e.outcome === 'goal' || e.outcome === 'saved';
        if (onTarget) s!.shotsOnTarget += 1;
        const gk = keeper(other(e.team));
        if (e.outcome === 'saved') {
          stats.get(gk)!.saves += 1;
          offer(gk, 0.4 + (m.xG ?? 0), { eventId: e.id, clockMs: e.clockMs, text: `Big save from ${info.get(e.playerId)?.shortName}'s shot in the ${minute(e.clockMs)} (xG ${(m.xG ?? 0).toFixed(2)})` });
        }
        if (lastPass && lastPass.receiver === e.playerId && lastPass.team === e.team) {
          stats.get(lastPass.passer)!.keyPasses += 1;
          if (e.outcome === 'goal') {
            stats.get(lastPass.passer)!.assists += 1;
            offer(lastPass.passer, 2, { eventId: lastPass.eventId, clockMs: e.clockMs, text: `Set up ${info.get(e.playerId)?.shortName}'s goal in the ${minute(e.clockMs)}` });
          }
        }
        if (e.outcome === 'goal') {
          s!.goals += 1;
          stats.get(gk)!.goalsConceded += 1;
          goals.push({ eventId: e.id, clockMs: e.clockMs, team: e.team, playerId: e.playerId, bin, penalty: e.context === 'penalty' });
          offer(e.playerId, 3 + (1 - (m.xG ?? 0)), { eventId: e.id, clockMs: e.clockMs, text: `Scored in the ${minute(e.clockMs)}${e.context === 'penalty' ? ' (penalty)' : ` from a ${(m.xG ?? 0).toFixed(2)} xG chance`}` });
        }
        lastPass = undefined;
        break;
      }
      case 'tackle':
        s!.tackles += 1;
        break;
      case 'interception':
        s!.interceptions += 1;
        break;
      case 'pressure':
        s!.pressures += 1;
        break;
      case 'foul':
        s!.fouls += 1;
        break;
    }
    if (m.xTAdded && s) s.xTAdded += m.xTAdded;
  }
  snap = live.snapshot();

  // Decisions (from the detector) and each player's biggest confirmed miss.
  const records = new Map(detector.playerRecords().map((r) => [r.playerId, r]));
  const analyses = detector.analyses().filter((a) => a.event.seq <= uptoSeq);
  const missFor = (id: string): DecisionMoment | undefined => {
    const mine = analyses.filter((a) => a.event.playerId === id && a.evLost > 0.01).sort((x, y) => y.severity - x.severity);
    for (const a of mine.slice(0, 3)) {
      const c = confirmWithSimulation(a, meta);
      if (c) return toDecisionMoment(c, detector.roster);
    }
    return undefined;
  };

  // Ratings are relative to the player's own team (the simulation turns over a lot of ball,
  // so raw ball-win counts would flatter everyone).
  const teamCtx = {} as Record<Side, RatingContext>;
  for (const side of ['home', 'away'] as Side[]) {
    const outfield = meta[side].players.filter((p) => p.position !== 'GK');
    const wins = outfield.map((p) => stats.get(p.id)!.tackles + stats.get(p.id)!.interceptions);
    const recs = outfield.map((p) => records.get(p.id)).filter((r) => r && r.decisions >= 10);
    teamCtx[side] = {
      ballWinsAvg: Math.max(1, wins.reduce((a, b) => a + b, 0) / wins.length),
      decisionRate: recs.length ? recs.reduce((a, r) => a + r!.bestChoices / r!.decisions, 0) / recs.length : 0.75,
    };
  }

  const players: PlayerReport[] = [...info.values()].map((p) => {
    const st = stats.get(p.id)!;
    st.passAccuracy = st.passes ? st.passesCompleted / st.passes : 0;
    st.distanceKm = +st.distanceKm.toFixed(1);
    st.xG = +st.xG.toFixed(2);
    st.xTAdded = +st.xTAdded.toFixed(3);
    const rec = records.get(p.id);
    const decisions = rec && rec.decisions ? { best: rec.bestChoices, total: rec.decisions, rate: rec.bestChoices / rec.decisions } : null;
    const rating = matchRating(p.position === 'GK', st, decisions, rec?.evLost ?? 0, teamCtx[sideOf.get(p.id)!]);
    const report: PlayerReport = {
      playerId: p.id,
      team: sideOf.get(p.id)!,
      name: p.name,
      shortName: p.shortName,
      role: p.role,
      rating,
      decisions,
      evLost: +(rec?.evLost ?? 0).toFixed(3),
      stats: st,
      ...(bestAction.get(p.id) ? { bestMoment: bestAction.get(p.id)!.moment } : {}),
      summary: '',
    };
    return report;
  });
  players.sort((a, b) => b.rating - a.rating);

  const potm = players[0];
  const highlights: Record<Side, string[]> = { home: [], away: [] };
  for (const s of ['home', 'away'] as Side[]) highlights[s] = players.filter((p) => p.team === s && p.playerId !== potm?.playerId).slice(0, 2).map((p) => p.playerId);

  // Simulation-checked misses only for the players we spotlight (it costs a few ms each).
  const spotlight = new Set([potm?.playerId, ...highlights.home, ...highlights.away, ...alsoSpotlight].filter(Boolean) as string[]);
  for (const p of players) {
    if (spotlight.has(p.playerId)) {
      const miss = missFor(p.playerId);
      if (miss) p.missedChance = miss;
    }
    p.summary = templateSummary(p, isGK(p.playerId));
  }

  return {
    matchId: meta.matchId,
    status: uptoSeq >= match.events.length - 1 ? 'final' : 'live',
    clockMs: last.clockMs,
    score: { ...last.score },
    teams: snap.teams,
    momentum: momentum.map((b) => ({ ...b, home: +b.home.toFixed(3), away: +b.away.toFixed(3) })),
    goals,
    topMoments: detector.recap(5).filter((m) => m.t <= last.t),
    ...(potm ? { playerOfTheMatch: potm.playerId } : {}),
    highlights,
    players,
  };
}

export type RatingContext = { ballWinsAvg: number; decisionRate: number };

/**
 * A football-style match rating (typically 5.5-8, a standout 8.5+) from output, involvement and
 * decision quality. Defensive work and decisions are judged against the player's own team.
 */
export function matchRating(isKeeper: boolean, s: PlayerMatchStats, d: PlayerReport['decisions'], evLost: number, ctx: RatingContext): number {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  let r = 6.2;
  r += s.goals * 1.1 + s.assists * 0.8;
  r += clamp(s.xG * 0.5 + s.keyPasses * 0.15 + Math.max(0, s.xTAdded) * 2, 0, 1.2); // threat created
  if (!isKeeper) r += clamp(0.8 * ((s.tackles + s.interceptions) / ctx.ballWinsAvg - 1), -0.4, 0.8);
  if (s.passes >= 15) r += clamp((s.passAccuracy - 0.8) * 3, -0.4, 0.3);
  if (d && d.total >= 10) r += clamp((d.rate - ctx.decisionRate) * 4, -0.5, 0.5);
  r -= Math.min(0.8, evLost * 1.5);
  if (isKeeper) r += s.saves * 0.4 - s.goalsConceded * 0.45;
  r -= s.fouls * 0.08;
  return Math.round(clamp(r, 3, 10) * 10) / 10;
}

/** Plain one-line summary from the numbers (the AI version replaces it when available). */
function templateSummary(p: PlayerReport, keeper: boolean): string {
  const s = p.stats;
  const parts: string[] = [];
  if (s.goals) parts.push(s.goals === 1 ? 'scored' : `scored ${s.goals}`);
  if (s.assists) parts.push(s.assists === 1 ? 'set one up' : `set up ${s.assists}`);
  if (keeper && s.saves) parts.push(`made ${s.saves} save${s.saves === 1 ? '' : 's'}`);
  if (!parts.length && s.tackles + s.interceptions >= 5) parts.push(`won the ball ${s.tackles + s.interceptions} times`);
  if (!parts.length && s.keyPasses) parts.push(`created ${s.keyPasses} chance${s.keyPasses === 1 ? '' : 's'}`);
  if (!parts.length) parts.push(`completed ${s.passesCompleted} of ${s.passes} passes`);
  const lead = `${p.shortName} ${parts.join(' and ')}`;
  const dec = p.decisions && p.decisions.total >= 5 ? `, choosing the best option ${p.decisions.best} of ${p.decisions.total} times` : '';
  return `${lead}${dec}.`;
}
