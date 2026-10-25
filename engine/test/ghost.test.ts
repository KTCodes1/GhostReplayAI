import { describe, expect, it } from 'vitest';
import {
  BEST_CHOICE_TOLERANCE,
  DecisionDetector,
  MIN_PLAUSIBLE_P,
  analyzeEvent,
  analyzeMatch,
  buildRoster,
  buildTeam,
  expectedValue,
  generateMatch,
  simulateWhatIf,
  type MatchEvent,
  type MatchMeta,
  type PlayerSnapshot,
} from '../src/index';

const match = generateMatch({ seed: 42 });
const roster = buildRoster(match.meta);

describe('analyzeEvent', () => {
  const analyses = match.events.map((e) => analyzeEvent(e, roster)).filter((a) => a !== null);

  it('judges outfield passes, carries and shots only', () => {
    expect(analyses.length).toBeGreaterThan(1000);
    for (const a of analyses) {
      expect(['pass', 'carry', 'shot']).toContain(a.event.type);
      expect(roster.get(a.event.playerId)!.isGK).toBe(false);
    }
  });

  it('scores every option with EV = p·v − (1−p)·cost and sorts alternatives best first', () => {
    for (const a of analyses.slice(0, 300)) {
      for (const o of [a.actual, ...a.alternatives]) {
        expect(o.expectedValue).toBeCloseTo(expectedValue(o.pSuccess, o.valueIfSuccess, o.turnoverCost), 12);
        expect(o.deltaVsActual).toBeCloseTo(o.expectedValue - a.actual.expectedValue, 12);
      }
      for (let i = 1; i < a.alternatives.length; i++) expect(a.alternatives[i - 1]!.expectedValue).toBeGreaterThanOrEqual(a.alternatives[i]!.expectedValue);
    }
  });

  it('never offers the actual choice back as a ghost', () => {
    for (const a of analyses) {
      if (a.event.type === 'pass') expect(a.alternatives.some((o) => o.action === 'pass' && o.targetPlayerId === a.event.targetPlayerId)).toBe(false);
      else expect(a.alternatives.some((o) => o.action === a.event.type)).toBe(false);
    }
  });

  it('headline ghost is plausible and evLost is never negative', () => {
    for (const a of analyses) {
      expect(a.evLost).toBeGreaterThanOrEqual(0);
      if (a.best !== a.actual) expect(a.best.action === 'shot' || a.best.pSuccess >= MIN_PLAUSIBLE_P).toBe(true);
      expect(a.choseBest).toBe(a.evLost <= BEST_CHOICE_TOLERANCE);
    }
  });
});

describe('hand-built moment: square pass instead of the free man in the box', () => {
  const home = buildTeam('nba');
  const away = buildTeam('kvl');
  const meta: MatchMeta = { matchId: 't', seed: 0, competition: '', venue: '', kickoffISO: '', home, away, halfLengthMs: 2_700_000 };
  const r = buildRoster(meta);
  const hp = (i: number) => home.players[i]!.id;
  const ap = (i: number) => away.players[i]!.id;
  // Home attacking right. Carrier (AM area) at 80,34; striker unmarked at 96,30; winger tightly marked at 82,12.
  const frame: PlayerSnapshot[] = [
    { playerId: hp(0), team: 'home', pos: { x: 10, y: 34 } },
    { playerId: hp(1), team: 'home', pos: { x: 55, y: 8 } },
    { playerId: hp(2), team: 'home', pos: { x: 50, y: 25 } },
    { playerId: hp(3), team: 'home', pos: { x: 50, y: 43 } },
    { playerId: hp(4), team: 'home', pos: { x: 55, y: 60 } },
    { playerId: hp(5), team: 'home', pos: { x: 80, y: 34 } }, // carrier
    { playerId: hp(6), team: 'home', pos: { x: 70, y: 22 } },
    { playerId: hp(7), team: 'home', pos: { x: 70, y: 46 } },
    { playerId: hp(8), team: 'home', pos: { x: 82, y: 12 } }, // marked winger
    { playerId: hp(9), team: 'home', pos: { x: 96, y: 30 } }, // free striker
    { playerId: hp(10), team: 'home', pos: { x: 84, y: 60 } },
    { playerId: ap(0), team: 'away', pos: { x: 103, y: 34 } },
    { playerId: ap(1), team: 'away', pos: { x: 83, y: 11 } }, // on the winger
    { playerId: ap(2), team: 'away', pos: { x: 92, y: 40 } },
    { playerId: ap(3), team: 'away', pos: { x: 92, y: 48 } },
    { playerId: ap(4), team: 'away', pos: { x: 86, y: 60 } },
    { playerId: ap(5), team: 'away', pos: { x: 76, y: 24 } },
    { playerId: ap(6), team: 'away', pos: { x: 76, y: 44 } },
    { playerId: ap(7), team: 'away', pos: { x: 72, y: 34 } },
    { playerId: ap(8), team: 'away', pos: { x: 65, y: 15 } },
    { playerId: ap(9), team: 'away', pos: { x: 60, y: 34 } },
    { playerId: ap(10), team: 'away', pos: { x: 65, y: 55 } },
  ];
  const e: MatchEvent = {
    id: 't-1', seq: 1, t: 1_000_000, period: 1, clockMs: 1_000_000, type: 'pass', team: 'home',
    playerId: hp(5), start: { x: 80, y: 34 }, end: { x: 82, y: 12 }, targetPlayerId: hp(8), outcome: 'fail',
    score: { home: 0, away: 0 }, freezeFrame: frame,
  };

  it('finds the striker as the ghost, with reasons', () => {
    const a = analyzeEvent(e, r)!;
    expect(a.best.action).toBe('pass');
    expect(a.best.targetPlayerId).toBe(hp(9));
    expect(a.evLost).toBeGreaterThan(0.03);
    const det = new DecisionDetector(meta);
    const m = det.push(e)!;
    expect(m).not.toBeNull();
    expect(m.ghost.targetPlayerId).toBe(hp(9));
    const codes = m.reasons.map((x) => x.code);
    expect(codes).toContain('into_box');
    expect(codes).toContain('marked_receiver');
  });
});

