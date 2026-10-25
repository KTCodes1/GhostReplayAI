// Ghost engine: re-scores every on-ball decision from its freeze frame, finds the options the
// player didn't take, and surfaces the moments where real value was left on the table.

import { clamp, inBox } from '../geometry';
import { passDifficulty } from '../models/pass';
import {
  type OptionContext,
  type ScoredOption,
  enumerateOptions,
  evaluateCarry,
  evaluatePass,
  evaluateShot,
} from '../options';
import type {
  DecisionMoment,
  DecisionReason,
  GeneratedMatch,
  GhostOption,
  MatchEvent,
  MatchMeta,
  PlayerInfo,
  Side,
} from '../types';
import { simulateWhatIf } from './whatif';

export type RosterEntry = { info: PlayerInfo; team: Side; isGK: boolean };
export type Roster = Map<string, RosterEntry>;

export function buildRoster(meta: MatchMeta): Roster {
  const r: Roster = new Map();
  for (const team of ['home', 'away'] as Side[])
    for (const info of meta[team].players) r.set(info.id, { info, team, isGK: info.position === 'GK' });
  return r;
}

/** Restarts where the "decision" is scripted or not worth judging. */
const SKIP_CONTEXTS = new Set(['penalty', 'kickoff']);

export function isJudgeable(e: MatchEvent): boolean {
  return (e.type === 'pass' || e.type === 'carry' || e.type === 'shot') && !SKIP_CONTEXTS.has(e.context ?? '');
}

/** Rebuild the option context (attacking frame) from an event's freeze frame. */
export function contextFromEvent(e: MatchEvent, roster: Roster): OptionContext {
  const me = roster.get(e.playerId);
  const toOP = (s: MatchEvent['freezeFrame'][number]) => {
    const r = roster.get(s.playerId);
    return { id: s.playerId, pos: s.pos, isGK: r?.isGK ?? false, finishing: r?.info.attrs.finishing, tackling: r?.info.attrs.tackling };
  };
  const a = me?.info.attrs;
  return {
    carrier: { id: e.playerId, pos: e.start, isGK: me?.isGK ?? false, passing: a?.passing, dribbling: a?.dribbling, pace: a?.pace, finishing: a?.finishing },
    teammates: e.freezeFrame.filter((s) => s.team === e.team && s.playerId !== e.playerId).map(toOP),
    opponents: e.freezeFrame.filter((s) => s.team !== e.team).map(toOP),
  };
}

const toGhost = (o: ScoredOption, actualEV: number): GhostOption => ({
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
});

export type GhostAnalysis = {
  event: MatchEvent;
  actual: GhostOption;
  alternatives: GhostOption[]; // distinct from the actual choice, best first
  best: GhostOption; // best plausible alternative, or the actual choice if nothing beat it
  choseBest: boolean;
  evLost: number;
  zoneWeight: number;
  severity: number;
  /** Set once the moment has been checked by simulation: expected goals per attempt. */
  sim?: { actual: number; ghost: number; rollouts: number };
};

/** Options within this EV of the best count as "the right call". */
export const BEST_CHOICE_TOLERANCE = 0.005;
/** A headline ghost must be something a fan would believe was on. */
export const MIN_PLAUSIBLE_P = 0.45;
const DRAMA_BOOST = 1.25;

export const isPlausible = (o: GhostOption): boolean => o.action === 'shot' || o.pSuccess >= MIN_PLAUSIBLE_P;

