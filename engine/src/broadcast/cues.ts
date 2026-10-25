// Timed, machine-readable overlay cues a broadcaster can sync to their feed.
//
// Every cue says when (match ms since kick-off), for how long, what kind of graphic, how
// important it is, and the data to draw it. Cues are placed in screen *slots*; each slot shows
// one cue at a time: a higher-priority cue cuts the current one short (and says which it
// replaced), a lower-priority one waits a moment or is dropped. Coordinates are metres in the
// absolute frame (105 × 68, home attacking left → right).

import { toAbsolute } from '../geometry';
import { DecisionDetector } from '../ghost/ghost';
import { LiveStats, type EventMetrics, type StatsSnapshot } from '../stats/interpret';
import type { DecisionMoment, GeneratedMatch, MatchEvent, MatchMeta, OverlayCue, PlayerInfo, Side, Vec2 } from '../types';

/** Screen areas; `pitch_tags` is a separate layer so player tags can sit on top of a replay. */
export type CueSlot = 'centre' | 'lower_third' | 'corner' | 'pitch' | 'pitch_tags';

export type CueSheet = {
  format: 'ghost-replay.overlay-cues';
  version: 1;
  matchId: string;
  teams: Record<Side, { id: string; name: string; shortName: string; colors: { primary: string; secondary: string } }>;
  timebase: string;
  coordinates: string;
  generatedAt: string;
  cues: OverlayCue[];
};

/** Priority by kind (higher wins a slot). */
export const CUE_PRIORITY = { milestone: 10, ghost_replay: 9, player_tag: 7, stat: 5, narrative: 4 } as const;
const DURATION = { goal: 8000, milestone: 5000, ghost: 12_000, tag: 6000, stat: 5000, commentary: 5000, studio: 10_000, analysis: 12_000 };
/** A lower-priority cue may wait this long for its slot before it's dropped. */
const MAX_DELAY_MS = 3000;

const clock = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
};
const round = (p: Vec2): Vec2 => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
/** A direction in the team's frame, in the absolute frame (away teams attack the other way). */
const toAbsDir = (d: Vec2, team: Side): Vec2 => (team === 'home' ? round(d) : round({ x: -d.x, y: -d.y }));

export class CueBuilder {
  private cues: OverlayCue[] = [];
  private busy = new Map<CueSlot, OverlayCue>();
  private n = 0;
  private players = new Map<string, { info: PlayerInfo; team: Side }>();

  constructor(private meta: MatchMeta) {
    for (const team of ['home', 'away'] as Side[]) for (const info of meta[team].players) this.players.set(info.id, { info, team });
  }

  /** Everything so far, in time order. */
  all(): OverlayCue[] {
    return [...this.cues].sort((a, b) => a.startT - b.startT || b.priority - a.priority);
  }

  sheet(): CueSheet {
    const team = (s: Side) => {
      const t = this.meta[s];
      return { id: t.id, name: t.name, shortName: t.shortName, colors: t.colors };
    };
    return {
      format: 'ghost-replay.overlay-cues',
      version: 1,
      matchId: this.meta.matchId,
      teams: { home: team('home'), away: team('away') },
      timebase: 'startT/durationMs in ms since kick-off, continuous across halves (the half-time break is excluded); payload.clock is the match clock as displayed',
      coordinates: 'metres on a 105 x 68 pitch, origin bottom-left, home attacking left to right',
      generatedAt: new Date().toISOString(),
      cues: this.all(),
    };
  }

  private tag(id: string, role: string, at: Vec2, startT: number, clockMs: number): OverlayCue | null {
    const p = this.players.get(id);
    if (!p) return null;
    return this.add('player_tag', 'pitch', startT, DURATION.tag, {
      clock: clock(clockMs),
      playerId: id,
      name: p.info.name,
      shortName: p.info.shortName,
      role: p.info.role,
      team: p.team,
      tag: role,
      position: round(at),
    });
  }

  /**
   * Place a cue in its slot. Returns the cue (possibly delayed) or null if it was dropped.
   * When a cue cuts another short, the earlier cue's duration is trimmed and `replaces` is set.
   */
  private add(kind: OverlayCue['kind'], slot: CueSlot, startT: number, durationMs: number, payload: Record<string, unknown>): OverlayCue | null {
    const priority = CUE_PRIORITY[kind];
    let start = startT;
    const cur = this.busy.get(slot);
    let replaces: string | undefined;
    if (cur && cur.startT + cur.durationMs > start) {
      if (priority >= cur.priority) {
        cur.durationMs = Math.max(0, start - cur.startT);
        replaces = cur.cueId;
      } else {
        const free = cur.startT + cur.durationMs;
        if (free - start > MAX_DELAY_MS) return null;
        start = free;
      }
    }
    const cue: OverlayCue = {
      cueId: `${this.meta.matchId}-cue-${++this.n}`,
      startT: Math.round(start),
      durationMs,
      kind,
      priority,
      payload: { slot, ...payload, ...(replaces ? { replaces } : {}) },
    };
    this.cues.push(cue);
    this.busy.set(slot, cue);
    return cue;
  }

