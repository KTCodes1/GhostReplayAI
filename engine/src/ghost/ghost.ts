// Ghost engine: re-scores every on-ball decision from its freeze frame, finds the options the
// player didn't take, and surfaces the moments where real value was left on the table — and the
// moments where a player found something special that most wouldn't have seen.
//
// Judging is fair by design (see judge.ts): options are scored on the moving picture, for what this
// player can execute, in this game state, two steps deep; a player is only blamed for options they
// could see; and only clear calls freeze the match.

import { clamp, inBox } from '../geometry';
import { NEUTRAL_STATE, type GameState } from '../models/gamestate';
import { passDifficulty } from '../models/pass';
import type { VisionCone } from '../models/vision';
import type { DecisionMoment, DecisionReason, GeneratedMatch, GhostOption, MatchEvent, MatchMeta, Side } from '../types';
import { contextCauses, geniusCauses, optionCauses } from './causes';
import { type JudgedOption, type Roster, type RosterEntry, judgeActual, judgeContext, judgeOptions } from './judge';
import { simulateWhatIf } from './whatif';

export { contextFromEvent, type Roster, type RosterEntry } from './judge';

export function buildRoster(meta: MatchMeta): Roster {
  const r: Roster = new Map();
  for (const team of ['home', 'away'] as Side[])
    for (const info of meta[team].players) r.set(info.id, { info, team, isGK: info.position === 'GK', directness: meta[team].style.directness });
  return r;
}

/** Restarts where the "decision" is scripted or not worth judging. */
const SKIP_CONTEXTS = new Set(['penalty', 'kickoff']);

export function isJudgeable(e: MatchEvent): boolean {
  return (e.type === 'pass' || e.type === 'carry' || e.type === 'shot') && !SKIP_CONTEXTS.has(e.context ?? '');
}

export const toGhostOption = (o: JudgedOption, actualEV: number): GhostOption => ({
  action: o.action,
  ...(o.targetPlayerId ? { targetPlayerId: o.targetPlayerId } : {}),
  end: o.end,
  pSuccess: o.pSuccess,
  valueIfSuccess: o.valueIfSuccess,
  turnoverCost: o.turnoverCost,
  expectedValue: o.expectedValue,
  deltaVsActual: o.expectedValue - actualEV,
  ...(o.action === 'pass' ? { difficulty: passDifficulty(o.pSuccess) } : {}),
  features: o.features,
  visibility: o.visibility,
  modelP: o.modelP,
  ...(o.offside ? { offside: true } : {}),
  ...(o.runner ? { runner: true } : {}),
  ...(o.execution ? { execution: { fit: o.execution.fit, notes: o.execution.notes } } : {}),
  ...(o.followUp ? { followUp: o.followUp } : {}),
});

export type GhostAnalysis = {
  event: MatchEvent;
  actual: GhostOption;
  alternatives: GhostOption[]; // distinct from the actual choice, best first
  best: GhostOption; // best plausible option the player could see, or the actual choice if nothing beat it
  choseBest: boolean;
  evLost: number;
  zoneWeight: number;
  severity: number;
  cone: VisionCone;
  state: GameState;
  /** A better option existed, but behind the player (not counted against them). */
  unseen?: GhostOption;
  /** The best-looking option that turned out to be offside. */
  offsideBest?: GhostOption;
  /** Genius check: the option most players would take, and how much more threat the actual choice reached. */
  obvious?: GhostOption;
  evGained?: number;
  geniusScore?: number;
  /** Set once the moment has been checked by simulation: expected goals per attempt. */
  sim?: { actual: number; ghost: number; rollouts: number };
  confidence?: { level: 'clear' | 'likely' | 'close'; score: number };
};

/** Options within this EV of the best count as "the right call". */
export const BEST_CHOICE_TOLERANCE = 0.005;
/** A headline ghost must be something a fan would believe was on. */
export const MIN_PLAUSIBLE_P = 0.45;
const DRAMA_BOOST = 1.25;

