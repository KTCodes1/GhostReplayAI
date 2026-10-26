// Seeded synthetic match generator.
//
// The simulation runs in the absolute frame (home attacks left -> right). At every
// on-ball action it lays out all 22 players (team shape + ball-side shift + offside line
// + pressing + marking + per-player drift), lets the player on the ball choose between
// passes, carries and shots using the same models the ghost engine uses (softmax on EV,
// temperature set by the player's decision-making), then resolves the outcome.
// Each emitted event is converted into the acting team's frame.

import {
  PITCH_LENGTH,
  PITCH_WIDTH,
  add,
  clamp,
  clampToPitch,
  dist,
  flipVel,
  inBox,
  lerpV,
  norm,
  pointToSegment,
  scale,
  sub,
  toAbsolute,
  toTeamFrame,
  v,
} from '../geometry';
import { PENALTY_XG, finishingAdjust } from '../models/xg';
import { pressureAt } from '../models/pass';
import { type OptionContext, type ScoredOption, enumerateOptions, evaluateCarry, evaluatePass, evaluateShot } from '../options';
import { Rng, hashSeed } from '../rng';
import type { EventType, GeneratedMatch, MatchEvent, MatchMeta, Outcome, PlayerInfo, Side, TeamInfo, Vec2 } from '../types';
import { CLUBS, FORMATIONS, buildTeam } from './teams';

export type GenerateOptions = {
  seed: number;
  homeClubId?: string;
  awayClubId?: string;
  halfLengthMin?: number;
};

type SimPlayer = {
  info: PlayerInfo;
  team: Side;
  base: Vec2; // formation slot, team frame
  isGK: boolean;
  pos: Vec2; // absolute
  prevPos: Vec2;
  vel: Vec2; // absolute, m/s
  drift: Vec2; // slowly varying personal offset, team frame
};

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const MS = 1000;
const SAVE_X = 103.6; // where the keeper meets a saved shot (team frame), 1.4 m off the line
const WIDE_Y = 4.6; // a missed shot ends at least this far from the centre of the goal (posts at 3.66)
const r2 = (x: number) => Math.round(x * 100) / 100;
const rv = (p: Vec2): Vec2 => ({ x: r2(p.x), y: r2(p.y) });

export function generateMatch(opts: GenerateOptions): GeneratedMatch {
  const rng = new Rng(hashSeed(`match:${opts.seed}`));
  const clubIds = CLUBS.map((c) => c.id);
  const homeId = opts.homeClubId ?? rng.pick(clubIds);
  const awayId = opts.awayClubId ?? rng.pick(clubIds.filter((c) => c !== homeId));
  const home = buildTeam(homeId);
  const away = buildTeam(awayId);
  const meta: MatchMeta = {
    matchId: `${homeId}-${awayId}-${opts.seed}`,
    seed: opts.seed,
    competition: 'Synthetic Premier Showcase',
    venue: `${home.city} Stadium`,
    kickoffISO: new Date(Date.UTC(2026, 9, 24, 15, 0, 0)).toISOString(),
    home,
    away,
    halfLengthMs: (opts.halfLengthMin ?? 45) * 60 * MS,
  };
  const sim = createSimulation({ rng, meta });
  sim.playMatch();
  return { meta, events: sim.events };
}

/** Where to (re)start a simulation from — e.g. a freeze frame, for "what if" branches. */
export type SimInitialState = {
  t: number;
  period: 1 | 2;
  periodStartT: number;
  score: { home: number; away: number };
  possession: Side;
  carrierId: string;
  ball: Vec2; // absolute
  positions: Map<string, Vec2>; // absolute
  velocities?: Map<string, Vec2>; // absolute, m/s
};

export type SimConfig = { rng: Rng; meta: MatchMeta; idPrefix?: string; initial?: SimInitialState };

/** The first action of a branch: what the player is made to do. `end` is in the actor's team frame. */
export type ForcedAction = { action: 'pass' | 'carry' | 'shot'; targetPlayerId?: string; end: Vec2 };

export type BranchResult = {
  events: MatchEvent[];
  outcome: 'goal' | 'shot' | 'turnover' | 'foul' | 'kept';
  xG: number; // xG of the shot that ended the branch, if any
  endBall: Vec2; // absolute
  durationMs: number;
  /** Did the forced first action come off? */
  firstSuccess: boolean;
  /** Where the shot was taken from / the ball was lost (absolute). */
  shotFrom?: Vec2;
  lossAt?: Vec2;
  /** After losing the ball: did the opponent counter-attack into a shot (within a few actions)? */
  counter?: { shot: boolean; goal: boolean; xG: number };
};

export type BranchOptions = {
  forceSuccess?: boolean;
  /** Resolve a forced pass with defenders reacting while the ball travels, instead of forcing or rolling the model. */
  reactive?: boolean;
  maxActions?: number;
  maxMs?: number;
  /** Keep simulating after a turnover to see if the opponent counter-attacks. */
  counter?: boolean;
};

