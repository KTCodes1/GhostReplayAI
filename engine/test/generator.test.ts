import { describe, expect, it } from 'vitest';
import { LiveStats, PITCH_LENGTH, PITCH_WIDTH, generateMatch } from '../src/index';

describe('match generator', () => {
  const a = generateMatch({ seed: 123 });

  it('is deterministic for a seed', () => {
    const b = generateMatch({ seed: 123 });
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
    expect(JSON.stringify(generateMatch({ seed: 124 }).events.slice(0, 50))).not.toEqual(JSON.stringify(a.events.slice(0, 50)));
  });

  it('starts with a kickoff, has a half time, ends at full time', () => {
    expect(a.events[0]!.type).toBe('kickoff');
    expect(a.events.filter((e) => e.type === 'half_time')).toHaveLength(1);
    expect(a.events.at(-1)!.type).toBe('full_time');
    expect(a.events.at(-1)!.clockMs).toBeGreaterThanOrEqual(90 * 60_000);
  });

  it('every event has a full, on-pitch freeze frame and time moves forward', () => {
    let prevT = -1;
    for (const e of a.events) {
      expect(e.freezeFrame).toHaveLength(22);
      expect(e.freezeFrame.filter((p) => p.team === 'home')).toHaveLength(11);
      for (const p of e.freezeFrame) {
        expect(p.pos.x).toBeGreaterThanOrEqual(0);
        expect(p.pos.x).toBeLessThanOrEqual(PITCH_LENGTH);
        expect(p.pos.y).toBeGreaterThanOrEqual(0);
        expect(p.pos.y).toBeLessThanOrEqual(PITCH_WIDTH);
      }
      expect(e.t).toBeGreaterThan(prevT);
      prevT = e.t;
    }
  });

  it('the actor stands on the ball in their own freeze frame', () => {
    for (const e of a.events.filter((e) => e.type === 'pass' || e.type === 'shot' || e.type === 'carry')) {
      const me = e.freezeFrame.find((p) => p.playerId === e.playerId)!;
      expect(Math.hypot(me.pos.x - e.start.x, me.pos.y - e.start.y)).toBeLessThan(0.05);
    }
  });

  it('score matches the goals scored', () => {
    const goals = { home: 0, away: 0 };
    for (const e of a.events) if (e.type === 'shot' && e.outcome === 'goal') goals[e.team]++;
    expect(a.events.at(-1)!.score).toEqual(goals);
  });

  it('looks like football across many seeds', () => {
    const n = 12;
    let goals = 0, shots = 0, passes = 0, completed = 0;
    for (let s = 1; s <= n; s++) {
      const m = generateMatch({ seed: s });
      const st = new LiveStats(m.meta);
      for (const e of m.events) st.push(e);
      const snap = st.snapshot();
      for (const side of ['home', 'away'] as const) {
        const t = snap.teams[side];
        goals += t.goals; shots += t.shots; passes += t.passes; completed += t.passesCompleted;
        expect(t.shots).toBeLessThan(45);
      }
      expect(snap.teams.home.possessionPct + snap.teams.away.possessionPct).toBeCloseTo(100, 5);
    }
    expect(goals / n).toBeGreaterThan(1.5);
    expect(goals / n).toBeLessThan(5);
    expect(shots / n).toBeGreaterThan(14);
    expect(shots / n).toBeLessThan(35);
    expect(passes / n).toBeGreaterThan(700);
    expect(passes / n).toBeLessThan(1400);
    expect(completed / passes).toBeGreaterThan(0.72);
    expect(completed / passes).toBeLessThan(0.9);
  });
});

describe('player profiles in simulated matches', () => {
  it('every player has ratings and two seasons of stats', () => {
    const { meta } = generateMatch({ seed: 123 });
    for (const p of [...meta.home.players, ...meta.away.players]) {
      for (const k of ['passing', 'finishing', 'dribbling', 'tackling', 'pace', 'decision'] as const) {
        expect(p.attrs[k]).toBeGreaterThanOrEqual(0);
        expect(p.attrs[k]).toBeLessThanOrEqual(1);
      }
      expect(p.seasons.previous.apps).toBeGreaterThan(p.seasons.current.apps);
    }
  });

  it('strikers out-score defenders in the data, and good finishers convert more in matches', () => {
    let fwdGoals = 0, defGoals = 0;
    const conv = { good: { shots: 0, goals: 0 }, poor: { shots: 0, goals: 0 } };
    for (let s = 1; s <= 25; s++) {
      const m = generateMatch({ seed: s });
      const all = new Map([...m.meta.home.players, ...m.meta.away.players].map((p) => [p.id, p]));
      if (s === 1)
        for (const p of all.values()) {
          if (p.position === 'ST') fwdGoals += p.seasons.previous.goals;
          if (p.position === 'CB') defGoals += p.seasons.previous.goals;
        }
      for (const e of m.events) {
        if (e.type !== 'shot' || e.context === 'penalty') continue;
        const f = all.get(e.playerId)!.attrs.finishing;
        const bucket = f >= 0.8 ? conv.good : f < 0.6 ? conv.poor : undefined;
        if (!bucket) continue;
        bucket.shots++;
        if (e.outcome === 'goal') bucket.goals++;
      }
    }
    expect(fwdGoals).toBeGreaterThan(defGoals);
    expect(conv.good.goals / conv.good.shots).toBeGreaterThan(conv.poor.goals / Math.max(1, conv.poor.shots));
  });
});
