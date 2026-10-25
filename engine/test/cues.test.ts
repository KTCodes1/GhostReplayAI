import { describe, expect, it } from 'vitest';
import { analyzeMatch, buildCueSheet, generateMatch, type OverlayCue } from '../src/index';

const match = generateMatch({ seed: 7 });
const sheet = buildCueSheet(match, (e) => (e.type === 'shot' ? `shot by ${e.playerId}` : undefined));
const slotOf = (c: OverlayCue) => (c.payload as { slot: string }).slot;

describe('overlay cue sheet', () => {
  it('is a self-describing, time-ordered document', () => {
    expect(sheet.format).toBe('ghost-replay.overlay-cues');
    expect(sheet.matchId).toBe(match.meta.matchId);
    for (let i = 1; i < sheet.cues.length; i++) expect(sheet.cues[i]!.startT).toBeGreaterThanOrEqual(sheet.cues[i - 1]!.startT);
    for (const c of sheet.cues) {
      expect(['player_tag', 'stat', 'ghost_replay', 'narrative', 'milestone']).toContain(c.kind);
      expect(c.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof (c.payload as { clock: string }).clock).toBe('string');
    }
  });

  it('never shows two cues in the same screen slot at once', () => {
    const slots = new Map<string, OverlayCue[]>();
    for (const c of sheet.cues) if (slotOf(c) !== 'pitch_tags') (slots.get(slotOf(c)) ?? slots.set(slotOf(c), []).get(slotOf(c))!).push(c);
    for (const list of slots.values())
      for (let i = 1; i < list.length; i++) expect(list[i]!.startT).toBeGreaterThanOrEqual(list[i - 1]!.startT + list[i - 1]!.durationMs);
  });

  it('marks every goal and every ghost moment', () => {
    const goals = match.events.filter((e) => e.type === 'shot' && e.outcome === 'goal').length;
    expect(sheet.cues.filter((c) => c.kind === 'milestone' && (c.payload as { label: string }).label === 'GOAL')).toHaveLength(goals);
    const { live } = analyzeMatch(match);
    const replays = sheet.cues.filter((c) => c.kind === 'ghost_replay');
    expect(replays).toHaveLength(live.length);
    for (const r of replays) {
      const p = r.payload as { momentKind: string; arrows: { kind: string; from: { x: number; y: number }; to: { x: number; y: number } }[]; freezeFrame: unknown[] };
      // A miss shows the better option; a genius moment shows the obvious one they didn't take.
      expect(p.arrows.map((a) => a.kind)).toEqual(expect.arrayContaining(['actual', p.momentKind === 'genius' ? 'obvious' : 'ghost']));
      expect(p.freezeFrame).toHaveLength(22);
      for (const a of p.arrows) for (const pt of [a.from, a.to]) {
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(105);
      }
    }
  });

  it('a higher-priority cue cuts a lower one short and says so', () => {
    const cut = sheet.cues.filter((c) => (c.payload as { replaces?: string }).replaces);
    for (const c of cut) {
      const old = sheet.cues.find((x) => x.cueId === (c.payload as { replaces: string }).replaces)!;
      expect(old.priority).toBeLessThanOrEqual(c.priority);
      expect(old.startT + old.durationMs).toBeLessThanOrEqual(c.startT);
    }
  });
});