/** Players can't cover more ground than this between two snapshots (m/s, averaged). */
const MAX_RUN_SPEED = 7;

// Reactive defending (what-if passes): defenders accelerate from their current motion, reach out
// a leg, and getting there doesn't always mean a clean interception.
/** Acceleration (m/s²) rises with pace: quicker players get going quicker, not just top speed. */
const accelFor = (pace: number) => 3.6 + 1.8 * pace;
const REACH = 0.9; // metres
const CLEAN_CUT = 0.75;
/** Where along a ground pass a defender can step in (fractions of its length), then the race at the target (1). */
const LANE_SAMPLES = [...Array.from({ length: 16 }, (_, i) => 0.1 + i * 0.05), 1];
/** Distance covered in `sec` seconds from a standing start, accelerating up to `vmax`. */
const runCover = (sec: number, vmax: number, accel: number) => {
  if (sec <= 0) return 0;
  const tAcc = vmax / accel;
  return sec <= tAcc ? 0.5 * accel * sec * sec : (vmax * vmax) / (2 * accel) + vmax * (sec - tAcc);
};
/** Time to cover `d` metres from a standing start. */
const runTime = (d: number, vmax: number, accel: number) => {
  const dAcc = (vmax * vmax) / (2 * accel);
  return d <= dAcc ? Math.sqrt((2 * d) / accel) : vmax / accel + (d - dAcc) / vmax;
};