export const isPlausible = (o: GhostOption): boolean => o.action === 'shot' || o.pSuccess >= MIN_PLAUSIBLE_P;
/** Can a player fairly be blamed for not taking this? It has to be on, seen, and onside. */
export const isFairGhost = (o: GhostOption): boolean => isPlausible(o) && o.visibility !== 'behind' && !o.offside;

/** Genius: the chosen ball must reach at least this much more threat (xT) than the obvious one. */
const GENIUS_MIN_THREAT = 0.008;
/** Genius: the choice must be within this of the best expected value (the right call, give or take). */
const GENIUS_EV_TOLERANCE = 0.01;

/** What a typical, risk-averse player would do (the same utility the simulated players use). */
const typicalUtility = (o: GhostOption) => o.pSuccess * (o.valueIfSuccess + 0.035) - (1 - o.pSuccess) * o.turnoverCost * 2.5;
const SUCCESS = new Set(['success', 'goal']);

/** Score the actual action and every alternative from the event's freeze frame. `prev` lets us tell a first touch from a run. */
export function analyzeEvent(e: MatchEvent, roster: Roster, prev?: MatchEvent): GhostAnalysis | null {
  if (!isJudgeable(e) || (!e.end && e.type !== 'shot')) return null;
  if (roster.get(e.playerId)?.isGK) return null;
  const jc = judgeContext(e, roster, prev);
  const actualJ = judgeActual(jc, e);
  const actualEV = actualJ.expectedValue;
  const actual = toGhostOption(actualJ, actualEV);

  // Alternatives: drop the option that *is* the actual choice, keep only the best carry.
  let carryKept = false;
  const alternatives: GhostOption[] = [];
  for (const o of judgeOptions(jc)) {
    if (o.action === e.type && (o.action === 'shot' || o.action === 'carry' || o.targetPlayerId === e.targetPlayerId)) continue;
    if (o.action === 'carry') {
      if (carryKept) continue;
      carryKept = true;
    }
    alternatives.push(toGhostOption(o, actualEV));
  }

  const top = alternatives.find(isFairGhost);
  const best = top && top.expectedValue > actual.expectedValue ? top : actual;
  const evLost = Math.max(0, best.expectedValue - actualEV);
  const zoneWeight = zoneWeightFor(e, best);
  const margin = Math.max(best.expectedValue, actualEV) + 0.01;
  const unseen = alternatives.find((o) => isPlausible(o) && !o.offside && o.visibility === 'behind' && o.expectedValue > margin);
  const offsideBest = alternatives.find((o) => o.offside && o.expectedValue > margin);
  // Decisions are judged on EV, not the result — but a "what if" lands harder when it went wrong.
  const drama = e.outcome === 'fail' || e.outcome === 'blocked' || e.outcome === 'off_target' ? DRAMA_BOOST : 1;
  const choseBest = evLost <= BEST_CHOICE_TOLERANCE;

  // Genius: the right call, it came off, it wasn't the one most players would make, it reached
  // much more dangerous ground than the obvious ball, and it was hard to find.
  let genius: Pick<GhostAnalysis, 'obvious' | 'evGained' | 'geniusScore'> = {};
  if (evLost <= GENIUS_EV_TOLERANCE && actual.action !== 'shot' && SUCCESS.has(e.outcome ?? '')) {
    const pool = alternatives.filter((o) => isPlausible(o) && o.visibility === 'visible' && !o.offside);
    const obvious = pool.reduce<GhostOption | undefined>((m, o) => (!m || typicalUtility(o) > typicalUtility(m) ? o : m), undefined);
    if (obvious && typicalUtility(obvious) > typicalUtility(actual)) {
      const extraThreat = actual.valueIfSuccess - obvious.valueIfSuccess;
      const hard =
        (actual.visibility === 'peripheral' ? 0.6 : actual.visibility === 'behind' ? 1.2 : 0) + // unknown earns nothing: we can't claim they found it blind
        ((actual.features?.bypassed ?? 0) >= 3 ? 0.4 : 0) +
        (actual.runner ? 0.4 : 0) +
        (actual.pSuccess < 0.75 ? 0.3 : 0);
      if (extraThreat >= GENIUS_MIN_THREAT && hard > 0) genius = { obvious, evGained: extraThreat, geniusScore: extraThreat * zoneWeightFor(e, actual) * (1 + hard) };
    }
  }

  return {
    event: e,
    actual,
    alternatives,
    best,
    choseBest,
    evLost,
    zoneWeight,
    severity: evLost * zoneWeight * drama,
    cone: jc.cone,
    state: jc.state,
    ...(unseen ? { unseen } : {}),
    ...(offsideBest ? { offsideBest } : {}),
    ...genius,
  };
}

