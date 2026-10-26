import { describe, expect, it } from 'vitest';
import {
  analyzeEvent,
  analyzeMatch,
  buildMatchReport,
  buildRoster,
  buildTeam,
  confidenceOf,
  decisionDNA,
  estimateVision,
  footedness,
  gameStateFor,
  generateMatch,
  isOffside,
  judgeSketch,
  leadTarget,
  offsideLine,
  passExecution,
  project,
  visibilityOf,
  whatIfScore,
  type MatchEvent,
  type MatchMeta,
  type PlayerSnapshot,
} from '../src/index';

const base = (over: Partial<MatchEvent>): MatchEvent => ({
  id: 'x-1', seq: 1, t: 0, period: 1, clockMs: 0, type: 'pass', team: 'home', playerId: 'me', start: { x: 50, y: 34 },
  score: { home: 0, away: 0 }, freezeFrame: [], ...over,
});

describe('vision: what the player could see', () => {
  it('a running player faces the way they run; things behind them are behind', () => {
    const e = base({ freezeFrame: [{ playerId: 'me', team: 'home', pos: { x: 50, y: 34 }, vel: { x: 5, y: 0 } }, { playerId: 'd', team: 'away', pos: { x: 51, y: 35 } }] });
    const cone = estimateVision(e, undefined);
    expect(cone.basis).toBe('running');
    expect(visibilityOf(cone, e.start, { x: 70, y: 34 })).toBe('visible');
    expect(visibilityOf(cone, e.start, { x: 30, y: 34 })).toBe('behind');
  });

  it('a receiver faces the passer, opened up towards goal', () => {
    const prev = base({ id: 'x-0', playerId: 'mate', start: { x: 40, y: 34 }, targetPlayerId: 'me', outcome: 'success' });
    const e = base({ freezeFrame: [{ playerId: 'me', team: 'home', pos: { x: 50, y: 34 } }, { playerId: 'd', team: 'away', pos: { x: 51.5, y: 34 } }] });
    const cone = estimateVision(e, prev);
    expect(cone.basis).toBe('receiving');
    expect(visibilityOf(cone, e.start, { x: 40, y: 34 })).not.toBe('behind'); // back to the passer
  });

  it('time on the ball widens the cone', () => {
    const tight = estimateVision(base({ freezeFrame: [{ playerId: 'd', team: 'away', pos: { x: 51, y: 34 } }] }), undefined);
    const free = estimateVision(base({ freezeFrame: [{ playerId: 'd', team: 'away', pos: { x: 70, y: 34 } }] }), undefined);
    expect(free.peripheralDeg).toBeGreaterThan(tight.peripheralDeg);
  });
});

describe('dynamics: the world keeps moving', () => {
  it('projects players along their run, capped', () => {
    expect(project({ x: 50, y: 34 }, { x: 6, y: 0 }, 1)).toEqual({ x: 56, y: 34 });
    expect(project({ x: 50, y: 34 }, { x: 8, y: 0 }, 5).x).toBeLessThanOrEqual(59.01);
  });

  it('leads a runner into space and checks offside against the second-last defender', () => {
    const lead = leadTarget({ x: 60, y: 34 }, { x: 75, y: 34 }, { x: 6, y: 0 });
    expect(lead.runner).toBe(true);
    expect(lead.end.x).toBeGreaterThan(80);
    const line = offsideLine([{ x: 103, y: 34 }, { x: 88, y: 30 }, { x: 85, y: 40 }], 60);
    expect(line).toBe(88);
    expect(isOffside({ x: 90, y: 30 }, line)).toBe(true);
    expect(isOffside({ x: 88.5, y: 30 }, line)).toBe(false); // tight calls go to the attacker
  });
});