/** Score the actual action and every alternative from the event's freeze frame. */
export function analyzeEvent(e: MatchEvent, roster: Roster): GhostAnalysis | null {
  if (!isJudgeable(e) || (!e.end && e.type !== 'shot')) return null;
  if (roster.get(e.playerId)?.isGK) return null;
  const ctx = contextFromEvent(e, roster);

  const actualScored =
    e.type === 'pass' ? evaluatePass(ctx, e.targetPlayerId, e.end!) : e.type === 'carry' ? evaluateCarry(ctx, e.end!) : evaluateShot(ctx);
  const actualEV = actualScored.expectedValue;
  const actual = toGhost(actualScored, actualEV);

  // Alternatives: drop the option that *is* the actual choice, keep only the best carry.
  let carryKept = false;
  const alternatives: GhostOption[] = [];
  for (const o of enumerateOptions(ctx)) {
    if (o.action === e.type && (o.action === 'shot' || o.action === 'carry' || o.targetPlayerId === e.targetPlayerId)) continue;
    if (o.action === 'carry') {
      if (carryKept) continue;
      carryKept = true;
    }
    alternatives.push(toGhost(o, actualEV));
  }

  const top = alternatives.find(isPlausible);
  const best = top && top.expectedValue > actual.expectedValue ? top : actual;
  const evLost = Math.max(0, best.expectedValue - actualEV);
  const zoneWeight = zoneWeightFor(e, best);
  // Decisions are judged on EV, not the result — but a "what if" lands harder when it went wrong.
  const drama = e.outcome === 'fail' || e.outcome === 'blocked' || e.outcome === 'off_target' ? DRAMA_BOOST : 1;
  return {
    event: e,
    actual,
    alternatives,
    best,
    choseBest: evLost <= BEST_CHOICE_TOLERANCE,
    evLost,
    zoneWeight,
    severity: evLost * zoneWeight * drama,
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

export function reasonsFor(a: GhostAnalysis, roster: Roster): DecisionReason[] {
  const out: DecisionReason[] = [];
  const name = (id?: string) => (id ? roster.get(id)?.info.shortName ?? id : 'a teammate');
  const { actual, best } = a;
  const bf = best.features ?? {};
  const af = actual.features ?? {};

  if (best !== actual) {
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

  return out;
}

export function toDecisionMoment(a: GhostAnalysis, roster: Roster, maxAlternatives = 5): DecisionMoment {
  const e = a.event;
  return {
    eventId: e.id,
    t: e.t,
    period: e.period,
    clockMs: e.clockMs,
    team: e.team,
    playerId: e.playerId,
    actual: a.actual,
    ...(e.outcome ? { actualOutcome: e.outcome } : {}),
    ghost: a.best,
    alternatives: a.alternatives.slice(0, maxAlternatives),
    severity: a.severity,
    evLost: a.evLost,
    zoneWeight: a.zoneWeight,
    reasons: reasonsFor(a, roster),
    ...(a.sim ? { sim: a.sim } : {}),
  };
}

// ---- simulation check -------------------------------------------------------------

export const SIM_ROLLOUTS = 50;
/** The ghost must create at least this much more expected goals in simulation than the actual choice. */
const SIM_MARGIN = 0.004;
const SIM_CANDIDATES = 3;

/**
 * Before a moment goes on screen, play the actual choice and the best plausible alternatives
 * out in the match engine. The headline ghost becomes the option that really creates the most
 * danger; if nothing beats what the player did, the moment is dropped. Model and simulation must agree.
 */
export function confirmWithSimulation(a: GhostAnalysis, meta: MatchMeta): GhostAnalysis | null {
  const candidates = a.alternatives.filter((o) => isPlausible(o) && o.deltaVsActual > BEST_CHOICE_TOLERANCE).slice(0, SIM_CANDIDATES);
  if (!candidates.length) return null;
  const xg = (o: GhostOption) => simulateWhatIf(meta, a.event, o, { rollouts: SIM_ROLLOUTS }).summary.expectedGoals;
  const actualXg = xg(a.actual);
  let best: GhostOption | undefined;
  let bestXg = -Infinity;
  for (const c of candidates) {
    const v = xg(c);
    if (v > bestXg) {
      bestXg = v;
      best = c;
    }
  }
  if (!best || bestXg < actualXg + SIM_MARGIN) return null;
  const evLost = best.expectedValue - a.actual.expectedValue;
  const zoneWeight = zoneWeightFor(a.event, best);
  const drama = a.severity / Math.max(1e-9, a.evLost * a.zoneWeight);
  return { ...a, best, evLost, zoneWeight, severity: evLost * zoneWeight * drama, sim: { actual: actualXg, ghost: bestXg, rollouts: SIM_ROLLOUTS } };
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
/** Never two freezes within this much match time, whoever they're for. */
const MIN_GAP_ANY_MS = 25_000;

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
  // Player focus mode: the followed player's moments get their own, lower bar and quota.
  private focusId: string | undefined;
  private lastFocusT = -Infinity;
  private focusThisHalf = 0;
  private lastAnyT = -Infinity;

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
    }
    const a = analyzeEvent(e, this.roster);
    if (!a) return null;
    this.all.push(a);

    const rec = this.records.get(e.playerId) ?? { playerId: e.playerId, team: e.team, decisions: 0, bestChoices: 0, evLost: 0, evCreated: 0 };
    rec.decisions += 1;
    if (a.choseBest) rec.bestChoices += 1;
    rec.evLost += a.evLost;
    rec.evCreated += a.actual.expectedValue;
    this.records.set(e.playerId, rec);

    const { threshold, cooldownMs, maxPerHalf } = this.opts;
    const focus = this.focusId !== undefined && e.playerId === this.focusId;
    // The bar rises as the half's quota fills, so late big moments still get a slot.
    const bar = focus ? threshold * FOCUS.barFactor : threshold * (1 + 0.2 * this.shownThisHalf);
    const blocked = focus
      ? e.t - this.lastFocusT < FOCUS.cooldownMs || this.focusThisHalf >= FOCUS.maxPerHalf
      : e.t - this.lastShownT < cooldownMs || this.shownThisHalf >= maxPerHalf;
    if (a.severity < bar || blocked || e.t - this.lastAnyT < MIN_GAP_ANY_MS) return null;
    const confirmed = confirmWithSimulation(a, this.meta);
    if (!confirmed || confirmed.severity < bar) return null;
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

  playerRecords(): PlayerDecisionRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  /** Every analysed decision so far (for recap / analyst drill-down). */
  analyses(): readonly GhostAnalysis[] {
    return this.all;
  }

  /** The decisions that shaped the match (simulation-checked), for the full-time recap. */
  recap(n = 8): DecisionMoment[] {
    return topDecisions(this.all, this.roster, this.meta, n);
  }
}

// ---- offline: the decisions that shaped the match ---------------------------------

/** Top-N simulation-confirmed moments by severity, at least `spacingMs` apart — the full-time recap. */
export function topDecisions(analyses: readonly GhostAnalysis[], roster: Roster, meta: MatchMeta, n = 8, spacingMs = 60_000): DecisionMoment[] {
  const picked: GhostAnalysis[] = [];
  let tries = 0;
  for (const a of [...analyses].sort((x, y) => y.severity - x.severity)) {
    if (picked.length >= n || tries >= n * 6) break;
    if (picked.some((p) => Math.abs(p.event.t - a.event.t) < spacingMs)) continue;
    tries += 1;
    const c = confirmWithSimulation(a, meta);
    if (c) picked.push(c);
  }
  return picked.sort((x, y) => x.event.t - y.event.t).map((a) => toDecisionMoment(a, roster));
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