/** Moments near the box matter more than a sideways ball in your own half. */
export function zoneWeightFor(e: MatchEvent, best: GhostOption): number {
  const reach = Math.max(e.start.x, best.end.x);
  let w = 0.4 + 1.0 * clamp((reach - 45) / 45, 0, 1);
  if (inBox(best.end) || e.type === 'shot' || best.action === 'shot') w += 0.3;
  return w;
}

// ---- reasons -------------------------------------------------------------------

const pct = (p: number) => `${Math.round(p * 100)}%`;
const m1 = (x: number) => `${x.toFixed(1)} m`;
const MAX_REASONS = 8;

export function reasonsFor(a: GhostAnalysis, roster: Roster, kind: DecisionMoment['kind'] = 'miss'): DecisionReason[] {
  if (kind === 'genius' && a.obvious) {
    const out = [...geniusCauses(a.actual, a.obvious, a.event, roster), ...optionCauses(a.actual, a.event, roster, 'actual')];
    if (a.state.code !== 'open') out.push({ code: 'game_state', about: 'context', text: a.state.label });
    return out.slice(0, MAX_REASONS);
  }
  const out: DecisionReason[] = [];
  const name = (id?: string) => (id ? roster.get(id)?.info.shortName ?? id : 'a teammate');
  const { actual, best } = a;
  const bf = best.features ?? {};
  const af = actual.features ?? {};

  if (best !== actual) {
    // Causes first: they say *why* the option was on.
    out.push(...optionCauses(best, a.event, roster, 'best'));
    if (best.action === 'pass') {
      const space = (bf.receiverSpace ?? 0) * 5;
      if ((bf.receiverSpace ?? 0) >= 0.8)
        out.push({
          code: 'receiver_free',
          about: 'best',
          text: space >= 4.99 ? `${name(best.targetPlayerId)} was free — no defender within 5 m` : `${name(best.targetPlayerId)} was free — nearest defender ${m1(space)} away`,
          value: space,
        });
      if ((bf.laneThreat ?? 1) < 0.15) out.push({ code: 'lane_clear', about: 'best', text: `the passing lane to ${name(best.targetPlayerId)} was open`, value: bf.laneThreat });
      if ((bf.bypassed ?? 0) >= 3) out.push({ code: 'line_breaking', about: 'best', text: `that ball would have taken ${bf.bypassed} defenders out of the game`, value: bf.bypassed });
      if (inBox(best.end)) out.push({ code: 'into_box', about: 'best', text: `it would have put ${name(best.targetPlayerId)} in the box`, value: best.valueIfSuccess });
    }
    if (best.action === 'carry') {
      out.push({ code: 'space_to_carry', about: 'best', text: `there was room to drive forward — ${pct(best.pSuccess)} chance of getting through`, value: best.pSuccess });
      if (inBox(best.end)) out.push({ code: 'into_box', about: 'best', text: `a few more strides would have taken the ball into the box`, value: best.valueIfSuccess });
    }
    if (best.action === 'shot') out.push({ code: 'better_shot', about: 'best', text: `a shot there had a ${pct(best.pSuccess)} chance of going in`, value: best.pSuccess });
    // Who the ball would have reached matters as much as where.
    const target = best.action === 'pass' && best.targetPlayerId ? roster.get(best.targetPlayerId) : undefined;
    if (target && best.end.x > 80) {
      const total = (r: RosterEntry) => r.info.seasons.current.goals + r.info.seasons.previous.goals;
      const top = [...roster.values()].filter((r) => r.team === target.team).sort((x, y) => total(y) - total(x))[0];
      const s = target.info.seasons;
      if (top?.info.id === target.info.id)
        out.push({ code: 'top_scorer', about: 'best', text: `${target.info.shortName} is the team's top scorer: ${s.previous.goals} goals last season, ${s.current.goals} so far this season`, value: total(target) });
      else if (target.info.attrs.finishing >= 0.82)
        out.push({ code: 'clinical_finisher', about: 'best', text: `${target.info.shortName} is one of the squad's best finishers (${Math.round(target.info.attrs.finishing * 100)}/100)`, value: target.info.attrs.finishing });
    }
  }

  if (actual.action === 'shot') {
    const shooter = roster.get(a.event.playerId);
    if (shooter && shooter.info.attrs.finishing < 0.5)
      out.push({ code: 'weak_finisher', about: 'actual', text: `${shooter.info.shortName} isn't a natural finisher: ${shooter.info.seasons.previous.goals} goals last season`, value: shooter.info.attrs.finishing });
    if (actual.pSuccess < 0.05) out.push({ code: 'low_xg_shot', about: 'actual', text: `the shot from ${m1(af.distance ?? 0)} only had a ${pct(actual.pSuccess)} chance of going in`, value: actual.pSuccess });
    if ((af.blockers ?? 0) >= 2) out.push({ code: 'blocked_shot_lane', about: 'actual', text: `${af.blockers} defenders stood between ball and goal`, value: af.blockers });
  }
  if (actual.action === 'pass') {
    if ((af.receiverSpace ?? 1) < 0.4) out.push({ code: 'marked_receiver', about: 'actual', text: `${name(actual.targetPlayerId)} was tightly marked`, value: (af.receiverSpace ?? 0) * 5 });
    if ((af.laneThreat ?? 0) > 0.6) out.push({ code: 'crowded_lane', about: 'actual', text: `the chosen lane was crowded — ${pct(actual.pSuccess)} chance of completing`, value: actual.pSuccess });
    if (actual.pSuccess > 0.85 && actual.valueIfSuccess < best.valueIfSuccess * 0.5) out.push({ code: 'safe_but_slow', about: 'actual', text: `the safe pass kept the ball but added almost no threat`, value: actual.valueIfSuccess });
  }
  if (actual.action === 'carry' && actual.pSuccess < 0.6) out.push({ code: 'speculative_dribble', about: 'actual', text: `the dribble only had a ${pct(actual.pSuccess)} chance of coming off`, value: actual.pSuccess });
  if (actual.pSuccess < 0.7 && actual.turnoverCost > 0.03) out.push({ code: 'risky_zone', about: 'actual', text: `losing it there handed the opponent a ${pct(actual.turnoverCost)} threat`, value: actual.turnoverCost });

  out.push(...contextCauses({ e: a.event, roster, actual, best, unseen: a.unseen, offsideBest: a.offsideBest, state: a.state }));
  // Keep the strongest few; the context lines always fit.
  const ctx = out.filter((r) => r.about === 'context');
  return [...out.filter((r) => r.about !== 'context').slice(0, MAX_REASONS - ctx.length), ...ctx];
}