describe('execution and game state', () => {
  it('a long ball is harder for a weaker passer, and the weaker foot is noted', () => {
    const weak = passExecution({ x: 30, y: 34 }, { x: 75, y: 34 }, { passing: 0.4, decision: 0.6 }, { foot: 'right', weakFoot: 0.5 }, 0);
    const strong = passExecution({ x: 30, y: 34 }, { x: 75, y: 34 }, { passing: 0.9, decision: 0.6 }, { foot: 'right', weakFoot: 0.5 }, 0);
    expect(weak.logitAdj).toBeLessThan(strong.logitAdj);
    expect(weak.notes.join(' ')).toContain('range');
    const cone = { facing: { x: 1, y: 0 }, centralDeg: 70, peripheralDeg: 125, basis: 'default' as const };
    const leftward = passExecution({ x: 50, y: 20 }, { x: 52, y: 50 }, { passing: 0.7, decision: 0.6 }, { foot: 'right', weakFoot: 0.2 }, 0, cone);
    expect(leftward.notes.join(' ')).toContain('weaker left foot');
    expect(['left', 'right']).toContain(footedness('any-player').foot);
  });

  it('protecting a late lead makes losing the ball cost more; chasing the game makes it cost less', () => {
    const protecting = gameStateFor(base({ clockMs: 86 * 60_000, score: { home: 1, away: 0 } }));
    const chasing = gameStateFor(base({ clockMs: 86 * 60_000, score: { home: 0, away: 1 } }));
    const open = gameStateFor(base({ clockMs: 20 * 60_000 }));
    expect(protecting.code).toBe('protecting');
    expect(chasing.code).toBe('chasing');
    expect(protecting.lossAversion).toBeGreaterThan(open.lossAversion);
    expect(chasing.lossAversion).toBeLessThan(open.lossAversion);
    expect(protecting.label).toContain('1-0');
  });
});

describe('confidence', () => {
  it('rises with the simulation margin and falls for peripheral options', () => {
    const lo = confidenceOf(0.01, 0.002, 0.05, 0.05, 50);
    const hi = confidenceOf(0.05, 0.05, 0.05, 0.05, 50);
    expect(hi.score).toBeGreaterThan(lo.score);
    expect(hi.level).toBe('clear');
    expect(lo.level).toBe('close');
    expect(confidenceOf(0.03, 0.02, 0.05, 0.05, 50, 'peripheral').score).toBeLessThan(confidenceOf(0.03, 0.02, 0.05, 0.05, 50).score);
  });
});

describe('two-step look-ahead and reasons', () => {
  const match = generateMatch({ seed: 7 });
  const roster = buildRoster(match.meta);
  const analyses = match.events.map((e, i) => analyzeEvent(e, roster, match.events[i - 1])).filter((a) => a !== null);

  it('a follow-up only ever adds value, and is recorded when it does', () => {
    const withFollow = analyses.flatMap((a) => a.alternatives).filter((o) => o.followUp);
    expect(withFollow.length).toBeGreaterThan(100);
    for (const o of withFollow.slice(0, 200)) expect(o.valueIfSuccess).toBeGreaterThan(0);
  });

  it('labels every option with what the player could see', () => {
    for (const a of analyses.slice(0, 200)) for (const o of [a.actual, ...a.alternatives]) expect(['visible', 'peripheral', 'behind', 'unknown']).toContain(o.visibility);
  });

  it('explains causes, not just numbers', () => {
    const { live, recap } = analyzeMatch(match);
    const codes = new Set([...live, ...recap].flatMap((m) => m.reasons.map((r) => r.code)));
    const causes = ['pressing_gap', 'runner_in_behind', 'high_line', 'overload', 'ball_watching', 'sets_up_next', 'game_state', 'peripheral_vision'];
    expect(causes.filter((c) => codes.has(c as never)).length).toBeGreaterThanOrEqual(3);
  });
});