  /** Cues triggered by a match event. */
  onEvent(e: MatchEvent, m: EventMetrics): OverlayCue[] {
    const out: (OverlayCue | null)[] = [];
    const start = toAbsolute(e.start, e.team);
    const who = this.players.get(e.playerId);
    const base = { clock: clock(e.clockMs), period: e.period, eventId: e.id };
    const score = { ...e.score };
    switch (e.type) {
      case 'kickoff':
        if (e.t === 0 || (e.period === 2 && e.clockMs <= this.meta.halfLengthMs + 1000))
          out.push(this.add('milestone', 'centre', e.t, DURATION.milestone, { ...base, label: e.period === 1 ? 'KICK OFF' : 'SECOND HALF', score }));
        break;
      case 'half_time':
      case 'full_time':
        out.push(this.add('milestone', 'centre', e.t, DURATION.milestone, { ...base, label: e.type === 'half_time' ? 'HALF TIME' : 'FULL TIME', score }));
        break;
      case 'foul':
        if (e.context === 'penalty') out.push(this.add('milestone', 'centre', e.t, DURATION.milestone, { ...base, label: 'PENALTY', team: e.team === 'home' ? 'away' : 'home', fouledBy: e.playerId }));
        break;
      case 'shot': {
        if (e.outcome === 'goal') {
          out.push(this.add('milestone', 'centre', e.t, DURATION.goal, { ...base, label: 'GOAL', team: e.team, scorer: e.playerId, scorerName: who?.info.name, score, penalty: e.context === 'penalty', xG: m.xG !== undefined ? Math.round(m.xG * 100) / 100 : undefined }));
          out.push(this.tag(e.playerId, 'scorer', start, e.t, e.clockMs));
        }
        out.push(
          this.add('stat', 'corner', e.t, DURATION.stat, {
            ...base,
            label: 'Shot',
            team: e.team,
            playerId: e.playerId,
            name: who?.info.shortName,
            xG: m.xG !== undefined ? Math.round(m.xG * 100) / 100 : undefined,
            speedKmh: m.ballSpeedKmh,
            outcome: e.outcome,
          }),
        );
        break;
      }
      case 'pass':
        // A very hard pass that came off is worth a graphic.
        if (e.outcome === 'success' && (m.difficulty ?? 0) >= 8)
          out.push(this.add('stat', 'corner', e.t, DURATION.stat, { ...base, label: 'Pass difficulty', team: e.team, playerId: e.playerId, name: who?.info.shortName, difficulty: m.difficulty, distanceM: m.passDistance && Math.round(m.passDistance) }));
        break;
    }
    return out.filter((c): c is OverlayCue => c !== null);
  }

  /** A ghost moment: the replay graphic plus tags on the decision-maker and the better option. */
  onMoment(mo: DecisionMoment, e: MatchEvent): OverlayCue[] {
    const toAbs = (p: Vec2) => round(toAbsolute(p, mo.team));
    const from = toAbs(e.start);
    const arrow = (o: DecisionMoment['ghost'], kind: string) => ({ kind, action: o.action, from, to: toAbs(o.end), targetPlayerId: o.targetPlayerId, pSuccess: Math.round(o.pSuccess * 100) / 100, expectedValue: Math.round(o.expectedValue * 1000) / 1000 });
    const out: (OverlayCue | null)[] = [
      this.add('ghost_replay', 'pitch', e.t, DURATION.ghost, {
        clock: clock(mo.clockMs),
        eventId: mo.eventId,
        team: mo.team,
        playerId: mo.playerId,
        name: this.players.get(mo.playerId)?.info.name,
        outcome: mo.actualOutcome,
        /** miss = a better option was on; genius = the player found the hard, right ball. */
        momentKind: mo.kind,
        arrows: [arrow(mo.actual, 'actual'), arrow(mo.ghost, mo.kind === 'genius' ? 'obvious' : 'ghost'), ...mo.alternatives.filter((o) => o.targetPlayerId !== mo.ghost.targetPlayerId || o.action !== mo.ghost.action).slice(0, 3).map((o) => arrow(o, 'alternative'))],
        valueLost: Math.round(mo.evLost * 1000) / 1000,
        ...(mo.kind === 'genius' ? { threatGained: Math.round((mo.evGained ?? 0) * 1000) / 1000 } : {}),
        confidence: mo.confidence?.level,
        gameState: mo.gameState?.label,
        ...(mo.vision ? { vision: { from, facing: toAbsDir(mo.vision.facing, mo.team), centralDeg: Math.round(mo.vision.centralDeg), peripheralDeg: Math.round(mo.vision.peripheralDeg) } } : {}),
        simulation: mo.sim,
        reasons: mo.reasons.map((r) => r.text),
        freezeFrame: e.freezeFrame.map((s) => ({ playerId: s.playerId, team: s.team, pos: toAbs(s.pos) })),
      }),
    ];
    // Tags ride along with the replay (same moment, separate overlay layer).
    const target = mo.kind === 'genius' ? mo.actual.targetPlayerId : mo.ghost.targetPlayerId;
    const tags: OverlayCue[] = [];
    const t1 = this.tagAt(mo.playerId, 'decision', from, e.t, mo.clockMs);
    if (t1) tags.push(t1);
    if (target) {
      const s = e.freezeFrame.find((f) => f.playerId === target);
      const t2 = s && this.tagAt(target, mo.kind === 'genius' ? 'found' : 'better_option', toAbs(s.pos), e.t, mo.clockMs);
      if (t2) tags.push(t2);
    }
    return [...out.filter((c): c is OverlayCue => c !== null), ...tags];
  }