export function toDecisionMoment(a: GhostAnalysis, roster: Roster, maxAlternatives = 5, kind: DecisionMoment['kind'] = 'miss'): DecisionMoment {
  const e = a.event;
  const genius = kind === 'genius' && a.obvious;
  return {
    eventId: e.id,
    t: e.t,
    period: e.period,
    clockMs: e.clockMs,
    team: e.team,
    playerId: e.playerId,
    kind: genius ? 'genius' : 'miss',
    actual: a.actual,
    ...(e.outcome ? { actualOutcome: e.outcome } : {}),
    ghost: genius ? a.obvious! : a.best,
    alternatives: a.alternatives.slice(0, maxAlternatives),
    severity: genius ? a.geniusScore ?? 0 : a.severity,
    evLost: genius ? 0 : a.evLost,
    ...(genius ? { evGained: a.evGained } : {}),
    zoneWeight: a.zoneWeight,
    reasons: reasonsFor(a, roster, genius ? 'genius' : 'miss'),
    vision: { facing: a.cone.facing, centralDeg: a.cone.centralDeg, peripheralDeg: a.cone.peripheralDeg, basis: a.cone.basis },
    gameState: { code: a.state.code, label: a.state.label, lossAversion: a.state.lossAversion, riskAppetite: a.state.riskAppetite },
    ...(a.unseen && !genius ? { unseen: a.unseen } : {}),
    ...(a.sim ? { sim: a.sim } : {}),
    ...(a.confidence ? { confidence: a.confidence } : {}),
    ...(genius ? {} : { fairPlay: fairPlayOf(a) }),
  };
}