describe('report: DNA, what-if scoreline, validation', () => {
  const match = generateMatch({ seed: 7 });
  const { detector } = analyzeMatch(match);
  const report = buildMatchReport(match, detector);

  it('decision DNA is a set of 0-100 percentiles with a style', () => {
    const withDna = report.players.filter((p) => p.dna);
    expect(withDna.length).toBeGreaterThan(2);
    for (const p of withDna) {
      expect(p.dna!.traits).toHaveLength(7);
      for (const t of p.dna!.traits) {
        expect(t.value).toBeGreaterThanOrEqual(0);
        expect(t.value).toBeLessThanOrEqual(100);
        expect(t.detail.length).toBeGreaterThan(5);
      }
      expect(p.dna!.style.length).toBeGreaterThan(3);
    }
    expect(decisionDNA('nobody', 'Nobody', detector.analyses())).toBeNull();
  });

  it('the what-if scoreline never goes below the actual xG and counts each attack once', () => {
    const w = report.whatIfScore;
    for (const s of ['home', 'away'] as const) {
      expect(w.bestDecisions[s]).toBeGreaterThanOrEqual(w.xg[s]);
      expect(w.improvedAttacks[s]).toBeLessThanOrEqual(w.attacks[s]);
    }
    expect(w.goals).toEqual(report.score);
    expect(whatIfScore(match.events, [], { home: 1, away: 2 }).bestDecisions).toEqual({ home: 1, away: 2 });
  });

  it('reports how often the simulation upheld the model', () => {
    expect(report.validation.simChecked).toBeGreaterThan(0);
    expect(report.validation.simAgreed).toBeLessThanOrEqual(report.validation.simChecked);
    expect(Array.isArray(report.genius)).toBe(true);
  });
});

describe('pundit sketch', () => {
  const home = buildTeam('nba');
  const away = buildTeam('kvl');
  const meta: MatchMeta = { matchId: 't', seed: 0, competition: '', venue: '', kickoffISO: '', home, away, halfLengthMs: 2_700_000 };
  const r = buildRoster(meta);
  const P = (id: string, team: 'home' | 'away', x: number, y: number): PlayerSnapshot => ({ playerId: id, team, pos: { x, y } });
  const hp = (i: number) => home.players[i]!.id;
  const ap = (i: number) => away.players[i]!.id;
  const frame = [
    P(hp(0), 'home', 10, 34), P(hp(1), 'home', 55, 8), P(hp(2), 'home', 50, 25), P(hp(3), 'home', 50, 43), P(hp(4), 'home', 55, 60),
    P(hp(5), 'home', 80, 34), P(hp(6), 'home', 70, 22), P(hp(7), 'home', 70, 46), P(hp(8), 'home', 82, 12), P(hp(9), 'home', 96, 30), P(hp(10), 'home', 84, 60),
    P(ap(0), 'away', 103, 34), P(ap(1), 'away', 83, 11), P(ap(2), 'away', 97, 40), P(ap(3), 'away', 92, 48), P(ap(4), 'away', 86, 60),
    P(ap(5), 'away', 76, 24), P(ap(6), 'away', 76, 44), P(ap(7), 'away', 72, 34), P(ap(8), 'away', 65, 15), P(ap(9), 'away', 60, 34), P(ap(10), 'away', 65, 55),
  ];
  const e: MatchEvent = { id: 't-1', seq: 1, t: 1_000_000, period: 1, clockMs: 1_000_000, type: 'pass', team: 'home', playerId: hp(5), start: { x: 80, y: 34 }, end: { x: 82, y: 12 }, targetPlayerId: hp(8), outcome: 'fail', score: { home: 0, away: 0 }, freezeFrame: frame };
  const a = analyzeEvent(e, r)!;

  it('reads a drawn arrow as a pass, a carry or a shot, and ranks it', () => {
    const toStriker = judgeSketch(e, r, undefined, { x: 96.5, y: 30.5 }, a);
    expect(toStriker.option.action).toBe('pass');
    expect(toStriker.option.targetPlayerId).toBe(hp(9));
    expect(toStriker.option.deltaVsActual).toBeGreaterThan(0);
    expect(toStriker.rank).toBeLessThanOrEqual(3);
    expect(judgeSketch(e, r, undefined, { x: 104, y: 33 }, a).option.action).toBe('shot');
    expect(judgeSketch(e, r, undefined, { x: 86, y: 36 }, a).option.action).toBe('carry');
    const space = judgeSketch(e, r, undefined, { x: 99, y: 20 }, a);
    expect(space.option.action).toBe('pass');
    expect(space.readAs).toContain('into space');
    expect(space.notes.length).toBeGreaterThan(0);
  });
});