  /** Player tags during a replay sit on their own layer so they never fight the replay graphic. */
  private tagAt(id: string, role: string, at: Vec2, startT: number, clockMs: number): OverlayCue | null {
    const p = this.players.get(id);
    if (!p) return null;
    const cue: OverlayCue = {
      cueId: `${this.meta.matchId}-cue-${++this.n}`,
      startT: Math.round(startT),
      durationMs: DURATION.ghost,
      kind: 'player_tag',
      priority: CUE_PRIORITY.player_tag,
      payload: { slot: 'pitch_tags', clock: clock(clockMs), playerId: id, name: p.info.name, shortName: p.info.shortName, role: p.info.role, team: p.team, tag: role, position: at },
    };
    this.cues.push(cue);
    return cue;
  }

  /** Commentary, studio lines and analysis text for the lower third. */
  onNarrative(text: string, startT: number, clockMs: number, kind: 'commentary' | 'studio' | 'analysis', source: string, eventId?: string): OverlayCue[] {
    const d = kind === 'commentary' ? DURATION.commentary : kind === 'studio' ? DURATION.studio : DURATION.analysis;
    const c = this.add('narrative', 'lower_third', startT, d, { clock: clock(clockMs), kind, text, source, ...(eventId ? { eventId } : {}) });
    return c ? [c] : [];
  }

  /** Periodic scoreboard-style stat panel (possession and xG). */
  onStatsPanel(snap: StatsSnapshot, startT: number, clockMs: number): OverlayCue[] {
    const { home: h, away: a } = snap.teams;
    const c = this.add('stat', 'corner', startT, DURATION.stat * 2, {
      clock: clock(clockMs),
      label: 'Match stats',
      possession: { home: Math.round(h.possessionPct), away: Math.round(a.possessionPct) },
      xG: { home: Math.round(h.xG * 100) / 100, away: Math.round(a.xG * 100) / 100 },
      shots: { home: h.shots, away: a.shots },
    });
    return c ? [c] : [];
  }
}

/** Stats panels go out at these match minutes. */
export const STATS_PANEL_MINUTES = [15, 30, 60, 75];

/**
 * The whole match's cue sheet, offline (no AI): run every event through the stats, the ghost
 * detector and the cue builder. `commentary` supplies template lines for the lower third.
 */
export function buildCueSheet(match: GeneratedMatch, commentary?: (e: MatchEvent, m: EventMetrics) => string | undefined): CueSheet {
  const cues = new CueBuilder(match.meta);
  const stats = new LiveStats(match.meta);
  const detector = new DecisionDetector(match.meta);
  const panels = new Set<number>();
  for (const e of match.events) {
    const m = stats.push(e);
    cues.onEvent(e, m);
    const line = commentary?.(e, m);
    if (line) cues.onNarrative(line, e.t, e.clockMs, 'commentary', 'template', e.id);
    const moment = detector.push(e);
    if (moment) cues.onMoment(moment, e);
    const minute = Math.floor(e.clockMs / 60000);
    const at = STATS_PANEL_MINUTES.find((x) => minute >= x && minute < x + 5 && !panels.has(x));
    if (at !== undefined || e.type === 'half_time') {
      if (at !== undefined) panels.add(at);
      cues.onStatsPanel(stats.snapshot(), e.t, e.clockMs);
    }
  }
  return cues.sheet();
}