/**
 * The Fair Play lens: one plain verdict per missed opportunity. Clear only when the better option
 * was in plain view, playable for this player, worth a real amount, and the simulation agrees
 * with conviction; anything less is a reasonable alternative; no clear simulation verdict means
 * there isn't enough evidence to judge.
 */
export function fairPlayOf(a: GhostAnalysis): NonNullable<DecisionMoment['fairPlay']> {
  const level = a.confidence?.level;
  if (!level || level === 'close' || a.best === a.actual)
    return { verdict: 'insufficient', label: 'Not enough evidence to judge', why: "the model and the simulation don't clearly separate the options" };
  const doubts: string[] = [];
  if (a.best.visibility === 'peripheral') doubts.push('it was at the edge of their modeled view');
  if (a.best.visibility === 'unknown') doubts.push("we can't tell whether it was in their view");
  if (a.best.execution && a.best.execution.fit < 0.85) doubts.push('it was hard to execute');
  if (a.evLost < CLEAR_MIN_GAIN) doubts.push('the gain was small');
  if (level === 'likely') doubts.push('the evidence is good but not conclusive');
  if (!doubts.length) return { verdict: 'clear', label: 'Clear opportunity missed', why: 'it was in view, playable, worth a real amount, and the simulation agrees' };
  return { verdict: 'reasonable', label: 'Reasonable alternative', why: doubts.join('; ') };
}
const CLEAR_MIN_GAIN = 0.03;

/** Was this the safe, obvious choice most players would make? (Predictability.) */
export function isObviousChoice(a: GhostAnalysis): boolean {
  const pool = [a.actual, ...a.alternatives.filter(isPlausible)];
  return pool.reduce((m, o) => (typicalUtility(o) > typicalUtility(m) ? o : m), pool[0]!) === a.actual;
}

// ---- simulation check + confidence ------------------------------------------------

export const SIM_ROLLOUTS = 50;
/** The ghost must create at least this much more expected goals in simulation than the actual choice. */
const SIM_MARGIN = 0.004;
const SIM_CANDIDATES = 3;
/** How uncertain the models are, in EV units: a margin this size is about one standard error. */
const MODEL_SE = 0.025;
/** The simulation is the stronger evidence. */
const SIM_WEIGHT = 0.65;

const normalCdf = (z: number) => 0.5 * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z ** 3)));

/**
 * How sure are we that the better option really was better? Combines the model's margin with the
 * simulation's margin (in standard errors of the 50 rollouts). Options on the edge of the player's
 * vision count for less. Close calls are labelled, never frozen on.
 */
export function confidenceOf(evMargin: number, simDiff: number, sdA: number, sdB: number, n: number, visibility?: GhostOption['visibility']): { level: 'clear' | 'likely' | 'close'; score: number } {
  const se = Math.max(0.004, Math.sqrt((sdA ** 2 + sdB ** 2) / n));
  let z = SIM_WEIGHT * (simDiff / se) + (1 - SIM_WEIGHT) * (evMargin / MODEL_SE);
  if (visibility === 'peripheral' || visibility === 'unknown') z -= 0.6;
  const score = normalCdf(z);
  return { level: score >= 0.9 ? 'clear' : score >= 0.7 ? 'likely' : 'close', score: +score.toFixed(3) };
}

