import { describe, expect, it } from 'vitest';
import { DecisionDetector, analyzeMatch, buildMatchReport, generateMatch } from '../src/index';

const match = generateMatch({ seed: 7 });
const { detector } = analyzeMatch(match);
const report = buildMatchReport(match, detector);

describe('match report', () => {
  it('summarises the final score and every goal', () => {
    const last = match.events.at(-1)!;
    expect(report.status).toBe('final');
    expect(report.score).toEqual(last.score);
    expect(report.goals.filter((g) => g.team === 'home')).toHaveLength(last.score.home);
    expect(report.goals.filter((g) => g.team === 'away')).toHaveLength(last.score.away);
    const scorers = report.players.reduce((n, p) => n + p.stats.goals, 0);
    expect(scorers).toBe(last.score.home + last.score.away);
  });

  it('has 18 five-minute momentum windows', () => {
    expect(report.momentum).toHaveLength(18);
    expect(report.momentum[9]!.period).toBe(2);
    for (const b of report.momentum) expect(b.home).toBeGreaterThanOrEqual(0);
  });

  it('picks the top-rated player as player of the match, and two others per team', () => {
    expect(report.playerOfTheMatch).toBe(report.players[0]!.playerId);
    for (const side of ['home', 'away'] as const) {
      expect(report.highlights[side]).toHaveLength(2);
      expect(report.highlights[side]).not.toContain(report.playerOfTheMatch);
      for (const id of report.highlights[side]) expect(report.players.find((p) => p.playerId === id)!.team).toBe(side);
    }
  });

  it('rates everyone 3-10 with consistent decision scores and realistic distances', () => {
    expect(report.players).toHaveLength(22);
    for (const p of report.players) {
      expect(p.rating).toBeGreaterThanOrEqual(3);
      expect(p.rating).toBeLessThanOrEqual(10);
      if (p.decisions) expect(p.decisions.best).toBeLessThanOrEqual(p.decisions.total);
      if (p.role !== 'GK') expect(p.stats.distanceKm).toBeGreaterThan(5);
      expect(p.summary.length).toBeGreaterThan(5);
    }
    const missed = report.players.filter((p) => p.missedChance);
    for (const p of missed) expect(p.missedChance!.playerId).toBe(p.playerId);
  });

  it('a report mid-match only covers what has happened so far', () => {
    const det = new DecisionDetector(match.meta);
    const half = Math.floor(match.events.length / 2);
    for (const e of match.events.slice(0, half + 1)) det.push(e);
    const mid = buildMatchReport(match, det, half);
    expect(mid.status).toBe('live');
    expect(mid.clockMs).toBe(match.events[half]!.clockMs);
    for (const m of mid.topMoments) expect(m.t).toBeLessThanOrEqual(match.events[half]!.t);
  });
});
