// Evidence-checked AI. The AI only ever sees numbered facts taken from the engine, must say which
// facts each of its claims rests on, and its answer is checked against those facts before anyone
// sees it: every number must match a fact, every player named must appear in the facts, and a few
// classic contradictions are caught ("X was unmarked" when a defender was 2 m away, "saw it" when
// the option was behind them, an offside that never happened). Unsupported answers are rejected.

import { dist, pointToSegment } from '../geometry';
import type { DecisionMoment, GhostOption, MatchEvent } from '../types';
import type { Roster } from './judge';

export type EvidenceFact = { id: string; text: string };
export type EvidenceClaim = { text: string; facts: string[] };
/** What the viewer sees under an explanation ("why we think this"). */
export type Evidence = {
  /** verified = the AI's answer passed first time; regenerated = it passed after a rejected draft;
   * template = written from the facts directly; insufficient = not enough evidence to judge. */
  status: 'verified' | 'regenerated' | 'template' | 'insufficient';
  claims: { text: string; facts: EvidenceFact[] }[];
  /** How many engine facts the answer was checked against. */
  checked: number;
  /** Why earlier drafts were rejected, in plain words. */
  rejected: string[];
};

const OUTCOME_WORDS: Record<string, string> = { success: 'came off', fail: 'failed', goal: 'went in', saved: 'was saved', blocked: 'was blocked', off_target: 'went off target' };
const pct = (p: number) => `${Math.round(p * 100)}%`;
const VIS: Record<NonNullable<GhostOption['visibility']>, string> = { visible: 'in their line of sight', peripheral: 'on the edge of their vision', behind: 'behind them, out of sight' };

function phrase(o: GhostOption, name: (id?: string) => string): string {
  return o.action === 'shot' ? 'a shot' : o.action === 'carry' ? 'a run forward with the ball' : `a pass to ${name(o.targetPlayerId)}`;
}

/** The numbered fact sheet for a moment, all from the engine (freeze frame, models, simulation). */
export function momentFacts(m: DecisionMoment, e: MatchEvent, roster: Roster): EvidenceFact[] {
  const name = (id?: string) => (id ? roster.get(id)?.info.shortName ?? 'a teammate' : 'a teammate');
  const me = roster.get(m.playerId);
  const facts: string[] = [];
  const genius = m.kind === 'genius';
  const minute = Math.floor(m.clockMs / 60000) + 1;
  facts.push(`${me?.info.name} (${me?.info.role}) ${genius ? 'played' : 'chose'} ${phrase(m.actual, name)} in minute ${minute}${m.actualOutcome ? `; it ${OUTCOME_WORDS[m.actualOutcome] ?? m.actualOutcome}` : ''}.`);
  facts.push(`${m.actual.action === 'shot' ? 'Chance the shot scores' : 'Chance the chosen option comes off'}: ${pct(m.actual.pSuccess)}.`);
  facts.push(
    genius
      ? `The obvious, safer option most players take was ${phrase(m.ghost, name)}, with a ${pct(m.ghost.pSuccess)} chance to come off.`
      : `The better option was ${phrase(m.ghost, name)}, with a ${pct(m.ghost.pSuccess)} chance to come off.`,
  );
  facts.push(genius ? `Extra threat reached over the obvious option: ${(m.evGained ?? 0).toFixed(3)}.` : `Value left on the table (expected value): ${m.evLost.toFixed(3)}.`);
  if (m.sim)
    facts.push(
      genius
        ? `Across ${m.sim.rollouts} simulations: the choice made created ${m.sim.actual.toFixed(3)} xG per attempt, the obvious option ${m.sim.ghost.toFixed(3)}.`
        : `Across ${m.sim.rollouts} simulations: the better option created ${m.sim.ghost.toFixed(3)} xG per attempt, the choice made ${m.sim.actual.toFixed(3)}.`,
    );
  const headline = genius ? m.actual : m.ghost;
  if (headline.visibility) facts.push(`${headline.action === 'pass' ? name(headline.targetPlayerId) : 'That option'} was ${VIS[headline.visibility]} for ${name(m.playerId)}.`);

  // Distances straight from the freeze frame (acting team's frame).
  const opp = e.freezeFrame.filter((s) => s.team !== e.team && !roster.get(s.playerId)?.isGK);
  const nearest = (p: { x: number; y: number }) => opp.map((s) => ({ s, d: dist(s.pos, p) })).sort((a, b) => a.d - b.d)[0];
  const carrierNear = nearest(e.start);
  if (carrierNear) facts.push(`Nearest opponent to ${name(m.playerId)}: ${name(carrierNear.s.playerId)}, ${carrierNear.d.toFixed(1)} m away.`);
  for (const o of [m.ghost, m.actual]) {
    if (o.action !== 'pass' || !o.targetPlayerId) continue;
    const t = e.freezeFrame.find((s) => s.playerId === o.targetPlayerId);
    if (!t) continue;
    const n = nearest(t.pos);
    if (n) facts.push(`Nearest defender to ${name(o.targetPlayerId)}: ${name(n.s.playerId)}, ${n.d.toFixed(1)} m away.`);
    const inLane = opp.filter((s) => {
      const { d, u } = pointToSegment(s.pos, e.start, o.end);
      return d < 2.5 && u > 0.1 && u < 0.9;
    }).length;
    facts.push(`Defenders within 2.5 m of the passing lane to ${name(o.targetPlayerId)}: ${inLane}.`);
  }
  if (m.confidence) facts.push(`How sure the engine is: a ${m.confidence.level} call (${pct(m.confidence.score)}).`);
  if (m.fairPlay) facts.push(`Fair Play verdict: ${m.fairPlay.label} (${m.fairPlay.why}).`);
  if (m.gameState && m.gameState.code !== 'open') facts.push(`Game state: ${m.gameState.label}.`);
  if (!m.ghost.offside && !m.actual.offside) facts.push('Nobody in these options was offside.');
  for (const r of m.reasons) facts.push(`${r.text.charAt(0).toUpperCase()}${r.text.slice(1)}.`);
  // Who the ball would have reached: finishing and goals, so the AI can mention them without guessing.
  for (const id of new Set([m.ghost.targetPlayerId, m.actual.targetPlayerId].filter((x): x is string => !!x))) {
    const p = roster.get(id)?.info;
    if (p) facts.push(`${p.shortName} (${p.role}): finishing ${Math.round(p.attrs.finishing * 100)} out of 100, ${p.seasons.previous.goals} goals last season.`);
  }
  return facts.map((text, i) => ({ id: `F${i + 1}`, text }));
}