/**
 * Before a moment goes on screen, play the actual choice and the best fair alternatives out in the
 * match engine. The headline ghost becomes the option that really creates the most danger; if
 * nothing beats what the player did, the moment is dropped. Model and simulation must agree.
 */
export function confirmWithSimulation(a: GhostAnalysis, meta: MatchMeta): GhostAnalysis | null {
  if (confirmed.has(a)) return confirmed.get(a)!;
  const r = confirmUncached(a, meta);
  confirmed.set(a, r);
  return r;
}

// Simulations are deterministic, so a decision only ever needs confirming once
// (the live detector, the recap and the report all ask about the same ones).
const confirmed = new WeakMap<GhostAnalysis, GhostAnalysis | null>();
const confirmedGenius = new WeakMap<GhostAnalysis, GhostAnalysis | null>();

function confirmUncached(a: GhostAnalysis, meta: MatchMeta): GhostAnalysis | null {
  const candidates = a.alternatives.filter((o) => isFairGhost(o) && o.deltaVsActual > BEST_CHOICE_TOLERANCE).slice(0, SIM_CANDIDATES);
  if (!candidates.length) return null;
  const run = (o: GhostOption) => simulateWhatIf(meta, a.event, o, { rollouts: SIM_ROLLOUTS }).summary;
  const actual = run(a.actual);
  let best: GhostOption | undefined;
  let bestSim: ReturnType<typeof run> | undefined;
  for (const c of candidates) {
    const s = run(c);
    if (!bestSim || s.expectedGoals > bestSim.expectedGoals) {
      bestSim = s;
      best = c;
    }
  }
  if (!best || !bestSim || bestSim.expectedGoals < actual.expectedGoals + SIM_MARGIN) return null;
  const evLost = best.expectedValue - a.actual.expectedValue;
  const zoneWeight = zoneWeightFor(a.event, best);
  const drama = a.severity / Math.max(1e-9, a.evLost * a.zoneWeight);
  const confidence = confidenceOf(evLost, bestSim.expectedGoals - actual.expectedGoals, actual.sdXg, bestSim.sdXg, SIM_ROLLOUTS, best.visibility);
  return { ...a, best, evLost, zoneWeight, severity: evLost * zoneWeight * drama, sim: { actual: actual.expectedGoals, ghost: bestSim.expectedGoals, rollouts: SIM_ROLLOUTS }, confidence };
}

/** Genius moments must hold up in simulation too: the choice made beats the obvious option. */
export function confirmGenius(a: GhostAnalysis, meta: MatchMeta): GhostAnalysis | null {
  if (confirmedGenius.has(a)) return confirmedGenius.get(a)!;
  const r = confirmGeniusUncached(a, meta);
  confirmedGenius.set(a, r);
  return r;
}

function confirmGeniusUncached(a: GhostAnalysis, meta: MatchMeta): GhostAnalysis | null {
  if (!a.obvious || !a.evGained) return null;
  const run = (o: GhostOption) => simulateWhatIf(meta, a.event, o, { rollouts: SIM_ROLLOUTS }).summary;
  const actual = run(a.actual);
  const obvious = run(a.obvious);
  if (actual.expectedGoals < obvious.expectedGoals + SIM_MARGIN) return null;
  const confidence = confidenceOf(a.evGained, actual.expectedGoals - obvious.expectedGoals, actual.sdXg, obvious.sdXg, SIM_ROLLOUTS);
  if (confidence.level === 'close') return null;
  return { ...a, sim: { actual: actual.expectedGoals, ghost: obvious.expectedGoals, rollouts: SIM_ROLLOUTS }, confidence };
}

// ---- per-player decision record (player focus mode) ------------------------------

export type PlayerDecisionRecord = {
  playerId: string;
  team: Side;
  decisions: number;
  bestChoices: number;
  evLost: number;
  evCreated: number; // sum of actual EV of chosen options
};

// ---- live detector ---------------------------------------------------------------

