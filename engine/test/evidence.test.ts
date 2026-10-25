import { describe, expect, it } from 'vitest';
import {
  DecisionDetector,
  LiveStats,
  PlayerTracker,
  PulseTracker,
  analyzeMatch,
  checkAgainstFacts,
  generateMatch,
  isObviousChoice,
  momentFacts,
  numbersIn,
  parseClaimed,
  spellOf,
  templateExplanation,
} from '../src/index';

const match = generateMatch({ seed: 7 });
const { live, detector } = analyzeMatch(match);
const misses = live.filter((m) => m.kind === 'miss');
const eventOf = (id: string) => match.events.find((e) => e.id === id)!;

describe('evidence-checked explanations', () => {
  it('the explanation written from the facts always passes the check', () => {
    for (const m of live) {
      const facts = momentFacts(m, eventOf(m.eventId), detector.roster);
      const t = templateExplanation(m, facts, detector.roster);
      expect(t.claims.length).toBeGreaterThan(0);
      expect(checkAgainstFacts(t.explanation, t.claims, facts, detector.roster)).toEqual([]);
    }
  });

  it('rejects invented numbers, stray players, fake citations and contradictions', () => {
    const m = misses.find((x) => x.ghost.targetPlayerId)!;
    const e = eventOf(m.eventId);
    const facts = momentFacts(m, e, detector.roster);
    const target = detector.roster.get(m.ghost.targetPlayerId!)!.info.shortName;
    const stranger = [...detector.roster.values()].find((r) => !facts.some((f) => f.text.includes(r.info.shortName)))!.info.shortName;
    const problems = checkAgainstFacts(`${target} was completely unmarked with a 97% chance, and ${stranger} was offside.`, [{ text: 'x', facts: ['F999'] }], facts, detector.roster);
    expect(problems.some((p) => p.includes('97'))).toBe(true);
    expect(problems.some((p) => p.includes(stranger))).toBe(true);
    expect(problems.some((p) => p.includes('cites no real fact'))).toBe(true);
    expect(problems.some((p) => p.includes('offside'))).toBe(true);
    const near = facts.find((f) => f.text.startsWith(`Nearest defender to ${target}:`))!;
    if (Number(numbersIn(near.text).at(-1)) < 3) expect(problems.some((p) => p.includes('unmarked'))).toBe(true);
  });

  it('reads the JSON claim format and refuses anything else', () => {
    expect(parseClaimed('```json\n{"explanation":"A b.","claims":[{"text":"A b.","facts":["F1"]}]}\n```')).toEqual({ explanation: 'A b.', claims: [{ text: 'A b.', facts: ['F1'] }] });
    expect(parseClaimed('Just some prose.')).toBeNull();
  });
});

describe('Fair Play lens', () => {
  it('gives every live miss a verdict, and clear ones are seen, confident calls', () => {
    for (const m of misses) {
      expect(m.fairPlay).toBeDefined();
      if (m.fairPlay!.verdict === 'clear') {
        expect(m.ghost.visibility).toBe('visible');
        expect(m.confidence!.level).toBe('clear');
        expect(m.evLost).toBeGreaterThanOrEqual(0.03);
      }
    }
    expect(live.filter((m) => m.kind === 'genius').every((m) => !m.fairPlay)).toBe(true);
  });
});

describe('match pulse and player tags', () => {
  it('tracks the last five minutes and names a spell from its facts', () => {
    const stats = new LiveStats(match.meta);
    const det = new DecisionDetector(match.meta);
    const pulse = new PulseTracker();
    let spells = 0;
    match.events.forEach((e, i) => {
      const m = stats.push(e);
      det.push(e);
      const a = det.analyses().at(-1);
      pulse.push(e, m, a && a.event === e ? isObviousChoice(a) : undefined);
      if (i % 50 === 0 && pulse.snapshot().spell) spells += 1;
    });
    const p = pulse.snapshot();
    for (const t of [p.home, p.away]) {
      expect(t.territory).toBeGreaterThanOrEqual(0);
      expect(t.territory).toBeLessThanOrEqual(1);
      expect(t.pressure).toBeGreaterThanOrEqual(0);
    }
    expect(spells).toBeGreaterThan(0);
    expect(spellOf({ ...p, home: { pressure: 3, territory: 0.8, threat: 0.5, predictability: 0.7 }, away: { pressure: 1, territory: 0.2, threat: 0.05, predictability: 0.4 } })?.code).toBe('pressure_predictable');
  });

  it('raises a handful of sprint and distance tags, not a flood', () => {
    const tracker = new PlayerTracker(match.meta);
    const alerts = match.events.flatMap((e) => tracker.push(e));
    expect(alerts.filter((a) => a.kind === 'distance').length).toBeGreaterThanOrEqual(3);
    expect(alerts.length).toBeLessThan(40);
    for (const a of alerts.filter((x) => x.kind === 'sprint')) expect(a.value).toBeGreaterThanOrEqual(26);
  });
});