describe('DecisionDetector rate limiting', () => {
  it('respects the per-half cap and cooldown', () => {
    const { live } = analyzeMatch(match, { maxPerHalf: 4, cooldownMs: 120_000 });
    for (const p of [1, 2] as const) expect(live.filter((m) => m.period === p).length).toBeLessThanOrEqual(4);
    for (let i = 1; i < live.length; i++) expect(live[i]!.t - live[i - 1]!.t).toBeGreaterThanOrEqual(120_000);
    expect(live.length).toBeGreaterThan(2);
  });

  it('only surfaces moments where the ghost also wins in simulation', () => {
    const { live, recap } = analyzeMatch(match);
    for (const m of [...live, ...recap]) {
      expect(m.sim).toBeDefined();
      expect(m.sim!.ghost).toBeGreaterThan(m.sim!.actual);
      expect(m.ghost.expectedValue).toBeGreaterThan(m.actual.expectedValue);
    }
  });

  it('player focus mode surfaces more of the followed player, without breaking the global rules', () => {
    const { detector } = analyzeMatch(match);
    // The busiest attacking player is a good test subject.
    const busiest = detector.playerRecords().sort((a, b) => b.decisions - a.decisions)[0]!;
    const count = (focus?: string) => {
      const det = new DecisionDetector(match.meta);
      det.setFocus(focus);
      const shown: { playerId: string; t: number }[] = [];
      for (const e of match.events) {
        const m = det.push(e);
        if (m) shown.push(m);
      }
      return shown;
    };
    const base = count().filter((m) => m.playerId === busiest.playerId).length;
    const focused = count(busiest.playerId);
    expect(focused.filter((m) => m.playerId === busiest.playerId).length).toBeGreaterThanOrEqual(base);
    for (let i = 1; i < focused.length; i++) expect(focused[i]!.t - focused[i - 1]!.t).toBeGreaterThanOrEqual(25_000);
  });

  it('tracks every player decision for player focus mode', () => {
    const { detector } = analyzeMatch(match);
    const recs = detector.playerRecords();
    expect(recs.length).toBeGreaterThan(15);
    for (const r of recs) expect(r.bestChoices).toBeLessThanOrEqual(r.decisions);
  });
});

describe('what-if simulation', () => {
  const { live } = analyzeMatch(match);
  const m = live[0]!;
  const ev = match.events.find((e) => e.id === m.eventId)!;

  it('starts from the freeze frame and plays the forced option first', () => {
    const r = simulateWhatIf(match.meta, ev, m.ghost, { rollouts: 20 });
    const first = r.replay[0]!;
    expect(first.type).toBe(m.ghost.action);
    expect(first.playerId).toBe(ev.playerId);
    if (m.ghost.targetPlayerId) expect(first.targetPlayerId).toBe(m.ghost.targetPlayerId);
    if (m.ghost.action !== 'shot') expect(first.outcome).toBe('success');
    for (const s of first.freezeFrame) {
      const orig = ev.freezeFrame.find((x) => x.playerId === s.playerId)!;
      // same instant, same team frame -> same positions
      if (first.team === ev.team) expect(Math.hypot(orig.pos.x - s.pos.x, orig.pos.y - s.pos.y)).toBeLessThan(0.02);
    }
  });

  it('is deterministic and its rates add up', () => {
    const a = simulateWhatIf(match.meta, ev, m.ghost, { rollouts: 30 });
    const b = simulateWhatIf(match.meta, ev, m.ghost, { rollouts: 30 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const total = Object.values(a.summary.outcomes).reduce((x, y) => x + y, 0);
    expect(total).toBe(30);
    expect(a.summary.shotRate).toBeGreaterThanOrEqual(a.summary.goalRate);
    expect(a.summary.expectedGoals).toBeCloseTo(a.summary.pSuccess * a.summary.avgXg, 10);
  });

  it('ends the replay on the play that finished the move', () => {
    const r = simulateWhatIf(match.meta, ev, m.ghost, { rollouts: 10 });
    expect(r.replay.some((e) => e.type === 'kickoff')).toBe(false);
    const last = r.replay.at(-1)!;
    if (r.replayOutcome === 'shot' || r.replayOutcome === 'goal') expect(last.type).toBe('shot');
    for (let i = 1; i < r.replay.length; i++) expect(r.replay[i]!.t).toBeGreaterThan(r.replay[i - 1]!.t);
  });
});