export type DetectorOptions = {
  /** Minimum weighted severity for a moment to reach the screen. */
  threshold: number;
  /** Minimum match time between two surfaced moments. */
  cooldownMs: number;
  /** Hard cap on surfaced moments per half. */
  maxPerHalf: number;
};

export const DEFAULT_DETECTOR: DetectorOptions = { threshold: 0.035, cooldownMs: 150_000, maxPerHalf: 6 };

/** Player focus mode: a lower bar, a shorter cooldown and a separate quota for the followed player. */
const FOCUS = { barFactor: 0.3, cooldownMs: 60_000, maxPerHalf: 6 };
/** Genius moments: their own bar and quota, so the match isn't only about mistakes. */
export const GENIUS = { threshold: 0.01, cooldownMs: 90_000, maxPerHalf: 2 };
/** Never two freezes within this much match time, whoever they're for. */
const MIN_GAP_ANY_MS = 25_000;

/** How the model compared with the simulation on every moment it checked (validation). */
export type SimAgreement = { checked: number; agreed: number };

/** Streaming detector: feed events in order; returns a DecisionMoment when one should be shown. */
export class DecisionDetector {
  readonly roster: Roster;
  private opts: DetectorOptions;
  private lastShownT = -Infinity;
  private shownThisHalf = 0;
  private half: 1 | 2 = 1;
  private records = new Map<string, PlayerDecisionRecord>();
  private all: GhostAnalysis[] = [];
  private meta: MatchMeta;
  private prev: MatchEvent | undefined;
  // Player focus mode: the followed player's moments get their own, lower bar and quota.
  private focusId: string | undefined;
  private lastFocusT = -Infinity;
  private focusThisHalf = 0;
  private lastAnyT = -Infinity;
  private lastGeniusT = -Infinity;
  private geniusThisHalf = 0;
  private agreement: SimAgreement = { checked: 0, agreed: 0 };

  constructor(meta: MatchMeta, opts: Partial<DetectorOptions> = {}) {
    this.meta = meta;
    this.roster = buildRoster(meta);
    this.opts = { ...DEFAULT_DETECTOR, ...opts };
  }

  /** Follow one player: more of their decisions reach the screen. */
  setFocus(playerId: string | undefined) {
    this.focusId = playerId && this.roster.has(playerId) ? playerId : undefined;
  }

  push(e: MatchEvent): DecisionMoment | null {
    if (e.period !== this.half) {
      this.half = e.period;
      this.shownThisHalf = 0;
      this.focusThisHalf = 0;
      this.geniusThisHalf = 0;
    }
    const prev = this.prev;
    this.prev = e;
    const a = analyzeEvent(e, this.roster, prev);
    if (!a) return null;
    this.all.push(a);

    const rec = this.records.get(e.playerId) ?? { playerId: e.playerId, team: e.team, decisions: 0, bestChoices: 0, evLost: 0, evCreated: 0 };
    rec.decisions += 1;
    if (a.choseBest) rec.bestChoices += 1;
    rec.evLost += a.evLost;
    rec.evCreated += a.actual.expectedValue;
    this.records.set(e.playerId, rec);

    if (e.t - this.lastAnyT < MIN_GAP_ANY_MS) return null;
    return a.geniusScore !== undefined ? this.tryGenius(a) : this.tryMiss(a);
  }

  private tryMiss(a: GhostAnalysis): DecisionMoment | null {
    const e = a.event;
    const { threshold, cooldownMs, maxPerHalf } = this.opts;
    const focus = this.focusId !== undefined && e.playerId === this.focusId;
    // The bar rises as the half's quota fills, so late big moments still get a slot.
    const bar = focus ? threshold * FOCUS.barFactor : threshold * (1 + 0.2 * this.shownThisHalf);
    const blocked = focus
      ? e.t - this.lastFocusT < FOCUS.cooldownMs || this.focusThisHalf >= FOCUS.maxPerHalf
      : e.t - this.lastShownT < cooldownMs || this.shownThisHalf >= maxPerHalf;
    if (a.severity < bar || blocked) return null;
    this.agreement.checked += 1;
    const confirmed = confirmWithSimulation(a, this.meta);
    if (confirmed) this.agreement.agreed += 1;
    // Close calls are kept for the record but never stop the match.
    if (!confirmed || confirmed.severity < bar || confirmed.confidence?.level === 'close') return null;
    this.lastAnyT = e.t;
    if (focus) {
      this.lastFocusT = e.t;
      this.focusThisHalf += 1;
    } else {
      this.lastShownT = e.t;
      this.shownThisHalf += 1;
    }
    return toDecisionMoment(confirmed, this.roster);
  }