// ---- checking ----------------------------------------------------------------------

/** Numbers as written: 54%, 0.032, 2.1 m, 16. Minutes like 63' count as numbers too. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

const supported = (x: number, allowed: number[]) =>
  allowed.some((y) => {
    const tol = Math.abs(y) >= 1 ? 1 : Math.max(0.0015, Math.abs(y) * 0.03);
    return Math.abs(Math.abs(x) - Math.abs(y)) <= tol;
  });

const FREE = /\b(unmarked|free|all alone|in (?:acres of )?space|no defender|wide open|completely open)\b/i;
const SAW = /\b(saw|spotted|in (?:his|her|their) (?:line of )?sight|in view|could see)\b/i;
const OFFSIDE = /\boffside\b/i;
const NEGATED = /\b(no|nobody|no one|not|never|none)\b|n't/i;

/**
 * Check an explanation against the facts. Returns the problems in plain words (empty = supported).
 * `claims` are the AI's own claim list; each must cite at least one real fact.
 */
export function checkAgainstFacts(text: string, claims: EvidenceClaim[] | null, facts: EvidenceFact[], roster: Roster): string[] {
  const problems: string[] = [];
  const byId = new Map(facts.map((f) => [f.id, f]));
  const factText = facts.map((f) => f.text).join('\n');
  const allowed = numbersIn(factText);

  if (claims) {
    if (!claims.length) problems.push('no claims were listed');
    for (const c of claims) if (!c.facts?.length || !c.facts.every((id) => byId.has(id))) problems.push(`"${c.text.slice(0, 60)}" cites no real fact`);
  }

  for (const x of numbersIn(text)) if (!supported(x, allowed)) problems.push(`the number ${x} is not in the facts`);

  // Players: anyone named must be in the facts.
  const names = new Set<string>();
  for (const r of roster.values()) {
    names.add(r.info.shortName);
    names.add(r.info.name);
  }
  for (const n of names) if (n.length > 2 && new RegExp(`\\b${n}\\b`).test(text) && !factText.includes(n)) problems.push(`${n} is not part of this moment`);

  // Contradictions, sentence by sentence.
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    for (const r of roster.values()) {
      const who = r.info.shortName;
      if (!new RegExp(`\\b${who}\\b`).test(sentence)) continue;
      const near = factText.match(new RegExp(`Nearest defender to ${who}: [^,]+, ([\\d.]+) m away`));
      if (FREE.test(sentence) && near && Number(near[1]) < 3) problems.push(`it says ${who} was unmarked, but a defender was ${near[1]} m away`);
      if (SAW.test(sentence) && new RegExp(`${who} was behind them`).test(factText)) problems.push(`it says ${who} could be seen, but they were behind the player`);
    }
  }
  // Offside: only if a fact says someone was in an offside position (saying nobody was is fine).
  const offsideClaim = text.split(/(?<=[.!?])\s+/).some((x) => OFFSIDE.test(x) && !NEGATED.test(x));
  if (offsideClaim && !/offside position/.test(factText)) problems.push('it mentions offside, which the facts do not support');
  return [...new Set(problems)];
}