export function createSimulation(cfg: SimConfig) {
  const { rng, meta } = cfg;
  const teams: Record<Side, TeamInfo> = { home: meta.home, away: meta.away };
  const halfLengthMs = meta.halfLengthMs;
  const idPrefix = cfg.idPrefix ?? meta.matchId;
  const init = cfg.initial;

  const players: SimPlayer[] = (['home', 'away'] as Side[]).flatMap((team) => {
    const slots = FORMATIONS[teams[team].formation];
    return teams[team].players.map((info, i) => {
      const base = slots[i]!.base;
      const pos = init?.positions.get(info.id) ?? toAbsolute(base, team);
      const vel = init?.velocities?.get(info.id) ?? v(0, 0);
      return { info, team, base, isGK: info.position === 'GK', pos, prevPos: pos, vel, drift: v(0, 0) };
    });
  });
  const byId = new Map(players.map((p) => [p.info.id, p]));
  const teamOf = (s: Side) => players.filter((p) => p.team === s);
  const gk = (s: Side) => teamOf(s).find((p) => p.isGK)!;
  const kickoffTaker = (s: Side) => teamOf(s).find((p) => p.info.position === 'ST') ?? teamOf(s)[10]!;

  // ---- match state ------------------------------------------------------------
  const events: MatchEvent[] = [];
  const score = init ? { ...init.score } : { home: 0, away: 0 };
  let t = init?.t ?? 0;
  let lastLayoutT = t;
  let period: 1 | 2 = init?.period ?? 1;
  let periodStartT = init?.periodStartT ?? 0;
  let possession: Side = init?.possession ?? 'home';
  let carrier: SimPlayer = init ? byId.get(init.carrierId)! : kickoffTaker(possession);
  let ball: Vec2 = init ? { ...init.ball } : v(PITCH_LENGTH / 2, PITCH_WIDTH / 2); // absolute
  let pendingPenalty = false;
  let restart: string | undefined; // context of the next on-ball action
  let lastShotXg = 0;

  // ---- event emission ---------------------------------------------------------
  type Emit = {
    type: EventType;
    team: Side;
    player: SimPlayer;
    start: Vec2; // absolute
    end?: Vec2; // absolute
    target?: SimPlayer;
    outcome?: Outcome;
    ballSpeed?: number;
    context?: string;
    at?: number; // override time
  };

  function emit(e: Emit): MatchEvent {
    const last = events[events.length - 1];
    const tt = Math.max(Math.round(e.at ?? t), last ? last.t + 1 : 0);
    const clockMs = period === 1 ? tt : halfLengthMs + (tt - periodStartT);
    const ev: MatchEvent = {
      id: `${idPrefix}-${events.length}`,
      seq: events.length,
      t: tt,
      period,
      clockMs,
      type: e.type,
      team: e.team,
      playerId: e.player.info.id,
      start: rv(toTeamFrame(e.start, e.team)),
      ...(e.end ? { end: rv(toTeamFrame(e.end, e.team)) } : {}),
      ...(e.target ? { targetPlayerId: e.target.info.id } : {}),
      ...(e.outcome ? { outcome: e.outcome } : {}),
      ...(e.ballSpeed ? { ballSpeed: r2(e.ballSpeed) } : {}),
      ...(e.context ? { context: e.context } : {}),
      score: { ...score },
      freezeFrame: players.map((p) => ({
        playerId: p.info.id,
        team: p.team,
        pos: rv(toTeamFrame(p.pos, e.team)),
        vel: rv(e.team === 'home' ? p.vel : flipVel(p.vel)),
      })),
    };
    events.push(ev);
    return ev;
  }

  // ---- shape model ------------------------------------------------------------
  function shapeTarget(p: SimPlayer, ballTF: Vec2, inPossession: boolean): Vec2 {
    const style = teams[p.team].style;
    if (p.isGK) {
      const x = inPossession ? clamp(3 + ballTF.x * 0.15, 3, 18) : clamp(2 + ballTF.x * 0.08, 2, 12);
      return v(x, 34 + (ballTF.y - 34) * 0.12);
    }
    const yFromBase = p.base.y - 34;
    if (inPossession) {
      const backline = clamp(ballTF.x - 28, 14, 55);
      const x = backline + (p.base.x - 24) * (1.05 + style.directness * 0.1);
      const y = 34 + yFromBase * 1.2 + (ballTF.y - 34) * 0.2;
      return v(x, y);
    }
    // The block gets shorter and narrower the closer the ball is to our goal.
    const danger = clamp(1 - ballTF.x / 55, 0, 1);
    const backline = clamp(0.5 * ballTF.x + 4 + style.press * 4, ballTF.x < 17 ? 8 : 13, 40 + style.press * 8);
    const x = backline + (p.base.x - 24) * (0.75 - danger * 0.35);
    const y = 34 + yFromBase * (0.8 - danger * 0.25) + (ballTF.y - 34) * 0.4;
    return v(x, y);
  }

  /** Lay out all 22 players for the current ball position/possession at time t. */
  function layout(): void {
    const att = possession;
    const def = other(att);
    const ballA = toTeamFrame(ball, att);
    const ballD = toTeamFrame(ball, def);

    for (const p of players) {
      p.drift = { x: p.drift.x * 0.9 + rng.normal(0, 0.6), y: p.drift.y * 0.9 + rng.normal(0, 0.6) };
    }

    // Defending team: shape + drift (team frame).
    const defTF = new Map<SimPlayer, Vec2>();
    for (const p of teamOf(def)) {
      const s = shapeTarget(p, ballD, false);
      defTF.set(p, p.isGK ? s : add(s, scale(p.drift, 0.7)));
    }

    // Attacking team: shape + drift, held onside (team frame).
    const defInAtt = [...defTF.values()].map((q) => PITCH_LENGTH - q.x).sort((a, b) => b - a);
    const offsideX = Math.max(defInAtt[1] ?? 52.5, ballA.x, PITCH_LENGTH / 2);
    const attTF = new Map<SimPlayer, Vec2>();
    for (const p of teamOf(att)) {
      if (p === carrier) {
        attTF.set(p, ballA);
        continue;
      }
      const s = add(shapeTarget(p, ballA, true), p.isGK ? v(0, 0) : p.drift);
      attTF.set(p, v(Math.min(s.x, offsideX - 0.3, PITCH_LENGTH - 2), s.y));
    }

    // Defending team reacts: mark nearby attackers goal-side, press the ball.
    const attInDef = [...attTF.entries()].filter(([p]) => !p.isGK).map(([, q]) => v(PITCH_LENGTH - q.x, PITCH_WIDTH - q.y));
    const ownGoal = v(0, PITCH_WIDTH / 2);
    const outfieldDef = teamOf(def).filter((p) => !p.isGK);
    const byBall = [...outfieldDef].sort((a, b) => dist(defTF.get(a)!, ballD) - dist(defTF.get(b)!, ballD));
    const pressers = new Set<SimPlayer>();
    const style = teams[def].style;
    const pressProb = ballD.x > 60 ? style.press : ballD.x > 35 ? 0.55 + style.press * 0.2 : 0.8;

    for (const p of outfieldDef) {
      const cur = defTF.get(p)!;
      let nearest: Vec2 | undefined;
      let nd = 12;
      for (const a of attInDef) {
        const d = dist(cur, a);
        if (d < nd) {
          nd = d;
          nearest = a;
        }
      }
      if (nearest) {
        const goalSide = add(nearest, scale(norm(sub(ownGoal, nearest)), 1.6));
        defTF.set(p, lerpV(cur, goalSide, cur.x < 20 ? 0.8 : cur.x < 35 ? 0.6 : 0.35));
      }
    }

    const first = byBall[0]!;
    const press1 = rng.chance(pressProb) ? rng.range(1.2, 3.5) : rng.range(4, 8);
    defTF.set(first, add(ballD, scale(norm(sub(ownGoal, ballD)), press1)));
    pressers.add(first);
    if (rng.chance(0.3 + style.press * 0.35) && byBall[1]) {
      const second = byBall[1];
      const cover = add(ballD, scale(norm(sub(defTF.get(second)!, ballD)), rng.range(4, 8)));
      defTF.set(second, cover);
      pressers.add(second);
    }

    // Commit positions + velocities in the absolute frame.
    const dtSec = Math.max(0.5, (t - lastLayoutT) / MS);
    lastLayoutT = t;
    const maxMove = MAX_RUN_SPEED * dtSec + 0.5;
    const commit = (p: SimPlayer, tf: Vec2, side: Side) => {
      p.prevPos = p.pos;
      let next = clampToPitch(toAbsolute(tf, side), 0.3);
      if (p !== carrier) {
        // Nobody teleports: cap how far a player gets towards their target since the last snapshot.
        const d = sub(next, p.pos);
        const l = Math.hypot(d.x, d.y);
        if (l > maxMove) next = add(p.pos, scale(d, maxMove / l));
      }
      p.pos = next;
      const raw = scale(sub(p.pos, p.prevPos), 1 / dtSec);
      const speed = Math.hypot(raw.x, raw.y);
      p.vel = speed > 8.5 ? scale(raw, 8.5 / speed) : raw;
    };
    for (const [p, tf] of defTF) commit(p, tf, def);
    for (const [p, tf] of attTF) commit(p, tf, att);
    carrier.pos = { ...ball };
  }

  /** Option context for the current carrier in the attacking frame. */
  function optionContext(): OptionContext {
    const att = possession;
    const toOP = (p: SimPlayer) => ({ id: p.info.id, pos: toTeamFrame(p.pos, att), isGK: p.isGK, finishing: p.info.attrs.finishing, tackling: p.info.attrs.tackling });
    const a = carrier.info.attrs;
    return {
      carrier: { ...toOP(carrier), passing: a.passing, dribbling: a.dribbling, pace: a.pace },
      teammates: teamOf(att).filter((p) => p !== carrier).map(toOP),
      opponents: teamOf(other(att)).map(toOP),
    };
  }

  function choose(options: ScoredOption[]): ScoredOption {
    const a = carrier.info.attrs;
    const style = teams[possession].style;
    const tau = 0.004 + 0.02 * (1 - a.decision);
    // Simulated players are more risk-averse than the pure-EV ghost engine: keeping the ball
    // has value and losing it hurts more than xT says. That gap is where "the pass was on!" moments live.
    const retain = 0.045 - style.directness * 0.02;
    const lossAversion = 2.5;
    const scores = options.map((o) => {
      let s =
        o.action === 'shot'
          ? o.expectedValue + 0.03 + a.shotBias * 0.03
          : o.pSuccess * (o.valueIfSuccess + retain) - (1 - o.pSuccess) * o.turnoverCost * lossAversion;
      if (o.action === 'pass' && (o.features.distance ?? 0) > 30) s += (style.directness - 0.5) * 0.01;
      if (o.action === 'pass' && o.end.x < 15) s -= 0.004; // reluctance to go all the way back
      return s;
    });
    const max = Math.max(...scores);
    return options[rng.weighted(scores.map((s) => Math.exp((s - max) / tau)))]!;
  }

  // ---- possession changes -----------------------------------------------------
  function turnover(newTeam: Side, newCarrier: SimPlayer, at: Vec2, context?: string, deadMs = 0) {
    possession = newTeam;
    carrier = newCarrier;
    ball = clampToPitch(at, 0.5);
    newCarrier.pos = { ...ball };
    emit({ type: 'possession_change', team: newTeam, player: newCarrier, start: ball, context });
    t += deadMs;
    restart = context;
  }

  function nearestOf(side: Side, to: Vec2, excludeGK = true): SimPlayer {
    let best = teamOf(side)[0]!;
    let bd = Infinity;
    for (const p of teamOf(side)) {
      if (excludeGK && p.isGK) continue;
      const d = dist(p.pos, to);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  function kickoff(side: Side) {
    possession = side;
    ball = v(PITCH_LENGTH / 2, PITCH_WIDTH / 2);
    for (const p of players) {
      const base = toAbsolute(p.base, p.team);
      // Everyone in their own half.
      p.pos = p.team === 'home' ? v(Math.min(base.x * 0.7, 51), base.y) : v(Math.max(PITCH_LENGTH - (PITCH_LENGTH - base.x) * 0.7, 54), base.y);
      p.prevPos = p.pos;
      p.vel = v(0, 0);
    }
    carrier = kickoffTaker(side);
    carrier.pos = { ...ball };
    emit({ type: 'kickoff', team: side, player: carrier, start: ball });
    lastLayoutT = t;
    restart = 'kickoff';
  }

  // ---- one on-ball action -----------------------------------------------------
  function step() {
    const att = possession;
    const def = other(att);

    if (pendingPenalty) {
      pendingPenalty = false;
      const taker = [...teamOf(att)].filter((p) => !p.isGK).sort((a, b) => b.info.attrs.finishing - a.info.attrs.finishing)[0]!;
      carrier = taker;
      ball = toAbsolute(v(PITCH_LENGTH - 11, PITCH_WIDTH / 2), att);
      layout();
      for (const p of players) {
        if (p.isGK || p === carrier) continue;
        const tf = toTeamFrame(p.pos, att);
        if (tf.x > PITCH_LENGTH - 17) p.pos = toAbsolute(v(PITCH_LENGTH - rng.range(17.5, 20), tf.y), att);
      }
      const keeper = gk(def);
      keeper.pos = toAbsolute(v(PITCH_LENGTH - 0.3, PITCH_WIDTH / 2), att);
      resolveShot(finishingAdjust(PENALTY_XG, taker.info.attrs.finishing), 'penalty');
      return;
    }

    // Time on the ball first, so the snapshot is taken at the moment of the action.
    const prePressure = pressureAt(ball, teamOf(def).map((p) => p.pos));
    const tempo = teams[att].style.tempo;
    const onBall = carrier.isGK ? rng.range(2, 5) : prePressure > 0.3 ? rng.range(0.6, 1.5) : rng.range(1.1, 3.2) * (1.3 - tempo * 0.6);
    t += onBall * MS;
    layout();
    const ctx = optionContext();

    // Pressure event from the nearest defender.
    const presser = nearestOf(def, carrier.pos);
    if (dist(presser.pos, carrier.pos) < 3.5 && rng.chance(0.35)) {
      emit({ type: 'pressure', team: def, player: presser, start: presser.pos, at: t - 300 });
    }

    const options = enumerateOptions(ctx);
    const pick = choose(options);
    const context = restart;
    restart = undefined;

    if (pick.action === 'pass') return resolvePass(pick, context);
    if (pick.action === 'carry') return resolveCarry(pick, context);
    return resolveShot(pick.pSuccess, context);
  }

  /**
   * Reactive defenders: while the ball travels, every defender reacts (after ~0.3 s) and runs at a
   * pace-based speed. A ground pass is cut out if a defender can reach its path before the ball gets
   * there; a lofted one only near the target. At the target the defender must beat the receiver to it.
   * The passer can also simply misplace it (longer passes, weaker passers).
   */
  function reactivePass(receiver: SimPlayer, startAbs: Vec2, endAbs: Vec2, endTF: Vec2, length: number, ballSpeed: number): { success: boolean; cut?: { p: SimPlayer; at: Vec2 } } {
    const T = length / ballSpeed;
    const accuracy = clamp(0.985 - length * 0.0035 * (1.3 - carrier.info.attrs.passing), 0.75, 0.99);
    if (!rng.chance(accuracy)) return { success: false };
    const lofted = length > 30;
    let best: { p: SimPlayer; at: Vec2; u: number } | undefined;
    for (const d of teamOf(other(possession))) {
      if (d.isGK && !inBox(endTF)) continue;
      const react = clamp(rng.normal(0.3, 0.08), 0.12, 0.55);
      const vmax = (6 + 1.8 * d.info.attrs.pace) * clamp(rng.normal(1, 0.06), 0.85, 1.15);
      const accel = accelFor(d.info.attrs.pace);
      const from = add(d.pos, scale(d.vel, Math.min(react, T)));
      // In flight (ground passes only) a defender can step into the lane; at the end it's a race with the receiver.
      for (const u of lofted ? [1] : LANE_SAMPLES) {
        if (best && u >= best.u) break;
        const at = lerpV(startAbs, endAbs, u);
        if (u < 1) {
          if (dist(from, at) <= runCover(u * T - react, vmax, accel) + REACH && rng.chance(CLEAN_CUT)) {
            best = { p: d, at, u };
            break;
          }
        } else {
          const receiverT = dist(add(receiver.pos, scale(receiver.vel, 0.2)), endAbs) / 7;
          const ballControlled = Math.max(T, receiverT);
          const defenderT = react + runTime(Math.max(0, dist(from, endAbs) - REACH), vmax, accel);
          if (defenderT < ballControlled - 0.2) best = { p: d, at: endAbs, u: 1 };
        }
      }
    }
    return best ? { success: false, cut: { p: best.p, at: best.at } } : { success: true };
  }

  function resolvePass(o: ScoredOption, context?: string, force?: boolean, reactive?: boolean) {
    const att = possession;
    const def = other(att);
    const receiver = byId.get(o.targetPlayerId!)!;
    const startTF = toTeamFrame(ball, att);
    const length = dist(startTF, o.end);
    const endTF = clampToPitch(add(o.end, v(rng.normal(0, 0.4 + length * 0.02), rng.normal(0, 0.4 + length * 0.02))), 0.5);
    const ballSpeed = clamp(10 + length * 0.28 + rng.normal(0, 1.5), 7, 30);
    const travelMs = (length / ballSpeed) * MS;
    const startAbs = { ...ball };
    const endAbs = toAbsolute(endTF, att);
    const r = reactive ? reactivePass(receiver, startAbs, endAbs, endTF, length, ballSpeed) : undefined;
    const success = r ? r.success : force ?? rng.chance(o.pSuccess);

    emit({ type: 'pass', team: att, player: carrier, start: startAbs, end: endAbs, target: receiver, outcome: success ? 'success' : 'fail', ballSpeed, context });

    if (success) {
      t += travelMs;
      ball = endAbs;
      carrier = receiver;
      return;
    }

    // Who wins it? The defender who got there (reactive), else the one most threatening the lane, else the one nearest the target.
    let interceptor: SimPlayer | undefined = r?.cut?.p;
    let interceptAt: Vec2 | undefined = r?.cut?.at;
    let bestThreat = 0.35;
    for (const p of interceptor ? [] : teamOf(def)) {
      const { d, u } = pointToSegment(p.pos, startAbs, endAbs);
      if (u <= 0.05 || u >= 0.95) continue;
      const threat = Math.exp(-((d / (1.2 + 0.05 * length * u)) ** 2));
      if (threat > bestThreat) {
        bestThreat = threat;
        interceptor = p;
        interceptAt = lerpV(startAbs, endAbs, u);
      }
    }
    const nearTouch = endTF.y < 2.5 || endTF.y > PITCH_WIDTH - 2.5 || endTF.x > PITCH_LENGTH - 1.5;
    if (!interceptor && (nearTouch || (length > 30 && rng.chance(0.3)))) {
      // Out of play.
      t += travelMs;
      if (endTF.x > PITCH_LENGTH - 1.5) {
        const keeper = gk(def);
        const gkSpot = toAbsolute(v(5.5, PITCH_WIDTH / 2 + rng.pick([-9, 9])), def);
        keeper.pos = gkSpot;
        turnover(def, keeper, gkSpot, 'goal_kick', rng.range(18, 32) * MS);
      } else {
        const outAt = toAbsolute(v(endTF.x, endTF.y < PITCH_WIDTH / 2 ? 0.5 : PITCH_WIDTH - 0.5), att);
        turnover(def, nearestOf(def, outAt), outAt, 'throw_in', rng.range(10, 22) * MS);
      }
      return;
    }
    if (!interceptor) {
      interceptor = nearestOf(def, endAbs, false);
      interceptAt = lerpV(endAbs, interceptor.pos, 0.3);
    }
    t += travelMs * 0.7;
    interceptor.pos = { ...interceptAt! };
    emit({ type: 'interception', team: def, player: interceptor, start: interceptAt!, outcome: 'success' });
    turnover(def, interceptor, interceptAt!);
  }

  function resolveCarry(o: ScoredOption, context?: string, force?: boolean) {
    const att = possession;
    const def = other(att);
    const startAbs = { ...ball };
    const endAbs = toAbsolute(o.end, att);
    const success = force ?? rng.chance(o.pSuccess);
    const speed = rng.range(4.5, 7);
    emit({ type: 'carry', team: att, player: carrier, start: startAbs, end: endAbs, outcome: success ? 'success' : 'fail', context });
    const length = dist(startAbs, endAbs);

    if (success) {
      t += (length / speed) * MS;
      ball = endAbs;
      carrier.pos = { ...ball };
      return;
    }

    const lossAt = lerpV(startAbs, endAbs, rng.range(0.2, 0.6));
    t += ((length * 0.4) / speed) * MS;
    const tackler = nearestOf(def, lossAt);
    tackler.pos = add(lossAt, v(rng.normal(0, 0.5), rng.normal(0, 0.5)));

    const inTheirBox = inBox(toTeamFrame(lossAt, att));
    if (rng.chance(inTheirBox ? 0.04 : 0.14)) {
      const penalty = inTheirBox;
      emit({ type: 'foul', team: def, player: tackler, start: lossAt, context: penalty ? 'penalty' : 'free_kick' });
      t += rng.range(18, 35) * MS;
      if (penalty) {
        t += rng.range(20, 40) * MS;
        pendingPenalty = true;
      } else {
        ball = lossAt;
        carrier.pos = { ...ball };
        restart = 'free_kick';
      }
      return;
    }

    emit({ type: 'tackle', team: def, player: tackler, start: lossAt, outcome: 'success' });
    turnover(def, tackler, lossAt);
  }

  function resolveShot(pGoal: number, context?: string) {
    lastShotXg = pGoal;
    const att = possession;
    const def = other(att);
    const shooter = carrier;
    const startAbs = { ...ball };
    const startTF = toTeamFrame(startAbs, att);
    const ballSpeed = clamp(rng.normal(context === 'penalty' ? 24 : 22, 4), 12, 34);
    const goalY = (spread: number) => v(PITCH_LENGTH, PITCH_WIDTH / 2 + rng.range(-spread, spread));
    const travelMs = (dist(startTF, v(PITCH_LENGTH, 34)) / ballSpeed) * MS;

    if (rng.chance(pGoal)) {
      score[att] += 1;
      emit({ type: 'shot', team: att, player: shooter, start: startAbs, end: toAbsolute(goalY(3.4), att), outcome: 'goal', ballSpeed, context });
      t += travelMs + rng.range(45, 75) * MS;
      kickoff(def);
      return;
    }

    const outfieldDef = teamOf(def).filter((p) => !p.isGK);
    const blockers = outfieldDef.filter((p) => {
      const tf = toTeamFrame(p.pos, att);
      return tf.x > startTF.x && pointToSegment(tf, startTF, v(PITCH_LENGTH, 34)).d < 1.6;
    });
    const isPen = context === 'penalty';
    const blocked = !isPen && blockers.length > 0 && rng.chance(Math.min(0.65, 0.2 + 0.2 * blockers.length));
    const outcome: Outcome = blocked ? 'blocked' : rng.chance(isPen ? 0.75 : 0.5) ? 'saved' : 'off_target';
    const keeper = gk(def);

    if (outcome === 'blocked') {
      const blocker = blockers[0]!;
      emit({ type: 'shot', team: att, player: shooter, start: startAbs, end: blocker.pos, outcome, ballSpeed, context });
      t += travelMs * 0.3;
      const r = rng.next();
      if (r < 0.5) turnover(def, blocker, blocker.pos);
      else if (r < 0.75) corner(att);
      else {
        ball = add(startAbs, toAbsolute(v(rng.range(-6, 2), rng.range(-5, 5)), 'home'));
        ball = clampToPitch(ball, 1);
        carrier = nearestOf(att, ball);
        restart = 'second_ball';
      }
      return;
    }

    // The pitch is drawn flat, so a non-goal must never end between the posts on the goal line:
    // a save stops where the keeper meets it, and a miss ends visibly wide.
    if (outcome === 'saved') {
      const aim = goalY(3.2);
      // Meet the keeper: the point on the shot's line nearest them, never closer to goal than SAVE_X.
      const k = toTeamFrame(keeper.pos, att);
      const dx = aim.x - startTF.x;
      const dy = aim.y - startTF.y;
      const uMax = clamp((SAVE_X - startTF.x) / Math.max(0.1, dx), 0, 1);
      const u = clamp(((k.x - startTF.x) * dx + (k.y - startTF.y) * dy) / Math.max(0.01, dx * dx + dy * dy), 0.5 * uMax, uMax);
      const caught = v(startTF.x + (aim.x - startTF.x) * u, startTF.y + (aim.y - startTF.y) * u);
      emit({ type: 'shot', team: att, player: shooter, start: startAbs, end: toAbsolute(caught, att), outcome, ballSpeed, context });
      t += travelMs;
      if (rng.chance(0.35)) corner(att);
      else turnover(def, keeper, keeper.pos, 'keeper_save', rng.range(4, 9) * MS);
      return;
    }

    const miss = rng.chance(0.5) ? goalY(9) : v(PITCH_LENGTH, 34 + rng.pick([-1, 1]) * rng.range(4, 8));
    const off = miss.y - PITCH_WIDTH / 2;
    if (Math.abs(off) < WIDE_Y) miss.y = PITCH_WIDTH / 2 + (off < 0 ? -1 : 1) * (WIDE_Y + Math.abs(off) / 2);
    emit({ type: 'shot', team: att, player: shooter, start: startAbs, end: toAbsolute(miss, att), outcome, ballSpeed, context });
    t += travelMs;
    const gkSpot = toAbsolute(v(5.5, PITCH_WIDTH / 2 + rng.pick([-9, 9])), def);
    keeper.pos = gkSpot;
    turnover(def, keeper, gkSpot, 'goal_kick', rng.range(20, 35) * MS);
  }

  function corner(side: Side) {
    possession = side;
    const y = rng.chance(0.5) ? 0.5 : PITCH_WIDTH - 0.5;
    ball = toAbsolute(v(PITCH_LENGTH - 0.5, y), side);
    const takers = teamOf(side).filter((p) => ['RW', 'LW', 'RM', 'LM', 'AM', 'CM', 'RB', 'LB'].includes(p.info.position));
    carrier = takers.sort((a, b) => b.info.attrs.passing - a.info.attrs.passing)[0] ?? nearestOf(side, ball);
    carrier.pos = { ...ball };
    t += rng.range(20, 35) * MS;
    restart = 'corner';
  }

  // ---- drivers ----------------------------------------------------------------
  function playMatch() {
    const firstKickoff: Side = rng.chance(0.5) ? 'home' : 'away';
    const stoppage = [rng.int(1, 3) * 60 * MS + rng.int(0, 50) * MS, rng.int(2, 6) * 60 * MS + rng.int(0, 50) * MS];
    kickoff(firstKickoff);
    for (let guard = 0; guard < 20000; guard++) {
      const periodEnd = periodStartT + halfLengthMs + stoppage[period - 1]!;
      if (t >= periodEnd) {
        if (period === 1) {
          emit({ type: 'half_time', team: possession, player: carrier, start: ball });
          period = 2;
          periodStartT = t + 1;
          t = periodStartT;
          kickoff(other(firstKickoff));
          continue;
        }
        emit({ type: 'full_time', team: possession, player: carrier, start: ball });
        break;
      }
      step();
    }
  }

  /** How the move ended, judged from events emitted since `from` (and the index of the ending event). */
  function endedBy(from: number): { outcome: BranchResult['outcome']; at: number } | undefined {
    for (let i = from; i < events.length; i++) {
      const e = events[i]!;
      if (e.type === 'shot') return { outcome: e.outcome === 'goal' ? 'goal' : 'shot', at: i };
      if (e.type === 'possession_change' || e.type === 'interception' || e.type === 'tackle') return { outcome: 'turnover', at: i };
      if (e.type === 'foul') return { outcome: 'foul', at: i };
    }
    return undefined;
  }

  /**
   * Play out a "what if": the carrier performs `first` straight from the initial state
   * (optionally guaranteed to come off), then the simulation runs on until the move ends.
   */
  function playBranch(first: ForcedAction, opts: BranchOptions = {}): BranchResult {
    const t0 = t;
    const startTeam = possession;
    const ctx = optionContext();
    const o =
      first.action === 'pass'
        ? evaluatePass(ctx, first.targetPlayerId, first.end)
        : first.action === 'carry'
          ? evaluateCarry(ctx, first.end)
          : evaluateShot(ctx);
    const firstAt = events.length;
    let mark = firstAt;
    if (o.action === 'pass') resolvePass(o, undefined, opts.forceSuccess, opts.reactive);
    else if (o.action === 'carry') resolveCarry(o, undefined, opts.forceSuccess);
    else resolveShot(o.pSuccess);
    const firstEvent = events[firstAt]!;
    const firstSuccess = firstEvent.type === 'shot' ? firstEvent.outcome === 'goal' : firstEvent.outcome === 'success';
    let ended = endedBy(mark);
    for (let i = 0; !ended && i < (opts.maxActions ?? 6) && t - t0 < (opts.maxMs ?? 15_000); i++) {
      if (possession !== startTeam) {
        ended = { outcome: 'turnover', at: events.length - 1 };
        break;
      }
      mark = events.length;
      step();
      ended = endedBy(mark);
    }
    const outcome = ended?.outcome ?? 'kept';
    const xG = outcome === 'goal' || outcome === 'shot' ? lastShotXg : 0;
    // Stop the story at the play that ended it (no celebrations, restarts or kick-offs).
    const out = ended ? events.slice(0, ended.at + 1) : [...events];
    const last = out[out.length - 1]!;
    // ...but keep the keeper or defender actually taking the ball, so the replay shows who won it.
    const taken = ended && events[ended.at + 1];
    if (taken && taken.type === 'possession_change' && (!taken.context || taken.context === 'keeper_save')) out.push(taken);
    const endEvent = ended ? events[ended.at]! : undefined;
    const shotFrom = endEvent?.type === 'shot' ? toAbsolute(endEvent.start, endEvent.team) : undefined;
    const lossAt = outcome === 'turnover' ? { ...ball } : undefined;

    // What the opponent does with it: a few more actions, counting any shot as a counter-attack.
    let counter: BranchResult['counter'];
    if (opts.counter && outcome === 'turnover') {
      counter = { shot: false, goal: false, xG: 0 };
      const tTurn = t;
      for (let i = 0; i < 5 && t - tTurn < 12_000 && possession !== startTeam; i++) {
        const before = events.length;
        step();
        const shot = events.slice(before).find((e) => e.type === 'shot' && e.team !== startTeam);
        if (shot) {
          counter = { shot: true, goal: shot.outcome === 'goal', xG: lastShotXg };
          break;
        }
      }
    }
    return { events: out, outcome, xG, endBall: { ...ball }, durationMs: last.t - t0, firstSuccess, ...(shotFrom ? { shotFrom } : {}), ...(lossAt ? { lossAt } : {}), ...(counter ? { counter } : {}) };
  }

  return { events, playMatch, playBranch };
}