  private tryGenius(a: GhostAnalysis): DecisionMoment | null {
    const e = a.event;
    if ((a.geniusScore ?? 0) < GENIUS.threshold || e.t - this.lastGeniusT < GENIUS.cooldownMs || this.geniusThisHalf >= GENIUS.maxPerHalf) return null;
    const confirmed = confirmGenius(a, this.meta);
    if (!confirmed) return null;
    this.lastAnyT = e.t;
    this.lastGeniusT = e.t;
    this.geniusThisHalf += 1;
    return toDecisionMoment(confirmed, this.roster, 5, 'genius');
  }

  playerRecords(): PlayerDecisionRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  /** Every analysed decision so far (for recap / analyst drill-down). */
  analyses(): readonly GhostAnalysis[] {
    return this.all;
  }

  /** Model vs simulation: of the moments the model flagged, how many did the simulation back up? */
  simAgreement(): SimAgreement {
    return { ...this.agreement };
  }

  /** The decisions that shaped the match (simulation-checked), for the full-time recap. */
  recap(n = 8): DecisionMoment[] {
    return topDecisions(this.all, this.roster, this.meta, n);
  }

  /** The best genius moments of the match (simulation-checked). */
  geniusRecap(n = 3): DecisionMoment[] {
    return topGenius(this.all, this.roster, this.meta, n);
  }
}

// ---- offline: the decisions that shaped the match ---------------------------------

/** Top-N simulation-confirmed, non-close-call moments by severity, at least `spacingMs` apart — the full-time recap. */
export function topDecisions(analyses: readonly GhostAnalysis[], roster: Roster, meta: MatchMeta, n = 8, spacingMs = 60_000): DecisionMoment[] {
  const picked: GhostAnalysis[] = [];
  let tries = 0;
  for (const a of [...analyses].sort((x, y) => y.severity - x.severity)) {
    if (picked.length >= n || tries >= n * 4) break;
    if (picked.some((p) => Math.abs(p.event.t - a.event.t) < spacingMs)) continue;
    tries += 1;
    const c = confirmWithSimulation(a, meta);
    if (c && c.confidence?.level !== 'close') picked.push(c);
  }
  return picked.sort((x, y) => x.event.t - y.event.t).map((a) => toDecisionMoment(a, roster));
}

export function topGenius(analyses: readonly GhostAnalysis[], roster: Roster, meta: MatchMeta, n = 3, spacingMs = 60_000): DecisionMoment[] {
  const picked: GhostAnalysis[] = [];
  let tries = 0;
  for (const a of analyses.filter((x) => x.geniusScore !== undefined).sort((x, y) => (y.geniusScore ?? 0) - (x.geniusScore ?? 0))) {
    if (picked.length >= n || tries >= n * 2) break;
    if (picked.some((p) => Math.abs(p.event.t - a.event.t) < spacingMs)) continue;
    tries += 1;
    const c = confirmGenius(a, meta);
    if (c) picked.push(c);
  }
  return picked.sort((x, y) => x.event.t - y.event.t).map((a) => toDecisionMoment(a, roster, 5, 'genius'));
}

export function analyzeMatch(match: GeneratedMatch, opts: Partial<DetectorOptions> = {}) {
  const det = new DecisionDetector(match.meta, opts);
  const live: DecisionMoment[] = [];
  for (const e of match.events) {
    const m = det.push(e);
    if (m) live.push(m);
  }
  return { live, detector: det, recap: det.recap() };
}

/** For callers that need the default game state (tests, tools). */
export { NEUTRAL_STATE };