/** Parse the AI's JSON answer ({ explanation, claims: [{ text, facts }] }); null if it isn't that. */
export function parseClaimed(raw: string): { explanation: string; claims: EvidenceClaim[] } | null {
  try {
    const json = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()) as { explanation?: unknown; claims?: unknown };
    if (typeof json.explanation !== 'string' || !Array.isArray(json.claims)) return null;
    const claims = json.claims
      .filter((c): c is { text: string; facts: unknown[] } => !!c && typeof (c as { text?: unknown }).text === 'string' && Array.isArray((c as { facts?: unknown }).facts))
      .map((c) => ({ text: c.text, facts: c.facts.map(String) }));
    return { explanation: json.explanation.trim(), claims };
  } catch {
    return null;
  }
}

/** Resolve claim fact ids into the facts themselves, for the evidence panel. */
export function withFacts(claims: EvidenceClaim[], facts: EvidenceFact[]): Evidence['claims'] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return claims.map((c) => ({ text: c.text, facts: c.facts.map((id) => byId.get(id)).filter((f): f is EvidenceFact => !!f) }));
}

/**
 * A plain explanation written straight from the facts, with its claims mapped to them (so it is
 * supported by construction). Used when the AI is off or its answers fail the check twice, and
 * as the "not enough evidence" statement when the Fair Play verdict says so.
 */
export function templateExplanation(m: DecisionMoment, facts: EvidenceFact[], roster: Roster): { explanation: string; claims: EvidenceClaim[] } {
  const name = (id?: string) => (id ? roster.get(id)?.info.shortName ?? 'a teammate' : 'a teammate');
  const find = (re: RegExp) => facts.find((f) => re.test(f.text))?.id;
  const claims: EvidenceClaim[] = [];
  const add = (text: string, ...ids: (string | undefined)[]) => {
    const ok = ids.filter((x): x is string => !!x);
    if (ok.length) claims.push({ text, facts: ok });
  };
  const who = name(m.playerId);
  if (m.fairPlay?.verdict === 'insufficient') {
    add(`Not enough evidence to judge: ${m.fairPlay.why}.`, find(/^Fair Play verdict/), find(/^How sure/));
    add(`${who} chose ${phrase(m.actual, name)}; ${phrase(m.ghost, name)} was the alternative.`, 'F1', 'F3');
  } else if (m.kind === 'genius') {
    add(`${who} found ${phrase(m.actual, name)} when most players would have taken ${phrase(m.ghost, name)}.`, 'F1', 'F3');
    add(`It reached ${(m.evGained ?? 0).toFixed(3)} more threat than the obvious ball.`, 'F4');
    if (m.sim) add(`In ${m.sim.rollouts} simulations it created ${m.sim.actual.toFixed(3)} xG per attempt against ${m.sim.ghost.toFixed(3)}.`, find(/^Across/));
  } else {
    add(`${who} chose ${phrase(m.actual, name)} when ${phrase(m.ghost, name)} was on, leaving ${m.evLost.toFixed(3)} of value on the table.`, 'F1', 'F3', 'F4');
    const cause = m.reasons.find((r) => r.about === 'best');
    if (cause) add(`${cause.text.charAt(0).toUpperCase()}${cause.text.slice(1)}.`, find(new RegExp(`^${cause.text.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')));
    if (m.sim) add(`In ${m.sim.rollouts} simulations the better option created ${m.sim.ghost.toFixed(3)} xG per attempt against ${m.sim.actual.toFixed(3)}.`, find(/^Across/));
  }
  return { explanation: claims.map((c) => c.text).join(' '), claims };
}
